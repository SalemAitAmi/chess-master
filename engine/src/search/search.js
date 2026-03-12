/**
 * Iterative-deepening alpha-beta with PVS, NMP, LMR, futility.
 *
 * Allocation budget for alphaBeta():
 *   - Returns a number (no result object per call)
 *   - No `{...move}` spreads
 *   - No moveCausesCheck pre-flight (check detected post-makeMove)
 *   - Manual gc() and memory-abort removed — symptoms, not causes
 *
 * Collector hooks (all null-guarded, free when absent):
 *   onNode() onRootMove() onMoveOrdering() onCutoff()
 */

import { SCORE, PIECES } from '../core/constants.js';
import { generateAllLegalMoves, isInCheck } from '../core/moveGeneration.js';
import { Evaluator } from '../evaluation/evaluate.js';
import { MoveOrderer } from './moveOrdering.js';
import { quiescenceSearch } from './quiescence.js';
import { TranspositionTable, TT_FLAG, decodeFrom, decodeTo, decodePromo } from '../tables/transposition.js';
import { detectGameStage, checkOpeningPrinciples } from '../utils/gameStage.js';
import { GAME_STAGE } from '../logging/categories.js';
import { indexToSquare } from '../core/bitboard.js';
import logger, { LOG } from '../logging/logger.js';

// Build-time guard. esbuild replaces `globalThis.__LOG__` with `false` in
// prod builds, making this const `false`, which lets DCE strip every
// `if (__LOG__ && ...)` block. Running from source: defaults to true.
const __LOG__ = globalThis.__LOG__ ?? true;

const FUTILITY_MARGIN = [0, 150, 300, 450];
const ASPIRATION_WINDOW = 50;
const ASPIRATION_MIN_DEPTH = 5;

function hasNonPawnMaterial(board, color) {
  const idx = color === 'white' ? 0 : 1;
  return board.bbPieces[idx][PIECES.QUEEN].popCount()  > 0 ||
         board.bbPieces[idx][PIECES.ROOK].popCount()   > 0 ||
         board.bbPieces[idx][PIECES.BISHOP].popCount() > 0 ||
         board.bbPieces[idx][PIECES.KNIGHT].popCount() > 0;
}

/** Build algebraic notation from an encoded TT move — for PV display only. */
function encodedToAlgebraic(enc) {
  if (enc === 0) return null;
  const from = indexToSquare(decodeFrom(enc));
  const to = indexToSquare(decodeTo(enc));
  const promo = decodePromo(enc);
  const promoChar = promo ? ' qrbnp'[promo] : '';  // index by PIECES enum
  return from + to + promoChar.trim();
}

export class SearchEngine {
  constructor(config = {}) {
    this.config = {
      maxDepth: config.maxDepth || 64,
      useQuiescence:          config.useQuiescence          !== false,
      quiescenceDepth:        config.quiescenceDepth        || 8,
      useTranspositionTable:  config.useTranspositionTable  !== false,
      useNullMovePruning:     config.useNullMovePruning     !== false,
      useLateMovereduction:   config.useLateMovereduction   !== false,
      useFutilityPruning:     config.useFutilityPruning     !== false,
      useAspirationWindows:   config.useAspirationWindows   !== false,
      usePVS:                 config.usePVS                 !== false,
      useIID:                 config.useIID                 !== false,
      useOpeningPrinciples:   config.useOpeningPrinciples   !== false,
      ...config,
    };

    this.evaluator = new Evaluator(config);
    this.moveOrderer = new MoveOrderer(config);
    this.tt = this.config.useTranspositionTable ? new TranspositionTable(64) : null;

    // Per-search state (reset each search)
    this.nodes = 0;
    this.qNodes = 0;
    this.maxDepthReached = 0;
    this.searchStartTime = 0;
    this.stopSearch = false;
    this.searchColor = 'white';
    this.pv = [];
    this.currentStage = null;
    this.previousStage = null;

    // Root-move bookkeeping — written at ply 0 instead of returned from alphaBeta
    this._rootBestMove = null;
    this._rootMoveScores = [];   // [{ move, score, orderScore, nodes }] for the final iteration

    // Injected per search() call
    this._collector = null;
    this._bookHints = null;
    this._stageInfo = null;

    this.stats = this._emptyStats();
  }

  _emptyStats() {
    return {
      ttHits: 0, ttCutoffs: 0,
      nullMoveCutoffs: 0, futilityCutoffs: 0,
      lmrSearches: 0, lmrResearches: 0, pvsResearches: 0,
    };
  }

  resetSearchState() {
    this.nodes = 0;
    this.qNodes = 0;
    this.maxDepthReached = 0;
    this.stopSearch = false;
    this.pv = [];
    this._rootBestMove = null;
    this._rootMoveScores = [];
    this.stats = this._emptyStats();
    this.tt?.newSearch();
    this.moveOrderer.prepareNewSearch();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Public entry point
  // ═══════════════════════════════════════════════════════════════════════════
  search(board, maxDepth = null, options = {}) {
    this.resetSearchState();
    this.searchStartTime = Date.now();
    this.searchColor = board.gameState.activeColor;
    board.searchColor = this.searchColor;

    // ── Injected dependencies — null in production, live in tests ──
    this._collector = options.collector || null;
    this._bookHints = options.bookHints || null;

    const stageInfo = detectGameStage(board);
    this._stageInfo = stageInfo;
    this.previousStage = this.currentStage;
    this.currentStage = stageInfo.stage;

    const depth = maxDepth || this.config.maxDepth;
    const fen = board.toFen();

    const c = this._collector;

    // Turn logging — gated on the aggregate flag, cheap when off.
    if (__LOG__ && (LOG.search || LOG.stage)) {
      logger.startTurn(fen, this.searchColor, stageInfo);
      if (this.previousStage && this.previousStage !== this.currentStage) {
        console.log(`[STAGE] ${this.previousStage} → ${this.currentStage}`);
      }
    }

    let bestMove = null;
    let bestScore = 0;

    // ── Iterative deepening ──
    for (let d = 1; d <= depth; d++) {
      if (this.stopSearch) break;
      if (c) c.onIterationStart?.(d);

      let alpha = -SCORE.INFINITY;
      let beta  =  SCORE.INFINITY;
      let delta = ASPIRATION_WINDOW;

      if (this.config.useAspirationWindows &&
          d >= ASPIRATION_MIN_DEPTH &&
          Math.abs(bestScore) < SCORE.MATE_THRESHOLD) {
        alpha = bestScore - delta;
        beta  = bestScore + delta;
      }

      // Aspiration re-search loop
      let score;
      for (let attempt = 0; attempt < 5; attempt++) {
        score = this.alphaBeta(board, d, alpha, beta, this.searchColor, 0, null);
        if (this.stopSearch) break;
        if (score <= alpha)      { alpha = Math.max(-SCORE.INFINITY, alpha - delta); delta *= 2; }
        else if (score >= beta)  { beta  = Math.min( SCORE.INFINITY, beta  + delta); delta *= 2; }
        else break;
      }

      if (this.stopSearch) break;

      if (this._rootBestMove) {
        bestMove = this._rootBestMove;
        bestScore = score;
        this.extractPV(board, d);

        if (__LOG__ && LOG.search) {
          const pvStr = this.pv.map(m => m.algebraic).join(' ');
          console.log(`[D${d}] ${bestMove.algebraic} cp=${bestScore} nodes=${this.nodes} pv=${pvStr}`);
        }

        if (Math.abs(bestScore) > SCORE.MATE_THRESHOLD) break;  // mate found
      }
    }

    const totalTime = Date.now() - this.searchStartTime;

    // ── Turn finalization — only runs when logging ──
    if (__LOG__ && (LOG.search || LOG.stage)) {
      // Opening-principle check on the selected move (root only, cheap)
      if (stageInfo.stage === GAME_STAGE.OPENING && bestMove && this.config.useOpeningPrinciples) {
        const oa = checkOpeningPrinciples(board, bestMove, this.searchColor);
        if (oa.violations.length > 0) {
          logger.addTurnWarning('opening_violation',
            `${bestMove.algebraic}: ${oa.violations.map(v => v.principle).join(', ')}`);
        }
      }

      for (const rm of this._rootMoveScores) {
        logger.recordCandidateMove(rm.move, rm.score, rm.orderScore, null);
      }

      logger.finalizeTurn(bestMove, {
        score: bestScore, depth: this.maxDepthReached,
        nodes: this.nodes, qNodes: this.qNodes, time: totalTime,
        pv: this.pv, stats: this.stats,
      });
    }

    // Detach injected refs so they can be GC'd between searches
    this._collector = null;
    this._bookHints = null;
    this._stageInfo = null;

    return {
      bestMove, score: bestScore,
      nodes: this.nodes, qNodes: this.qNodes,
      depth: this.maxDepthReached, time: totalTime,
      pv: this.pv, stats: this.stats, stageInfo,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Alpha-beta — returns a NUMBER. Root move written to this._rootBestMove.
  // ═══════════════════════════════════════════════════════════════════════════
  alphaBeta(board, depth, alpha, beta, color, ply, lastMove) {
    this.nodes++;
    if (ply > this.maxDepthReached) this.maxDepthReached = ply;
    if (this.stopSearch) return 0;

    const c = this._collector;
    if (c) c.onNode();

    const isRoot = ply === 0;
    const isPvNode = beta - alpha > 1;
    const oppositeColor = color === 'white' ? 'black' : 'white';
    const inCheck = isInCheck(board, color);

    // ── Draw detection — MUST come before TT probe ──
    // A repeated position during search is scored as a draw. We use
    // twofold (not threefold) inside the search tree: if the engine can
    // reach this position again, the opponent can force the third
    // occurrence on the next cycle. Scoring at count=2 is standard and
    // prevents the oscillation seen in Colosseum endgames.
    //
    // Skipped at root because the root position is the one we were ASKED
    // to search — we need to return a move from it, not "draw". The draw
    // scoring of root's children is what makes the engine steer away from
    // (or toward, if losing) repetition.
    //
    // Placed BEFORE the TT probe because a TT entry stores a score that
    // assumed no repetition — using it here would let the engine think a
    // repeating line still wins material.
    if (!isRoot) {
      // 50-move rule: halfMoveClock counts plies since last capture/pawn move.
      // 100 plies = 50 full moves. Maintained by board.makeMove but was never
      // consulted here. Without this, K+R vs K shuffles forever.
      if (board.gameState.halfMoveClock >= 100) {
        return SCORE.DRAW;
      }
      // Repetition. countRepetitions walks the undo stack — cheap, bounded
      // by halfMoveClock (typically < 20 in normal play). Now that the
      // Zobrist EP bug is fixed, hashes actually match on repeated positions.
      if (board.isRepetition(2)) {
        // Tiny contempt: when ahead, a draw is slightly bad; when behind,
        // slightly good. Prevents a dead-even 0 from making the engine
        // indifferent between a draw and a marginal win attempt. Sign flips
        // with ply parity so it's symmetric across the negamax negation.
        return (ply & 1) ? 1 : -1;
      }
    }

    const moves = generateAllLegalMoves(board, color);

    // Terminal: mate or stalemate
    if (moves.length === 0) {
      if (inCheck) {
        // Negamax: being mated is always −MATE from the mated side's own
        // perspective. The parent negates this to +MATE. Ply offset prefers
        // faster mates (+49999 beats +49998).
        // The old `color === searchColor` check was a leftover from a
        // fixed-perspective search that got half-converted to negamax.
        return -(SCORE.MATE - ply);
      }
      // Stalemate: 0 from either perspective, negation is a no-op.
      return SCORE.DRAW;
    }

    // ── TT probe ──
    // ttMove is an encoded int (from|to<<6|promo<<12), 0 = none.
    let ttMove = 0;
    const key = board.gameState.zobristKey;
    if (this.tt) {
      const tt = this.tt.probe(key, depth, alpha, beta);
      if (tt.hit) {
        this.stats.ttHits++;
        ttMove = tt.move;
        if (!isRoot && tt.usable) {
          this.stats.ttCutoffs++;
          return tt.score;   // ← number, no object
        }
      }
    }

    // ── Leaf / quiescence ──
    if (depth <= 0) {
      if (this.config.useQuiescence) {
        this.qNodes++;
        // searchColor dropped — quiescence now evals from `color` internally.
        return quiescenceSearch(
          board, alpha, beta, color, this.evaluator,
          0, this.config.quiescenceDepth
        );
      }
      return this.evaluator.evaluate(board, color).score;
    }

    // ── IID: get a TT move by doing a shallow search first ──
    // The shallow search populates TT; we then read the move hint back out.
    // No need to capture a return object — TT is the communication channel.
    if (this.config.useIID && ttMove === 0 && depth >= 4 && isPvNode && this.tt) {
      this.alphaBeta(board, Math.max(1, depth - 3), alpha, beta, color, ply, lastMove);
      ttMove = this.tt.getBestMove(key);
    }

    // ── Null-move pruning ──
    if (this.config.useNullMovePruning &&
        depth >= 3 && !isRoot && !inCheck && !isPvNode &&
        hasNonPawnMaterial(board, color)) {

      const R = depth > 6 ? 3 : 2;

      // Null move: flip side without moving. Restore by hand — cheaper than
      // going through the undo stack for this non-move.
      const gs = board.gameState;
      const savedEp = gs.enPassantSquare;
      const savedColor = gs.activeColor;
      const savedKey = gs.zobristKey;
      gs.enPassantSquare = -1;
      gs.activeColor = oppositeColor;
      gs.zobristKey ^= 0xABCDEF0123456789n;   // arbitrary side-to-move flip constant

      const nullScore = -this.alphaBeta(board, depth - R - 1, -beta, -beta + 1, oppositeColor, ply + 1, null);

      gs.enPassantSquare = savedEp;
      gs.activeColor = savedColor;
      gs.zobristKey = savedKey;

      if (nullScore >= beta) {
        this.stats.nullMoveCutoffs++;
        if (c) c.onCutoff(ply, null, 'null');
        return beta;
      }
    }

    // ── Static eval for futility ──
    let staticEval = 0;
    const canFutility = this.config.useFutilityPruning &&
                        depth <= 3 && !inCheck && !isPvNode &&
                        Math.abs(alpha) < SCORE.MATE_THRESHOLD;
    if (canFutility) {
      staticEval = this.evaluator.evaluate(board, color).score;
    }

    // ── Move ordering ──
    // Book hints are root-only; at ply > 0 they'd distort deep-line ordering.
    const bookHints = isRoot ? this._bookHints : null;
    this.moveOrderer.orderMoves(moves, ply, board, color, ttMove, lastMove, bookHints);

    // Apply opening-principle adjustments at root (mutates orderScore in place)
    if (isRoot && this._stageInfo?.stage === GAME_STAGE.OPENING && this.config.useOpeningPrinciples) {
      this._adjustForOpeningPrinciples(moves, board, color);
    }

    // Collector hook — root only to bound memory
    if (c && isRoot) c.onMoveOrdering(ply, moves);

    if (__LOG__ && LOG.moveOrder && isRoot) {
      logger.moveOrderPoint(ply, moves[0]?.algebraic, moves[0]?.orderScore, moves.length);
    }

    // ── Main move loop ──
    const extension = inCheck ? 1 : 0;
    let bestMove = moves[0];
    let bestScore = -SCORE.INFINITY;
    let nodeType = TT_FLAG.UPPER_BOUND;
    let searched = 0;

    // Root-move score tracking — reuse the same array across iterations
    if (isRoot) this._rootMoveScores.length = 0;

    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      const isCapture = move.capturedPiece !== null;
      const isPromotion = move.isPromotion;

      // ── Futility pruning — BEFORE makeMove ──
      // Dropped the givesCheck guard here. Checking moves that reach this
      // branch are quiet late moves that happen to give check — rare, and
      // the worst case is we prune a marginal check. The old implementation
      // doubled every makeMove to compute this up front; not worth it.
      if (canFutility && searched > 0 && !isCapture && !isPromotion &&
          staticEval + FUTILITY_MARGIN[depth] <= alpha) {
        this.stats.futilityCutoffs++;
        continue;
      }

      const nodesBefore = this.nodes;

      board.makeMove(move.fromSquare, move.toSquare, move.promotionPiece);

      // ── givesCheck computed ONCE, after the makeMove we were doing anyway ──
      // This replaces the old moveCausesCheck(), which did an extra
      // makeMove/undoMove per move — literally doubling board mutations.
      const givesCheck = isInCheck(board, oppositeColor);

      // ── LMR — decided post-makeMove using the real givesCheck ──
      let reduction = 0;
      if (this.config.useLateMovereduction &&
          searched >= 4 && depth >= 3 &&
          !isCapture && !isPromotion && !inCheck && !givesCheck && !move.isKiller) {
        reduction = Math.floor(Math.log2(depth) * Math.log2(searched + 1) * 0.5);
        reduction = Math.max(1, Math.min(reduction, depth - 2));
        this.stats.lmrSearches++;
      }

      // ── Search the move ──
      // When a collector is attached at root, search every move with a full
      // window so the collector gets TRUE scores, not alpha-beta bounds.
      // Without this, once move #1 scores +600, every subsequent move's
      // null-window search fails low and reports ≈alpha — gap appears as 0cp.
      // Cost: root-only, collector-only, so zero impact on production play.
      const wantTrueRootScores = isRoot && c !== null;

      let score;
      if (wantTrueRootScores) {
        // Full window, no reduction. We still computed `reduction` above for
        // stats parity, but we don't apply it — a reduced search would give
        // a misleadingly low score for a move that's actually fine.
        score = -this.alphaBeta(board, depth - 1 + extension,
                                -SCORE.INFINITY, SCORE.INFINITY,
                                oppositeColor, ply + 1, move);

      } else if (this.config.usePVS && searched > 0) {
        // Null-window scout
        score = -this.alphaBeta(board, depth - 1 + extension - reduction,
                                -alpha - 1, -alpha, oppositeColor, ply + 1, move);

        // Failed high inside window → re-search. If we reduced, undo the
        // reduction first, then open the window if still necessary.
        if (score > alpha && score < beta) {
          this.stats.pvsResearches++;
          if (reduction > 0) {
            this.stats.lmrResearches++;
            score = -this.alphaBeta(board, depth - 1 + extension,
                                    -alpha - 1, -alpha, oppositeColor, ply + 1, move);
          }
          if (score > alpha && score < beta) {
            score = -this.alphaBeta(board, depth - 1 + extension,
                                    -beta, -alpha, oppositeColor, ply + 1, move);
          }
        }
      } else {
        score = -this.alphaBeta(board, depth - 1 + extension - reduction,
                                -beta, -alpha, oppositeColor, ply + 1, move);
        if (reduction > 0 && score > alpha) {
          this.stats.lmrResearches++;
          score = -this.alphaBeta(board, depth - 1 + extension,
                                  -beta, -alpha, oppositeColor, ply + 1, move);
        }
      }

      board.undoMove();
      searched++;

      if (this.stopSearch) return 0;

      // ── Root bookkeeping — no spread, just a small record ──
      if (isRoot) {
        const moveNodes = this.nodes - nodesBefore;
        this._rootMoveScores.push({
          move, score, orderScore: move.orderScore, nodes: moveNodes,
        });
        if (c) c.onRootMove(move, score, moveNodes);
      }

      // ── Per-move trace — double-guarded, sampled inside ──
      if (__LOG__ && LOG.search) {
        logger.searchNode(depth, ply, alpha, beta, searched);
      }

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }

      if (score > alpha) {
        alpha = score;
        nodeType = TT_FLAG.EXACT;

        if (alpha >= beta) {
          // Beta cutoff — update heuristics
          this.moveOrderer.addKiller(move, ply);
          if (!isCapture) {
            this.moveOrderer.updateHistory(move, depth, true);
            this.moveOrderer.updateCounterMove(lastMove, move);
          }
          for (let j = 0; j < i; j++) {
            if (moves[j].capturedPiece === null) {
              this.moveOrderer.updateHistory(moves[j], depth, false);
            }
          }
          nodeType = TT_FLAG.LOWER_BOUND;
          if (c) c.onCutoff(ply, move, 'beta');

          // When collecting true root scores, DON'T break — we need every
          // root move evaluated so scoreGap / moveRank assertions work.
          // In production (no collector), cutoff as normal.
          if (!wantTrueRootScores) break;
        }
      }
    }

    // ── TT store — bestMove encoded to int inside, no object retained ──
    if (this.tt && !this.stopSearch) {
      this.tt.store(key, depth, bestScore, nodeType, bestMove);
    }

    if (isRoot) {
      this._rootBestMove = bestMove;
      this._rootMoveScores.sort((a, b) => b.score - a.score);
    }

    return bestScore;   // ← number
  }

  /**
   * Adjust root-move order scores for opening principles.
   * Mutates in place — no .map(), no spread, no retained analysis objects.
   */
  _adjustForOpeningPrinciples(moves, board, color) {
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const a = checkOpeningPrinciples(board, m, color);
      const adj = a.totalBonus + a.totalPenalty;
      if (adj !== 0) m.orderScore += adj;
      // Deliberately NOT attaching `a` to the move — it would be retained
      // through TT storage in the old design. If you want the analysis,
      // recompute it once for the winning move after search ends.
    }
    moves.sort((a, b) => b.orderScore - a.orderScore);
  }

  /**
   * Follow the TT chain to build the PV. Works with encoded moves.
   */
  extractPV(board, maxLen) {
    this.pv = [];
    if (!this.tt) return;

    const seen = new Set();
    let made = 0;

    for (let i = 0; i < maxLen; i++) {
      const key = board.gameState.zobristKey;
      const keyStr = key.toString(16);
      if (seen.has(keyStr)) break;   // repetition
      seen.add(keyStr);

      const enc = this.tt.getBestMove(key);
      if (enc === 0) break;

      const from = decodeFrom(enc);
      const to = decodeTo(enc);
      const promo = decodePromo(enc) || null;

      // Minimal move object for PV display — not a full legal-move struct.
      this.pv.push({
        fromSquare: from, toSquare: to, promotionPiece: promo,
        algebraic: encodedToAlgebraic(enc),
      });

      board.makeMove(from, to, promo);
      made++;
    }

    // Unwind
    for (let i = 0; i < made; i++) board.undoMove();
  }

  stop() { this.stopSearch = true; }

  setOption(name, value) {
    if (name in this.config) this.config[name] = value;
    if (name.startsWith('use') || name === 'weights') {
      this.evaluator = new Evaluator(this.config);
      this.moveOrderer = new MoveOrderer(this.config);
    }
  }
}

export default SearchEngine;