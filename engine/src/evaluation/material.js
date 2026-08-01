/**
 * Material + piece-square-table evaluation.
 *
 * Called once per leaf and once per quiescence node. The previous version
 * built a nested `details.material` / `details.pst` object graph and invoked
 * logger.heuristicCalc() unconditionally — the guard was inside the logger,
 * so the allocation happened even with logging disabled.
 */
import { PIECES, PIECE_VALUES } from '../core/constants.js';
import { colorToIndex } from '../core/bitboard.js';
import { getPSTValue } from './pieceSquareTables.js';
import logger, { LOG } from '../logging/logger.js';

const __LOG__ = globalThis.__LOG__ ?? true;
const PIECE_KEYS = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];

export function evaluateMaterial(board, color, weight = 1.0, gamePhase = 1) {
  const colorIdx = colorToIndex(color);
  const oppIdx = colorIdx ^ 1;
  const isWhite = color === 'white';

  let materialScore = 0;
  let pstScore = 0;

  // Only built when someone will read it.
  const wantDetails = __LOG__ && LOG.heuristics;
  const details = wantDetails ? {} : null;

  for (let piece = PIECES.KING; piece <= PIECES.PAWN; piece++) {
    const ourCount = board.bbPieces[colorIdx][piece].popCount();
    const theirCount = board.bbPieces[oppIdx][piece].popCount();
    materialScore += (ourCount - theirCount) * PIECE_VALUES[piece];

    let ourPST = 0;
    const ours = board.bbPieces[colorIdx][piece].clone();
    while (!ours.isEmpty()) ourPST += getPSTValue(piece, ours.popLSB(), isWhite, gamePhase);

    let theirPST = 0;
    const theirs = board.bbPieces[oppIdx][piece].clone();
    while (!theirs.isEmpty()) theirPST += getPSTValue(piece, theirs.popLSB(), !isWhite, gamePhase);

    pstScore += ourPST - theirPST;

    if (details) {
      details[PIECE_KEYS[piece]] = { ours: ourCount, theirs: theirCount, pst: ourPST - theirPST };
    }
  }

  const weighted = Math.round((materialScore + pstScore) * weight);

  if (wantDetails) {
    logger.heuristics('trace',
      { h: 'material', c: color, s: weighted, rawMaterial: materialScore, rawPST: pstScore, details },
      `material ${weighted}`);
  }
  return weighted;
}