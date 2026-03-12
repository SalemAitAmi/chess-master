/**
 * Layer-by-layer introspection for debugging and testing.
 * 
 * CRITICAL FIX: evalComponents now uses the exact same phase calculation
 * as the production Evaluator, ensuring test coverage matches production.
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

// ═══════════════════════════════════════════════════════════════════════════
// Phase calculation — MUST match evaluate.js exactly
// ═══════════════════════════════════════════════════════════════════════════

const PHASE_KNIGHT = 1;
const PHASE_BISHOP = 1;
const PHASE_ROOK = 2;
const PHASE_QUEEN = 4;
const MAX_PHASE = 24;

function computePhase(board) {
  const wp = board.bbPieces[WHITE_IDX];
  const bp = board.bbPieces[BLACK_IDX];
  return (wp[PIECES.KNIGHT].popCount() + bp[PIECES.KNIGHT].popCount()) * PHASE_KNIGHT
       + (wp[PIECES.BISHOP].popCount() + bp[PIECES.BISHOP].popCount()) * PHASE_BISHOP
       + (wp[PIECES.ROOK].popCount() + bp[PIECES.ROOK].popCount()) * PHASE_ROOK
       + (wp[PIECES.QUEEN].popCount() + bp[PIECES.QUEEN].popCount()) * PHASE_QUEEN;
}

// Mop-up calculation matching evaluate.js
function computeMopUp(board, color, endgameWeight) {
  if (endgameWeight < 0.5) return 0;
  
  const usIdx = color === 'white' ? WHITE_IDX : BLACK_IDX;
  const oppIdx = usIdx ^ 1;
  
  const ourMat = board.bbPieces[usIdx][PIECES.QUEEN].popCount()
               + board.bbPieces[usIdx][PIECES.ROOK].popCount()
               + board.bbPieces[usIdx][PIECES.BISHOP].popCount()
               + board.bbPieces[usIdx][PIECES.KNIGHT].popCount()
               + board.bbPieces[usIdx][PIECES.PAWN].popCount();
  const oppMat = board.bbPieces[oppIdx][PIECES.QUEEN].popCount()
               + board.bbPieces[oppIdx][PIECES.ROOK].popCount()
               + board.bbPieces[oppIdx][PIECES.BISHOP].popCount()
               + board.bbPieces[oppIdx][PIECES.KNIGHT].popCount()
               + board.bbPieces[oppIdx][PIECES.PAWN].popCount();
  
  let sign;
  if (oppMat === 0 && ourMat > 0) sign = 1;
  else if (ourMat === 0 && oppMat > 0) sign = -1;
  else return 0;
  
  const ourKingSq = board.bbPieces[usIdx][PIECES.KING].getLSB();
  const oppKingSq = board.bbPieces[oppIdx][PIECES.KING].getLSB();
  if (ourKingSq < 0 || oppKingSq < 0) return 0;
  
  const defKingSq = sign === 1 ? oppKingSq : ourKingSq;
  const atkKingSq = sign === 1 ? ourKingSq : oppKingSq;
  
  const defF = defKingSq & 7, defR = defKingSq >> 3;
  const df = defF < 4 ? 3 - defF : defF - 4;
  const dr = defR < 4 ? 3 - defR : defR - 4;
  const cmd = df + dr;
  let edgePush = cmd * cmd * 8;
  if (defF === 0 || defF === 7 || defR === 0 || defR === 7) edgePush += 40;
  
  const atkF = atkKingSq & 7, atkR = atkKingSq >> 3;
  const kingDist = Math.max(Math.abs(atkF - defF), Math.abs(atkR - defR));
  const proximity = Math.max(0, 14 - 2 * kingDist) * 6;
  
  return sign * Math.round((edgePush + proximity) * endgameWeight);
}

// ═══════════════════════════════════════════════════════════════════════════
// Layer 0: Position utilities
// ═══════════════════════════════════════════════════════════════════════════

export function legalMoves(fen) {
  const board = Board.fromFen(fen);
  const color = board.gameState.activeColor;
  const moves = generateAllLegalMoves(board, color);
  return {
    fen, color, count: moves.length, inCheck: isInCheck(board, color),
    moves: moves.map(m => m.algebraic).sort(),
  };
}

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

// ═══════════════════════════════════════════════════════════════════════════
// Layer 1: Static evaluation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate a position and return per-component breakdown.
 * Uses the EXACT same phase calculation as the production Evaluator.
 */
export function evalComponents(fen, color = null, weights = {}) {
  const board = Board.fromFen(fen);
  color = color || board.gameState.activeColor;
  
  // Phase calculation matching Evaluator._computePhase
  const phase = computePhase(board);
  const gamePhase = phase >= MAX_PHASE ? 1 : phase / MAX_PHASE;
  const endgameWeight = 1 - gamePhase;
  const moveCount = board.plyCount;
  
  const w = { material: 1, centerControl: 1, development: 1, pawnStructure: 1, kingSafety: 1, ...weights };
  
  // Call sub-modules with EXACT same parameters as evaluate.js
  const components = {
    material: evaluateMaterial(board, color, w.material, gamePhase),
    centerControl: evaluateCenterControl(board, color, w.centerControl * (0.5 + 0.5 * gamePhase)),
    development: evaluateDevelopment(board, color, moveCount, w.development),
    pawnStructure: evaluatePawnStructure(board, color, w.pawnStructure),
    kingSafety: evaluateKingSafety(board, color, endgameWeight, w.kingSafety),
    mopUp: computeMopUp(board, color, endgameWeight),
  };
  
  const total = Object.values(components).reduce((s, v) => s + v, 0);
  
  return {
    fen, color, total, components,
    context: { phase, gamePhase, endgameWeight, moveCount },
  };
}

export function evalSymmetry(fen) {
  const white = evalComponents(fen, 'white');
  const black = evalComponents(fen, 'black');
  const asymmetry = white.total + black.total;

  const componentAsymmetry = {};
  for (const k of Object.keys(white.components)) {
    componentAsymmetry[k] = white.components[k] + black.components[k];
  }

  return { white, black, asymmetry, componentAsymmetry };
}

export function evalLine(fen, moves, { perspective = null } = {}) {
  const board = Board.fromFen(fen);
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
      context: ec.context,
    });
  };

  record(null);

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
    mopUp: s.components.mopUp,
    TOTAL: s.total,
  })));
}

// ═══════════════════════════════════════════════════════════════════════════
// Layer 2: Quiescence
// ═══════════════════════════════════════════════════════════════════════════

export function traceQSearch(fen, { maxQDepth = 8, config = {} } = {}) {
  const board = Board.fromFen(fen);
  const color = board.gameState.activeColor;
  const basePly = board.plyCount;

  const realEval = new Evaluator(config);
  const trace = [];

  const tracingEvaluator = {
    evaluate(b, c) {
      const r = realEval.evaluate(b, c);
      trace.push({
        qDepth: b.plyCount - basePly,
        fen: b.toFen(),
        color: c,
        standPat: r.score,
        inCheck: isInCheck(b, c),
      });
      return r;
    },
  };

  const score = quiescenceSearch(
    board, -SCORE.INFINITY, SCORE.INFINITY, color, tracingEvaluator, 0, maxQDepth
  );

  const pv = [];
  let expectDepth = 0;
  for (const node of trace) {
    if (node.qDepth === expectDepth) {
      pv.push(node);
      expectDepth++;
    } else if (node.qDepth <= pv.length - 1) {
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

// ═══════════════════════════════════════════════════════════════════════════
// Layer 3: Move ordering
// ═══════════════════════════════════════════════════════════════════════════

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
    tier: m.isTTMove ? 'TT'
        : m.isBookMove ? 'BOOK'
        : m.isPromotion ? 'PROMO'
        : m.capturedPiece !== null ? 'CAPTURE'
        : m.isKiller ? 'KILLER'
        : m.isCounterMove ? 'COUNTER'
        : m.orderScore > 0 ? 'HISTORY'
        : 'QUIET',
    capture: m.capturedPiece !== null ? m.capturedPiece : null,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Layer 4: Single-depth search
// ═══════════════════════════════════════════════════════════════════════════

export function searchOnce(fen, depth, { config = {}, bookHints = null } = {}) {
  const board = Board.fromFen(fen);
  const engine = new SearchEngine({ ...DEFAULT_CONFIG, ...config });
  const collector = new DecisionCollector();

  engine.resetSearchState();
  engine.searchColor = board.gameState.activeColor;
  engine._collector = collector;
  engine._bookHints = bookHints;
  engine._stageInfo = null;

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
    consistent: engine._rootBestMove?.algebraic === roots[0]?.move,
  };
}

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

// ═══════════════════════════════════════════════════════════════════════════
// Layer 5: Move expansion
// ═══════════════════════════════════════════════════════════════════════════

export function expandMove(fen, moveAlgebraic, replyDepth = 2, config = {}) {
  const childBoard = afterMove(fen, moveAlgebraic);
  const childFen = childBoard.toFen();
  const reply = searchOnce(childFen, replyDepth, { config });

  return {
    move: moveAlgebraic,
    childFen,
    scoreForMover: -reply.score,
    opponentBest: reply.bestMove,
    opponentReplies: reply.rootMoves.map(m => ({
      reply: m.move,
      opponentScore: m.score,
      moverScore: -m.score,
    })),
  };
}