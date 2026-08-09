/**
 * Material + piece-square-table evaluation.
 *
 * The `clone().popLSB()` loops allocated one BitBoard per piece type per side
 * per evaluation — 12 per leaf node. Replaced by a single non-destructive
 * iterator reused for all 24 walks (eval is synchronous and never nests).
 */
import { PIECES, PIECE_VALUES } from '../core/constants.js';
import { colorToIndex, BitBoardIterator } from '../core/bitboard.js';
import { getPSTValue } from './pieceSquareTables.js';
import logger, { LOG, CAT } from '../logging/logger.js';

const __LOG__ = globalThis.__LOG__ ?? true;
const PIECE_KEYS = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];

const IT = new BitBoardIterator();

export function evaluateMaterial(board, color, weight = 1.0, gamePhase = 1) {
  const colorIdx = colorToIndex(color);
  const oppIdx = colorIdx ^ 1;
  const isWhite = color === 'white';

  let materialScore = 0;
  let pstScore = 0;

  const wantDetails = __LOG__ && LOG.heuristics;
  const details = wantDetails ? {} : null;

  for (let piece = PIECES.KING; piece <= PIECES.PAWN; piece++) {
    const ourBB = board.bbPieces[colorIdx][piece];
    const theirBB = board.bbPieces[oppIdx][piece];

    const ourCount = ourBB.popCount();
    const theirCount = theirBB.popCount();
    materialScore += (ourCount - theirCount) * PIECE_VALUES[piece];

    let ourPST = 0;
    for (let s = IT.init(ourBB).next(); s >= 0; s = IT.next()) {
      ourPST += getPSTValue(piece, s, isWhite, gamePhase);
    }
    let theirPST = 0;
    for (let s = IT.init(theirBB).next(); s >= 0; s = IT.next()) {
      theirPST += getPSTValue(piece, s, !isWhite, gamePhase);
    }
    pstScore += ourPST - theirPST;

    if (details) {
      details[PIECE_KEYS[piece]] = { ours: ourCount, theirs: theirCount, pst: ourPST - theirPST };
    }
  }

  const weighted = Math.round((materialScore + pstScore) * weight);

  if (__LOG__ && LOG.heuristics) {
    logger.trace(CAT.HEURISTIC, 'center', { c: color, s: weighted });
  }
  
  return weighted;
}