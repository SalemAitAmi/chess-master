/**
 * Pawn structure evaluation heuristic.
 *
 * Penalties (per pawn):
 *   Doubled    -12   two+ pawns on the same file
 *   Isolated   -15   no friendly pawns on adjacent files
 *   Backward   -10   neighbors all advanced past it + stop square attacked
 * Bonuses (per pawn):
 *   Connected   +8   at least one friendly pawn on an adjacent file
 *   Passed  +10..+90 no enemy pawn on this or adjacent files ahead
 * Per-side:
 *   Islands     -8   per island beyond the first
 */

import { PIECES } from '../core/constants.js';
import { colorToIndex, indexToRowCol } from '../core/bitboard.js';

const PASSED_PAWN_BONUS = [0, 10, 15, 25, 40, 60, 90, 0];
const ISOLATED_PAWN_PENALTY = 15;
const DOUBLED_PAWN_PENALTY = 12;
const CONNECTED_PAWN_BONUS = 8;
const BACKWARD_PAWN_PENALTY = 10;
const PAWN_ISLAND_PENALTY = 8;

export function evaluatePawnStructure(board, color, weight = 1.0) {
  const colorIdx = colorToIndex(color);
  const oppositeColor = color === 'white' ? 'black' : 'white';
  const oppositeColorIdx = colorToIndex(oppositeColor);

  let score = 0;
  score += analyzePawnStructure(board, color, colorIdx, oppositeColorIdx);
  score -= analyzePawnStructure(board, oppositeColor, oppositeColorIdx, colorIdx);

  // NOTE: removed the unguarded `logger.heuristicCalc(...)` call that was
  // here. It fired on every leaf eval — ~millions of calls at depth 12.
  // The guard was INSIDE heuristicCalc, so it short-circuited the file
  // write, but the call overhead + `{}` literal alloc still happened.
  // evaluate.js already does `if (bd) bd.pawnStructure = s` which covers
  // the breakdown-logging case.

  return Math.round(score * weight);
}

function analyzePawnStructure(board, color, colorIdx, oppositeColorIdx) {
  let score = 0;

  // ── Single pass: collect file counts + positions ──
  const pawnFiles = new Int8Array(8);
  const pawnPositions = [];
  const tempBB = board.bbPieces[colorIdx][PIECES.PAWN].clone();
  while (!tempBB.isEmpty()) {
    const square = tempBB.popLSB();
    const [row, col] = indexToRowCol(square);
    pawnFiles[col]++;
    pawnPositions.push({ row, col, square });
  }

  // ── Pawn islands ──
  // An "island" is a maximal run of files that each have ≥1 pawn.
  // One island is the ideal (all pawns connectable). Each additional
  // island is a structural liability — the gaps between islands are
  // files the opponent can use, and the islands can't support each other.
  //
  // This is cheap: one 8-iteration scan of an array we already built.
  // Penalty is applied once per side, not per pawn.
  let islands = 0;
  let inIsland = false;
  for (let f = 0; f < 8; f++) {
    if (pawnFiles[f] > 0) {
      if (!inIsland) { islands++; inIsland = true; }
    } else {
      inIsland = false;
    }
  }
  // First island is free — everyone has at least one if they have pawns.
  if (islands > 1) {
    score -= (islands - 1) * PAWN_ISLAND_PENALTY;
  }

  // ── Per-pawn analysis ──
  for (const pawn of pawnPositions) {
    // Doubled
    if (pawnFiles[pawn.col] > 1) {
      score -= DOUBLED_PAWN_PENALTY;
    }

    // Isolated / connected — mutually exclusive
    const hasLeftNeighbor  = pawn.col > 0 && pawnFiles[pawn.col - 1] > 0;
    const hasRightNeighbor = pawn.col < 7 && pawnFiles[pawn.col + 1] > 0;
    const isolated = !hasLeftNeighbor && !hasRightNeighbor;
    if (isolated) {
      score -= ISOLATED_PAWN_PENALTY;
    } else {
      score += CONNECTED_PAWN_BONUS;

      // Backward — only meaningful for non-isolated pawns.
      // An isolated pawn's weakness is already captured by the isolated
      // penalty; stacking backward on top would double-count.
      if (isBackwardPawn(pawn, color, pawnPositions, board, oppositeColorIdx)) {
        score -= BACKWARD_PAWN_PENALTY;
      }
    }

    // Passed
    if (isPassedPawn(board, pawn, color, oppositeColorIdx)) {
      const advancement = color === 'white' ? 7 - pawn.row : pawn.row;
      score += PASSED_PAWN_BONUS[advancement];
    }
  }

  return score;
}

/**
 * A pawn is backward if:
 *   1. It has neighbors on adjacent files (not isolated — checked by caller)
 *   2. ALL those neighbors are strictly more advanced
 *   3. Its stop square (one step forward) is attacked by an enemy pawn
 *
 * Condition 2 means no friendly pawn can ever advance alongside to
 * support the stop square. Condition 3 means advancing loses the pawn.
 * Together: the pawn is permanently stuck on a weak square.
 *
 * We deliberately DON'T check for an enemy pawn on the same file ahead
 * (the "half-open" condition some definitions use). A blocked backward
 * pawn is still a backward pawn — arguably worse, since it can't even
 * trade itself off.
 */
function isBackwardPawn(pawn, color, pawnPositions, board, oppositeColorIdx) {
  // "More advanced" = closer to promotion. Row decreases for white,
  // increases for black (row 0 = rank 8, row 7 = rank 1).
  const moreAdvanced = color === 'white'
    ? (other) => other.row < pawn.row
    : (other) => other.row > pawn.row;

  // Any adjacent-file neighbor at the same rank or behind → not backward.
  // (That neighbor could advance to support our stop square.)
  for (const other of pawnPositions) {
    if (other === pawn) continue;
    const df = other.col - pawn.col;
    if (df === -1 || df === 1) {
      if (!moreAdvanced(other)) return false;
    }
  }

  // ── Stop square attacked by an enemy pawn? ──
  // Our direction of advance:
  const dir = color === 'white' ? -1 : 1;
  const stopRow = pawn.row + dir;
  if (stopRow < 0 || stopRow > 7) return false;  // on the 7th, about to promote — not "backward"

  // Enemy pawns advance in the OPPOSITE direction, so they attack one
  // row *further ahead from our perspective*. An enemy pawn on
  // (stopRow + dir, col ± 1) attacks (stopRow, col).
  //
  // Example (white, dir=-1): our pawn on d3 (row 5), stop = d4 (row 4).
  // Black pawn on c5 or e5 (row 3 = stopRow + dir = 4 + (-1)) attacks d4. ✓
  const enemyRow = stopRow + dir;
  if (enemyRow < 0 || enemyRow > 7) return false;

  const enemyPawns = board.bbPieces[oppositeColorIdx][PIECES.PAWN];
  for (const dc of [-1, 1]) {
    const ec = pawn.col + dc;
    if (ec < 0 || ec > 7) continue;
    // Convert (row, col) → square index. Matching isPassedPawn's math:
    // rank = 7 - row, square = rank * 8 + col.
    const sq = (7 - enemyRow) * 8 + ec;
    if (enemyPawns.getBit(sq)) {
      return true;
    }
  }

  return false;
}

function isPassedPawn(board, pawn, color, oppositeColorIdx) {
  const direction = color === 'white' ? -1 : 1;
  const endRow = color === 'white' ? 0 : 7;

  for (let col = Math.max(0, pawn.col - 1); col <= Math.min(7, pawn.col + 1); col++) {
    let row = pawn.row + direction;
    while ((color === 'white' && row >= endRow) || (color === 'black' && row <= endRow)) {
      const rank = 7 - row;
      const checkSquare = rank * 8 + col;
      if (board.bbPieces[oppositeColorIdx][PIECES.PAWN].getBit(checkSquare)) {
        return false;
      }
      row += direction;
    }
  }

  return true;
}