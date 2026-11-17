/**
 * Game constants for the Chess UI.
 *
 * Chess logic lives in the engine. Everything here is presentational or a
 * shared literal: piece identity and glyphs, score conventions, the initial
 * gamestate shape, difficulty labels and failure-path timeouts.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Pieces
// ═══════════════════════════════════════════════════════════════════════════

/** Piece type ids — same numbering as the engine (engine/src/core/constants.js). */
export const PIECES = {
  KING: 0,
  QUEEN: 1,
  ROOK: 2,
  BISHOP: 3,
  KNIGHT: 4,
  PAWN: 5,
  NONE: 6,
};

/** Display material in PAWNS (the engine reports centipawns). */
export const PIECE_VALUES = {
  [PIECES.PAWN]: 1,
  [PIECES.KNIGHT]: 3,
  [PIECES.BISHOP]: 3,
  [PIECES.ROOK]: 5,
  [PIECES.QUEEN]: 9,
  [PIECES.KING]: 0,
};

/** Upper-case letter per piece type, indexed by PIECES. */
export const PIECE_LETTERS = ['K', 'Q', 'R', 'B', 'N', 'P'];

/** Piece letter → English name. */
export const PIECE_NAMES = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' };

/** Font Awesome glyph per piece type. */
export const pieceIcons = {
  [PIECES.KING]: 'fa-chess-king',
  [PIECES.QUEEN]: 'fa-chess-queen',
  [PIECES.ROOK]: 'fa-chess-rook',
  [PIECES.BISHOP]: 'fa-chess-bishop',
  [PIECES.KNIGHT]: 'fa-chess-knight',
  [PIECES.PAWN]: 'fa-chess-pawn',
};

// ═══════════════════════════════════════════════════════════════════════════
// Scores
// ═══════════════════════════════════════════════════════════════════════════

/** |cp| above this is a mate score (engine SCORE.MATE_THRESHOLD). */
export const MATE_THRESHOLD = 49000;

// ═══════════════════════════════════════════════════════════════════════════
// Game state
// ═══════════════════════════════════════════════════════════════════════════

export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Shape of every gamestate block. Pages merge engine responses over this. */
export const INITIAL_GAME_STATE = {
  fen: STARTING_FEN,
  turn: 'white',
  fullmove: 1,
  halfmove: 0,
  status: 'ongoing',
  winner: 'none',
  incheck: false,
  eval: 0,
  material_white: 3900,
  material_black: 3900,
  captured_white: [],
  captured_black: [],
  canundo: false,
  blunder: false,
  lastmove: null,
};

// ═══════════════════════════════════════════════════════════════════════════
// Difficulty
// ═══════════════════════════════════════════════════════════════════════════

export const DIFFICULTY_NAMES = { 1: 'Rookie', 2: 'Casual', 3: 'Strategic', 4: 'Master' };
export const DIFFICULTY_DEPTHS = { 1: 4, 2: 6, 3: 8, 4: 12 };

// ═══════════════════════════════════════════════════════════════════════════
// Failure-path timeouts (ms)
// ═══════════════════════════════════════════════════════════════════════════

export const TIMEOUTS = {
  INIT_WATCHDOG: 15000,     // no gamestate after ucinewgame within this → error
  ENGINE_MOVE_DELAY: 500,   // vs-computer pause before the engine moves
  COLOSSEUM_MOVE_DELAY: 200,
  COLOSSEUM_ROUND_DELAY: 2000,
};