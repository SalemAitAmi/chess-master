/**
 * Core constants for the chess engine
 */

export const PIECES = {
  KING: 0,
  QUEEN: 1,
  ROOK: 2,
  BISHOP: 3,
  KNIGHT: 4,
  PAWN: 5,
  NONE: 6
};

export const PIECE_NAMES = ['King', 'Queen', 'Rook', 'Bishop', 'Knight', 'Pawn', 'None'];
export const PIECE_CHARS = ['K', 'Q', 'R', 'B', 'N', 'P'];

export const PIECE_VALUES = {
  [PIECES.PAWN]: 100,
  [PIECES.KNIGHT]: 320,
  [PIECES.BISHOP]: 330,
  [PIECES.ROOK]: 500,
  [PIECES.QUEEN]: 900,
  [PIECES.KING]: 0
};

export const WHITE_IDX = 0;
export const BLACK_IDX = 1;

export const CASTLING = {
  WHITE_KINGSIDE: 1,
  WHITE_QUEENSIDE: 2,
  BLACK_KINGSIDE: 4,
  BLACK_QUEENSIDE: 8,
  ALL: 15
};

// Square indices
export const SQUARES = {};
const FILES = 'abcdefgh';
for (let rank = 1; rank <= 8; rank++) {
  for (let file = 0; file < 8; file++) {
    const name = FILES[file] + rank;
    SQUARES[name] = (rank - 1) * 8 + file;
  }
}

// Score bounds for search
export const SCORE = {
  INFINITY: 100000,
  MATE: 50000,
  MATE_THRESHOLD: 49000,
  DRAW: 0
};

// Engine configuration defaults
export const DEFAULT_CONFIG = {
  // Search parameters
  maxDepth: 64,
  
  // Heuristic toggles (can be individually enabled/disabled)
  useMaterial: true,
  useCenterControl: true,
  useDevelopment: true,
  usePawnStructure: true,
  useKingSafety: true,
  usePawnPush: true,
  
  // Search features
  useQuiescence: true,
  quiescenceDepth: 8,
  useMoveOrdering: true,
  useKillerMoves: true,
  useHistoryHeuristic: true,
  useTranspositionTable: true,
  useNullMovePruning: true,
  useLateMovereduction: true,
  useOpeningBook: true,
  
  // Heuristic weights (for fine-tuning)
  weights: {
    material: 1.0,
    centerControl: 1.0,
    development: 1.0,
    pawnStructure: 1.0,
    kingSafety: 1.0,
    pawnPush: 1.0
  },

  useOpeningPrinciples: true,
  openingPrincipleWeight: 1.0,
  
  // Stage-aware evaluation
  useStageWeights: true,
  
  // Logging
  logDecisions: true,
  logStages: true
};