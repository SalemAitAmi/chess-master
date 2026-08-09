/**
 * Attack tables and attack-set construction.
 *
 * Everything is a flat Int32Array of (lo, hi) halves, built once at module
 * load. Nothing here allocates at runtime: functions write their result into
 * a module-level out-struct. Read `.lo`/`.hi` into locals IMMEDIATELY — the
 * next call to the same function overwrites them.
 *
 *   SLIDE      ← rookAttacks / bishopAttacks
 *   ATTACKS    ← computeAttackSet      (never aliases SLIDE)
 *   ATTACKERS  ← attackersToSquare     (never aliases SLIDE or ATTACKS)
 *
 * Slider attacks use the classic ray + blocker-bitscan method:
 *
 *   ray      = RAY[dir][sq]
 *   blockers = ray & occ
 *   if blockers: ray ^= RAY[dir][ positive(dir) ? lsb(blockers) : msb(blockers) ]
 *
 * which keeps the blocker square itself in the set (so it is a capture target)
 * and drops everything behind it. In C this becomes the identical two-line
 * body with `__builtin_ctzll` / `63 - __builtin_clzll`.
 */
import { PIECES, WHITE_IDX } from './constants.js';
import { BitBoardIterator, bitLo, bitHi, lsb64, msb64 } from './bitboard.js';

// ── Direction encoding ──────────────────────────────────────────────────────
// 0..3 are the rook directions, 4..7 the bishop directions. POS[] records
// whether the direction increases the square index, which selects lsb vs msb.
const DR  = [  1,  0, -1,  0,   1,  1, -1, -1];
const DF  = [  0,  1,  0, -1,   1, -1,  1, -1];
//             N   E   S   W   NE  NW  SE  SW
const POS = [  1,  1,  0,  0,   1,  1,  0,  0];

export const KN_LO = new Int32Array(64),  KN_HI = new Int32Array(64);
export const KG_LO = new Int32Array(64),  KG_HI = new Int32Array(64);
/** PA_[color << 6 | sq] = squares a `color` pawn standing on `sq` attacks. */
export const PA_LO = new Int32Array(128), PA_HI = new Int32Array(128);
/** RAY_[dir << 6 | sq] = every square from `sq` in `dir`, exclusive of `sq`. */
const RAY_LO = new Int32Array(512), RAY_HI = new Int32Array(512);
/** BTW_[a << 6 | b] = squares strictly between a and b; 0 when not aligned. */
export const BTW_LO = new Int32Array(4096), BTW_HI = new Int32Array(4096);
/** Empty-board attack sets, used to find pin candidates. */
export const RRAY_LO = new Int32Array(64), RRAY_HI = new Int32Array(64);
export const BRAY_LO = new Int32Array(64), BRAY_HI = new Int32Array(64);

{
  const KNIGHT_D = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  const KING_D   = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];

  for (let sq = 0; sq < 64; sq++) {
    const r = sq >> 3, f = sq & 7;

    for (const [dr, df] of KNIGHT_D) {
      const nr = r + dr, nf = f + df;
      if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
        const s = (nr << 3) | nf;
        KN_LO[sq] |= bitLo(s); KN_HI[sq] |= bitHi(s);
      }
    }
    for (const [dr, df] of KING_D) {
      const nr = r + dr, nf = f + df;
      if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
        const s = (nr << 3) | nf;
        KG_LO[sq] |= bitLo(s); KG_HI[sq] |= bitHi(s);
      }
    }

    // Pawn attacks. White from `sq` hits sq+7 (file-1) and sq+9 (file+1).
    if (r < 7) {
      if (f > 0) { PA_LO[sq] |= bitLo(sq + 7); PA_HI[sq] |= bitHi(sq + 7); }
      if (f < 7) { PA_LO[sq] |= bitLo(sq + 9); PA_HI[sq] |= bitHi(sq + 9); }
    }
    if (r > 0) {
      const b = 64 | sq;   // (BLACK_IDX << 6) | sq
      if (f > 0) { PA_LO[b] |= bitLo(sq - 9); PA_HI[b] |= bitHi(sq - 9); }
      if (f < 7) { PA_LO[b] |= bitLo(sq - 7); PA_HI[b] |= bitHi(sq - 7); }
    }

    for (let d = 0; d < 8; d++) {
      const i = (d << 6) | sq;
      let nr = r + DR[d], nf = f + DF[d];
      while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
        const s = (nr << 3) | nf;
        RAY_LO[i] |= bitLo(s); RAY_HI[i] |= bitHi(s);
        nr += DR[d]; nf += DF[d];
      }
      if (d < 4) { RRAY_LO[sq] |= RAY_LO[i]; RRAY_HI[sq] |= RAY_HI[i]; }
      else       { BRAY_LO[sq] |= RAY_LO[i]; BRAY_HI[sq] |= RAY_HI[i]; }
    }
  }

  // BETWEEN: walk each ray, recording the accumulated prefix at each square.
  for (let a = 0; a < 64; a++) {
    for (let d = 0; d < 8; d++) {
      let accLo = 0, accHi = 0;
      let r = (a >> 3) + DR[d], f = (a & 7) + DF[d];
      while (r >= 0 && r < 8 && f >= 0 && f < 8) {
        const b = (r << 3) | f;
        BTW_LO[(a << 6) | b] = accLo;
        BTW_HI[(a << 6) | b] = accHi;
        accLo |= bitLo(b); accHi |= bitHi(b);
        r += DR[d]; f += DF[d];
      }
    }
  }
}

// ── Out-structs. Never aliased; see the header comment. ──
export const SLIDE     = { lo: 0, hi: 0 };
export const ATTACKS   = { lo: 0, hi: 0 };
export const ATTACKERS = { lo: 0, hi: 0 };

export function rookAttacks(sq, occLo, occHi) {
  let lo = 0, hi = 0;
  for (let d = 0; d < 4; d++) {
    const i = (d << 6) | sq;
    let rLo = RAY_LO[i], rHi = RAY_HI[i];
    const bLo = rLo & occLo, bHi = rHi & occHi;
    if ((bLo | bHi) !== 0) {
      const b = POS[d] ? lsb64(bLo, bHi) : msb64(bLo, bHi);
      const j = (d << 6) | b;
      rLo ^= RAY_LO[j]; rHi ^= RAY_HI[j];
    }
    lo |= rLo; hi |= rHi;
  }
  SLIDE.lo = lo; SLIDE.hi = hi;
}

export function bishopAttacks(sq, occLo, occHi) {
  let lo = 0, hi = 0;
  for (let d = 4; d < 8; d++) {
    const i = (d << 6) | sq;
    let rLo = RAY_LO[i], rHi = RAY_HI[i];
    const bLo = rLo & occLo, bHi = rHi & occHi;
    if ((bLo | bHi) !== 0) {
      const b = POS[d] ? lsb64(bLo, bHi) : msb64(bLo, bHi);
      const j = (d << 6) | b;
      rLo ^= RAY_LO[j]; rHi ^= RAY_HI[j];
    }
    lo |= rLo; hi |= rHi;
  }
  SLIDE.lo = lo; SLIDE.hi = hi;
}

// Dedicated iterator: computeAttackSet is the only consumer and never nests.
const A_IT = new BitBoardIterator();

/**
 * Every square attacked by `byIdx`, including squares occupied by its own
 * pieces (a defended piece is not capturable by the enemy king).
 *
 * `occLo/occHi` is the occupancy the sliders see. Callers pass the real
 * occupancy MINUS the defending king, so that a ray passing through the king
 * continues onto the square behind it — otherwise the king could "escape"
 * backwards along the checking line. The king is put back simply by not
 * having touched the board: the lift is a local scalar, never a mutation.
 */
export function computeAttackSet(board, byIdx, occLo, occHi) {
  const bb = board.bbPieces[byIdx];
  const base = byIdx << 6;
  let lo = 0, hi = 0;

  for (let s = A_IT.init(bb[PIECES.PAWN]).next(); s >= 0; s = A_IT.next()) {
    lo |= PA_LO[base | s]; hi |= PA_HI[base | s];
  }
  for (let s = A_IT.init(bb[PIECES.KNIGHT]).next(); s >= 0; s = A_IT.next()) {
    lo |= KN_LO[s]; hi |= KN_HI[s];
  }
  for (let s = A_IT.init(bb[PIECES.BISHOP]).next(); s >= 0; s = A_IT.next()) {
    bishopAttacks(s, occLo, occHi); lo |= SLIDE.lo; hi |= SLIDE.hi;
  }
  for (let s = A_IT.init(bb[PIECES.ROOK]).next(); s >= 0; s = A_IT.next()) {
    rookAttacks(s, occLo, occHi); lo |= SLIDE.lo; hi |= SLIDE.hi;
  }
  for (let s = A_IT.init(bb[PIECES.QUEEN]).next(); s >= 0; s = A_IT.next()) {
    rookAttacks(s, occLo, occHi);   lo |= SLIDE.lo; hi |= SLIDE.hi;
    bishopAttacks(s, occLo, occHi); lo |= SLIDE.lo; hi |= SLIDE.hi;
  }
  const k = bb[PIECES.KING].getLSB();
  if (k >= 0) { lo |= KG_LO[k]; hi |= KG_HI[k]; }

  ATTACKS.lo = lo; ATTACKS.hi = hi;
}

/**
 * Squares of every `byIdx` piece that attacks `sq`. KINGS ARE EXCLUDED:
 * the only caller is checker detection, a king can never give check, and
 * including one would report a bogus check in a corrupt position with
 * adjacent kings.
 *
 * The pawn term uses the mirror identity: a `byIdx` pawn on `s` attacks `sq`
 * iff `s ∈ PA[byIdx^1][sq]`.
 */
export function attackersToSquare(board, sq, byIdx, occLo, occHi) {
  const bb = board.bbPieces[byIdx];
  const m = (byIdx ^ 1) << 6;

  let lo = PA_LO[m | sq] & bb[PIECES.PAWN].low;
  let hi = PA_HI[m | sq] & bb[PIECES.PAWN].high;

  lo |= KN_LO[sq] & bb[PIECES.KNIGHT].low;
  hi |= KN_HI[sq] & bb[PIECES.KNIGHT].high;

  const bqLo = (bb[PIECES.BISHOP].low  | bb[PIECES.QUEEN].low)  | 0;
  const bqHi = (bb[PIECES.BISHOP].high | bb[PIECES.QUEEN].high) | 0;
  if ((bqLo | bqHi) !== 0) {
    bishopAttacks(sq, occLo, occHi);
    lo |= SLIDE.lo & bqLo; hi |= SLIDE.hi & bqHi;
  }

  const rqLo = (bb[PIECES.ROOK].low  | bb[PIECES.QUEEN].low)  | 0;
  const rqHi = (bb[PIECES.ROOK].high | bb[PIECES.QUEEN].high) | 0;
  if ((rqLo | rqHi) !== 0) {
    rookAttacks(sq, occLo, occHi);
    lo |= SLIDE.lo & rqLo; hi |= SLIDE.hi & rqHi;
  }

  ATTACKERS.lo = lo; ATTACKERS.hi = hi;
}

/** Boolean form with early exit, cheapest attacker first. Includes kings. */
export function squareAttackedBy(board, sq, byIdx, occLo, occHi) {
  const bb = board.bbPieces[byIdx];
  const m = (byIdx ^ 1) << 6;

  if (((PA_LO[m | sq] & bb[PIECES.PAWN].low) | (PA_HI[m | sq] & bb[PIECES.PAWN].high)) !== 0) return true;
  if (((KN_LO[sq] & bb[PIECES.KNIGHT].low) | (KN_HI[sq] & bb[PIECES.KNIGHT].high)) !== 0) return true;
  if (((KG_LO[sq] & bb[PIECES.KING].low) | (KG_HI[sq] & bb[PIECES.KING].high)) !== 0) return true;

  const bqLo = (bb[PIECES.BISHOP].low  | bb[PIECES.QUEEN].low)  | 0;
  const bqHi = (bb[PIECES.BISHOP].high | bb[PIECES.QUEEN].high) | 0;
  if ((bqLo | bqHi) !== 0) {
    bishopAttacks(sq, occLo, occHi);
    if (((SLIDE.lo & bqLo) | (SLIDE.hi & bqHi)) !== 0) return true;
  }

  const rqLo = (bb[PIECES.ROOK].low  | bb[PIECES.QUEEN].low)  | 0;
  const rqHi = (bb[PIECES.ROOK].high | bb[PIECES.QUEEN].high) | 0;
  if ((rqLo | rqHi) !== 0) {
    rookAttacks(sq, occLo, occHi);
    if (((SLIDE.lo & rqLo) | (SLIDE.hi & rqHi)) !== 0) return true;
  }
  return false;
}

/** Slider-only attack test against a hypothetical occupancy. Used by e.p. */
export function sliderAttacksKing(board, ksq, themIdx, occLo, occHi) {
  const tb = board.bbPieces[themIdx];

  rookAttacks(ksq, occLo, occHi);
  const rqLo = (tb[PIECES.ROOK].low  | tb[PIECES.QUEEN].low)  | 0;
  const rqHi = (tb[PIECES.ROOK].high | tb[PIECES.QUEEN].high) | 0;
  if (((SLIDE.lo & rqLo) | (SLIDE.hi & rqHi)) !== 0) return true;

  bishopAttacks(ksq, occLo, occHi);
  const bqLo = (tb[PIECES.BISHOP].low  | tb[PIECES.QUEEN].low)  | 0;
  const bqHi = (tb[PIECES.BISHOP].high | tb[PIECES.QUEEN].high) | 0;
  if (((SLIDE.lo & bqLo) | (SLIDE.hi & bqHi)) !== 0) return true;

  return false;
}

export { WHITE_IDX };