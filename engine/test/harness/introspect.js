/**
 * Layer-by-layer introspection — call eval sub-modules, quiescence, move
 * ordering, and single-depth search INDEPENDENTLY of the full search entry
 * point. No logging, no collectors threaded through — each function returns
 * a plain data structure you inspect directly.
 *
 * Debugging flow, bottom-up:
 *   1. legalMoves(fen)        — is the move you expect even legal? (catches fixture bugs)
 *   2. evalComponents(fen)    — does static eval see what you expect?
 *   3. evalLine(fen, [moves]) — play the line by hand; does material track correctly?
 *   4. traceQSearch(fen)      — does quiescence follow the capture chain?
 *   5. searchOnce(fen, depth) — one clean alpha-beta pass, no ID, no TT carryover
 *   6. ordering(fen)          — is the expected move ranked high?
 *
 * If step N looks right but N+1 is wrong, the bug is in layer N+1.
 */

import { Board } from '../../src/core/board.js';
import { generateAllLegalMoves, isInCheck } from '../../src/core/moveGeneration.js';
import { PIECES, WHITE_IDX, BLACK_IDX, DEFAULT_CONFIG, SCORE } from '../../src/core/constants.js';
import { Evaluator } from '../../src/evaluation/evaluate.js';
import { evaluateMaterial } from '../../src/evaluation/material.js';
import { evaluateCenterControl } from '../../src/evaluation/centerControl.js';
import { evaluateDevelopment } from '../../src/evaluation/development.js';
import { evaluatePawnStructure } from '../../src/evaluation/pawnStructure.js';
import { evaluateKingSafety } from '../../src/evaluation/kingSafety.js';
import { quiescenceSearch } from '../../src/search/quiescence.js';
import { MoveOrderer } from '../../src/search/moveOrdering.js';
import { SearchEngine } from '../../src/search/search.js';
import { DecisionCollector } from './DecisionCollector.js';

// ═════════════════════════════════════════════════════════════════════════════
// Layer 0: Position utilities
// ═════════════════════════════════════════════════════════════════════════════

/** List legal moves as algebraic strings. First line of defense against fixture typos. */
export function legalMoves(fen) {
  const board = Board.fromFen(fen);
  const color = board.gameState.activeColor;
  const moves = generateAllLegalMoves(board, color);
  return {
    fen, color, count: moves.length, inCheck: isInCheck(board, color),
    moves: moves.map(m => m.algebraic).sort(),
  };
}

/** Apply a move by algebraic string and return the resulting board. Throws if illegal. */
export function afterMove(fen, algebraic) {
  const board = Board.fromFen(fen);
  const moves = generateAllLegalMoves(board, board.gameState.activeColor);
  const m = moves.find(x => x.algebraic === algebraic);
  if (!m) {
    throw new Error(
      `${algebraic} is not legal in ${fen}\n` +
      `Legal: ${moves.map(x => x.algebraic).sort().join(' ')}`
    );
  }
  board.makeMove(m.fromSquare, m.toSquare, m.promotionPiece);
  return board;
}

// ═════════════════════════════════════════════════════════════════════════════
// Layer 1: Static evaluation — call sub-modules directly
// ═════════════════════════════════════════════════════════════════════════════

// Phase constants mirrored from evaluate.js so we can compute context
// without instantiating an Evaluator.
const PHASE_WEIGHTS = { [PIECES.KNIGHT]: 1, [PIECES.BISHOP]: 1, [PIECES.ROOK]: 2, [PIECES.QUEEN]: 4 };
const MAX_PHASE = 24;

function computePhase(board) {
  let p = 0;
  for (const pt of [PIECES.KNIGHT, PIECES.BISHOP, PIECES.ROOK, PIECES.QUEEN]) {
    p += (board.bbPieces[WHITE_IDX][pt].popCount() + board.bbPieces[BLACK_IDX][pt].popCount()) * PHASE_WEIGHTS[pt];
  }
  return p;
}

/**
 * Call each eval sub-module directly. Returns per-component scores plus
 * the context (phase, etc.) each was called with — so you can see both
 * WHAT a component returned and WHY (what inputs it saw).
 *
 * All scores are from `color`'s perspective (positive = good for `color`).
 */
export function evalComponents(fen, color = null, weights = {}) {
  const board = Board.fromFen(fen);
  color = color || board.gameState.activeColor;

  // Replicate the context Evaluator computes internally. If this drifts
  // from evaluate.js, the totals won't match — which is itself a useful
  // regression signal (add a test asserting they agree).
  const phase = computePhase(board);
  const gamePhase = Math.min(1, phase / MAX_PHASE);
  const endgameWeight = 1 - gamePhase;
  const moveCount = board.plyCount;

  const w = { material: 1, centerControl: 1, development: 1, pawnStructure: 1, kingSafety: 1, ...weights };

  // Direct sub-module calls. If one throws, you know exactly which
  // component is broken — no need to bisect through the orchestrator.
  const components = {
    material:      evaluateMaterial(board, color, w.material, gamePhase),
    centerControl: evaluateCenterControl(board, color, w.centerControl * (0.5 + 0.5 * gamePhase)),
    development:   evaluateDevelopment(board, color, moveCount, w.development),
    pawnStructure: evaluatePawnStructure(board, color, w.pawnStructure),
    kingSafety:    evaluateKingSafety(board, color, endgameWeight, w.kingSafety),
  };

  const total = Object.values(components).reduce((s, v) => s + v, 0);

  return {
    fen, color, total, components,
    context: { phase, gamePhase, endgameWeight, moveCount },
  };
}

/**
 * Eval the same position from both sides. A correct zero-sum evaluation
 * should give white.total ≈ −black.total. Non-zero `asymmetry` means
 * one of your sub-evaluators is not properly color-symmetric — a common
 * source of "engine plays well as white, badly as black" bugs.
 */
export function evalSymmetry(fen) {
  const white = evalComponents(fen, 'white');
  const black = evalComponents(fen, 'black');
  const asymmetry = white.total + black.total;

  // Per-component asymmetry — pinpoints WHICH sub-module is asymmetric.
  const componentAsymmetry = {};
  for (const k of Object.keys(white.components)) {
    componentAsymmetry[k] = white.components[k] + black.components[k];
  }

  return { white, black, asymmetry, componentAsymmetry };
}

/**
 * Play a sequence of moves and evaluate at each step, all from a FIXED
 * perspective so the numbers are directly comparable across plies.
 *
 * This is the tool for "I think Nxc7+ Kf8 Nxa8 wins a rook — does the
 * evaluator agree at each step?"
 *
 *   const line = evalLine(fen, ['d5c7', 'e8f8', 'c7a8']);
 *   // line[3].components.material should be ~+500 higher than line[0]
 */
export function evalLine(fen, moves, { perspective = null } = {}) {
  const board = Board.fromFen(fen);
  // Default: eval from the original mover's perspective throughout,
  // so a winning line shows monotonically increasing scores.
  const evalColor = perspective || board.gameState.activeColor;

  const steps = [];
  const record = (moveLabel) => {
    const ec = evalComponents(board.toFen(), evalColor);
    steps.push({
      ply: steps.length,
      move: moveLabel,
      toMove: board.gameState.activeColor,
      fen: board.toFen(),
      total: ec.total,
      components: ec.components,
    });
  };

  record(null);  // starting position

  for (const alg of moves) {
    const legal = generateAllLegalMoves(board, board.gameState.activeColor);
    const m = legal.find(x => x.algebraic === alg);
    if (!m) {
      throw new Error(
        `${alg} illegal at ply ${steps.length} (${board.toFen()})\n` +
        `Legal: ${legal.map(x => x.algebraic).sort().join(' ')}`
      );
    }
    board.makeMove(m.fromSquare, m.toSquare, m.promotionPiece);
    record(alg);
  }

  return steps;
}

/** Console-friendly table of an evalLine result. */
export function printEvalLine(steps) {
  console.table(steps.map(s => ({
    ply: s.ply,
    move: s.move ?? '(start)',
    toMove: s.toMove,
    material: s.components.material,
    center: s.components.centerControl,
    dev: s.components.development,
    pawns: s.components.pawnStructure,
    king: s.components.kingSafety,
    TOTAL: s.total,
  })));
}

// ═════════════════════════════════════════════════════════════════════════════
// Layer 2: Quiescence — trace the capture chain
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Run quiescence and record every eval call it makes. Since q-search
 * evaluates exactly once per node (for stand-pat), the sequence of eval
 * calls IS the sequence of nodes visited.
 *
 * We intercept via an evaluator wrapper — no modification to engine code.
 * Q-depth is recovered from board.plyCount (it increments with each
 * makeMove, so plyCount − startingPly = current q-depth).
 */
export function traceQSearch(fen, { maxQDepth = 8, config = {} } = {}) {
  const board = Board.fromFen(fen);
  const color = board.gameState.activeColor;
  const basePly = board.plyCount;

  const realEval = new Evaluator(config);
  const trace = [];

  // Wrapping evaluate() lets us observe q-search from the outside without
  // touching quiescence.js. Every stand-pat passes through here.
  const tracingEvaluator = {
    evaluate(b, c) {
      const r = realEval.evaluate(b, c);
      trace.push({
        qDepth: b.plyCount - basePly,   // recovered from undo-stack depth
        fen: b.toFen(),
        color: c,
        standPat: r.score,
        inCheck: isInCheck(b, c),
      });
      // r is Evaluator's shared _result object. Both we and q-search read
      // .score before the next evaluate() call, so the reuse is safe.
      return r;
    },
  };

  const score = quiescenceSearch(
    board, -SCORE.INFINITY, SCORE.INFINITY, color, tracingEvaluator, 0, maxQDepth
  );

  // Reconstruct the PV by following the deepest chain. Q-search is DFS,
  // so a node at depth d+1 immediately following a node at depth d is
  // the child that was explored from it. The first such chain reaching
  // max depth is (usually) the line that produced the returned score.
  const pv = [];
  let expectDepth = 0;
  for (const node of trace) {
    if (node.qDepth === expectDepth) {
      pv.push(node);
      expectDepth++;
    } else if (node.qDepth <= pv.length - 1) {
      // Backtrack — truncate pv to this depth and continue
      pv.length = node.qDepth;
      pv.push(node);
      expectDepth = node.qDepth + 1;
    }
  }

  return {
    score,
    nodesVisited: trace.length,
    maxDepthReached: Math.max(...trace.map(t => t.qDepth), 0),
    trace,
    pvLine: pv.map(n => ({ qDepth: n.qDepth, fen: n.fen, standPat: n.standPat })),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Layer 3: Move ordering — see the ranking and why
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Generate legal moves, run them through a fresh MoveOrderer, and return
 * the ranking. A fresh orderer means no killer/history state — you see
 * pure MVV-LVA / book / TT tier assignment.
 *
 * Pass `bookHints` to verify book integration without running a full search.
 */
export function ordering(fen, { bookHints = null, ttMove = 0, config = {} } = {}) {
  const board = Board.fromFen(fen);
  const color = board.gameState.activeColor;
  const moves = generateAllLegalMoves(board, color);

  const orderer = new MoveOrderer(config);
  orderer.orderMoves(moves, 0, board, color, ttMove, null, bookHints);

  return moves.map((m, i) => ({
    rank: i + 1,
    move: m.algebraic,
    orderScore: m.orderScore,
    // Tier label derived from which flag got set. Makes it easy to spot
    // "why is this capture ranked below that quiet move" at a glance.
    tier: m.isTTMove       ? 'TT'
        : m.isBookMove     ? 'BOOK'
        : m.isPromotion    ? 'PROMO'
        : m.capturedPiece !== null ? 'CAPTURE'
        : m.isKiller       ? 'KILLER'
        : m.isCounterMove  ? 'COUNTER'
        : m.orderScore > 0 ? 'HISTORY'
        : 'QUIET',
    capture: m.capturedPiece !== null ? m.capturedPiece : null,
  }));
}

// ═════════════════════════════════════════════════════════════════════════════
// Layer 4: Single-depth search — no iterative deepening, no TT carryover
// ═════════════════════════════════════════════════════════════════════════════

/**
 * One clean alpha-beta pass at exactly `depth`. Fresh engine every call,
 * so no TT poisoning from previous iterations or previous tests.
 *
 * Use this when you suspect iterative deepening or cross-iteration TT
 * state is confusing the picture. If searchOnce(fen, 4) gives the right
 * answer but searchPosition(fen, {depth:4}) doesn't, the bug is in the
 * ID loop or aspiration windows, not in alpha-beta itself.
 */
export function searchOnce(fen, depth, { config = {}, bookHints = null } = {}) {
  const board = Board.fromFen(fen);
  const engine = new SearchEngine({ ...DEFAULT_CONFIG, ...config });
  const collector = new DecisionCollector();

  // Bypass search() — set up the minimal state alphaBeta needs and call
  // it directly. This skips iterative deepening, aspiration windows, and
  // turn logging entirely.
  engine.resetSearchState();
  engine.searchColor = board.gameState.activeColor;
  engine._collector = collector;
  engine._bookHints = bookHints;
  engine._stageInfo = null;   // opening-principle adjustment skipped (null-safe in alphaBeta)

  const score = engine.alphaBeta(
    board, depth, -SCORE.INFINITY, SCORE.INFINITY, engine.searchColor, 0, null
  );

  const roots = collector.rootMoves.slice().sort((a, b) => b.score - a.score);

  return {
    score,
    bestMove: engine._rootBestMove?.algebraic ?? null,
    nodes: engine.nodes,
    rootMoves: roots,
    stats: engine.stats,
    // Sanity check: bestMove should match roots[0].move. If not, the
    // root-move recording and best-move selection have diverged.
    consistent: engine._rootBestMove?.algebraic === roots[0]?.move,
  };
}

/**
 * Run searchOnce at depths 1..maxDepth and tabulate. If scores oscillate
 * in sign between odd/even depths, you have a perspective bug somewhere
 * (like the ones we just fixed). If the best move changes wildly, move
 * ordering or eval is unstable.
 */
export function depthSweep(fen, maxDepth, config = {}) {
  const results = [];
  for (let d = 1; d <= maxDepth; d++) {
    const r = searchOnce(fen, d, { config });
    results.push({
      depth: d, bestMove: r.bestMove, score: r.score, nodes: r.nodes,
    });
  }
  return results;
}

// ═════════════════════════════════════════════════════════════════════════════
// Layer 5: Move expansion — see opponent replies to a specific move
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Make `moveAlgebraic`, then search the resulting position at `replyDepth`
 * to see how the opponent responds. Answers "if I play X, what does the
 * engine think black does, and what's the resulting score?"
 */
export function expandMove(fen, moveAlgebraic, replyDepth = 2, config = {}) {
  const childBoard = afterMove(fen, moveAlgebraic);
  const childFen = childBoard.toFen();

  // Score from the REPLYING side's perspective (negamax at the child node).
  // Negate to get the original mover's view.
  const reply = searchOnce(childFen, replyDepth, { config });

  return {
    move: moveAlgebraic,
    childFen,
    // Original mover's score = −(opponent's best score)
    scoreForMover: -reply.score,
    opponentBest: reply.bestMove,
    opponentReplies: reply.rootMoves.map(m => ({
      reply: m.move,
      opponentScore: m.score,       // opponent's perspective
      moverScore: -m.score,         // flipped to original mover's perspective
    })),
  };
}