import { PIECES, CASTLING } from '../constants/gameConstants.js';
import { getPieceColor, rowColToIndex, indexToRowCol } from './bitboard.js';

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

/**
 * Convert a board state to FEN (Forsyth-Edwards Notation)
 * @param {Board} board - The board object to convert
 * @returns {string} - The FEN string representation
 */
export function boardToFen(board) {
  let fen = '';
  
  // Piece placement
  for (let row = 0; row < 8; row++) {
    let emptyCount = 0;
    for (let col = 0; col < 8; col++) {
      const square = rowColToIndex(row, col);
      const piece = board.pieceList[square];
      
      if (piece === PIECES.NONE) {
        emptyCount++;
      } else {
        if (emptyCount > 0) {
          fen += emptyCount;
          emptyCount = 0;
        }
        const colorIdx = board.bbSide[0].getBit(square) ? 0 : 1;
        const pieceChar = ['K', 'Q', 'R', 'B', 'N', 'P'][piece];
        fen += colorIdx === 0 ? pieceChar : pieceChar.toLowerCase();
      }
    }
    if (emptyCount > 0) fen += emptyCount;
    if (row < 7) fen += '/';
  }
  
  // Active color
  fen += ' ' + (board.gameState.active_color === 'white' ? 'w' : 'b');
  
  // Castling availability
  let castling = '';
  if (board.gameState.castling & CASTLING.WHITE_KINGSIDE) castling += 'K';
  if (board.gameState.castling & CASTLING.WHITE_QUEENSIDE) castling += 'Q';
  if (board.gameState.castling & CASTLING.BLACK_KINGSIDE) castling += 'k';
  if (board.gameState.castling & CASTLING.BLACK_QUEENSIDE) castling += 'q';
  fen += ' ' + (castling || '-');
  
  // En passant target square
  if (board.gameState.en_passant_sq !== -1) {
    const [epRow, epCol] = indexToRowCol(board.gameState.en_passant_sq);
    const file = String.fromCharCode('a'.charCodeAt(0) + epCol);
    const rank = 8 - epRow;
    fen += ' ' + file + rank;
  } else {
    fen += ' -';
  }
  
  // Halfmove clock and fullmove number
  fen += ' ' + board.gameState.half_move_clock;
  fen += ' ' + board.gameState.full_move_count;
  
  return fen;
}
