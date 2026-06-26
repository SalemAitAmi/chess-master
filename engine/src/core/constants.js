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

export const SQUARES = {};
const FILES = 'abcdefgh';
for (let rank = 1; rank <= 8; rank++) {
  for (let file = 0; file < 8; file++) {
    const name = FILES[file] + rank;
    SQUARES[name] = (rank - 1) * 8 + file;
  }
}

export const SCORE = {
  INFINITY: 100000,
  MATE: 50000,
  MATE_THRESHOLD: 49000,
  DRAW: 0
};

export const DEFAULT_CONFIG = {
  maxDepth: 64,

  useMaterial: true,
  useCenterControl: true,
  useDevelopment: true,
  usePawnStructure: true,
  useKingSafety: true,
  usePawnPush: true,

  useQuiescence: true,
  quiescenceDepth: 8,
  useMoveOrdering: true,
  useKillerMoves: true,
  useHistoryHeuristic: true,
  useTranspositionTable: true,
  useNullMovePruning: true,
  useLateMovereduction: true,
  useFutilityPruning: true,
  useAspirationWindows: true,
  usePVS: true,
  useIID: true,
  useOpeningBook: true,

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
  useStageWeights: true,

  // Maximum draw-contempt magnitude (centipawns).
  drawContemptMax: 50,

  // Hard time ceiling per search (ms). Prevents the synchronous search from
  // blocking the event-loop indefinitely. The iterative-deepening loop
  // checks this before starting each new depth.
  maxSearchTime: 30000,

  logDecisions: true,
  logStages: true
};