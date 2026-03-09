/**
 * Quiescence search — extend captures/checks until the position is quiet.
 *
 * This is a negamax recursion like the main search. Stand-pat MUST be
 * evaluated from the side-to-move's perspective (`color`), not a fixed
 * root perspective. The previous version used `searchColor`, flipping
 * the sign at odd q-plies and poisoning the TT across iterations.
 */

import { PIECE_VALUES, PIECES, SCORE } from '../core/constants.js';
import { generateAllLegalMoves, isInCheck } from '../core/moveGeneration.js';
import { LOG } from '../logging/logger.js';

// Build-time stripping guard — see search.js.
const __LOG__ = globalThis.__LOG__ ?? true;

const DELTA_MARGIN     = 200;
const DELTA_PER_MOVE   = 100;
const SEE_PRUNE_MARGIN = -200;

/**
 * @param {Board}     board
 * @param {number}    alpha     Lower bound, this node's perspective
 * @param {number}    beta      Upper bound, this node's perspective
 * @param {string}    color     Side to move — eval perspective MUST match this
 * @param {Evaluator} evaluator
 * @param {number}    qDepth    Current q-ply (starts at 0)
 * @param {number}    maxQDepth Cap on q-search depth
 */
export function quiescenceSearch(board, alpha, beta, color, evaluator, qDepth = 0, maxQDepth = 8) {
  // ── Stand-pat ──
  // Negamax rule: eval from THIS node's side-to-move. The parent negates.
  // Using a fixed root-color here was the bug — at odd q-plies it returned
  // the opponent's score into our alpha-beta window.
  const standPat = evaluator.evaluate(board, color).score;

  if (qDepth >= maxQDepth) {
    return standPat;
  }

  const inCheck = isInCheck(board, color);

  // Not in check → may stand pat (decline to capture).
  if (!inCheck) {
    // Fail-high: even doing nothing already beats beta.
    if (standPat >= beta) {
      return beta;
    }
    if (standPat > alpha) {
      alpha = standPat;
    }

    // Big-delta: if even winning a queen can't reach alpha, nothing will.
    // Saves exploring hopeless capture trees.
    const bigDelta = PIECE_VALUES[PIECES.QUEEN] + DELTA_MARGIN;
    if (standPat + bigDelta < alpha) {
      return alpha;
    }
  }

  const oppositeColor = color === 'white' ? 'black' : 'white';
  const allMoves = generateAllLegalMoves(board, color);

  // ── Filter to tactical moves (in-check searches everything) ──
  // Score each tactical move as we filter — avoids the old comparator
  // calling getMoveValue O(n log n) times during sort.
  let tacticalMoves;
  if (inCheck) {
    tacticalMoves = allMoves;   // every evasion is mandatory
    for (let i = 0; i < tacticalMoves.length; i++) {
      tacticalMoves[i]._qScore = scoreTacticalMove(tacticalMoves[i]);
    }
  } else {
    tacticalMoves = [];
    for (let i = 0; i < allMoves.length; i++) {
      const m = allMoves[i];
      if (m.capturedPiece !== null || m.isPromotion) {
        m._qScore = scoreTacticalMove(m);
        tacticalMoves.push(m);
      }
    }
  }

  // No tactical moves left
  if (tacticalMoves.length === 0) {
    if (inCheck) {
      // Checkmate inside q-search. Negamax: always bad for side-to-move.
      // qDepth offset is imprecise (doesn't include main-search ply) —
      // mates found here may sort slightly wrong vs. mates found in the
      // main tree. Acceptable; q-search mates are rare. TODO: thread ply through.
      return -(SCORE.MATE - qDepth);
    }
    return standPat;
  }

  // Sort by precomputed score — comparator does a subtraction, nothing more.
  tacticalMoves.sort((a, b) => b._qScore - a._qScore);

  if (__LOG__ && LOG.search) {
    // Kept minimal — q-search fires far more often than main-search nodes.
    // Building topMoves arrays per call (as before) was a per-q-node alloc.
    console.log(`[Q${qDepth}] ${tacticalMoves.length} tactical, top=${tacticalMoves[0]?.algebraic}`);
  }

  for (let i = 0; i < tacticalMoves.length; i++) {
    const move = tacticalMoves[i];

    // ── Per-move pruning (captures only, not when in check) ──
    if (!inCheck && move.capturedPiece !== null) {
      // Delta: even the best-case gain from this capture can't reach alpha.
      const maxGain = PIECE_VALUES[move.capturedPiece] +
        (move.isPromotion ? PIECE_VALUES[PIECES.QUEEN] - PIECE_VALUES[PIECES.PAWN] : 0);
      if (standPat + maxGain + DELTA_PER_MOVE < alpha) {
        continue;
      }

      // SEE estimate: capturing with a more valuable piece than the victim,
      // by a wide margin, is probably a losing trade. Skip it.
      // (This is a crude SEE — it doesn't look at recaptures. Good enough
      // for pruning obviously-bad QxP in q-search.)
      const seeEstimate = PIECE_VALUES[move.capturedPiece] - PIECE_VALUES[move.piece];
      if (seeEstimate < SEE_PRUNE_MARGIN) {
        continue;
      }
    }

    board.makeMove(move.fromSquare, move.toSquare, move.promotionPiece);
    const score = -quiescenceSearch(board, -beta, -alpha, oppositeColor, evaluator, qDepth + 1, maxQDepth);
    board.undoMove();

    if (score >= beta) {
      return beta;
    }
    if (score > alpha) {
      alpha = score;
    }
  }

  return alpha;
}

/**
 * MVV-LVA + promotion bonus. Computed once per move, stored on the move,
 * then used by sort comparator.
 */
function scoreTacticalMove(move) {
  let v = 0;
  if (move.capturedPiece !== null) {
    // Most-valuable-victim × 10 dominates; least-valuable-attacker breaks ties.
    v += PIECE_VALUES[move.capturedPiece] * 10 - PIECE_VALUES[move.piece];
  }
  if (move.isPromotion) {
    v += PIECE_VALUES[move.promotionPiece || PIECES.QUEEN];
  }
  return v;
}

export default quiescenceSearch;