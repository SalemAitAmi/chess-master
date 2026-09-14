/**
 * Initiative and attacking potential.
 *
 * WHY THIS EXISTS. Material + PST + pawn structure are all static, per-square
 * terms: a queen-for-queen trade moves them by roughly zero. The search
 * therefore saw "trade queens" and "improve a piece" as equal, and the move
 * loop's `score > bestScore` tie-break (plus captures being ordered first)
 * resolved every such tie in favour of the trade. The fix is not a tie-break
 * hack — it is to give the evaluation a real derivative with respect to
 * liquidation, so the tie does not exist.
 *
 * Three sub-terms, all integer, all tapered by phase:
 *
 *   1. KING-ZONE ATTACK POTENTIAL. Weighted count of pieces bearing on the
 *      enemy king zone, through a convex curve, gated on >= 2 attackers.
 *      A queen is worth 5 units of the 1..5 scale, so removing it from an
 *      established attack costs 100-180cp. THAT is the price of QxQ when you
 *      are the attacker — and it is correctly ~0 when you are not.
 *      This also makes minor-piece sacrifices that ADD attackers profitable,
 *      which is the behaviour you asked for.
 *
 *   2. QUEEN ASYMMETRY. A lone queen is worth more than its 900cp tariff
 *      against rooks and minors (it is the only omnidirectional attacker, and
 *      the defender must answer every threat with a different piece). Flat
 *      bonus to the side that has the only queen. Makes winning a queen better
 *      and losing one worse, without touching the trade case.
 *
 *   3. TEMPO. Side to move gets a small bonus. Breaks the exact symmetry of
 *      mirrored positions, which is where most of the exact score ties came
 *      from.
 *
 * NOT REENTRANT: module-static iterator + scratch. Never recurses, and the only
 * functions it calls (rookAttacks/bishopAttacks) use their own out-struct which
 * is read immediately.
 */
import { PIECES, WHITE_IDX } from '../core/constants.js';
import { colorToIndex, BitBoardIterator, bitLo, bitHi } from '../core/bitboard.js';
import {
  KG_LO, KG_HI, KN_LO, KN_HI, PA_LO, PA_HI,
  rookAttacks, bishopAttacks, SLIDE,
} from '../core/attacks.js';
import logger, { LOG, CAT } from '../logging/logger.js';

const __LOG__ = globalThis.__LOG__ ?? true;

/**
 * ZONE[(defenderIdx << 6) | kingSq] — the king, its ring, and the ring pushed
 * one rank toward the attacker (where a mating net is actually built).
 */
const ZONE_LO = new Int32Array(128);
const ZONE_HI = new Int32Array(128);
{
  for (let k = 0; k < 64; k++) {
    const ringLo = KG_LO[k], ringHi = KG_HI[k];
    for (let def = 0; def < 2; def++) {
      let lo = ringLo | bitLo(k), hi = ringHi | bitHi(k);
      const shift = def === WHITE_IDX ? 8 : -8;   // attackers come from ahead
      for (let sq = 0; sq < 64; sq++) {
        const set = sq < 32 ? (ringLo & (1 << sq)) !== 0 : (ringHi & (1 << (sq - 32))) !== 0;
        if (!set) continue;
        const t = sq + shift;
        if (t >= 0 && t < 64) { lo |= bitLo(t); hi |= bitHi(t); }
      }
      ZONE_LO[(def << 6) | k] = lo;
      ZONE_HI[(def << 6) | k] = hi;
    }
  }
}

/** Attack units per piece type, indexed by PIECES (KING..PAWN). */
const ATT_UNIT = [0, 5, 3, 2, 2, 1];

/** Convex units → centipawns. Capped so a swarm cannot dwarf material. */
const ATT_CURVE = new Int32Array(48);
for (let i = 0; i < 48; i++) ATT_CURVE[i] = Math.min(360, i * i);

const QUEEN_SYNERGY   = 40;   // queen + >=1 helper in the zone
const SYNERGY_SLOPE   = 5;    // per non-queen unit alongside her
const QUEEN_ASYMMETRY = 55;   // exactly one side has a queen
const TEMPO           = 12;
const MIN_ATTACKERS   = 2;

const IT = new BitBoardIterator();
/** [units, distinctAttackers, queenPresentInZone] */
const G = new Int32Array(3);

function gather(board, attIdx, occLo, occHi, zoneLo, zoneHi) {
  const bb = board.bbPieces[attIdx];
  const base = attIdx << 6;
  let units = 0, count = 0, queenIn = 0;

  for (let s = IT.init(bb[PIECES.PAWN]).next(); s >= 0; s = IT.next()) {
    if (((PA_LO[base | s] & zoneLo) | (PA_HI[base | s] & zoneHi)) !== 0) {
      units += ATT_UNIT[PIECES.PAWN]; count++;
    }
  }
  for (let s = IT.init(bb[PIECES.KNIGHT]).next(); s >= 0; s = IT.next()) {
    if (((KN_LO[s] & zoneLo) | (KN_HI[s] & zoneHi)) !== 0) {
      units += ATT_UNIT[PIECES.KNIGHT]; count++;
    }
  }
  for (let s = IT.init(bb[PIECES.BISHOP]).next(); s >= 0; s = IT.next()) {
    bishopAttacks(s, occLo, occHi);
    if (((SLIDE.lo & zoneLo) | (SLIDE.hi & zoneHi)) !== 0) {
      units += ATT_UNIT[PIECES.BISHOP]; count++;
    }
  }
  for (let s = IT.init(bb[PIECES.ROOK]).next(); s >= 0; s = IT.next()) {
    rookAttacks(s, occLo, occHi);
    if (((SLIDE.lo & zoneLo) | (SLIDE.hi & zoneHi)) !== 0) {
      units += ATT_UNIT[PIECES.ROOK]; count++;
    }
  }
  for (let s = IT.init(bb[PIECES.QUEEN]).next(); s >= 0; s = IT.next()) {
    let hit = false;
    rookAttacks(s, occLo, occHi);
    if (((SLIDE.lo & zoneLo) | (SLIDE.hi & zoneHi)) !== 0) hit = true;
    if (!hit) {
      bishopAttacks(s, occLo, occHi);
      if (((SLIDE.lo & zoneLo) | (SLIDE.hi & zoneHi)) !== 0) hit = true;
    }
    if (hit) { units += ATT_UNIT[PIECES.QUEEN]; count++; queenIn = 1; }
  }

  G[0] = units; G[1] = count; G[2] = queenIn;
}

function sideAttack(board, attIdx, defIdx, defKingSq, occLo, occHi) {
  const zi = (defIdx << 6) | defKingSq;
  gather(board, attIdx, occLo, occHi, ZONE_LO[zi], ZONE_HI[zi]);
  const units = G[0], count = G[1], queenIn = G[2];
  if (count < MIN_ATTACKERS) return 0;          // one piece is not an attack
  let s = ATT_CURVE[units < 48 ? units : 47];
  if (queenIn !== 0) {
    s += QUEEN_SYNERGY + SYNERGY_SLOPE * Math.max(0, units - ATT_UNIT[PIECES.QUEEN]);
  }
  return s;
}

export function evaluateInitiative(board, color, gamePhase, weight = 1.0) {
  const us = colorToIndex(color), them = us ^ 1;
  const ourK   = board.bbPieces[us][PIECES.KING].getLSB();
  const theirK = board.bbPieces[them][PIECES.KING].getLSB();
  if (ourK < 0 || theirK < 0) return 0;

  const occLo = (board.bbSide[0].low  | board.bbSide[1].low)  | 0;
  const occHi = (board.bbSide[0].high | board.bbSide[1].high) | 0;

  let raw = sideAttack(board, us, them, theirK, occLo, occHi)
          - sideAttack(board, them, us, ourK, occLo, occHi);

  const qUs   = board.bbPieces[us][PIECES.QUEEN].popCount();
  const qThem = board.bbPieces[them][PIECES.QUEEN].popCount();
  if (qUs > 0 && qThem === 0)      raw += QUEEN_ASYMMETRY;
  else if (qThem > 0 && qUs === 0) raw -= QUEEN_ASYMMETRY;

  raw += (board.gameState.activeColor === color ? TEMPO : -TEMPO);

  // Keep 35% in the endgame: the attack term is mostly a middlegame concern,
  // but the tempo and queen-asymmetry parts still matter with few pieces.
  const out = Math.round(raw * (0.35 + 0.65 * gamePhase) * weight);
  if (__LOG__ && LOG.heuristics) {
    logger.trace(CAT.HEURISTIC, 'initiative', { c: color, s: out, dq: qUs - qThem });
  }
  return out;
}