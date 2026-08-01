/**
 * Game-stage detection. Used for opening-principle move ordering and for
 * stage logging; `halfMoveCount` is also the single source of truth for
 * "how many plies into the game are we" (used by the development eval term).
 */
import { PIECES } from '../core/constants.js';
import { colorToIndex } from '../core/bitboard.js';
import { GAME_STAGE } from '../logging/categories.js';

const OPENING_END_PLY = 20;
const EARLY_MIDDLE_END_PLY = 40;
const MIDDLE_END_PLY = 70;
const LATE_MIDDLE_END_PLY = 100;
const ENDGAME_MATERIAL_THRESHOLD = 13;
const MAX_PHASE = 24;

/**
 * Game half-move (ply) count derived from the FEN counters.
 *
 * Deliberately NOT board.plyCount: that is the undo-stack depth, which is 0
 * for any position loaded from a FEN and inflated by search make/unmake.
 */
export function halfMoveCount(board) {
  const gs = board.gameState;
  return (gs.fullMoveCount - 1) * 2 + (gs.activeColor === 'black' ? 1 : 0);
}

function materialPhase(board) {
  const w = board.bbPieces[colorToIndex('white')];
  const b = board.bbPieces[colorToIndex('black')];
  return (w[PIECES.KNIGHT].popCount() + b[PIECES.KNIGHT].popCount()) * 1
       + (w[PIECES.BISHOP].popCount() + b[PIECES.BISHOP].popCount()) * 1
       + (w[PIECES.ROOK  ].popCount() + b[PIECES.ROOK  ].popCount()) * 2
       + (w[PIECES.QUEEN ].popCount() + b[PIECES.QUEEN ].popCount()) * 4;
}

const PRIORITIES = {
  [GAME_STAGE.OPENING]: ['Control the centre', 'Develop knights before bishops',
    'Castle early', 'Connect rooks', 'Avoid moving the same piece twice',
    'Avoid early queen sorties'],
  [GAME_STAGE.EARLY_MIDDLE]: ['Complete development', 'Improve piece placement',
    'Fix the pawn structure', 'Identify targets'],
  [GAME_STAGE.MIDDLE]: ['Execute plans', 'Attack weaknesses',
    'Improve the worst-placed piece', 'Control open files'],
  [GAME_STAGE.LATE_MIDDLE]: ['Simplify if ahead', 'Avoid simplification if behind',
    'Steer toward a favourable endgame', 'Create passed pawns'],
  [GAME_STAGE.ENDGAME]: ['Activate the king', 'Promote pawns',
    'Coordinate pieces', 'Opposition and key squares'],
};

export function getStagePriorities(stage) { return PRIORITIES[stage] ?? PRIORITIES[GAME_STAGE.MIDDLE]; }

/**
 * Cheap stage classification. Returns scalars only — the caller asks for
 * priorities separately, so the common path allocates one small object.
 */
export function detectGameStage(board) {
  const ply = halfMoveCount(board);
  const phase = materialPhase(board);

  let stage;
  if (phase <= ENDGAME_MATERIAL_THRESHOLD)   stage = GAME_STAGE.ENDGAME;
  else if (ply <= OPENING_END_PLY)           stage = GAME_STAGE.OPENING;
  else if (ply <= EARLY_MIDDLE_END_PLY)      stage = GAME_STAGE.EARLY_MIDDLE;
  else if (ply <= MIDDLE_END_PLY)            stage = GAME_STAGE.MIDDLE;
  else if (ply <= LATE_MIDDLE_END_PLY)       stage = GAME_STAGE.LATE_MIDDLE;
  else                                       stage = GAME_STAGE.ENDGAME;

  return {
    stage,
    fullMoveNumber: board.gameState.fullMoveCount,
    halfMoveCount: ply,
    materialPhase: phase,
    maxMaterialPhase: MAX_PHASE,
    phasePercent: phase / MAX_PHASE,
  };
}

/**
 * Opening-principle bonuses/penalties for move ordering. Root-only — this
 * allocates two arrays per call and must never be used inside the tree.
 */
export function checkOpeningPrinciples(board, move, color) {
  const violations = [];
  const bonuses = [];
  const ply = halfMoveCount(board);
  const colorIdx = colorToIndex(color);

  if (ply > OPENING_END_PLY) {
    return { violations, bonuses, isOpening: false, totalPenalty: 0, totalBonus: 0 };
  }

  // Same piece twice: scan our own previous moves in the undo history.
  if (move.capturedPiece === null) {
    const undoPly = board.plyCount;
    for (let back = 2; back <= Math.min(4, undoPly); back += 2) {
      const frame = board._undo[undoPly - back];
      if (frame && frame.to === move.fromSquare) {
        violations.push({ principle: 'SAME_PIECE_TWICE', severity: 'medium', penalty: -15 });
        break;
      }
    }
  }

  const knightStarts = color === 'white' ? [1, 6] : [57, 62];
  const bishopStarts = color === 'white' ? [2, 5] : [58, 61];

  if (move.piece === PIECES.QUEEN && ply < 12) {
    let undeveloped = 0;
    for (const sq of knightStarts) if (board.bbPieces[colorIdx][PIECES.KNIGHT].getBit(sq)) undeveloped++;
    for (const sq of bishopStarts) if (board.bbPieces[colorIdx][PIECES.BISHOP].getBit(sq)) undeveloped++;
    if (undeveloped >= 2) {
      violations.push({ principle: 'EARLY_QUEEN', severity: 'high', penalty: -30 });
    }
  }

  // Squares instead of move.from / move.to tuples.
  const fromFile = move.fromSquare & 7;
  const toFile = move.toSquare & 7;
  const toRank = move.toSquare >> 3;

  if (move.piece === PIECES.PAWN && ply < 8 && (fromFile === 0 || fromFile === 7)) {
    const dPawn = color === 'white' ? 11 : 51;
    const ePawn = color === 'white' ? 12 : 52;
    if (board.bbPieces[colorIdx][PIECES.PAWN].getBit(dPawn) &&
        board.bbPieces[colorIdx][PIECES.PAWN].getBit(ePawn)) {
      violations.push({ principle: 'EDGE_PAWN_EARLY', severity: 'low', penalty: -10 });
    }
  }
  
  if (move.piece === PIECES.PAWN && (toFile === 3 || toFile === 4) && (toRank === 3 || toRank === 4)) {
    bonuses.push({ principle: 'CENTRAL_PAWN', bonus: 10 });
  }
  if (move.piece === PIECES.KNIGHT) {
    if (toFile >= 2 && toFile <= 5 && toRank >= 2 && toRank <= 5) {
      bonuses.push({ principle: 'KNIGHT_DEVELOPMENT', bonus: 8 });
    }
    const classicRank = color === 'white' ? 2 : 5;   // c3/f3 for white, c6/f6 for black
    if (toRank === classicRank && (toFile === 2 || toFile === 5)) {
      bonuses.push({ principle: 'CLASSIC_KNIGHT_SQUARE', bonus: 5 });
    }
  }
  if (move.piece === PIECES.BISHOP) {
    // Long diagonals in rank/file terms: a1-h8 (rank === file) and a8-h1.
    if (toRank === toFile || toRank + toFile === 7) {
      bonuses.push({ principle: 'BISHOP_LONG_DIAGONAL', bonus: 8 });
    }
  }
  if (move.piece === PIECES.KING && Math.abs(toFile - fromFile) === 2) {
    bonuses.push({ principle: 'CASTLING', bonus: 25 });
  }

  let totalPenalty = 0;
  for (const v of violations) totalPenalty += v.penalty;
  let totalBonus = 0;
  for (const b of bonuses) totalBonus += b.bonus;

  return { violations, bonuses, isOpening: true, totalPenalty, totalBonus };
}

export { GAME_STAGE };