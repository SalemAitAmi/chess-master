/**
 * Quiescence search — extend captures/promotions (and all evasions when in
 * check) until the position is quiet.
 *
 * `ply` is the ABSOLUTE distance from the search root, threaded through from
 * alphaBeta. Mate scores returned from here are therefore directly comparable
 * to mates found in the main tree; previously they used qDepth alone, so a
 * mate found 3 q-plies into a 10-ply line scored as mate-in-3.
 */
import { PIECE_VALUES, PIECES, SCORE } from '../core/constants.js';
import { generateMoves, listForPly, isInCheck, moveAlgebraic } from '../core/moveGeneration.js';
import { see, seeFast } from './see.js';
import logger, { LOG, CAT } from '../logging/logger.js';

const __LOG__ = globalThis.__LOG__ ?? true;

const DELTA_MARGIN   = 200;
const DELTA_PER_MOVE = 100;

export function quiescenceSearch(
  board, alpha, beta, color, evaluator, ply = 0, qDepth = 0, maxQDepth = 8
) {
  const standPat = evaluator.evaluate(board, color).score;
  if (qDepth >= maxQDepth) return standPat;

  const inCheck = isInCheck(board, color);

  if (!inCheck) {
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (standPat + PIECE_VALUES[PIECES.QUEEN] + DELTA_MARGIN < alpha) return alpha;
  }

  const oppositeColor = color === 'white' ? 'black' : 'white';

  // Captures-only generation (the generator ignores the flag when in check, so
  // evasions are complete). Previously this generated every legal move and
  // filtered — ~35 move objects per q-node to keep 4.
  const moves = generateMoves(board, color, listForPly(ply), true, false);

  if (moves.length === 0) {
    if (inCheck) return -(SCORE.MATE - ply);   // absolute ply → comparable to main-tree mates
    return standPat;
  }

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    m.seeScore = m.capturedPiece !== null ? seeFast(board, m) : 0;
    m._qScore = scoreTacticalMove(m);
  }
  moves.sort((a, b) => b._qScore - a._qScore);

  if (__LOG__ && LOG.search) {
    logger.trace(CAT.SEARCH, 'qnode', { q: qDepth, ply, n: moves.length, top: moveAlgebraic(moves[0]) });
  }

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];

    if (!inCheck && move.capturedPiece !== null) {
      // Delta pruning: even the best case can't reach alpha.
      const maxGain = PIECE_VALUES[move.capturedPiece] +
        (move.isPromotion ? PIECE_VALUES[PIECES.QUEEN] - PIECE_VALUES[PIECES.PAWN] : 0);
      if (standPat + maxGain + DELTA_PER_MOVE < alpha) continue;

      // SEE pruning. The old test was `victim - attacker < -200`, which ignored
      // whether the victim was defended:
      //   QxR with the rook UNDEFENDED  → 500-900 = -400 → pruned (free rook missed!)
      //   NxB with the bishop defended by a pawn → 330-320 = +10 → explored,
      //   and the recapture could fall outside the q-horizon, so the engine
      //   banked 330 and never paid the 320.
      // A real SEE answers both correctly.
      if (move.seeScore < 0) continue;
    }

    board.makeMove(move.fromSquare, move.toSquare, move.promotionPiece);
    const score = -quiescenceSearch(board, -beta, -alpha, oppositeColor, evaluator,
                                    ply + 1, qDepth + 1, maxQDepth);
    board.undoMove();

    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function scoreTacticalMove(move) {
  // SEE-first ordering: winning captures, then equal, then promotions, then
  // losing ones (which are pruned above unless we're in check).
  let v = move.seeScore * 16;
  if (move.capturedPiece !== null) {
    v += PIECE_VALUES[move.capturedPiece] - PIECE_VALUES[move.piece] / 16;
  }
  if (move.isPromotion) v += PIECE_VALUES[move.promotionPiece ?? PIECES.QUEEN];
  return v;
}

export default quiescenceSearch;