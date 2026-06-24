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
    
    for (const char of rows[row]) {
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
  }
  
  return board;
}

/**
 * Create empty 8x8 board
 */
export function createEmptyBoard() {
  return Array(8).fill(null).map(() => Array(8).fill(null));
}

/**
 * Get piece at position from parsed board
 */
export function getPieceAt(board, row, col) {
  if (!board || row < 0 || row >= 8 || col < 0 || col >= 8) {
    return null;
  }
  return board[row][col];
}

/**
 * Parse active color from FEN
 */
export function getActiveColor(fen) {
  if (!fen) return 'white';
  const parts = fen.split(' ');
  return parts[1] === 'b' ? 'black' : 'white';
}

/**
 * Get full move number from FEN
 */
export function getFullMoveNumber(fen) {
  if (!fen) return 1;
  const parts = fen.split(' ');
  return parseInt(parts[5]) || 1;
}