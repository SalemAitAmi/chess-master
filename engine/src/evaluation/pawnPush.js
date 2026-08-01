/**
 * Pawn double-push bonus for move ordering.
 */
import { PIECES } from '../core/constants.js';
import { colorToIndex } from '../core/bitboard.js';
import logger, { LOG } from '../logging/logger.js';

const __LOG__ = globalThis.__LOG__ ?? true;
const CENTRAL_SQUARES = [27, 28, 35, 36];   // d4 e4 d5 e5

export function evaluatePawnPush(move, board, color) {
  if (move.piece !== PIECES.PAWN) return 0;

  // Squares, not [row,col] tuples — the generator no longer produces tuples.
  const fromRank = move.fromSquare >> 3;
  const toRank = move.toSquare >> 3;
  if (Math.abs(toRank - fromRank) !== 2) return 0;

  const file = move.fromSquare & 7;
  let bonus = 15;
  if (file === 3 || file === 4) bonus += 20;
  else if (file === 2 || file === 5) bonus += 10;

  // NOTE: the old "blocks our own bishop's diagonal" penalty was unreachable.
  // It tested `toRow === 5` for white, but a white double push always lands on
  // row 3 (rank 4), so the branch never fired for either colour. Removed
  // rather than fixed: the case it was aiming at (pushing a pawn in front of
  // an undeveloped bishop) is already covered by the development term.

  const oppPawns = board.bbPieces[colorToIndex(color) ^ 1][PIECES.PAWN];
  let oppInCentre = false;
  for (let i = 0; i < CENTRAL_SQUARES.length; i++) {
    if (oppPawns.getBit(CENTRAL_SQUARES[i])) { oppInCentre = true; break; }
  }
  if (oppInCentre && file >= 2 && file <= 5) bonus += 15;

  if (__LOG__ && LOG.heuristics) {
    logger.heuristics('trace', { h: 'pawnPush', c: color, s: bonus, file }, `push ${bonus}`);
  }
  return bonus;
}