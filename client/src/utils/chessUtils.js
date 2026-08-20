/**
 * Chess utilities for UI rendering and coordinate plumbing.
 * All game logic is handled by the engine.
 */

import { PIECES } from '../constants/gameConstants.js';
import { indexToSquare, rowColToIndex, squareToIndex, indexToRowCol } from './bitboard.js';

const FEN_PIECE_MAP = {
  'k': PIECES.KING, 'q': PIECES.QUEEN, 'r': PIECES.ROOK,
  'b': PIECES.BISHOP, 'n': PIECES.KNIGHT, 'p': PIECES.PAWN
};

/** Create empty 8x8 board */
export function createEmptyBoard() {
  return Array(8).fill(null).map(() => Array(8).fill(null));
}

/**
 * Parse FEN string to get board position for rendering. Always returns a full
 * 8x8 array (truncated ranks are padded), so callers index without guards.
 * @param {string} fen
 * @returns {Array} 8x8 array of {type, color} or null
 */
export function parseFenToBoard(fen) {
  if (!fen) return createEmptyBoard();

  const board = [];
  const position = fen.split(' ')[0];
  const rows = position.split('/');

  for (let row = 0; row < 8; row++) {
    board[row] = [];
    let col = 0;
    const rankStr = rows[row] !== undefined ? rows[row] : '8';

    for (const char of rankStr) {
      if (char >= '1' && char <= '8') {
        const empty = parseInt(char, 10);
        for (let i = 0; i < empty && col < 8; i++) board[row][col++] = null;
      } else if (col < 8) {
        const isWhite = char === char.toUpperCase();
        const pieceType = FEN_PIECE_MAP[char.toLowerCase()];
        board[row][col++] = pieceType !== undefined
          ? { type: pieceType, color: isWhite ? 'white' : 'black' }
          : null;
      }
    }
    while (col < 8) board[row][col++] = null;
  }

  return board;
}

/** UI (row, col) → UCI square name, e.g. (6, 4) → "e2". */
export function squareFromRowCol(row, col) {
  return indexToSquare(rowColToIndex(row, col));
}

/**
 * `lastmove` from the engine ("e2e4") → { from:[r,c], to:[r,c] } or null.
 */
export function lastMoveToCoords(lastmove) {
  if (typeof lastmove !== 'string' || lastmove.length < 4) return null;
  const from = squareToIndex(lastmove.slice(0, 2));
  const to = squareToIndex(lastmove.slice(2, 4));
  if (from === -1 || to === -1) return null;
  return { from: indexToRowCol(from), to: indexToRowCol(to) };
}

/**
 * Selected square + legal UCI moves → ChessBoard `selected` prop:
 * { row, col, moves: [[r,c], ...] }, or null when nothing is selected.
 */
export function selectionToBoard(selected, legalMoves) {
  if (!selected) return null;
  const moves = [];
  for (const m of legalMoves) {
    const toIdx = squareToIndex(m.slice(2, 4));
    if (toIdx !== -1) moves.push(indexToRowCol(toIdx));
  }
  return { row: selected[0], col: selected[1], moves };
}