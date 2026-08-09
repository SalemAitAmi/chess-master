import { SCORE, PIECES, PIECE_VALUES } from '../core/constants.js';
import { generateMoves, generateAllLegalMoves, listForPly, freshList, isInCheck } from '../core/moveGeneration.js';
import { Evaluator } from '../evaluation/evaluate.js';
import { MoveOrderer, pickMove } from './moveOrdering.js';
import { quiescenceSearch } from './quiescence.js';
import { TranspositionTable, TT_FLAG, decodeFrom, decodeTo, decodePromo } from '../tables/transposition.js';
import { SIDE_KEYS, EN_PASSANT_KEYS, getEnPassantZobristIndex } from '../tables/zobrist.js';
import { detectGameStage, checkOpeningPrinciples, GAME_STAGE } from '../utils/gameStage.js';
import { indexToSquare } from '../core/bitboard.js';
import { Rng } from '../utils/rng.js';
import logger, { LOG, CAT } from '../logging/logger.js';

const __LOG__ = globalThis.__LOG__ ?? true;

const FUTILITY_MARGIN = [0, 150, 300, 450];
const ASPIRATION_WINDOW = 50;
const ASPIRATION_MIN_DEPTH = 5;
const PROMO_SUFFIX = ['', 'q', 'r', 'b', 'n'];
const SIDE_FLIP_KEY = SIDE_KEYS[0] ^ SIDE_KEYS[1];
const EP_NONE_KEY = EN_PASSANT_KEYS[16];
const VARIATION_STAGES = new Set([GAME_STAGE.OPENING, GAME_STAGE.EARLY_MIDDLE]);

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

// ═══════════════════════════════════════════════════════════════════════════
export class SearchEngine {
  constructor(config = {}) {
    this.config = {
      maxDepth: config.maxDepth || 64,
      useQuiescence:         config.useQuiescence         !== false,
      quiescenceDepth:       config.quiescenceDepth       || 8,
      useTranspositionTable: config.useTranspositionTable !== false,
      useNullMovePruning:    config.useNullMovePruning    !== false,
      useLateMovereduction:  config.useLateMovereduction  !== false,
      useFutilityPruning:    config.useFutilityPruning    !== false,
      useSEEPruning:         config.useSEEPruning         !== false,
      useAspirationWindows:  config.useAspirationWindows  !== false,
      usePVS:                config.usePVS                !== false,
      useIID:                config.useIID                !== false,
      useOpeningPrinciples:  config.useOpeningPrinciples  !== false,
      useMoveVariation:      config.useMoveVariation      !== false,
      drawContemptMax:       config.drawContemptMax       ?? 50,
      repetitionContempt:    config.repetitionContempt    ?? 30,
      repetitionMargin:      config.repetitionMargin      ?? 90,
      variationMargin:       config.variationMargin       ?? 10,
      variationMaxScore:     config.variationMaxScore     ?? 90,
      variationMaxMoves:     config.variationMaxMoves     ?? 4,
      maxSearchTime:         config.maxSearchTime         ?? 30000,
      ...config,
    };
    this.evaluator   = new Evaluator(this.config);
    this.moveOrderer = new MoveOrderer(this.config);
    this.tt = this.config.useTranspositionTable ? new TranspositionTable(64) : null;
    this.rng = new Rng(this.config.randomSeed ?? 0x2545f491);
    this._initTransient();
  }

  _initTransient() {
    this.nodes = 0; this.qNodes = 0; this.maxDepthReached = 0;
    this.searchStartTime = 0; this.stopSearch = false;
    this.searchColor = 'white'; this.pv = [];
    this._rootBestMove = null;
    this._rootMoveScores = [];
    this._rootScores = [];
    this._rootMoveExact = false;
    this._variationActive = false;
    this._collector = null; this._bookHints = null; this._bookPick = null; this._stageInfo = null;
    this._pvKeys = [];
    this.stats = this._emptyStats();
  }

  _emptyStats() {
    return { ttHits: 0, ttCutoffs: 0, nullMoveCutoffs: 0, futilityCutoffs: 0,
             lmrSearches: 0, lmrResearches: 0, pvsResearches: 0, seePrunes: 0,
             repetitionAvoided: 0, varied: 0, rootVerified: 0 };
  }

  reseed(seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) { this.rng.reseed(seed); }

  resetSearchState() {
    this.nodes = 0; this.qNodes = 0; this.maxDepthReached = 0;
    this.stopSearch = false; this.pv = [];
    this._rootBestMove = null;
    this._rootMoveScores.length = 0;
    this._rootScores.length = 0;
    this._rootMoveExact = false;
    this._variationActive = false;
    this._bookPick = null;
    this.stats = this._emptyStats();
    this.tt?.newSearch();
    this.moveOrderer.prepareNewSearch();
  }

  stop() { this.stopSearch = true; }

  setOption(name, value) {
    if (name in this.config) this.config[name] = value;
    if (name === 'randomSeed') { this.rng.reseed(value); return; }
    if (name.startsWith('use') || name === 'weights') {
      this.evaluator = new Evaluator(this.config);
      this.moveOrderer = new MoveOrderer(this.config);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Contempt
  // ═══════════════════════════════════════════════════════════════════════

  _drawContempt(board, ply) {
    const balance = quickMaterialBalance(board, this.searchColor);
    const absBalance = Math.abs(balance);
    const cap = this.config.drawContemptMax;
    const absContempt = absBalance > 50 ? Math.min(cap, Math.floor(absBalance / 10)) : 1;
    const fromSearchPOV = balance > 50 ? -absContempt : balance < -50 ? absContempt : -1;
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

  search(board, maxDepth = null, options = {}) {
    this._prepare(board, maxDepth, options);
    const score = this._iterativeDeepening(board, maxDepth || this.config.maxDepth);
    return this._finish(board, score);
  }

  _prepare(board, maxDepth, options) {
    this.resetSearchState();
    this.searchStartTime = Date.now();
    this.searchColor = board.gameState.activeColor;
    this._collector = options.collector || null;
    this._bookHints = options.bookHints || null;
    this._bookPick = this._pickBookMove(this._bookHints);
    this._stageInfo = this._detectStage(board);
    this._variationActive = this._shouldVary();

    if (__LOG__ && LOG.time) {
      logger.event(CAT.TIME, 'search-start', {
        color: this.searchColor, maxDepth: maxDepth || this.config.maxDepth,
        maxMs: this.config.maxSearchTime,
      });
    }
    if (__LOG__ && LOG.stage && this._stageInfo) {
      logger.event(CAT.STAGE, 'detect', {
        stage: this._stageInfo.stage, phase: this._stageInfo.phasePercent,
      });
    }
  }

  _detectStage(board) {
    const want = this.config.useOpeningPrinciples || this.config.useMoveVariation || (__LOG__ && LOG.stage);
    return want ? detectGameStage(board) : null;
  }

  _shouldVary() {
    return this.config.useMoveVariation &&
           this._collector === null &&
           VARIATION_STAGES.has(this._stageInfo?.stage);
  }

  _iterativeDeepening(board, depth) {
    let score = 0, lastIterMs = 0;

    for (let d = 1; d <= depth; d++) {
      if (this.stopSearch) break;
      if (d > 1 && this._outOfTime(lastIterMs)) break;

      const t0 = Date.now();
      this._collector?.onIterationStart?.(d);

      const iterScore = this._searchIteration(board, d, score);
      if (this.stopSearch) break;

      lastIterMs = Date.now() - t0;
      score = iterScore;

      if (this._rootBestMove) {
        this._snapshotRootScores();
        this.extractPV(board, d);
        this._logIteration(d, score, lastIterMs);
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

  _logIteration(d, score, ms) {
    if (__LOG__ && LOG.search) {
      logger.event(CAT.SEARCH, 'iteration', {
        d, best: this._rootBestMove.algebraic, cp: score,
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
    let alpha = -SCORE.INFINITY, beta = SCORE.INFINITY, delta = ASPIRATION_WINDOW;

    if (this.config.useAspirationWindows && depth >= ASPIRATION_MIN_DEPTH &&
        Math.abs(prevScore) < SCORE.MATE_THRESHOLD) {
      alpha = prevScore - delta;
      beta  = prevScore + delta;
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const score = this.alphaBeta(board, depth, alpha, beta, this.searchColor, 0, null);
      if (this.stopSearch) return score;
      if (score <= alpha)      { alpha = Math.max(-SCORE.INFINITY, alpha - delta); delta *= 2; }
      else if (score >= beta)  { beta  = Math.min( SCORE.INFINITY, beta  + delta); delta *= 2; }
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

  _finish(board, score) {
    this._verifyRootCandidates(board);
    const chosen = this._chooseRootMove(board);
    let bestMove = this._rootBestMove;
    let bestScore = score;

    if (chosen) {
      bestMove = chosen.move;
      bestScore = chosen.score;
      if (this._rootBestMove && chosen.move !== this._rootBestMove) this.pv = [chosen.move];
    }

    const totalTime = Date.now() - this.searchStartTime;
    this._logTurnSummary(board, bestMove, bestScore, totalTime);

    const stageInfo = this._stageInfo;
    this._collector = null; this._bookHints = null; this._bookPick = null; this._stageInfo = null;

    return { bestMove, score: bestScore, nodes: this.nodes, qNodes: this.qNodes,
             depth: this.maxDepthReached, time: totalTime, pv: this.pv,
             stats: this.stats, stageInfo };
  }

  _logTurnSummary(board, bestMove, bestScore, ms) {
    if (__LOG__ && LOG.search) {
      logger.event(CAT.SEARCH, 'turn', {
        color: this.searchColor, best: bestMove?.algebraic ?? null, cp: bestScore,
        depth: this.maxDepthReached, nodes: this.nodes, qnodes: this.qNodes, ms,
        pv: this.pv.map(m => m.algebraic).join(' '),
        stage: this._stageInfo?.stage ?? null, ...this.stats,
      });
    }
    if (__LOG__ && LOG.search && this._stageInfo?.stage === GAME_STAGE.OPENING &&
        bestMove && this.config.useOpeningPrinciples) {
      const oa = checkOpeningPrinciples(board, bestMove, this.searchColor);
      if (oa.violations.length > 0) {
        logger.event(CAT.SEARCH, 'opening-violation', {
          move: bestMove.algebraic, principles: oa.violations.map(v => v.principle).join(','),
        });
      }
    }
    if (__LOG__ && LOG.tt && this.tt) logger.event(CAT.TT, 'stats', this.tt.getStats());
    if (__LOG__ && LOG.time) {
      logger.event(CAT.TIME, 'search-end', { ms, nodes: this.nodes, depth: this.maxDepthReached });
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

  _pickBookMove(hints) {
    if (!hints || hints.size === 0) return null;
    if (hints.size === 1 || this._collector) {
      let best = null, bw = -1;
      for (const [m, w] of hints) if (w > bw) { bw = w; best = m; }
      return best;
    }
    let total = 0;
    for (const w of hints.values()) total += w;
    let r = this.rng.nextInt(total);
    for (const [m, w] of hints) { if (r < w) return m; r -= w; }
    return null;
  }

  _verifyRootCandidates(board) {
    const scores = this._rootScores;
    if (scores.length === 0) return;

    const bestScore = scores[0].score;
    const needVariation = this._variationActive && Math.abs(bestScore) <= this.config.variationMaxScore;
    const needRepAvoid = scores[0].move &&
                         this._repetitionsAfter(board, scores[0].move) >= 3 &&
                         bestScore > -this.config.drawContemptMax;
    if (!needVariation && !needRepAvoid) return;

    const slack = needRepAvoid ? this.config.repetitionMargin : this.config.variationMargin;
    const lastDepth = this.maxDepthReached;
    const oppositeColor = this.searchColor === 'white' ? 'black' : 'white';
    let verified = 0;

    for (let i = 0; i < scores.length; i++) {
      const s = scores[i];
      if (s.exact) continue;
      if (bestScore - s.score > slack) break;
      if (verified >= this.config.variationMaxMoves + 2) break;

      board.makeMove(s.move.fromSquare, s.move.toSquare, s.move.promotionPiece);
      s.score = -this.alphaBeta(board, lastDepth - 1, -SCORE.INFINITY, SCORE.INFINITY, oppositeColor, 1, s.move);
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
    const best = scores[0];
    return this._avoidRepetition(board, scores, best) ??
           this._applyVariation(board, scores, best);
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

  _applyVariation(board, scores, best) {
    if (!this._variationActive) return best;
    if (Math.abs(best.score) > this.config.variationMaxScore) return best;

    const margin = this.config.variationMargin;
    const maxMoves = this.config.variationMaxMoves;
    const pool = [];
    let total = 0;

    for (let i = 0; i < scores.length && pool.length < maxMoves; i++) {
      const s = scores[i];
      if (!s.exact) continue;
      const deficit = best.score - s.score;
      if (deficit > margin) break;
      if (this._repetitionsAfter(board, s.move) >= 3) continue;
      const w = margin - deficit + 1;
      pool.push({ entry: s, weight: w });
      total += w;
    }
    if (pool.length <= 1) return best;

    let r = this.rng.nextInt(total);
    for (let i = 0; i < pool.length; i++) {
      if (r < pool[i].weight) {
        if (pool[i].entry !== best) this.stats.varied++;
        return pool[i].entry;
      }
      r -= pool[i].weight;
    }
    return best;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Node search
  // ═══════════════════════════════════════════════════════════════════════

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
    const alphaOrig = alpha;

    // ── Early exits ────────────────────────────────────────────────────
    const earlyScore = this._checkEarlyExit(board, ply, isRoot, inCheck);
    if (earlyScore !== null) return earlyScore;

    // ── TT probe ───────────────────────────────────────────────────────
    let ttMove = 0;
    const key = board.gameState.zobristKey;
    const ttResult = this._probeTT(key, depth, alpha, beta, isRoot);
    if (ttResult.cutoff) return ttResult.score;
    ttMove = ttResult.move;

    // ── Leaf / quiescence ──────────────────────────────────────────────
    if (depth <= 0) return this._evaluateLeaf(board, alpha, beta, color, ply);

    // ── IID (not at root — it would wipe _rootMoveScores) ──────────────
    if (this.config.useIID && ttMove === 0 && depth >= 4 && isPvNode && !isRoot && this.tt) {
      this.alphaBeta(board, Math.max(1, depth - 3), alpha, beta, color, ply, lastMove);
      ttMove = this.tt.getBestMove(key);
    }

    // ── Generate ───────────────────────────────────────────────────────
    const moves = generateMoves(board, color, isRoot ? freshList() : listForPly(ply), false, isRoot);
    if (moves.length === 0) return this._noMovesScore(inCheck, board, ply);

    // ── Null move ──────────────────────────────────────────────────────
    if (this._tryNullMove(board, depth, beta, color, oppositeColor, ply, isRoot, inCheck, isPvNode)) {
      if (c) c.onCutoff(ply, null, 'null');
      return beta;
    }

    // ── Pre-search setup ───────────────────────────────────────────────
    const canFutility = this._canFutility(depth, inCheck, isPvNode, alpha);
    const staticEval = canFutility ? this.evaluator.evaluate(board, color).score : 0;
    this._orderRoot(moves, board, color, ply, isRoot, ttMove, lastMove);

    // ── Move loop ──────────────────────────────────────────────────────
    return this._moveLoop(board, moves, depth, alpha, beta, alphaOrig, color, oppositeColor,
                          ply, isRoot, isPvNode, inCheck, lastMove, canFutility, staticEval, c);
  }

  _checkEarlyExit(board, ply, isRoot, inCheck) {
    if (isRoot) return null;
    if (board.gameState.halfMoveClock >= 100) return this._drawContempt(board, ply);
    if (board.isRepetition(2)) return this._repetitionScore(board, ply);
    return null;
  }

  _probeTT(key, depth, alpha, beta, isRoot) {
    if (!this.tt) return { move: 0, cutoff: false, score: 0 };
    const tt = this.tt.probe(key, depth, alpha, beta);
    if (!tt.hit) return { move: 0, cutoff: false, score: 0 };
    this.stats.ttHits++;
    if (!isRoot && tt.usable) {
      this.stats.ttCutoffs++;
      return { move: tt.move, cutoff: true, score: scoreFromTT(tt.score, 0) };
    }
    return { move: tt.move, cutoff: false, score: 0 };
  }

  _evaluateLeaf(board, alpha, beta, color, ply) {
    if (this.config.useQuiescence) {
      this.qNodes++;
      return quiescenceSearch(board, alpha, beta, color, this.evaluator, ply, 0, this.config.quiescenceDepth);
    }
    return this.evaluator.evaluate(board, color).score;
  }

  _noMovesScore(inCheck, board, ply) {
    return inCheck ? -(SCORE.MATE - ply) : this._drawContempt(board, ply);
  }

  _tryNullMove(board, depth, beta, color, oppositeColor, ply, isRoot, inCheck, isPvNode) {
    if (!this.config.useNullMovePruning || depth < 3 || isRoot || inCheck || isPvNode) return false;
    if (!hasNonPawnMaterial(board, color)) return false;

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

  _canFutility(depth, inCheck, isPvNode, alpha) {
    return this.config.useFutilityPruning && depth <= 3 && !inCheck && !isPvNode &&
           Math.abs(alpha) < SCORE.MATE_THRESHOLD;
  }

  _orderRoot(moves, board, color, ply, isRoot, ttMove, lastMove) {
    this.moveOrderer.scoreMoves(moves, ply, board, color, ttMove, lastMove,
                                isRoot ? this._bookHints : null, isRoot ? this._bookPick : null);
    if (!isRoot) return;

    this.moveOrderer.sortMoves(moves);
    if (this._stageInfo?.stage === GAME_STAGE.OPENING && this.config.useOpeningPrinciples) {
      for (let i = 0; i < moves.length; i++) {
        const a = checkOpeningPrinciples(board, moves[i], color);
        moves[i].orderScore += a.totalBonus + a.totalPenalty;
      }
      moves.sort((a, b) => b.orderScore - a.orderScore);
    }
    if (this._collector) this._collector.onMoveOrdering(0, moves);
    if (__LOG__ && LOG.moveOrder) {
      logger.event(CAT.MOVE_ORDER, 'root', { top: moves[0].algebraic, score: moves[0].orderScore, n: moves.length });
    }
  }

  // ── Move loop (the hot core) ─────────────────────────────────────────

  _moveLoop(board, moves, depth, alpha, beta, alphaOrig, color, oppositeColor,
            ply, isRoot, isPvNode, inCheck, lastMove, canFutility, staticEval, c) {
    const extension = inCheck ? 1 : 0;
    const wantTrueRootScores = isRoot && c !== null;
    let bestMove = null, bestScore = -SCORE.INFINITY;
    let searched = 0;

    if (isRoot) this._rootMoveScores.length = 0;

    for (let i = 0; i < moves.length; i++) {
      const move = isRoot ? moves[i] : pickMove(moves, i);
      const isCapture = move.capturedPiece !== null;
      const losingCapture = isCapture && move.seeScore < 0;

      if (this._shouldPrune(move, depth, alpha, staticEval, canFutility, searched,
                            isPvNode, inCheck, losingCapture)) continue;

      const nodesBefore = this.nodes;
      board.makeMove(move.fromSquare, move.toSquare, move.promotionPiece);
      const givesCheck = isInCheck(board, oppositeColor);
      const reduction = this._computeReduction(depth, searched, move, inCheck, givesCheck, losingCapture, isCapture);

      const score = isRoot
        ? this._searchRootMove(board, move, depth, alpha, beta, oppositeColor, extension, reduction, searched, wantTrueRootScores)
        : this._searchChild(board, move, depth, alpha, beta, oppositeColor, ply, extension, reduction, searched);

      board.undoMove();
      searched++;
      if (this.stopSearch) return 0;

      if (isRoot) this._recordRootMove(move, score, wantTrueRootScores, nodesBefore, c);

      if (__LOG__ && LOG.search) logger.trace(CAT.SEARCH, 'node', { d: depth, p: ply, a: alpha, b: beta, mc: searched });

      if (score > bestScore) { bestScore = score; bestMove = move; }
      if (bestScore > alpha) alpha = bestScore;

      if (bestScore >= beta) {
        this._onBetaCutoff(moves, i, move, ply, depth, isCapture, lastMove, color);
        if (c) c.onCutoff(ply, move, 'beta');
        if (!wantTrueRootScores) break;
      }
    }

    if (bestMove === null) bestMove = moves[0];
    this._storeTT(board.gameState.zobristKey, depth, bestScore, alphaOrig, beta, bestMove);
    if (isRoot) this._rootBestMove = bestMove;
    return bestScore;
  }

  _shouldPrune(move, depth, alpha, staticEval, canFutility, searched, isPvNode, inCheck, losingCapture) {
    if (searched === 0) return false;
    if (canFutility && move.capturedPiece === null && !move.isPromotion &&
        staticEval + FUTILITY_MARGIN[depth] <= alpha) {
      this.stats.futilityCutoffs++;
      return true;
    }
    if (this.config.useSEEPruning && losingCapture && !isPvNode && !inCheck &&
        depth <= 4 && move.seeScore < -50 * depth) {
      this.stats.seePrunes++;
      return true;
    }
    return false;
  }

  _computeReduction(depth, searched, move, inCheck, givesCheck, losingCapture, isCapture) {
    const reducible = !move.isPromotion && (!isCapture || losingCapture);
    if (!this.config.useLateMovereduction || searched < 4 || depth < 3) return 0;
    if (!reducible || inCheck || givesCheck || move.isKiller) return 0;
    let r = Math.floor(Math.log2(depth) * Math.log2(searched + 1) * 0.5);
    if (losingCapture) r++;
    r = Math.max(1, Math.min(r, depth - 2));
    this.stats.lmrSearches++;
    return r;
  }

  _searchRootMove(board, move, depth, alpha, beta, oppositeColor, extension, reduction, searched, wantTrue) {
    const full = depth - 1 + extension;

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

  _searchChild(board, move, depth, alpha, beta, oppositeColor, ply, extension, reduction, searched) {
    const full = depth - 1 + extension;
    if (this.config.usePVS && searched > 0) {
      return this._pvsSearch(board, full, alpha, beta, oppositeColor, ply + 1, move, reduction, false);
    }
    let s = -this.alphaBeta(board, full - reduction, -beta, -alpha, oppositeColor, ply + 1, move);
    if (reduction > 0 && s > alpha) {
      this.stats.lmrResearches++;
      s = -this.alphaBeta(board, full, -beta, -alpha, oppositeColor, ply + 1, move);
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

  _recordRootMove(move, score, wantTrue, nodesBefore, c) {
    const exact = wantTrue || this._rootMoveExact;
    if (exact) this.stats.rootVerified++;
    this._rootMoveScores.push({ move, score, exact, orderScore: move.orderScore, nodes: this.nodes - nodesBefore });
    if (c) c.onRootMove(move, score, this.nodes - nodesBefore);
  }

  _onBetaCutoff(moves, i, move, ply, depth, isCapture, lastMove, color) {
    this.moveOrderer.addKiller(move, ply);
    if (!isCapture) {
      this.moveOrderer.updateHistory(move, depth, true);
      this.moveOrderer.updateCounterMove(lastMove, color === 'white' ? 1 : 0, move);
    }
    for (let j = 0; j < i; j++) {
      if (moves[j].capturedPiece === null) this.moveOrderer.updateHistory(moves[j], depth, false);
    }
  }

  _storeTT(key, depth, bestScore, alphaOrig, beta, bestMove) {
    if (this.tt && !this.stopSearch) {
      this.tt.store(key, depth, scoreToTT(bestScore, 0), nodeFlag(bestScore, alphaOrig, beta), bestMove);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PV extraction
  // ═══════════════════════════════════════════════════════════════════════

  extractPV(board, maxLen) {
    this.pv = [];
    if (!this.tt) return;
    const seen = this._pvKeys;
    seen.length = 0;
    let made = 0;

    for (let i = 0; i < maxLen; i++) {
      const key = board.gameState.zobristKey;
      if (this._keySeenBefore(seen, key)) break;
      seen.push(key);

      const enc = this.tt.getBestMove(key);
      if (enc === 0) break;

      const from = decodeFrom(enc), to = decodeTo(enc), promo = decodePromo(enc) || null;
      this.pv.push({ fromSquare: from, toSquare: to, promotionPiece: promo, algebraic: encodedToAlgebraic(enc) });
      board.makeMove(from, to, promo);
      made++;
    }
    for (let i = 0; i < made; i++) board.undoMove();
  }

  _keySeenBefore(seen, key) {
    for (let j = 0; j < seen.length; j++) if (seen[j] === key) return true;
    return false;
  }
}

export default SearchEngine;