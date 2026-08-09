/**
 * Pawn structure evaluation heuristic.
 *
 * Penalties (per pawn):  Doubled -12  Isolated -15  Backward -10
 * Bonuses  (per pawn):   Connected +8  Passed +10..+90
 * Per-side:              Islands -8 beyond the first
 *
 * ALLOCATION: the old version built a `{row, col, square}` object per pawn and
 * a fresh array per side — up to 16 objects + 2 arrays on every leaf eval.
 * Pawn data now lives in module-static parallel Int8Arrays (max 8 per side,
 * 16 for safety against corrupt FENs) walked with a non-destructive iterator.
 * analyzePawnStructure runs once per side, sequentially, so a single buffer set
 * is sufficient — it is NOT reentrant.
 */
import { PIECES } from '../core/constants.js';
import { colorToIndex, BitBoardIterator } from '../core/bitboard.js';

const PASSED_PAWN_BONUS = [0, 10, 15, 25, 40, 60, 90, 0];
const ISOLATED_PAWN_PENALTY = 15;
const DOUBLED_PAWN_PENALTY = 12;
const CONNECTED_PAWN_BONUS = 8;
const BACKWARD_PAWN_PENALTY = 10;
const PAWN_ISLAND_PENALTY = 8;

const PS_ROW  = new Int8Array(16);
const PS_COL  = new Int8Array(16);
const PS_FILE = new Int8Array(8);
const PS_IT   = new BitBoardIterator();

export function evaluatePawnStructure(board, color, weight = 1.0) {
  const colorIdx = colorToIndex(color);
  const oppositeColor = color === 'white' ? 'black' : 'white';
  const oppositeColorIdx = colorToIndex(oppositeColor);

  let score = 0;
  score += analyzePawnStructure(board, color, colorIdx, oppositeColorIdx);
  score -= analyzePawnStructure(board, oppositeColor, oppositeColorIdx, colorIdx);
  return Math.round(score * weight);
}

function analyzePawnStructure(board, color, colorIdx, oppositeColorIdx) {
  const n = collectPawnSquares(board, colorIdx);
  if (n === 0) return 0;

  let score = 0;
  score += evaluateIslands();
  score += evaluateIndividualPawns(n, color, board, oppositeColorIdx);
  return score;
}

function collectPawnSquares(board, colorIdx) {
  let n = 0;
  PS_FILE.fill(0);

  for (let sq = PS_IT.init(board.bbPieces[colorIdx][PIECES.PAWN]).next();
       sq >= 0 && n < 16;
       sq = PS_IT.next()) {
    const row = 7 - (sq >> 3);
    const col = sq & 7;
    PS_ROW[n] = row;
    PS_COL[n] = col;
    n++;
    PS_FILE[col]++;
  }
  return n;
}

function evaluateIslands() {
  let islands = 0, inIsland = false;
  for (let f = 0; f < 8; f++) {
    if (PS_FILE[f] > 0) {
      if (!inIsland) { islands++; inIsland = true; }
    } else {
      inIsland = false;
    }
  }
  return islands > 1 ? -(islands - 1) * PAWN_ISLAND_PENALTY : 0;
}

function evaluateIndividualPawns(n, color, board, oppositeColorIdx) {
  let score = 0;

  for (let i = 0; i < n; i++) {
    const row = PS_ROW[i], col = PS_COL[i];

    score += evaluateDoubled(col);
    score += evaluateIsolationOrConnection(i, n, col, color, board, oppositeColorIdx);
    score += evaluatePassed(board, row, col, color, oppositeColorIdx);
  }
  return score;
}

function evaluateDoubled(col) {
  return PS_FILE[col] > 1 ? -DOUBLED_PAWN_PENALTY : 0;
}

function evaluateIsolationOrConnection(i, n, col, color, board, oppositeColorIdx) {
  const hasLeft  = col > 0 && PS_FILE[col - 1] > 0;
  const hasRight = col < 7 && PS_FILE[col + 1] > 0;

  if (!hasLeft && !hasRight) return -ISOLATED_PAWN_PENALTY;

  let score = CONNECTED_PAWN_BONUS;
  if (isBackwardPawn(i, n, color, board, oppositeColorIdx)) {
    score -= BACKWARD_PAWN_PENALTY;
  }
  return score;
}

function evaluatePassed(board, row, col, color, oppositeColorIdx) {
  if (!isPassedPawn(board, row, col, color, oppositeColorIdx)) return 0;
  const advancement = color === 'white' ? 7 - row : row;
  return PASSED_PAWN_BONUS[advancement];
}

/**
 * Backward iff every adjacent-file neighbour is strictly more advanced AND the
 * stop square is attacked by an enemy pawn. Together: the pawn can never be
 * supported forward, and advancing loses it.
 */
function isBackwardPawn(i, n, color, board, oppositeColorIdx) {
  const row = PS_ROW[i], col = PS_COL[i];
  const white = color === 'white';

  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    const df = PS_COL[j] - col;
    if (df !== -1 && df !== 1) continue;
    const moreAdvanced = white ? PS_ROW[j] < row : PS_ROW[j] > row;
    if (!moreAdvanced) return false;
  }

  const dir = white ? -1 : 1;
  const stopRow = row + dir;
  if (stopRow < 0 || stopRow > 7) return false;   // about to promote — not "backward"
  const enemyRow = stopRow + dir;
  if (enemyRow < 0 || enemyRow > 7) return false;

  const enemyPawns = board.bbPieces[oppositeColorIdx][PIECES.PAWN];
  const base = (7 - enemyRow) * 8;
  if (col > 0 && enemyPawns.getBit(base + col - 1)) return true;
  if (col < 7 && enemyPawns.getBit(base + col + 1)) return true;
  return false;
}

function isPassedPawn(board, row, col, color, oppositeColorIdx) {
  const direction = color === 'white' ? -1 : 1;
  const endRow = color === 'white' ? 0 : 7;
  const enemyPawns = board.bbPieces[oppositeColorIdx][PIECES.PAWN];

  for (let c = Math.max(0, col - 1); c <= Math.min(7, col + 1); c++) {
    let r = row + direction;
    while ((color === 'white' && r >= endRow) || (color === 'black' && r <= endRow)) {
      if (enemyPawns.getBit((7 - r) * 8 + c)) return false;
      r += direction;
    }
  }
  return true;
}