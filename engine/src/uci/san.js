/**
 * Standard Algebraic Notation for move display.
 *
 * Must be called BEFORE the move is made: disambiguation needs the sibling
 * legal moves, and the check/mate suffix is determined by make/unmake.
 */
import { PIECES } from '../core/constants.js';
import { indexToSquare } from '../core/bitboard.js';
import { isInCheck, hasLegalMoves } from '../core/moveGeneration.js';

const PIECE_LETTER = ['K', 'Q', 'R', 'B', 'N', ''];   // pawn has no letter
const PROMO_LETTER = ['', 'Q', 'R', 'B', 'N'];

/**
 * @param {Board}  board       Position BEFORE the move.
 * @param {object} move        Move to render.
 * @param {Array}  legalMoves  All legal moves in this position (for disambiguation).
 */
export function moveToSan(board, move, legalMoves) {
  const color = board.gameState.activeColor;
  const fromFile = move.fromSquare & 7;
  const fromRank = move.fromSquare >> 3;
  const toName = indexToSquare(move.toSquare);

  const isCapture = move.capturedPiece !== null;

  let body;
  if (move.piece === PIECES.KING && Math.abs((move.toSquare & 7) - fromFile) === 2) {
    body = (move.toSquare & 7) === 6 ? 'O-O' : 'O-O-O';
  } else if (move.piece === PIECES.PAWN) {
    body = (isCapture ? 'abcdefgh'[fromFile] + 'x' : '') + toName;
    if (move.isPromotion) body += '=' + PROMO_LETTER[move.promotionPiece ?? PIECES.QUEEN];
  } else {
    body = PIECE_LETTER[move.piece] + disambiguate(move, legalMoves, fromFile, fromRank)
         + (isCapture ? 'x' : '') + toName;
  }

  // Check / mate suffix.
  board.makeMove(move.fromSquare, move.toSquare, move.promotionPiece);
  const opponent = color === 'white' ? 'black' : 'white';
  const opponentInCheck = isInCheck(board, opponent);
  const opponentHasMoves = opponentInCheck ? hasLegalMoves(board, opponent) : true;
  board.undoMove();

  if (opponentInCheck) body += opponentHasMoves ? '+' : '#';
  return body;
}

/**
 * Minimal disambiguator: file if unique, else rank, else full square.
 * Promotion variants share a from/to pair, so they are excluded — otherwise
 * every promotion would look ambiguous with itself.
 */
function disambiguate(move, legalMoves, fromFile, fromRank) {
  let sameFile = 0, sameRank = 0, others = 0;
  for (const m of legalMoves) {
    if (m.piece !== move.piece) continue;
    if (m.toSquare !== move.toSquare) continue;
    if (m.fromSquare === move.fromSquare) continue;
    others++;
    if ((m.fromSquare & 7) === fromFile) sameFile++;
    if ((m.fromSquare >> 3) === fromRank) sameRank++;
  }
  if (others === 0) return '';
  if (sameFile === 0) return 'abcdefgh'[fromFile];
  if (sameRank === 0) return String(fromRank + 1);
  return 'abcdefgh'[fromFile] + (fromRank + 1);
}