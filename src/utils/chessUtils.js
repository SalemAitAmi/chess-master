import { PIECES } from '../constants/gameConstants';
import { getPieceColor, rowColToIndex } from './bitboard';

// Deep copy board (now returns a cloned Board object)
export const deepCopyBoard = (board) => {
  return board.clone();
};

// Get piece type and color at a position
export const getPieceAt = (board, row, col) => {
  const index = rowColToIndex(row, col);
  const piece = board.pieceList[index];
  
  if (piece === PIECES.NONE) return null;
  
  const color = getPieceColor(board.bbSide, index);
  return { type: piece, color };
};