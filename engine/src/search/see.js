/**
 * Static Exchange Evaluation.
 *
 * Plays out the capture sequence on one square, always recapturing with the
 * least valuable attacker, and returns the material swing in centipawns for
 * the side that initiates it. Handles x-rays (a rook behind a rook becomes an
 * attacker once the front rook is removed) because attackers are recomputed
 * against a live "removed" mask rather than enumerated up front.
 *
 * This replaces two broken approximations:
 *   - moveOrdering's `victim*10 - attacker`, which classified EVERY capture as
 *     winning, and
 *   - quiescence's `victim - attacker`, which ignored whether the victim was
 *     defended — pruning QxR when the rook was free while exploring NxB when
 *     the bishop was defended.
 *
 * NOT reentrant: it uses module-level scratch state. Safe because it never
 * recurses and never calls anything that calls it.
 */
import { PIECES, WHITE_IDX } from '../core/constants.js';
import { KNIGHT_ATTACKS, KING_ATTACKS, ORTHO, DIAG } from '../core/moveGeneration.js';

// King value is large but finite: it makes the min/max refuse to trade the
// king, and `leastValuableAttacker` returns it last.
const SEE_VALUES = new Int32Array(7);
SEE_VALUES[PIECES.KING]   = 10000;
SEE_VALUES[PIECES.QUEEN]  = 900;
SEE_VALUES[PIECES.ROOK]   = 500;
SEE_VALUES[PIECES.BISHOP] = 330;
SEE_VALUES[PIECES.KNIGHT] = 320;
SEE_VALUES[PIECES.PAWN]   = 100;
SEE_VALUES[PIECES.NONE]   = 0;

export function seeValue(piece) { return SEE_VALUES[piece]; }

// Scratch state (see the reentrancy note above).
let remLo = 0, remHi = 0;
const GAIN = new Int32Array(40);

function markRemoved(sq) {
  if (sq < 32) remLo |= (1 << sq); else remHi |= (1 << (sq - 32));
}
function isRemoved(sq) {
  return sq < 32 ? (remLo & (1 << sq)) !== 0 : (remHi & (1 << (sq - 32))) !== 0;
}

/**
 * @returns {number} Centipawn swing for the mover. >0 wins material,
 *                   0 is an even trade, <0 loses material.
 */
export function see(board, move) {
  const target = move.toSquare;
  const pieceList = board.pieceList;

  remLo = 0; remHi = 0;

  // Victim value. For en passant the captured pawn is not on `target`.
  let victimValue;
  if (move.isEnPassant) {
    victimValue = SEE_VALUES[PIECES.PAWN];
    markRemoved(board.bbSide[WHITE_IDX].getBit(move.fromSquare) ? target - 8 : target + 8);
  } else {
    victimValue = SEE_VALUES[pieceList[target]];
  }

  markRemoved(move.fromSquare);

  // Whatever now stands on the target square — this is what the opponent wins
  // if they recapture.
  let occupant = SEE_VALUES[move.piece];
  if (move.isPromotion) {
    const promo = move.promotionPiece ?? PIECES.QUEEN;
    occupant = SEE_VALUES[promo];
    victimValue += SEE_VALUES[promo] - SEE_VALUES[PIECES.PAWN];
  }

  const moverIdx = board.bbSide[WHITE_IDX].getBit(move.fromSquare) ? WHITE_IDX : 1;
  let side = moverIdx ^ 1;

  let d = 0;
  GAIN[0] = victimValue;

  while (true) {
    const atkSq = leastValuableAttacker(board, target, side);
    if (atkSq < 0) break;

    d++;
    if (d >= GAIN.length - 1) break;
    GAIN[d] = occupant - GAIN[d - 1];

    // Pruning: once neither side can improve on the running balance, the rest
    // of the sequence cannot change the result.
    if (Math.max(-GAIN[d - 1], GAIN[d]) < 0) break;

    const atkPiece = pieceList[atkSq];
    if (atkPiece === PIECES.KING && leastValuableAttacker(board, target, side ^ 1) >= 0) {
      // The king cannot capture onto a square the opponent still attacks, so
      // this continuation does not exist — retract it.
      d--;
      break;
    }

    markRemoved(atkSq);
    occupant = SEE_VALUES[atkPiece];
    side ^= 1;
  }

  // Unwind: each side takes the better of "capture" and "stand pat".
  for (let i = d; i > 0; i--) {
    GAIN[i - 1] = -Math.max(-GAIN[i - 1], GAIN[i]);
  }
  return GAIN[0];
}

/**
 * Square of the least valuable `sideIdx` piece attacking `sq`, ignoring
 * already-removed pieces. -1 if none. Checked in value order: pawn, knight,
 * bishop/rook/queen (min of the ray blockers), king.
 */
function leastValuableAttacker(board, sq, sideIdx) {
  const bb = board.bbPieces[sideIdx];
  const pieceList = board.pieceList;
  const side = board.bbSide[sideIdx];
  const r = sq >> 3, f = sq & 7;

  if (sideIdx === WHITE_IDX) {
    if (r > 0) {
      let p = sq - 9;
      if (f > 0 && !isRemoved(p) && bb[PIECES.PAWN].getBit(p)) return p;
      p = sq - 7;
      if (f < 7 && !isRemoved(p) && bb[PIECES.PAWN].getBit(p)) return p;
    }
  } else if (r < 7) {
    let p = sq + 9;
    if (f < 7 && !isRemoved(p) && bb[PIECES.PAWN].getBit(p)) return p;
    p = sq + 7;
    if (f > 0 && !isRemoved(p) && bb[PIECES.PAWN].getBit(p)) return p;
  }

  const kn = KNIGHT_ATTACKS[sq];
  for (let i = 0; i < kn.length; i++) {
    const s = kn[i];
    if (!isRemoved(s) && bb[PIECES.KNIGHT].getBit(s)) return s;
  }

  // Walk all eight rays once, taking the first live piece on each. X-rays fall
  // out for free: a removed front piece is skipped, exposing the one behind.
  let best = -1, bestVal = 0x7fffffff;
  for (let pass = 0; pass < 2; pass++) {
    const dirs = pass === 0 ? DIAG : ORTHO;
    const slider = pass === 0 ? PIECES.BISHOP : PIECES.ROOK;
    for (let d = 0; d < dirs.length; d++) {
      const dr = dirs[d][0], df = dirs[d][1];
      let nr = r + dr, nf = f + df;
      while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
        const s = (nr << 3) | nf;
        if (!isRemoved(s) && pieceList[s] !== PIECES.NONE) {
          const p = pieceList[s];
          if ((p === slider || p === PIECES.QUEEN) && side.getBit(s)) {
            const v = SEE_VALUES[p];
            if (v < bestVal) { bestVal = v; best = s; }
          }
          break;
        }
        nr += dr; nf += df;
      }
    }
  }
  if (best >= 0) return best;

  const kg = KING_ATTACKS[sq];
  for (let i = 0; i < kg.length; i++) {
    const s = kg[i];
    if (!isRemoved(s) && bb[PIECES.KING].getBit(s)) return s;
  }
  return -1;
}

/**
 * SEE with a cheap short-circuit: when the victim is worth at least as much as
 * the attacker, the worst case is losing the attacker, so the swing is
 * >= victim - attacker >= 0 and the full sequence never needs playing out.
 * This keeps SEE off the vast majority of captures.
 */
export function seeFast(board, move) {
  const victim = move.isEnPassant ? SEE_VALUES[PIECES.PAWN]
                                  : SEE_VALUES[board.pieceList[move.toSquare]];
  if (victim >= SEE_VALUES[move.piece] && !move.isPromotion) {
    return victim - SEE_VALUES[move.piece] >= 0 ? Math.max(0, victim - SEE_VALUES[move.piece]) : 0;
  }
  return see(board, move);
}