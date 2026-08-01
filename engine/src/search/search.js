/**
 * Iterative-deepening alpha-beta with PVS, null-move, LMR and futility pruning.
 */
import { SCORE, PIECES, PIECE_VALUES } from '../core/constants.js';
import { generateMoves, listForPly, freshList, isInCheck, moveAlgebraic } from '../core/moveGeneration.js';
import { Evaluator } from '../evaluation/evaluate.js';
import { MoveOrderer } from './moveOrdering.js';
import { quiescenceSearch } from './quiescence.js';
import { TranspositionTable, TT_FLAG, decodeFrom, decodeTo, decodePromo } from '../tables/transposition.js';
import { SIDE_KEYS, EN_PASSANT_KEYS, getEnPassantZobristIndex } from '../tables/zobrist.js';
import { detectGameStage, checkOpeningPrinciples, GAME_STAGE } from '../utils/gameStage.js';
import { indexToSquare } from '../core/bitboard.js';
import logger, { LOG } from '../logging/logger.js';

const __LOG__ = globalThis.__LOG__ ?? true;

const FUTILITY_MARGIN = [0, 150, 300, 450];
const ASPIRATION_WINDOW = 50;
const ASPIRATION_MIN_DEPTH = 5;

// Null-move hash delta: flipping the side to move and clearing any en-passant
// file. Previously a magic constant (0xABCDEF0123456789n), which produced TT
// keys unrelated to the actual position — correct only because it was undone.
const SIDE_FLIP_KEY = SIDE_KEYS[0] ^ SIDE_KEYS[1];
const EP_NONE_KEY = EN_PASSANT_KEYS[16];

const PROMO_SUFFIX = ['', 'q', 'r', 'b', 'n'];

/**
 * Mate scores are stored relative to the ROOT but are computed relative to the
 * current node. A score of MATE-ply at ply 5 means the same mate as MATE-ply at
 * ply 9 from a different path, so it must be normalised on the way into the TT
 * and de-normalised on the way out. Without this, a mate score retrieved at a
 * different ply is wrong by the ply delta — which shows up as mate-in-N
 * oscillation, or a mate score leaking into a non-mating line.
 */
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
  return board.bbPieces[idx][PIECES.QUEEN].popCount()  > 0 ||
         board.bbPieces[idx][PIECES.ROOK].popCount()   > 0 ||
         board.bbPieces[idx][PIECES.BISHOP].popCount() > 0 ||
         board.bbPieces[idx][PIECES.KNIGHT].popCount() > 0;
}

function encodedToAlgebraic(enc) {
  if (enc === 0) return null;
  return indexToSquare(decodeFrom(enc)) + indexToSquare(decodeTo(enc)) + PROMO_SUFFIX[decodePromo(enc)];
}

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
      drawContemptMax:       config.drawContemptMax       ?? 50,
      maxSearchTime:         config.maxSearchTime         ?? 30000,
      ...config,
    };

    this.evaluator   = new Evaluator(this.config);
    this.moveOrderer = new MoveOrderer(this.config);
    this.tt = this.config.useTranspositionTable ? new TranspositionTable(64) : null;

    this.nodes = 0; this.qNodes = 0; this.maxDepthReached = 0;
    this.searchStartTime = 0; this.stopSearch = false;
    this.searchColor = 'white'; this.pv = [];
    this._rootBestMove = null; this._rootMoveScores = [];
    this._collector = null; this._bookHints = null; this._stageInfo = null;
    this._pvKeys = [];           // reused by extractPV, see below
    this.stats = this._emptyStats();
  }

  _emptyStats() {
    return { ttHits: 0, ttCutoffs: 0, nullMoveCutoffs: 0, futilityCutoffs: 0,
             lmrSearches: 0, lmrResearches: 0, pvsResearches: 0, seePrunes : 0 };
  }

  resetSearchState() {
    this.nodes = 0; this.qNodes = 0; this.maxDepthReached = 0;
    this.stopSearch = false; this.pv = [];
    this._rootBestMove = null; this._rootMoveScores = [];
    this.stats = this._emptyStats();
    this.tt?.newSearch();
    this.moveOrderer.prepareNewSearch();
  }

  /** Material-aware draw contempt: avoid draws when winning, seek them when losing. */
  _drawContempt(board, ply) {
    const balance = quickMaterialBalance(board, this.searchColor);
    const absBalance = Math.abs(balance);
    const cap = this.config.drawContemptMax;
    const absContempt = absBalance > 50 ? Math.min(cap, Math.floor(absBalance / 10)) : 1;
    const fromSearchPOV = balance > 50 ? -absContempt : balance < -50 ? absContempt : -1;
    return (ply & 1) ? -fromSearchPOV : fromSearchPOV;
  }

  search(board, maxDepth = null, options = {}) {
    this.resetSearchState();
    this.searchStartTime = Date.now();
    this.searchColor = board.gameState.activeColor;

    this._collector = options.collector || null;
    this._bookHints = options.bookHints || null;

    // Stage info is only consumed by opening-principle ordering and by stage
    // logging. Computing it allocates several arrays, so skip it when neither
    // consumer is active.
    const wantStage = this.config.useOpeningPrinciples || (__LOG__ && LOG.stage);
    const stageInfo = wantStage ? detectGameStage(board) : null;
    this._stageInfo = stageInfo;

    const depth = maxDepth || this.config.maxDepth;
    const maxTime = this.config.maxSearchTime;
    const c = this._collector;

    if (__LOG__ && (LOG.search || LOG.stage)) {
      logger.startTurn(board.toFen(), this.searchColor, stageInfo);
    }

    let bestMove = null;
    let bestScore = 0;
    let lastIterTime = 0;

    for (let d = 1; d <= depth; d++) {
      if (this.stopSearch) break;

      // If the previous iteration already ate a third of the budget, the next
      // one (3-5× the nodes) will blow through it. Stop rather than block the
      // event loop.
      const elapsed = Date.now() - this.searchStartTime;
      if (d > 1 && elapsed + lastIterTime * 3 > maxTime) {
        if (__LOG__ && LOG.search) {
          logger.search('info', { depth: d, elapsed, lastIterTime }, 'time-budget stop');
        }
        break;
      }

      const iterStart = Date.now();
      if (c) c.onIterationStart?.(d);

      let alpha = -SCORE.INFINITY, beta = SCORE.INFINITY, delta = ASPIRATION_WINDOW;
      if (this.config.useAspirationWindows && d >= ASPIRATION_MIN_DEPTH &&
          Math.abs(bestScore) < SCORE.MATE_THRESHOLD) {
        alpha = bestScore - delta;
        beta  = bestScore + delta;
      }

      let score;
      for (let attempt = 0; attempt < 5; attempt++) {
        score = this.alphaBeta(board, d, alpha, beta, this.searchColor, 0, null);
        if (this.stopSearch) break;
        if      (score <= alpha) { alpha = Math.max(-SCORE.INFINITY, alpha - delta); delta *= 2; }
        else if (score >= beta)  { beta  = Math.min( SCORE.INFINITY, beta  + delta); delta *= 2; }
        else break;
      }
      if (this.stopSearch) break;

      lastIterTime = Date.now() - iterStart;

      if (this._rootBestMove) {
        bestMove = this._rootBestMove;
        bestScore = score;
        this.extractPV(board, d);

        if (__LOG__ && LOG.search) {
          logger.search('info',
            { d, best: bestMove.algebraic, cp: bestScore, nodes: this.nodes,
              pv: this.pv.map(m => m.algebraic).join(' ') },
            `d${d} ${bestMove.algebraic} cp=${bestScore}`);
        }
        if (Math.abs(bestScore) > SCORE.MATE_THRESHOLD) break;
      }
    }

    const totalTime = Date.now() - this.searchStartTime;

    if (__LOG__ && (LOG.search || LOG.stage)) {
      if (stageInfo?.stage === GAME_STAGE.OPENING && bestMove && this.config.useOpeningPrinciples) {
        const oa = checkOpeningPrinciples(board, bestMove, this.searchColor);
        if (oa.violations.length > 0) {
          logger.addTurnWarning('opening_violation',
            `${bestMove.algebraic}: ${oa.violations.map(v => v.principle).join(', ')}`);
        }
      }
      for (const rm of this._rootMoveScores) {
        logger.recordCandidateMove(rm.move, rm.score, rm.orderScore, null);
      }
      logger.finalizeTurn(bestMove, { score: bestScore, depth: this.maxDepthReached,
        nodes: this.nodes, qNodes: this.qNodes, time: totalTime, pv: this.pv, stats: this.stats });
    }

    this._collector = null; this._bookHints = null; this._stageInfo = null;

    return { bestMove, score: bestScore, nodes: this.nodes, qNodes: this.qNodes,
             depth: this.maxDepthReached, time: totalTime, pv: this.pv,
             stats: this.stats, stageInfo };
  }

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
    if (!isRoot) {
      if (board.gameState.halfMoveClock >= 100) return this._drawContempt(board, ply);
      if (board.isRepetition(2))                return this._drawContempt(board, ply);
    }
    // ── TT probe (before generation: a cutoff here skips move generation) ──
    let ttMove = 0;
    const key = board.gameState.zobristKey;
    if (this.tt) {
      const tt = this.tt.probe(key, depth, alpha, beta);
      if (tt.hit) {
        this.stats.ttHits++;
        ttMove = tt.move;
        if (!isRoot && tt.usable) { this.stats.ttCutoffs++; return scoreFromTT(tt.score, ply); }
      }
    }
    if (depth <= 0) {
      if (this.config.useQuiescence) {
        this.qNodes++;
        return quiescenceSearch(board, alpha, beta, color, this.evaluator,
                                ply, 0, this.config.quiescenceDepth);
      }
      return this.evaluator.evaluate(board, color).score;
    }
    // IID re-enters at THIS ply, so it must run before we populate our own
    // pooled move list.
    if (this.config.useIID && ttMove === 0 && depth >= 4 && isPvNode && this.tt) {
      this.alphaBeta(board, Math.max(1, depth - 3), alpha, beta, color, ply, lastMove);
      ttMove = this.tt.getBestMove(key);
    }
    // ── Generate ──
    // Root gets a fresh list: bestMove, _rootMoveScores and the logger's
    // candidate records all outlive the node, and pooled objects are recycled
    // by the next generation at that ply.
    const moves = generateMoves(board, color, isRoot ? freshList() : listForPly(ply), false, isRoot);
    if (moves.length === 0) {
      if (inCheck) return -(SCORE.MATE - ply);
      return this._drawContempt(board, ply);
    }

    // ── Null-move pruning ──
    if (this.config.useNullMovePruning && depth >= 3 && !isRoot && !inCheck && !isPvNode &&
        hasNonPawnMaterial(board, color)) {
      const R = depth > 6 ? 3 : 2;
      const gs = board.gameState;
      const savedEp = gs.enPassantSquare;
      const savedColor = gs.activeColor;
      const savedKey = gs.zobristKey;

      gs.enPassantSquare = -1;
      gs.activeColor = oppositeColor;
      // Real incremental hash update for "same position, other side to move,
      // no en-passant" — so the child's TT entries are keyed on a position
      // that actually exists in the hash space.
      gs.zobristKey ^= SIDE_FLIP_KEY;
      if (savedEp !== -1) {
        gs.zobristKey ^= EN_PASSANT_KEYS[getEnPassantZobristIndex(savedEp)] ^ EP_NONE_KEY;
      }

      const nullScore = -this.alphaBeta(board, depth - R - 1, -beta, -beta + 1,
                                        oppositeColor, ply + 1, null);

      gs.enPassantSquare = savedEp;
      gs.activeColor = savedColor;
      gs.zobristKey = savedKey;

      if (nullScore >= beta) {
        this.stats.nullMoveCutoffs++;
        if (c) c.onCutoff(ply, null, 'null');
        return beta;
      }
    }

    let staticEval = 0;
    const canFutility = this.config.useFutilityPruning && depth <= 3 && !inCheck && !isPvNode &&
                        Math.abs(alpha) < SCORE.MATE_THRESHOLD;
    if (canFutility) staticEval = this.evaluator.evaluate(board, color).score;

    const bookHints = isRoot ? this._bookHints : null;
    this.moveOrderer.orderMoves(moves, ply, board, color, ttMove, lastMove, bookHints);

    if (isRoot && this._stageInfo?.stage === GAME_STAGE.OPENING && this.config.useOpeningPrinciples) {
      this._adjustForOpeningPrinciples(moves, board, color);
    }
    if (c && isRoot) c.onMoveOrdering(ply, moves);
    if (__LOG__ && LOG.moveOrder && isRoot) {
      logger.moveOrderPoint(ply, moves[0].algebraic, moves[0].orderScore, moves.length);
    }

    const extension = inCheck ? 1 : 0;
    let bestMove = moves[0], bestScore = -SCORE.INFINITY;
    let nodeType = TT_FLAG.UPPER_BOUND, searched = 0;

    if (isRoot) this._rootMoveScores.length = 0;

    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      const isCapture = move.capturedPiece !== null;
      const isPromotion = move.isPromotion;
      // seeScore is set by orderMoves for captures, 0 otherwise.
      const losingCapture = isCapture && move.seeScore < 0;
      if (canFutility && searched > 0 && !isCapture && !isPromotion &&
          staticEval + FUTILITY_MARGIN[depth] <= alpha) {
        this.stats.futilityCutoffs++;
        continue;
      }
      // SEE pruning: at shallow depth, skip captures that statically lose
      // material. The margin scales with depth so deep nodes stay exact.
      // Without this, losing captures were not only ordered in the winning
      // tier, they were also exempt from every pruning rule — full depth for
      // QxR-into-a-pawn, reduced depth for the quiet move that won a piece.
      if (this.config.useSEEPruning && losingCapture && !isPvNode && !inCheck &&
          depth <= 4 && searched > 0 && move.seeScore < -50 * depth) {
        this.stats.seePrunes++;
        continue;
      }
      const nodesBefore = this.nodes;
      board.makeMove(move.fromSquare, move.toSquare, move.promotionPiece);
      const givesCheck = isInCheck(board, oppositeColor);
      let reduction = 0;
      // Captures are no longer blanket-exempt from LMR — only non-losing ones.
      // A SEE-negative capture is a worse candidate than most quiet moves and
      // should be reduced like one.
      const reducible = !isPromotion && (!isCapture || losingCapture);
      if (this.config.useLateMovereduction && searched >= 4 && depth >= 3 &&
          reducible && !inCheck && !givesCheck && !move.isKiller) {
        reduction = Math.floor(Math.log2(depth) * Math.log2(searched + 1) * 0.5);
        if (losingCapture) reduction++;           // extra trim for bad captures
        reduction = Math.max(1, Math.min(reduction, depth - 2));
        this.stats.lmrSearches++;
      }

      // Tests attach a collector and need a true minimax value for EVERY root
      // move, which means no window narrowing and no early exit at the root.
      const wantTrueRootScores = isRoot && c !== null;

      let score;
      if (wantTrueRootScores) {
        score = -this.alphaBeta(board, depth - 1 + extension,
                                -SCORE.INFINITY, SCORE.INFINITY, oppositeColor, ply + 1, move);
      } else if (this.config.usePVS && searched > 0) {
        score = -this.alphaBeta(board, depth - 1 + extension - reduction,
                                -alpha - 1, -alpha, oppositeColor, ply + 1, move);
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

      if (isRoot) {
        const moveNodes = this.nodes - nodesBefore;
        this._rootMoveScores.push({ move, score, orderScore: move.orderScore, nodes: moveNodes });
        if (c) c.onRootMove(move, score, moveNodes);
      }

      if (__LOG__ && LOG.search) logger.searchNode(depth, ply, alpha, beta, searched);

      if (score > bestScore) { bestScore = score; bestMove = move; }

      if (score > alpha) {
        alpha = score;
        nodeType = TT_FLAG.EXACT;
        if (alpha >= beta) {
          this.moveOrderer.addKiller(move, ply);
          if (!isCapture) {
            this.moveOrderer.updateHistory(move, depth, true);
            this.moveOrderer.updateCounterMove(lastMove, move);
          }
          for (let j = 0; j < i; j++) {
            if (moves[j].capturedPiece === null) this.moveOrderer.updateHistory(moves[j], depth, false);
          }
          nodeType = TT_FLAG.LOWER_BOUND;
          if (c) c.onCutoff(ply, move, 'beta');
          if (!wantTrueRootScores) break;
        }
      }
    }

    if (this.tt && !this.stopSearch) {
      this.tt.store(key, depth, scoreToTT(bestScore, ply), nodeType, bestMove);
    }
    if (isRoot) {
      this._rootBestMove = bestMove;
      this._rootMoveScores.sort((a, b) => b.score - a.score);
    }
    return bestScore;
  }

  _adjustForOpeningPrinciples(moves, board, color) {
    for (let i = 0; i < moves.length; i++) {
      const a = checkOpeningPrinciples(board, moves[i], color);
      const adj = a.totalBonus + a.totalPenalty;
      if (adj !== 0) moves[i].orderScore += adj;
    }
    moves.sort((a, b) => b.orderScore - a.orderScore);
  }

  /**
   * Walk TT best-moves to build the PV. Loop detection uses a reused BigInt
   * array with linear scan — PVs are ≤ 64 entries, so that beats allocating a
   * Set plus one hex string per ply (the old `key.toString(16)` was pure garbage).
   */
  extractPV(board, maxLen) {
    this.pv = [];
    if (!this.tt) return;

    const seen = this._pvKeys;
    seen.length = 0;
    let made = 0;

    for (let i = 0; i < maxLen; i++) {
      const key = board.gameState.zobristKey;
      let repeat = false;
      for (let j = 0; j < seen.length; j++) if (seen[j] === key) { repeat = true; break; }
      if (repeat) break;
      seen.push(key);

      const enc = this.tt.getBestMove(key);
      if (enc === 0) break;

      const from = decodeFrom(enc), to = decodeTo(enc), promo = decodePromo(enc) || null;
      this.pv.push({ fromSquare: from, toSquare: to, promotionPiece: promo,
                     algebraic: encodedToAlgebraic(enc) });
      board.makeMove(from, to, promo);
      made++;
    }
    for (let i = 0; i < made; i++) board.undoMove();
  }

  stop() { this.stopSearch = true; }

  setOption(name, value) {
    if (name in this.config) this.config[name] = value;
    // Evaluator and MoveOrderer snapshot config at construction time.
    if (name.startsWith('use') || name === 'weights') {
      this.evaluator = new Evaluator(this.config);
      this.moveOrderer = new MoveOrderer(this.config);
    }
  }
}

export default SearchEngine;