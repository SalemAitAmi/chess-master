/**
 * Chess utilities for UI rendering
 * All game logic is handled by the engine
 */

import { PIECES } from '../constants/gameConstants.js';

/**
 * Parse FEN string to get board position for rendering
 * @param {string} fen - FEN string
 * @returns {Array} 8x8 array of piece objects {type, color} or null
 */
export function parseFenToBoard(fen) {
  if (!fen) return createEmptyBoard();
  
  const board = [];
  const [position] = fen.split(' ');
  const rows = position.split('/');
  
  const pieceMap = {
    'k': PIECES.KING, 'q': PIECES.QUEEN, 'r': PIECES.ROOK,
    'b': PIECES.BISHOP, 'n': PIECES.KNIGHT, 'p': PIECES.PAWN
  };
  
  for (let row = 0; row < 8; row++) {
    board[row] = [];
    let col = 0;
    
    for (const char of rows[row] ?? '8') {
      if (char >= '1' && char <= '8') {
        const empty = parseInt(char);
        for (let i = 0; i < empty; i++) {
          board[row][col++] = null;
        }
      } else {
        const isWhite = char === char.toUpperCase();
        const pieceType = pieceMap[char.toLowerCase()];
        board[row][col++] = {
          type: pieceType,
          color: isWhite ? 'white' : 'black'
        };
      }
    }
    while (col < 8) board[row][col++] = null;   // tolerate truncated ranks
  }
  
  return board;
}

/**
 * Create empty 8x8 board
 */
export function createEmptyBoard() {
  return Array(8).fill(null).map(() => Array(8).fill(null));
}