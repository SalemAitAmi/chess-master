/**
 * Chess utilities for UI rendering and coordinate plumbing.
 * All game LOGIC is handled by the engine; nothing here decides legality.
 *
 * Coordinates: UI (row, col) has row 0 = rank 8 (top of an unflipped board),
 * col 0 = file a. Square names are UCI ("e4").
 */
import { PIECES } from '../constants/gameConstants.js';
import { indexToSquare, rowColToIndex, squareToIndex, indexToRowCol } from './bitboard.js';

/** FEN piece letter (lower case) → PIECES type. */
export const PIECE_FROM_CHAR = {
  k: PIECES.KING, q: PIECES.QUEEN, r: PIECES.ROOK,
  b: PIECES.BISHOP, n: PIECES.KNIGHT, p: PIECES.PAWN,
};

// ═══════════════════════════════════════════════════════════════════════════
// Colours / results
// ═══════════════════════════════════════════════════════════════════════════

export const otherColor = (color) => (color === 'white' ? 'black' : 'white');

/** 'white' | 'black' when the gamestate names a winner; null while ongoing or drawn. */
export function winnerColor(gameState) {
  const w = gameState.winner;
  return w === 'white' || w === 'black' ? w : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Board parsing
// ═══════════════════════════════════════════════════════════════════════════

export function createEmptyBoard() {
  return Array.from({ length: 8 }, () => Array(8).fill(null));
}

/**
 * FEN placement → 8×8 array of {type, color} | null. Always returns a full
 * board (truncated ranks are padded), so callers index without guards.
 */
export function parseFenToBoard(fen) {
  if (!fen) return createEmptyBoard();
  const rows = fen.split(' ')[0].split('/');
  const board = [];
  for (let row = 0; row < 8; row++) {
    board[row] = [];
    let col = 0;
    for (const char of rows[row] ?? '8') {
      if (char >= '1' && char <= '8') {
        for (let i = 0; i < Number(char) && col < 8; i++) board[row][col++] = null;
      } else if (col < 8) {
        const type = PIECE_FROM_CHAR[char.toLowerCase()];
        board[row][col++] = type !== undefined
          ? { type, color: char === char.toUpperCase() ? 'white' : 'black' }
          : null;
      }
    }
    while (col < 8) board[row][col++] = null;
  }
  return board;
}

// ═══════════════════════════════════════════════════════════════════════════
// Coordinates
// ═══════════════════════════════════════════════════════════════════════════

/** UI (row, col) → UCI square, e.g. (6, 4) → "e2". */
export function squareFromRowCol(row, col) {
  return indexToSquare(rowColToIndex(row, col));
}

/** UCI square → [row, col], or null when malformed. */
export function squareToRowCol(square) {
  const index = squareToIndex(square);
  return index === -1 ? null : indexToRowCol(index);
}

/** Engine `lastmove` ("e2e4") → { from:[r,c], to:[r,c] } or null. */
export function lastMoveToCoords(lastmove) {
  if (typeof lastmove !== 'string' || lastmove.length < 4) return null;
  const from = squareToRowCol(lastmove.slice(0, 2));
  const to = squareToRowCol(lastmove.slice(2, 4));
  return from && to ? { from, to } : null;
}

/**
 * Selected square + legal UCI moves → ChessBoard `selected` prop:
 * { row, col, moves: [[r,c], ...] }, or null when nothing is selected.
 */
export function selectionToBoard(selected, legalMoves) {
  if (!selected) return null;
  const moves = legalMoves.map(m => squareToRowCol(m.slice(2, 4))).filter(Boolean);
  return { row: selected[0], col: selected[1], moves };
}