/**
 * Static Exchange Evaluation — exact negamax over the capture sequence.
 *
 * Plays the sequence out on one square, always recapturing with the least
 * valuable attacker, and returns the centipawn swing for the initiator.
 * X-rays fall out for free because attackers are recomputed against a live
 * "removed" mask rather than enumerated up front.
 *
 * WHY NO PRUNE. The canonical CPW swap algorithm breaks on
 * `max(-gain[d-1], gain[d]) < 0`, discarding gain[d]. That is SIGN-exact but
 * not MAGNITUDE-exact: in
 *
 *     3r2k1/6pp/2p5/3p4/8/8/3R2PP/3R2K1 w - - 0 1   Rxd5
 *
 * the prune fires one ply before the doubled rook recaptures. We use SEE
 * magnitudes to pick the ordering tier (WINNING / EQUAL / LOSING + score) and
 * to rank quiescence captures, so the sequence is played to exhaustion.
 * `seeFast` keeps the cheap cases off this path entirely.
 *
 * The previous implementation had the worst of both: it wrote gain[d] AND
 * unwound over it after the prune, which silently lost 100cp on every x-ray
 * and mis-valued the "defender refuses the recapture" case by a full pawn.
 *
 * NOT REENTRANT: module-level scratch. Never recurses, never calls anything
 * that calls it.
 */
import { PIECES, WHITE_IDX } from '../core/constants.js';
import { KNIGHT_ATTACKS, KING_ATTACKS, ORTHO, DIAG } from '../core/moveGeneration.js';

// King value is large but finite: min/max then refuses to trade the king, and
// `leastValuableAttacker` returns it last.
const SEE_VALUES = new Int32Array(7);
SEE_VALUES[PIECES.KING]   = 10000;
SEE_VALUES[PIECES.QUEEN]  = 900;
SEE_VALUES[PIECES.ROOK]   = 500;
SEE_VALUES[PIECES.BISHOP] = 330;
SEE_VALUES[PIECES.KNIGHT] = 320;
SEE_VALUES[PIECES.PAWN]   = 100;
SEE_VALUES[PIECES.NONE]   = 0;

export function seeValue(piece) { return SEE_VALUES[piece]; }

let remLo = 0, remHi = 0;
const GAIN = new Int32Array(34);

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
  remLo = 0; remHi = 0;

  const moverIsWhite = board.bbSide[WHITE_IDX].getBit(move.fromSquare);
  const victimValue = computeVictimValue(board, move, target, moverIsWhite);
  const initialOccupant = computeInitialOccupant(move);

  markRemoved(move.fromSquare);
  const startingSide = (moverIsWhite ? WHITE_IDX : 1) ^ 1;

  const depth = playOutCaptures(board, target, startingSide, initialOccupant, victimValue);
  unwindGains(depth);

  return GAIN[0];
}

function computeVictimValue(board, move, target, moverIsWhite) {
  if (move.isEnPassant) {
    const victimSq = moverIsWhite ? target - 8 : target + 8;
    markRemoved(victimSq);
    return SEE_VALUES[PIECES.PAWN];
  }

  let value = SEE_VALUES[board.pieceList[target]];

  if (move.isPromotion) {
    const promo = move.promotionPiece ?? PIECES.QUEEN;
    value += SEE_VALUES[promo] - SEE_VALUES[PIECES.PAWN];
  }
  return value;
}

function computeInitialOccupant(move) {
  if (move.isPromotion) {
    const promo = move.promotionPiece ?? PIECES.QUEEN;
    return SEE_VALUES[promo];
  }
  return SEE_VALUES[move.piece];
}

function playOutCaptures(board, target, startingSide, initialOccupant, victimValue) {
  let occupant = initialOccupant;
  let side = startingSide;
  let d = 0;
  GAIN[0] = victimValue;

  for (;;) {
    const atkSq = leastValuableAttacker(board, target, side);
    if (atkSq < 0) break;

    const atkPiece = board.pieceList[atkSq];
    if (isIllegalKingCapture(board, target, side, atkPiece)) break;

    if (d + 1 >= GAIN.length) break;
    d++;
    GAIN[d] = occupant - GAIN[d - 1];

    markRemoved(atkSq);
    occupant = SEE_VALUES[atkPiece];
    side ^= 1;
  }
  return d;
}

function isIllegalKingCapture(board, target, side, atkPiece) {
  if (atkPiece !== PIECES.KING) return false;
  return leastValuableAttacker(board, target, side ^ 1) >= 0;
}

function unwindGains(d) {
  for (let i = d; i > 0; i--) {
    GAIN[i - 1] = -Math.max(-GAIN[i - 1], GAIN[i]);
  }
}

/**
 * Square of the least valuable `sideIdx` piece attacking `sq`, ignoring
 * already-removed pieces. -1 if none.
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

  // Walk all eight rays once, taking the first live piece on each. A removed
  // front piece is skipped, exposing the x-ray behind it.
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
 * SEE with a sound short-circuit: when the victim is worth at least as much as
 * the attacker, the worst case is losing the attacker, so the swing is
 * >= victim - attacker >= 0. The exact value may be higher; the LOWER BOUND is
 * all the ordering tiers and the quiescence `seeScore < 0` gate need, and it
 * keeps the full swap off the vast majority of captures.
 */
export function seeFast(board, move) {
  if (!move.isPromotion) {
    const victim = move.isEnPassant ? SEE_VALUES[PIECES.PAWN]
                                    : SEE_VALUES[board.pieceList[move.toSquare]];
    const attacker = SEE_VALUES[move.piece];
    if (victim >= attacker) return victim - attacker;   // ≥ 0 by construction
  }
  return see(board, move);
}