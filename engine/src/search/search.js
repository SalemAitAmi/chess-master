/**
 * Iterative-deepening alpha-beta with PVS, TT, null move, LMR, futility,
 * IID, aspiration windows and quiescence.
 *
 * SMP. `options.smp` makes this engine one thread of a Lazy SMP search (see
 * smpCoordinator.js):
 *   role 'main'    the UCI thread; reads helper progress through `monitor` and
 *                  stops early once a helper has completed the target depth.
 *   role 'helper'  runs in a worker; publishes progress to its status slot,
 *                  stops when STOP_ID reaches its search id, and skips depths
 *                  by thread index for diversity.
 * Both roles use a SharedTranspositionTable installed with attachTable(). With
 * options.smp null, behaviour is exactly the single-threaded engine.
 *
 * TABLE OWNERSHIP. A local table is claimed in the process registry under
 * `ownerId`; attachTable() refuses a table owned by anyone else.
 */
import { SCORE, PIECES, PIECE_VALUES, PIECE_CHARS } from '../core/constants.js';
import { DEFAULT_CONFIG } from '../config/index.js';
import { generateMoves, listForPly, freshList, isInCheck } from '../core/moveGeneration.js';
import { Evaluator } from '../evaluation/evaluate.js';
import { MoveOrderer, pickMove } from './moveOrdering.js';
import { quiescenceSearch } from './quiescence.js';
import { SEE_EQUAL_BAND } from './see.js';
import {
  TranspositionTable, TT_FLAG, decodeFrom, decodeTo, decodePromo,
  encodeMove, encodedMatches, claimTable, releaseTable,
} from '../tables/transposition.js';
import { CTRL, SLOT, SLOT_STATE, UNIT_FLAG, raiseSharedAlpha } from './lazySMP.js';
import { SIDE_KEYS, EN_PASSANT_KEYS, getEnPassantZobristIndex } from '../tables/zobrist.js';
import { detectGameStage, checkOpeningPrinciples, GAME_STAGE } from '../utils/gameStage.js';
import { indexToSquare } from '../core/bitboard.js';
import logger, { LOG, CAT } from '../logging/logger.js';
// ═══════════════════════════════════════════════════════════════════════════
// Module constants
// ═══════════════════════════════════════════════════════════════════════════
const __LOG__ = globalThis.__LOG__ ?? true;
const FUTILITY_MARGIN = [0, 150, 300, 450];
const ASPIRATION_WINDOW = 50;
const ASPIRATION_MIN_DEPTH = 5;
const ASPIRATION_MAX_ATTEMPTS = 5;
const NODE_CHECK_INTERVAL = 2048;
const MAX_CHECK_EXTENSION_PLIES = 16;
const HEARTBEAT_NODES = 1 << 21;
const PROMO_SUFFIX = ['', 'q', 'r', 'b', 'n'];
const SIDE_FLIP_KEY = SIDE_KEYS[0] ^ SIDE_KEYS[1];
const EP_NONE_KEY = EN_PASSANT_KEYS[16];
const ROOT_VERIFY_LIMIT = 6;
const DEFAULT_HASH_MB = 64;
const ROOT_SCORE_DUMP = 8;
/** Lazy SMP depth skipping (Stockfish 8 tables). Helper k uses row (k-1) % 20. */
const SKIP_SIZE  = [1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4];
const SKIP_PHASE = [0, 1, 0, 1, 2, 3, 0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5, 6, 7];
/** Dedicated slot for PV legality checks (PV extraction never nests). */
const PV_SLOT = freshList();
// ═══════════════════════════════════════════════════════════════════════════
// Pure helpers
// ═══════════════════════════════════════════════════════════════════════════
function scoreToTT(score, ply) {
  if (score >  SCORE.MATE_THRESHOLD) return score + ply;
  if (score < -SCORE.MATE_THRESHOLD) return score - ply;
  return score;
}
function scoreFromTT(score, ply) {
  if (score >  SCORE.MATE_THRESHOLD) return score - ply;
  if (score < -SCORE.MATE_THRESHOLD) return score + ply;
  return score;
}
function quickMaterialBalance(board, color) {
  const usIdx = color === 'white' ? 0 : 1;
  const themIdx = usIdx ^ 1;
  let balance = 0;
  for (let p = PIECES.QUEEN; p <= PIECES.PAWN; p++) {
    balance += (board.bbPieces[usIdx][p].popCount() -
                board.bbPieces[themIdx][p].popCount()) * PIECE_VALUES[p];
  }
  return balance;
}
function hasNonPawnMaterial(board, color) {
  const idx = color === 'white' ? 0 : 1;
  const bb = board.bbPieces[idx];
  return bb[PIECES.QUEEN].popCount()  > 0 || bb[PIECES.ROOK].popCount()   > 0 ||
         bb[PIECES.BISHOP].popCount() > 0 || bb[PIECES.KNIGHT].popCount() > 0;
}
function encodedToAlgebraic(enc) {
  if (enc === 0) return null;
  return indexToSquare(decodeFrom(enc)) + indexToSquare(decodeTo(enc)) + PROMO_SUFFIX[decodePromo(enc)];
}
function nodeFlag(bestScore, alphaOrig, beta) {
  if (bestScore <= alphaOrig) return TT_FLAG.UPPER_BOUND;
  if (bestScore >= beta) return TT_FLAG.LOWER_BOUND;
  return TT_FLAG.EXACT;
}
function heaviestBookMove(hints) {
  if (!hints || hints.size === 0) return null;
  let best = null, bw = -1;
  for (const [m, w] of hints) {
    if (w > bw) { bw = w; best = m; }
  }
  return best;
}
function applyRootBias(moves, bias) {
  if (bias === null) return;
  for (let i = 0; i < moves.length; i++) {
    const b = bias.get(moves[i].algebraic);
    if (b !== undefined) moves[i].orderScore += b;
  }
}
function tensionRank(m) {
  if (m.capturedPiece === null) return 2;
  if (m.seeScore > SEE_EQUAL_BAND) return 3;
  if (m.piece === m.capturedPiece &&
      (m.piece === PIECES.QUEEN || m.piece === PIECES.ROOK)) return 0;
  return 1;
}
/** Depth 1 and the target depth are never skipped: every helper reports `target`. */
function skipDepth(threadIndex, d, target) {
  if (threadIndex <= 0 || d <= 1 || d >= target) return false;
  const i = (threadIndex - 1) % 20;
  return (((d + SKIP_PHASE[i]) / SKIP_SIZE[i]) | 0) % 2 === 1;
}
// ═══════════════════════════════════════════════════════════════════════════
export class SearchEngine {
  /**
   * @param {object} config
   * @param {object} [opts]  { ownerId, table }  `table` attaches an existing
   *                         (shared) table instead of allocating a local one.
   */
  constructor(config, opts) {
    const c = config || {};
    const o = opts || {};
    this.config = { ...DEFAULT_CONFIG, ...(c || {}) };
    this.configHash = null;      // set by the owning handler; stamped on turn records
    this.ownerId = o.ownerId ?? null;
    // ── Long-lived components (private to this engine instance) ──
    this.evaluator   = new Evaluator(this.config);
    this.moveOrderer = new MoveOrderer(this.config);
    this.tt = null;
    this._ownsTable = false;
    if (o.table) this.attachTable(o.table);
    else if (this.config.useTranspositionTable) this._allocLocalTable();
    this._ttProbe = { move: 0, cutoff: false, score: 0 };
    // ── Per-search transient state ──
    this.nodes = 0; this.qNodes = 0; this.maxDepthReached = 0;
    this.searchStartTime = 0; this.stopSearch = false;
    this.searchColor = 'white'; this.pv = [];
    this._rootBestMove = null;
    this._rootMoveScores = [];
    this._rootScores = [];
    this._rootMoveExact = false;
    this._rootBias = null;
    this._collector = null; this._bookHints = null; this._bookPick = null; this._stageInfo = null;
    this._pvKeys = [];
    // ── Deadline enforcement ──
    this._deadline = 0;
    this._nextClockCheck = 0;
    this._nextHeartbeat = 0;
    this._currentDepth = 0;
    this._maxExtPly = 0;
    this._abortedMs = 0;
    this._abortReason = null;
    // ── SMP ──
    this._smp = null;
    this._deferTurnLog = false;
    this._deferredTurn = null;
    this._targetDepth = 0;
    this._aspDelta = ASPIRATION_WINDOW;
    this._skipIndex = 0;
    this._rootFilter = null;      // root-split: Set<algebraic> this thread owns
    this._rootInCheck = false;    // pv-split: root check extension for units
    this.unitScore = 0;           // pv-split: last unit result (read immediately)
    this.unitFlag = 0;
    // ── Instrumentation ──
    this._completedDepth = 0;
    this._iterBest = null;
    this._firstSeenMs = 0;
    this._firstSeenDepth = 0;
    this._rootChanges = 0;
    this._staticRoot = 0;
    this._rootN = 0;
    this._rootCaps = 0;
    this.stats = this._emptyStats();
  }
  // ═══════════════════════════════════════════════════════════════════════
  // Transposition table ownership
  // ═══════════════════════════════════════════════════════════════════════
  _allocLocalTable() {
    const tt = new TranspositionTable(this.config.hashSizeMB);
    tt.owner = this.ownerId;
    if (this.ownerId !== null) claimTable(tt.serial, this.ownerId);
    this.tt = tt;
    this._ownsTable = true;
  }
  _releaseTable() {
    if (this.tt !== null && this._ownsTable && this.ownerId !== null) releaseTable(this.tt.serial, this.ownerId);
    this.tt = null;
    this._ownsTable = false;
  }
  /** Install a table this engine does not own (the instance's shared SMP table). */
  attachTable(table) {
    if (table.owner !== null && table.owner !== undefined &&
        this.ownerId !== null && table.owner !== this.ownerId) {
      throw new Error(`${table.id} is owned by ${table.owner}; refusing to attach it to ${this.ownerId}`);
    }
    this._releaseTable();
    this.tt = table;
    this._ownsTable = false;
  }
  /** Back to a fresh private table (or none, if the TT is disabled). */
  useLocalTable() {
    this._releaseTable();
    if (this.config.useTranspositionTable) this._allocLocalTable();
  }
  tableId() { return this.tt === null ? 'none' : this.tt.id; }
  dispose() { this._releaseTable(); }
  // ═══════════════════════════════════════════════════════════════════════
  // Lifecycle / configuration
  // ═══════════════════════════════════════════════════════════════════════
  _emptyStats() {
    return { ttHits: 0, ttCutoffs: 0, nullMoveCutoffs: 0, futilityCutoffs: 0,
             lmrSearches: 0, lmrResearches: 0, pvsResearches: 0, seePrunes: 0,
             repetitionAvoided: 0, rootVerified: 0,
             cutoffs: 0, firstMoveCutoffs: 0, aspLow: 0, aspHigh: 0, pvRejected: 0 };
  }
  resetSearchState() {
    this.nodes = 0; this.qNodes = 0; this.maxDepthReached = 0;
    this.stopSearch = false; this.pv = [];
    this._rootBestMove = null;
    this._rootMoveScores.length = 0;
    this._rootScores.length = 0;
    this._rootMoveExact = false;
    this._bookPick = null;
    this._deadline = 0;
    this._nextClockCheck = NODE_CHECK_INTERVAL;
    this._nextHeartbeat = HEARTBEAT_NODES;
    this._currentDepth = 0;
    this._maxExtPly = MAX_CHECK_EXTENSION_PLIES;
    this._abortedMs = 0;
    this._abortReason = null;
    this._completedDepth = 0;
    this._iterBest = null;
    this._firstSeenMs = 0;
    this._firstSeenDepth = 0;
    this._rootChanges = 0;
    this._staticRoot = 0;
    this._rootN = 0;
    this._rootCaps = 0;
    this.stats = this._emptyStats();
    if (this.tt !== null) this.tt.newSearch();
    this.moveOrderer.prepareNewSearch();
  }

  stop() { this.stopSearch = true; }

  /**
   * Adopt a new config (from ConfigState). Evaluator and orderer are rebuilt;
   * a PRIVATE table is reallocated only when its size or enablement changed.
   * A shared SMP table belongs to its coordinator, which resizes it on the next go.
   */
  reconfigure(config) {
    const prev = this.config;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.evaluator = new Evaluator(this.config);
    this.moveOrderer = new MoveOrderer(this.config);
    const ttChanged = prev.hashSizeMB !== this.config.hashSizeMB ||
                      prev.useTranspositionTable !== this.config.useTranspositionTable;
    if (ttChanged && (this.tt === null || this._ownsTable)) this.useLocalTable();
  }
  // ═══════════════════════════════════════════════════════════════════════
  // Contempt
  // ═══════════════════════════════════════════════════════════════════════
  _drawContempt(board, ply) {
    const balance = quickMaterialBalance(board, this.searchColor);
    const absBalance = Math.abs(balance);
    const cap = this.config.drawContemptMax;
    const neutral = this.config.neutralContempt;
    const absContempt = absBalance > 50
      ? Math.min(cap, Math.max(neutral, Math.floor(absBalance / 10)))
      : neutral;
    const fromSearchPOV = balance > 50 ? -absContempt
                        : balance < -50 ? absContempt
                        : -neutral;
    return (ply & 1) ? -fromSearchPOV : fromSearchPOV;
  }
  _repetitionScore(board, ply) {
    const balance = quickMaterialBalance(board, this.searchColor);
    const floor = this.config.repetitionContempt;
    const cap = this.config.drawContemptMax + floor;
    const mag = Math.min(cap, Math.max(floor, (Math.abs(balance) / 8) | 0));
    const fromSearchPOV = balance >= 0 ? -mag : mag;
    return (ply & 1) ? -fromSearchPOV : fromSearchPOV;
  }
  // ═══════════════════════════════════════════════════════════════════════
  // Search driver
  // ═══════════════════════════════════════════════════════════════════════
  /**
   *   options.collector    test introspection hook
   *   options.bookHints    Map<algebraic, weight> or null
   *   options.rootBias     Map<algebraic, bonus>  or null
   *   options.smp          SMP thread context (see header) or null
   *   options.deferTurnLog build the `turn` record but hand it back in
   *                        result.turnRecord instead of writing it
   */
  search(board, maxDepth, options) {
    const o = options || null;
    const depth     = maxDepth || this.config.maxDepth;
    const collector = (o && o.collector) || null;
    const bookHints = (o && o.bookHints) || null;
    const rootBias  = (o && o.rootBias)  || null;
    const smp       = (o && o.smp)       || null;
    const defer     = !!(o && o.deferTurnLog);
    const rootMoves = (o && o.rootMoves) || null;
    this._prepare(board, depth, collector, bookHints, rootBias, smp, defer, rootMoves);
    const score = this._iterativeDeepening(board, depth, collector);
    return this._finish(board, score);
  }
  _prepare(board, maxDepth, collector, bookHints, rootBias, smp, deferTurnLog, rootFilter) {
    this.resetSearchState();
    this.searchStartTime = Date.now();
    this._deadline = this.searchStartTime + this.config.maxSearchTime;
    this._nextClockCheck = NODE_CHECK_INTERVAL;
    this._nextHeartbeat = HEARTBEAT_NODES;
    this.searchColor = board.gameState.activeColor;
    this._collector = collector;
    this._bookHints = bookHints;
    this._bookPick = heaviestBookMove(bookHints);
    this._rootBias = rootBias;
    this._smp = smp;
    this._deferTurnLog = deferTurnLog;
    this._deferredTurn = null;
    this._targetDepth = maxDepth;
    this._aspDelta = smp !== null && smp.aspDelta > 0 ? smp.aspDelta : ASPIRATION_WINDOW;
    this._rootFilter = (rootFilter instanceof Set && rootFilter.size > 0) ? rootFilter : null;
    this._skipIndex = smp !== null && smp.role === 'helper' && smp.skip === true ? (smp.threadIndex | 0) : 0;
    if (smp !== null && smp.role === 'helper') this._smpBeginHelper();
    this._stageInfo = this._detectStage(board);
    this._staticRoot = this.evaluator.evaluate(board, this.searchColor).score;
    if (__LOG__ && LOG.any) logger.lockTurn(board);
    if (__LOG__ && LOG.time) {
      logger.event(CAT.TIME, 'search-start', {
        color: this.searchColor, maxDepth, maxMs: this.config.maxSearchTime,
        role: smp !== null ? smp.role : 'single',
      });
    }
    if (__LOG__ && LOG.stage && this._stageInfo !== null) {
      logger.event(CAT.STAGE, 'detect', {
        stage: this._stageInfo.stage, phase: this._stageInfo.phasePercent,
      });
    }
  }
  _detectStage(board) {
    const want = this.config.useOpeningPrinciples || (__LOG__ && LOG.stage);
    return want ? detectGameStage(board) : null;
  }
  _iterativeDeepening(board, depth, collector) {
    let score = 0, lastIterMs = 0;
    for (let d = 1; d <= depth; d++) {
      if (this.stopSearch) break;
      if (this._smp !== null && this._smpStopRequested(Date.now())) break;
      if (this._skipIndex > 0 && skipDepth(this._skipIndex, d, depth)) continue;
      if (d > 1 && this._outOfTime(lastIterMs)) break;
      this._currentDepth = d;
      this._maxExtPly = d + MAX_CHECK_EXTENSION_PLIES;
      const t0 = Date.now();
      if (collector !== null) collector.onIterationStart(d);
      const iterScore = this._searchIteration(board, d, score);
      if (this.stopSearch) break;
      lastIterMs = Date.now() - t0;
      score = iterScore;
      if (this._rootBestMove !== null) {
        this._snapshotRootScores();
        this.extractPV(board, d);
        const alg = this._rootBestMove.algebraic;
        const changed = alg !== this._iterBest;
        if (changed) {
          if (this._iterBest !== null) this._rootChanges++;
          this._iterBest = alg;
          this._firstSeenMs = Date.now() - this.searchStartTime;
          this._firstSeenDepth = d;
        }
        this._completedDepth = d;
        if (this._smp !== null) this._smpIteration(d, score, changed);
        this._logIteration(d, score, lastIterMs, changed);
        if (Math.abs(score) > SCORE.MATE_THRESHOLD) break;
      }
    }
    return score;
  }
  _outOfTime(lastIterMs) {
    const elapsed = Date.now() - this.searchStartTime;
    if (elapsed + lastIterMs * 3 <= this.config.maxSearchTime) return false;
    if (__LOG__ && LOG.time) {
      logger.event(CAT.TIME, 'budget-stop', { elapsed, lastIterMs, predicted: lastIterMs * 3 });
    }
    return true;
  }
  _logIteration(d, score, ms, changed) {
    if (__LOG__ && LOG.search) {
      logger.event(CAT.SEARCH, 'iteration', {
        d, best: this._rootBestMove.algebraic, cp: score,
        changed: changed ? 1 : 0, seldepth: this.maxDepthReached,
        nodes: this.nodes, qnodes: this.qNodes, ms,
      });
    }
    if (__LOG__ && LOG.pv) {
      logger.event(CAT.PV, 'line', { d, pv: this.pv.map(m => m.algebraic).join(' ') });
    }
    if (__LOG__ && LOG.time) {
      logger.event(CAT.TIME, 'iteration', {
        d, ms, totalMs: Date.now() - this.searchStartTime,
        nodes: this.nodes, qnodes: this.qNodes,
      });
    }
  }
  _searchIteration(board, depth, prevScore) {
    let alpha = -SCORE.INFINITY, beta = SCORE.INFINITY, delta = this._aspDelta;
    if (this.config.useAspirationWindows && depth >= ASPIRATION_MIN_DEPTH &&
        Math.abs(prevScore) < SCORE.MATE_THRESHOLD) {
      alpha = prevScore - delta;
      beta  = prevScore + delta;
    }
    for (let attempt = 0; attempt < ASPIRATION_MAX_ATTEMPTS; attempt++) {
      const score = this.alphaBeta(board, depth, alpha, beta, this.searchColor, 0, null);
      if (this.stopSearch) return score;
      if (score <= alpha)     { this.stats.aspLow++;  alpha = Math.max(-SCORE.INFINITY, alpha - delta); delta *= 2; }
      else if (score >= beta) { this.stats.aspHigh++; beta  = Math.min( SCORE.INFINITY, beta  + delta); delta *= 2; }
      else return score;
    }
    return this.alphaBeta(board, depth, -SCORE.INFINITY, SCORE.INFINITY, this.searchColor, 0, null);
  }
  _snapshotRootScores() {
    const dst = this._rootScores;
    dst.length = 0;
    for (let i = 0; i < this._rootMoveScores.length; i++) dst.push(this._rootMoveScores[i]);
    dst.sort((a, b) => b.score - a.score);
  }
  _rootScoresLite() {
    const src = this._rootScores;
    const out = new Array(src.length);
    for (let i = 0; i < src.length; i++) {
      out[i] = { alg: src[i].move.algebraic, score: src[i].score, exact: src[i].exact };
    }
    return out;
  }
  _finish(board, score) {
    this._verifyRootCandidates(board);
    const chosen = this._chooseRootMove(board);
    let bestMove = this._rootBestMove;
    let bestScore = score;
    if (chosen !== null) {
      bestMove = chosen.move;
      bestScore = chosen.score;
      if (this._rootBestMove !== null && chosen.move !== this._rootBestMove) this.pv = [chosen.move];
    }
    const totalTime = Date.now() - this.searchStartTime;
    if (this._abortReason !== null && __LOG__ && LOG.time) {
      logger.event(CAT.TIME, 'search-aborted', {
        reason: this._abortReason, ms: totalTime,
        budgetMs: this.config.maxSearchTime,
        completedDepth: this._completedDepth,
        haveMove: bestMove !== null ? 1 : 0,
      });
    }
    this._logTurnSummary(board, bestMove, bestScore, totalTime);
    const stageInfo = this._stageInfo;
    const smp = this._smp;
    const result = {
      bestMove, score: bestScore, nodes: this.nodes, qNodes: this.qNodes,
      depth: this._completedDepth, seldepth: this.maxDepthReached,
      time: totalTime, pv: this.pv, stats: this.stats, stageInfo,
      abortReason: this._abortReason,
      abortedMs: this._abortedMs,
      turnRecord: this._deferredTurn,
      rootScores: (smp !== null || this._deferTurnLog) ? this._rootScoresLite() : null,
      iterations: smp !== null && smp.collect ? smp.iterations : null,
    };
    if (smp !== null && smp.role === 'helper') {
      Atomics.store(smp.ctrl, smp.base + SLOT.STATE, SLOT_STATE.DONE);
    }
    this._collector = null; this._bookHints = null; this._bookPick = null;
    this._stageInfo = null; this._rootBias = null;
    this._smp = null; this._deferTurnLog = false; this._deferredTurn = null; this._skipIndex = 0;
    this._rootFilter = null;
    if (__LOG__ && LOG.any) logger.unlockTurn();
    return result;
  }

    // ═══════════════════════════════════════════════════════════════════════
  // Work-unit API (pv-split). The COORDINATOR owns iterative deepening; this
  // engine supplies the same per-search state, node accounting, deadline,
  // instrumentation and root policy that search() uses.
  //
  //   beginUnitSearch → searchRootUnit / searchSplitUnit × N →
  //   recordUnitIteration (per completed depth) → finishUnitSearch (main)
  //                                               endUnitSearch    (helper)
  // ═══════════════════════════════════════════════════════════════════════
  beginUnitSearch(board, depth, opts) {
    const o = opts || {};
    this._prepare(board, depth, null, o.bookHints ?? null, null, o.smp ?? null, !!o.deferTurnLog, null);
    this._rootInCheck = isInCheck(board, this.searchColor);
    const root = generateMoves(board, this.searchColor, freshList(), false, false);
    this._rootN = root.length;
    let caps = 0;
    for (let i = 0; i < root.length; i++) if (root[i].capturedPiece !== null) caps++;
    this._rootCaps = caps;
  }
  /** Search one root move at `depth` inside (alpha, beta). Root stays unmodified. */
  searchRootUnit(board, move, depth, alpha, beta) {
    this._currentDepth = depth;
    this._maxExtPly = depth + MAX_CHECK_EXTENSION_PLIES;
    const opp = this.searchColor === 'white' ? 'black' : 'white';
    board.makeMove(move.fromSquare, move.toSquare, move.promotionPiece);
    const s = -this.alphaBeta(board, depth - 1 + (this._rootInCheck ? 1 : 0), -beta, -alpha, opp, 1, move);
    board.undoMove();
    return s;
  }
  /**
   * One pv-split unit: null-window scout against the SHARED alpha, open-window
   * re-search on fail-high. EXACT scores raise the shared alpha (CAS max);
   * fail-lows are upper bounds. Result in this.unitScore / this.unitFlag.
   */
  searchSplitUnit(board, move, depth, ctrl) {
    const a = Atomics.load(ctrl, CTRL.ALPHA);
    let s = this.searchRootUnit(board, move, depth, a, a + 1);
    let flag = UNIT_FLAG.UPPER;
    if (!this.stopSearch && s > a) {
      s = this.searchRootUnit(board, move, depth, a, SCORE.INFINITY);
      if (!this.stopSearch && s > a) {
        flag = UNIT_FLAG.EXACT;
        raiseSharedAlpha(ctrl, s);
      }
    }
    this.unitScore = s;
    this.unitFlag = flag;
  }
  /** Install a completed iteration's root list (best first) exactly as _iterativeDeepening would. */
  recordUnitIteration(board, d, entries, score, ms) {
    const rms = this._rootMoveScores;
    rms.length = 0;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      rms.push({ move: e.move, score: e.score, exact: e.exact, orderScore: 0, nodes: e.nodes });
    }
    this._rootBestMove = entries[0].move;
    this._snapshotRootScores();
    // Root entry, so extractPV starts from the move we will actually play.
    if (this.tt !== null && !this.stopSearch) {
      this.tt.store(board.gameState.zobristKey, d, scoreToTT(score, 0), TT_FLAG.EXACT, this._rootBestMove);
    }
    this.extractPV(board, d);
    const alg = this._rootBestMove.algebraic;
    const changed = alg !== this._iterBest;
    if (changed) {
      if (this._iterBest !== null) this._rootChanges++;
      this._iterBest = alg;
      this._firstSeenMs = Date.now() - this.searchStartTime;
      this._firstSeenDepth = d;
    }
    this._completedDepth = d;
    this._logIteration(d, score, ms, changed);
  }
  /** Main thread: root policy + instrumentation + result, identical to search(). */
  finishUnitSearch(board, score) { return this._finish(board, score); }
  /** Helper thread: release per-search state without root policy or logging. */
  endUnitSearch() {
    const smp = this._smp;
    if (smp !== null && smp.role === 'helper') Atomics.store(smp.ctrl, smp.base + SLOT.STATE, SLOT_STATE.DONE);
    this._smp = null; this._deferTurnLog = false; this._deferredTurn = null;
    this._skipIndex = 0; this._rootFilter = null; this._collector = null;
    this._bookHints = null; this._bookPick = null; this._stageInfo = null; this._rootBias = null;
    if (__LOG__ && LOG.any) logger.unlockTurn();
  }
  /** Coordinator-raised abort (e.g. the deadline fired while the main thread was at a barrier). */
  abortExternal(reason) { if (!this.stopSearch) this._abort(reason, Date.now()); }
  predictsOverrun(lastIterMs) { return this._outOfTime(lastIterMs); }
  /**
   * Root policy over an EXTERNAL score list (root-split merge). Same rules as
   * the single-threaded root: repetition avoidance, then the tension
   * tie-break, then the best score. Entries: { move, score, exact, ... }.
   */
  chooseRootMove(board, scores) {
    if (scores.length === 0) return null;
    scores.sort((a, b) => b.score - a.score);
    return this._avoidRepetition(board, scores, scores[0]) ??
           this._preferTension(scores, scores[0]) ??
           scores[0];
  }
  
  _buildTurnRecord(board, bestMove, bestScore, ms) {
    const scores = this._rootScores;
    const bestCp   = scores.length > 0 ? scores[0].score : bestScore;
    const secondCp = scores.length > 1 ? scores[1].score : null;
    let bestRank = -1;
    for (let i = 0; i < scores.length; i++) {
      if (scores[i].move === bestMove) { bestRank = i; break; }
    }
    const tt = this.tt !== null ? this.tt.getStats() : null;
    const mateIn = Math.abs(bestScore) > SCORE.MATE_THRESHOLD
      ? (bestScore > 0 ? SCORE.MATE - bestScore : -(SCORE.MATE + bestScore))
      : null;
    return {
      color: this.searchColor,
      best: bestMove !== null ? bestMove.algebraic : null,
      cp: bestScore, mate: mateIn,
      bestCp, secondCp,
      margin: secondCp !== null ? bestCp - secondCp : null,
      qual: bestMove !== null ? bestScore - bestCp : 0,
      bestRank, rootN: this._rootN, rootCaps: this._rootCaps,
      depth: this._completedDepth, seldepth: this.maxDepthReached,
      nodes: this.nodes, qnodes: this.qNodes, ms,
      firstSeenMs: this._firstSeenMs, firstSeenDepth: this._firstSeenDepth,
      aborted: this._abortReason,
      abortMs: this._abortReason !== null ? this._abortedMs : null,
      rootChanges: this._rootChanges,
      pv: this.pv.map(m => m.algebraic).join(' '), pvLen: this.pv.length,
      staticCp: this._staticRoot,
      ttId: this.tableId(), threads: 1,
      cfg: this.configHash,
      ttHit: tt !== null ? tt.hits : 0, ttCut: this.stats.ttCutoffs,
      ttAgeAvg: tt !== null ? tt.hitAgeAvg : null,
      ttDepthAvg: tt !== null ? tt.hitDepthAvg : null,
      ttFill: tt !== null ? tt.fillPermille : null,
      cap: bestMove !== null && bestMove.capturedPiece !== null
             ? PIECE_CHARS[bestMove.capturedPiece] : null,
      capSee: bestMove !== null ? bestMove.seeScore : 0,
      promo: bestMove !== null && bestMove.isPromotion ? 1 : 0,
      bal: quickMaterialBalance(board, 'white'),
      phase: this._stageInfo !== null ? Math.round(this._stageInfo.phasePercent * 100) : null,
      stage: this._stageInfo !== null ? this._stageInfo.stage : null,
      fen: board.toFen(),
      softRefreshes: this.moveOrderer.softRefreshes,
      ...this.stats,
    };
  }
  _logTurnSummary(board, bestMove, bestScore, ms) {
    if (!(__LOG__ && LOG.search)) return;
    const record = this._buildTurnRecord(board, bestMove, bestScore, ms);
    if (this._deferTurnLog) this._deferredTurn = record;
    else logger.event(CAT.SEARCH, 'turn', record);
    const scores = this._rootScores;
    if (LOG.moveOrder && scores.length > 0) {
      const top = scores.slice(0, ROOT_SCORE_DUMP)
        .map(s => `${s.move.algebraic}:${s.score}:${s.exact ? 1 : 0}`).join('|');
      logger.event(CAT.MOVE_ORDER, 'root-scores', { n: scores.length, top });
    }
    if (this._stageInfo !== null && this._stageInfo.stage === GAME_STAGE.OPENING &&
        bestMove !== null && this.config.useOpeningPrinciples) {
      const oa = checkOpeningPrinciples(board, bestMove, this.searchColor);
      if (oa.violations.length > 0) {
        logger.event(CAT.SEARCH, 'opening-violation', {
          move: bestMove.algebraic, principles: oa.violations.map(v => v.principle).join(','),
        });
      }
    }
    if (LOG.tt && this.tt !== null) logger.event(CAT.TT, 'stats', { tt: this.tt.id, ...this.tt.getStats() });
    if (LOG.time) {
      logger.event(CAT.TIME, 'search-end', { ms, nodes: this.nodes, depth: this._completedDepth });
    }
  }
  // ═══════════════════════════════════════════════════════════════════════
  // Deadline + SMP polling
  // ═══════════════════════════════════════════════════════════════════════
  _pollClock() {
    this._nextClockCheck = this.nodes + NODE_CHECK_INTERVAL;
    const now = Date.now();
    if (this._smp !== null) this._smpPoll(now);
    if (__LOG__ && LOG.time && this.nodes >= this._nextHeartbeat) {
      this._nextHeartbeat = this.nodes + HEARTBEAT_NODES;
      logger.event(CAT.TIME, 'search-heartbeat', {
        d: this._currentDepth, nodes: this.nodes, qnodes: this.qNodes,
        seldepth: this.maxDepthReached, ms: now - this.searchStartTime,
        budgetMs: this.config.maxSearchTime, maxExtPly: this._maxExtPly,
        smp: this._smp !== null && this._smp.monitor ? this._smp.monitor.snapshot() : null,
      });
    }
    if (!this.stopSearch && now >= this._deadline) {
      this._abort('deadline', now);
      if (__LOG__ && LOG.time) {
        logger.event(CAT.TIME, 'deadline-abort', {
          d: this._currentDepth, ms: this._abortedMs,
          budgetMs: this.config.maxSearchTime,
          nodes: this.nodes, qnodes: this.qNodes, seldepth: this.maxDepthReached,
        });
      }
    }
  }
  _abort(reason, now) {
    this.stopSearch = true;
    this._abortedMs = now - this.searchStartTime;
    this._abortReason = reason;
  }
  _smpBeginHelper() {
    const s = this._smp, c = s.ctrl, b = s.base;
    Atomics.store(c, b + SLOT.COMPLETED, 0);
    Atomics.store(c, b + SLOT.DEPTH, 0);
    Atomics.store(c, b + SLOT.NODES, 0);
    Atomics.store(c, b + SLOT.POLLS, 0);
    Atomics.store(c, b + SLOT.BEST, 0);
    Atomics.store(c, b + SLOT.SCORE, 0);
    // SEARCH_ID last: the monitor never pairs this id with a stale COMPLETED.
    Atomics.store(c, b + SLOT.SEARCH_ID, s.searchId);
    Atomics.store(c, b + SLOT.STATE, SLOT_STATE.SEARCHING);
  }
  _smpPoll(now) {
    const s = this._smp;
    if (s.role === 'helper') {
      const c = s.ctrl, b = s.base;
      Atomics.store(c, b + SLOT.DEPTH, this._currentDepth);
      Atomics.store(c, b + SLOT.NODES, this.nodes & 0x7FFFFFFF);
      Atomics.store(c, b + SLOT.SELDEPTH, this.maxDepthReached);
      Atomics.store(c, b + SLOT.POLL_MS, now - this.searchStartTime);
      Atomics.add(c, b + SLOT.POLLS, 1);
    }
    if (!this.stopSearch) this._smpStopRequested(now);
  }

  _smpStopRequested(now) {
    const s = this._smp;
    if (s.role === 'helper') {
      if (Atomics.load(s.ctrl, CTRL.STOP_ID) < s.searchId) return false;
      this._abort('smp-stop', now);
      return true;
    }
    if (s.earlyStop !== false && s.monitor && this._completedDepth >= 1 &&
        s.monitor.helperCompleted(this._targetDepth)) {
      this._abort('helper-complete', now);
      return true;
    }
    return false;
  }

  _smpIteration(d, score, changed) {
    const s = this._smp;
    if (s.collect && s.iterations !== null) {
      s.iterations.push({
        d, cp: score, best: this._rootBestMove.algebraic, changed: changed ? 1 : 0,
        nodes: this.nodes, ms: Date.now() - this.searchStartTime, seldepth: this.maxDepthReached,
      });
    }
    if (s.role === 'helper') {
      Atomics.store(s.ctrl, s.base + SLOT.BEST, encodeMove(this._rootBestMove));
      Atomics.store(s.ctrl, s.base + SLOT.SCORE, score | 0);
      Atomics.store(s.ctrl, s.base + SLOT.COMPLETED, d);
    }
  }
  // ═══════════════════════════════════════════════════════════════════════
  // Root move policy
  // ═══════════════════════════════════════════════════════════════════════
  _repetitionsAfter(board, move) {
    board.makeMove(move.fromSquare, move.toSquare, move.promotionPiece);
    const r = board.countRepetitions();
    board.undoMove();
    return r;
  }
  _verifyRootCandidates(board) {
    if (this.stopSearch) return;
    const scores = this._rootScores;
    if (scores.length === 0) return;
    const best = scores[0];
    if (best.move === null) return;
    const bestScore = best.score;
    const needRepAvoid = this._repetitionsAfter(board, best.move) >= 3 &&
                         bestScore > -this.config.drawContemptMax;
    if (!needRepAvoid) return;
    const slack = this.config.repetitionMargin;
    const lastDepth = this._completedDepth;
    const oppositeColor = this.searchColor === 'white' ? 'black' : 'white';
    let verified = 0;
    for (let i = 0; i < scores.length; i++) {
      const s = scores[i];
      if (s.exact) continue;
      if (bestScore - s.score > slack) break;
      if (verified >= ROOT_VERIFY_LIMIT) break;
      board.makeMove(s.move.fromSquare, s.move.toSquare, s.move.promotionPiece);
      s.score = -this.alphaBeta(board, Math.max(1, lastDepth - 1),
                                -SCORE.INFINITY, SCORE.INFINITY, oppositeColor, 1, s.move);
      board.undoMove();
      s.exact = true;
      verified++;
      this.stats.rootVerified++;
    }
    if (verified > 0) scores.sort((a, b) => b.score - a.score);
  }
  _chooseRootMove(board) {
    const scores = this._rootScores;
    if (scores.length === 0) return null;
    const rep = this._avoidRepetition(board, scores, scores[0]);
    if (rep !== null) return rep;
    return this._preferTension(scores, scores[0]);
  }
  _avoidRepetition(board, scores, best) {
    if (Math.abs(best.score) > SCORE.MATE_THRESHOLD) return null;
    if (best.score <= -this.config.drawContemptMax) return null;
    if (this._repetitionsAfter(board, best.move) < 3) return null;
    const margin = this.config.repetitionMargin;
    for (let i = 1; i < scores.length; i++) {
      const s = scores[i];
      if (!s.exact) continue;
      if (s.score < best.score - margin) break;
      if (this._repetitionsAfter(board, s.move) >= 3) continue;
      this.stats.repetitionAvoided++;
      if (__LOG__ && LOG.search) {
        logger.event(CAT.SEARCH, 'repetition-avoided', {
          best: best.move.algebraic, played: s.move.algebraic, cost: best.score - s.score,
        });
      }
      return s;
    }
    return null;
  }
  _preferTension(scores, best) {
    if (!best.exact || best.move === null) return null;
    let pick = best;
    for (let i = 1; i < scores.length; i++) {
      const s = scores[i];
      if (!s.exact || s.score !== best.score) continue;
      if (tensionRank(s.move) > tensionRank(pick.move)) pick = s;
    }
    if (pick === best) return null;
    if (__LOG__ && LOG.search) {
      logger.event(CAT.SEARCH, 'tie-break', {
        best: best.move.algebraic, played: pick.move.algebraic, cp: best.score,
      });
    }
    return pick;
  }
  // ═══════════════════════════════════════════════════════════════════════
  // TT helpers — ZERO ALLOCATION. Writes into this._ttProbe.
  // ═══════════════════════════════════════════════════════════════════════
  _probeTT(key, depth, alpha, beta, ply, isRoot) {
    const r = this._ttProbe;
    if (this.tt === null) { r.move = 0; r.cutoff = false; r.score = 0; return r; }
    const tt = this.tt.probe(key, depth, alpha, beta);
    if (!tt.hit) { r.move = 0; r.cutoff = false; r.score = 0; return r; }
    this.stats.ttHits++;
    r.move = tt.move;
    if (!isRoot && tt.usable) {
      this.stats.ttCutoffs++;
      r.cutoff = true;
      r.score = scoreFromTT(tt.score, ply);
      return r;
    }
    r.cutoff = false;
    r.score = 0;
    return r;
  }
  _storeTT(key, depth, bestScore, alphaOrig, beta, ply, bestMove) {
    if (this.tt !== null && !this.stopSearch) {
      this.tt.store(key, depth, scoreToTT(bestScore, ply),
                    nodeFlag(bestScore, alphaOrig, beta), bestMove);
    }
  }
  // ═══════════════════════════════════════════════════════════════════════
  // Node search
  // ═══════════════════════════════════════════════════════════════════════
  alphaBeta(board, depth, alpha, beta, color, ply, lastMove) {
    this.nodes++;
    if (ply > this.maxDepthReached) this.maxDepthReached = ply;
    if (this.nodes >= this._nextClockCheck) this._pollClock();
    if (this.stopSearch) return 0;
    const c = this._collector;
    if (c !== null) c.onNode();
    const isRoot = ply === 0;
    const isPvNode = beta - alpha > 1;
    const oppositeColor = color === 'white' ? 'black' : 'white';
    const inCheck = isInCheck(board, color);
    const alphaOrig = alpha;
    if (!isRoot) {
      if (board.gameState.halfMoveClock >= 100) return this._drawContempt(board, ply);
      if (board.isRepetition(2)) return this._repetitionScore(board, ply);
    }
    const ttResult = this._probeTT(board.gameState.zobristKey, depth, alpha, beta, ply, isRoot);
    const ttCutoff = ttResult.cutoff;
    const ttScore = ttResult.score;
    let ttMove = ttResult.move;
    if (ttCutoff) return ttScore;
    if (depth <= 0) {
      if (this.config.useQuiescence) {
        this.qNodes++;
        return quiescenceSearch(board, alpha, beta, color, this.evaluator,
                                ply, 0, this.config.quiescenceDepth,
                                lastMove !== null && lastMove.capturedPiece !== null
                                  ? lastMove.toSquare : -1,
                                this);
      }
      return this.evaluator.evaluate(board, color).score;
    }
    if (this.config.useIID && ttMove === 0 && depth >= 4 && isPvNode && !isRoot && this.tt !== null) {
      this.alphaBeta(board, Math.max(1, depth - 3), alpha, beta, color, ply, lastMove);
      ttMove = this.tt.getBestMove(board.gameState.zobristKey);
    }
    const moves = generateMoves(board, color, isRoot ? freshList() : listForPly(ply), false, isRoot);
    if (moves.length === 0) {
      return inCheck ? -(SCORE.MATE - ply) : this._drawContempt(board, ply);
    }
    // root-split: this thread owns only its subset of root moves.
    if (isRoot && this._rootFilter !== null) {
      let k = 0;
      for (let i = 0; i < moves.length; i++) {
        if (this._rootFilter.has(moves[i].algebraic)) moves[k++] = moves[i];
      }
      if (k > 0) moves.length = k;
    }

    if (isRoot) {
      this._rootN = moves.length;
      let caps = 0;
      for (let i = 0; i < moves.length; i++) if (moves[i].capturedPiece !== null) caps++;
      this._rootCaps = caps;
    }
    const canFutility = this.config.useFutilityPruning && depth <= 3 && !inCheck && !isPvNode &&
                        Math.abs(alpha) < SCORE.MATE_THRESHOLD;
    const canNull = this.config.useNullMovePruning && depth >= 3 && !isRoot &&
                    !inCheck && !isPvNode && hasNonPawnMaterial(board, color);
    const staticEval = (canFutility || canNull) ? this.evaluator.evaluate(board, color).score : 0;
    if (canNull && staticEval >= beta &&
        this._tryNullMove(board, depth, beta, color, oppositeColor, ply)) {
      if (c !== null) c.onCutoff(ply, null, 'null');
      return beta;
    }
    // NOTE: the null-move subtree above regenerated moves and clobbered the
    // generator's ANALYSIS. MoveOrderer detects that and re-analyses; it used
    // to silently skip the soft-pin term instead.
    this.moveOrderer.scoreMoves(moves, ply, board, color, ttMove, lastMove,
                                isRoot ? this._bookHints : null,
                                isRoot ? this._bookPick : null);
    if (isRoot) this._orderRoot(board, color, moves, c);
    const extension = (inCheck && ply < this._maxExtPly) ? 1 : 0;
    const wantTrueRootScores = isRoot && c !== null;
    let bestMove = null, bestScore = -SCORE.INFINITY;
    let searched = 0;
    if (isRoot) this._rootMoveScores.length = 0;
    for (let i = 0; i < moves.length; i++) {
      const move = isRoot ? moves[i] : pickMove(moves, i);
      const isCapture = move.capturedPiece !== null;
      const badCapture  = isCapture && move.seeScore < -SEE_EQUAL_BAND;
      const evenCapture = isCapture && move.seeScore <= SEE_EQUAL_BAND;
      if (searched > 0) {
        if (canFutility && !move.isPromotion && (!isCapture || evenCapture) &&
            staticEval + FUTILITY_MARGIN[depth] +
              (isCapture ? PIECE_VALUES[move.capturedPiece] : 0) <= alpha) {
          this.stats.futilityCutoffs++;
          continue;
        }
        if (this.config.useSEEPruning && badCapture && !isPvNode && !inCheck &&
            depth <= 3 && move.seeScore < -90 * depth) {
          this.stats.seePrunes++;
          continue;
        }
      }
      const nodesBefore = this.nodes;
      board.makeMove(move.fromSquare, move.toSquare, move.promotionPiece);
      const givesCheck = isInCheck(board, oppositeColor);
      let reduction = 0;
      const reducible = !move.isPromotion && (!isCapture || evenCapture);
      const lmrFloor = isCapture ? 6 : 4;
      if (this.config.useLateMovereduction && searched >= lmrFloor && depth >= 3 &&
          reducible && !inCheck && !givesCheck && !move.isKiller) {
        reduction = Math.floor(Math.log2(depth) * Math.log2(searched + 1) * 0.5);
        if (badCapture) reduction++;
        reduction = Math.max(1, Math.min(reduction, depth - 2));
        this.stats.lmrSearches++;
      }
      let score;
      const full = depth - 1 + extension;
      if (isRoot) {
        score = this._searchRootMove(board, move, full, alpha, beta, oppositeColor,
                                     reduction, searched, wantTrueRootScores);
      } else {
        score = this._searchChild(board, move, full, alpha, beta, oppositeColor,
                                  ply + 1, reduction, searched);
      }
      board.undoMove();
      searched++;
      if (this.stopSearch) {
        if (isRoot && bestMove !== null && this._rootScores.length === 0) {
          this._rootBestMove = bestMove;
          this._snapshotRootScores();
        }
        return 0;
      }
      if (isRoot) {
        const exact = wantTrueRootScores || this._rootMoveExact;
        if (exact) this.stats.rootVerified++;
        this._rootMoveScores.push({
          move, score, exact, orderScore: move.orderScore, nodes: this.nodes - nodesBefore,
        });
        if (c !== null) c.onRootMove(move, score, this.nodes - nodesBefore);
      }
      if (__LOG__ && LOG.search) {
        logger.trace(CAT.SEARCH, 'node', { d: depth, p: ply, a: alpha, b: beta, mc: searched });
      }
      if (score > bestScore) { bestScore = score; bestMove = move; }
      if (bestScore > alpha) alpha = bestScore;
      if (bestScore >= beta) {
        this.stats.cutoffs++;
        if (searched === 1) this.stats.firstMoveCutoffs++;
        this.moveOrderer.addKiller(move, ply);
        if (!isCapture) {
          this.moveOrderer.updateHistory(move, depth, true);
          this.moveOrderer.updateCounterMove(lastMove, color === 'white' ? 1 : 0, move);
        }
        for (let j = 0; j < i; j++) {
          if (moves[j].capturedPiece === null) this.moveOrderer.updateHistory(moves[j], depth, false);
        }
        if (c !== null) c.onCutoff(ply, move, 'beta');
        if (!wantTrueRootScores) break;
      }
    }
    if (bestMove === null) bestMove = moves[0];
    this._storeTT(board.gameState.zobristKey, depth, bestScore, alphaOrig, beta, ply, bestMove);
    if (isRoot) this._rootBestMove = bestMove;
    return bestScore;
  }
  _orderRoot(board, color, moves, collector) {
    this.moveOrderer.sortMoves(moves);
    if (this._stageInfo !== null && this._stageInfo.stage === GAME_STAGE.OPENING &&
        this.config.useOpeningPrinciples) {
      for (let i = 0; i < moves.length; i++) {
        const a = checkOpeningPrinciples(board, moves[i], color);
        moves[i].orderScore += a.totalBonus + a.totalPenalty;
      }
      moves.sort((a, b) => b.orderScore - a.orderScore);
    }
    if (this._rootBias !== null) {
      applyRootBias(moves, this._rootBias);
      moves.sort((a, b) => b.orderScore - a.orderScore);
    }
    if (collector !== null) collector.onMoveOrdering(0, moves);
    if (__LOG__ && LOG.moveOrder) {
      logger.event(CAT.MOVE_ORDER, 'root', {
        top: moves[0].algebraic, score: moves[0].orderScore, n: moves.length,
      });
    }
  }
  _tryNullMove(board, depth, beta, color, oppositeColor, ply) {
    const R = depth > 6 ? 3 : 2;
    const gs = board.gameState;
    const savedEp = gs.enPassantSquare, savedColor = gs.activeColor, savedKey = gs.zobristKey;
    gs.enPassantSquare = -1;
    gs.activeColor = oppositeColor;
    gs.zobristKey ^= SIDE_FLIP_KEY;
    if (savedEp !== -1) gs.zobristKey ^= EN_PASSANT_KEYS[getEnPassantZobristIndex(savedEp)] ^ EP_NONE_KEY;
    const nullScore = -this.alphaBeta(board, depth - R - 1, -beta, -beta + 1, oppositeColor, ply + 1, null);
    gs.enPassantSquare = savedEp;
    gs.activeColor = savedColor;
    gs.zobristKey = savedKey;
    if (nullScore >= beta) { this.stats.nullMoveCutoffs++; return true; }
    return false;
  }
  _searchRootMove(board, move, full, alpha, beta, oppositeColor, reduction, searched, wantTrue) {
    if (wantTrue) {
      this._rootMoveExact = true;
      return -this.alphaBeta(board, full, -SCORE.INFINITY, SCORE.INFINITY, oppositeColor, 1, move);
    }
    if (searched === 0) {
      const s = -this.alphaBeta(board, full, -beta, -alpha, oppositeColor, 1, move);
      this._rootMoveExact = s > alpha && s < beta;
      return s;
    }
    return this._pvsSearch(board, full, alpha, beta, oppositeColor, 1, move, reduction, true);
  }
  _searchChild(board, move, full, alpha, beta, oppositeColor, childPly, reduction, searched) {
    if (this.config.usePVS && searched > 0) {
      return this._pvsSearch(board, full, alpha, beta, oppositeColor, childPly, move, reduction, false);
    }
    let s = -this.alphaBeta(board, full - reduction, -beta, -alpha, oppositeColor, childPly, move);
    if (reduction > 0 && s > alpha) {
      this.stats.lmrResearches++;
      s = -this.alphaBeta(board, full, -beta, -alpha, oppositeColor, childPly, move);
    }
    return s;
  }
  _pvsSearch(board, full, alpha, beta, oppositeColor, childPly, move, reduction, isRoot) {
    let s = -this.alphaBeta(board, full - reduction, -alpha - 1, -alpha, oppositeColor, childPly, move);
    if (s > alpha && s < beta) {
      this.stats.pvsResearches++;
      if (reduction > 0) {
        this.stats.lmrResearches++;
        s = -this.alphaBeta(board, full, -alpha - 1, -alpha, oppositeColor, childPly, move);
      }
      if (s > alpha && s < beta) {
        s = -this.alphaBeta(board, full, -beta, -alpha, oppositeColor, childPly, move);
        if (isRoot) this._rootMoveExact = s > alpha && s < beta;
        return s;
      }
    }
    if (isRoot) this._rootMoveExact = false;
    return s;
  }
  // ═══════════════════════════════════════════════════════════════════════
  // PV extraction
  //
  // Every TT move is checked against the legal list before it is played.
  // makeMove() trusts its input; a bad hint (torn shared entry, key collision)
  // on an empty from-square would index bbPieces[color][NONE] and corrupt the
  // board. The check costs one generation per PV ply, i.e. nothing.
  // ═══════════════════════════════════════════════════════════════════════
  _isLegalEncoded(board, enc) {
    const list = generateMoves(board, board.gameState.activeColor, PV_SLOT, false, false);
    for (let i = 0; i < list.length; i++) if (encodedMatches(enc, list[i])) return true;
    return false;
  }
  extractPV(board, maxLen) {
    this.pv = [];
    if (this.tt === null) return;
    const seen = this._pvKeys;
    seen.length = 0;
    let made = 0;
    for (let i = 0; i < maxLen; i++) {
      const key = board.gameState.zobristKey;
      let found = false;
      for (let j = 0; j < seen.length; j++) {
        if (seen[j] === key) { found = true; break; }
      }
      if (found) break;
      seen.push(key);
      const enc = this.tt.getBestMove(key);
      if (enc === 0) break;
      if (!this._isLegalEncoded(board, enc)) { this.stats.pvRejected++; break; }
      const from = decodeFrom(enc), to = decodeTo(enc), promo = decodePromo(enc) || null;
      this.pv.push({ fromSquare: from, toSquare: to, promotionPiece: promo,
                     algebraic: encodedToAlgebraic(enc) });
      board.makeMove(from, to, promo);
      made++;
    }
    for (let i = 0; i < made; i++) board.undoMove();
  }
}
export default SearchEngine;