/**
 * Test-scoped collector for search decisions.
 * Lives for one test, dies with the test. No global state, no file I/O.
 * Memory is bounded by test duration, not game duration.
 */
export class DecisionCollector {
  constructor() {
    this.rootMoves = [];          // [{ move, score, nodes, wasPruned }]
    this.cutoffs = [];            // [{ ply, move, type: 'beta'|'null'|'futility' }]
    this.orderingAtRoot = null;   // snapshot of move ordering at ply 0
    this.evalSamples = [];        // bounded — sample every Nth eval
    this.ttActivity = { hits: 0, stores: 0, cutoffs: 0 };
    this.nodeCount = 0;

    this._evalSampleRate = 100;
    this._evalCounter = 0;
  }

  // ── Hooks the search calls ──

  onRootMove(move, score, nodes) {
    this.rootMoves.push({ move: move.algebraic, score, nodes });
  }

  onMoveOrdering(ply, orderedMoves) {
    if (ply === 0 && !this.orderingAtRoot) {
      // Only snapshot root — inner plies would blow memory
      this.orderingAtRoot = orderedMoves.map(m => ({
        move: m.algebraic,
        orderScore: m.orderScore,
        isCapture: m.capturedPiece !== null,
        isBook: m.isBookMove || false,
        isTT: m.isTTMove || false,
        isKiller: m.isKiller || false,
      }));
    }
  }

  onCutoff(ply, move, type) {
    // Only record shallow cutoffs — deep ones are noise for analysis
    if (ply <= 3) {
      this.cutoffs.push({ ply, move: move?.algebraic ?? null, type });
    }
  }

  onEval(score, breakdown) {
    this._evalCounter++;
    if (this._evalCounter % this._evalSampleRate === 0) {
      this.evalSamples.push({ score, breakdown });
    }
  }

  onTTHit()    { this.ttActivity.hits++; }
  onTTStore()  { this.ttActivity.stores++; }
  onTTCutoff() { this.ttActivity.cutoffs++; }
  onNode()     { this.nodeCount++; }

  onIterationStart(depth) {
    // Fresh root-move list each iteration; we only care about the deepest
    // completed one. Ordering snapshot stays — it's only taken once at ply 0
    // of iteration 1 anyway.
    this.rootMoves.length = 0;
    this.currentDepth = depth;
  }

  // ── Analysis helpers for assertions ──

  bestMove() {
    return this.rootMoves.reduce((best, m) => m.score > best.score ? m : best, this.rootMoves[0]);
  }

  moveRank(algebraic) {
    const sorted = [...this.rootMoves].sort((a, b) => b.score - a.score);
    return sorted.findIndex(m => m.move === algebraic) + 1;  // 1-indexed, 0 if not found
  }

  scoreGap(moveA, moveB) {
    const a = this.rootMoves.find(m => m.move === moveA);
    const b = this.rootMoves.find(m => m.move === moveB);
    return (a && b) ? a.score - b.score : null;
  }

  wasOrderedFirst(algebraic) {
    return this.orderingAtRoot?.[0]?.move === algebraic;
  }

  cutoffRate() {
    return this.nodeCount > 0 ? this.cutoffs.length / this.nodeCount : 0;
  }
}