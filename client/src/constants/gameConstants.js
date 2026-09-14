/**
 * Game constants for the Chess UI
 * Chess logic constants live in the engine. Everything here is presentational
 * or a shared literal (initial state, difficulty labels, profile fallbacks).
 */

// ── Piece rendering ──
export const PIECES = {
  KING: 0,
  QUEEN: 1,
  ROOK: 2,
  BISHOP: 3,
  KNIGHT: 4,
  PAWN: 5,
  NONE: 6
};

export const PIECE_VALUES = {
  [PIECES.PAWN]: 1,
  [PIECES.KNIGHT]: 3,
  [PIECES.BISHOP]: 3,
  [PIECES.ROOK]: 5,
  [PIECES.QUEEN]: 9,
  [PIECES.KING]: 0
};

export const pieceIcons = {
  [PIECES.KING]: "fa-chess-king",
  [PIECES.QUEEN]: "fa-chess-queen",
  [PIECES.ROOK]: "fa-chess-rook",
  [PIECES.BISHOP]: "fa-chess-bishop",
  [PIECES.KNIGHT]: "fa-chess-knight",
  [PIECES.PAWN]: "fa-chess-pawn",
};

// ── Game state ──
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

// ── Difficulty ──
export const DIFFICULTY_NAMES = { 1: 'Rookie', 2: 'Casual', 3: 'Strategic', 4: 'Master' };
export const DIFFICULTY_DEPTHS = { 1: 4, 2: 6, 3: 8, 4: 12 };

// ── Engine profiles ──
/**
 * Fallback list, used only until the engine's `option name Profile type combo
 * ... var <name>` line has been parsed (EngineClient captures it during the
 * `uci` handshake and exposes it as `engine.profiles`). Mirrors
 * engine/config/profiles.json; if they drift, the engine wins.
 */
export const DEFAULT_ENGINE_PROFILES = [
  { name: 'baseline',   label: 'Baseline' },
  { name: 'tactical',   label: 'Tactical' },
  { name: 'positional', label: 'Positional' },
  { name: 'liquidator', label: 'Liquidator' },
  { name: 'greedy',     label: 'Greedy' },
];

// ── Failure-path timeouts (ms) ──
export const TIMEOUTS = {
  INIT_WATCHDOG: 15000,     // no gamestate after ucinewgame within this → error
  ENGINE_MOVE_DELAY: 500,   // vs-computer pause before the engine moves
  COLOSSEUM_MOVE_DELAY: 200,
  COLOSSEUM_ROUND_DELAY: 2000,
};