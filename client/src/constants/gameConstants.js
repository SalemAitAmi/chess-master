/**
 * Game constants for the Chess UI
 * Chess logic constants have been moved to the engine
 */

// Piece type definitions (needed for rendering)
export const PIECES = {
  KING: 0,
  QUEEN: 1,
  ROOK: 2,
  BISHOP: 3,
  KNIGHT: 4,
  PAWN: 5,
  NONE: 6
};

// Piece names for display
export const PIECE_NAMES = ['King', 'Queen', 'Rook', 'Bishop', 'Knight', 'Pawn', 'None'];

// Piece values for material display
export const PIECE_VALUES = {
  [PIECES.PAWN]: 1,
  [PIECES.KNIGHT]: 3,
  [PIECES.BISHOP]: 3,
  [PIECES.ROOK]: 5,
  [PIECES.QUEEN]: 9,
  [PIECES.KING]: 0
};

// Icon mappings for UI
export const pieceIcons = {
  [PIECES.KING]: "fa-chess-king",
  [PIECES.QUEEN]: "fa-chess-queen",
  [PIECES.ROOK]: "fa-chess-rook",
  [PIECES.BISHOP]: "fa-chess-bishop",
  [PIECES.KNIGHT]: "fa-chess-knight",
  [PIECES.PAWN]: "fa-chess-pawn",
};

// Piece characters for captured pieces display
export const PIECE_CHARS = {
  [PIECES.KING]: 'K',
  [PIECES.QUEEN]: 'Q',
  [PIECES.ROOK]: 'R',
  [PIECES.BISHOP]: 'B',
  [PIECES.KNIGHT]: 'N',
  [PIECES.PAWN]: 'P',
};

// Unicode chess pieces for alternative display
export const PIECE_UNICODE = {
  white: {
    [PIECES.KING]: '♔',
    [PIECES.QUEEN]: '♕',
    [PIECES.ROOK]: '♖',
    [PIECES.BISHOP]: '♗',
    [PIECES.KNIGHT]: '♘',
    [PIECES.PAWN]: '♙',
  },
  black: {
    [PIECES.KING]: '♚',
    [PIECES.QUEEN]: '♛',
    [PIECES.ROOK]: '♜',
    [PIECES.BISHOP]: '♝',
    [PIECES.KNIGHT]: '♞',
    [PIECES.PAWN]: '♟',
  }
};