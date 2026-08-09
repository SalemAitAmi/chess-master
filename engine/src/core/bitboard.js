/**
 * Bitboard utilities. 64 bits as two 32-bit halves (low/high).
 *
 * Hot paths never touch the BitBoard object: they pull `.low`/`.high` into
 * locals and operate on the (lo, hi) int32 pair. That is the exact shape the
 * C port wants (`uint64_t` + `__builtin_ctzll`), and it keeps V8 from boxing
 * intermediates. BitBoard itself is a holder, not a value type — it has no
 * allocating operators on the hot path (`or()` survives only for setup code).
 *
 * NOTE ON SIGNEDNESS: `low`/`high` may hold either a signed int32 (after a
 * `|=` / `&=`) or an unsigned double (after a `>>> 0`). Every read site below
 * normalises with `| 0`. Do not add a `===` comparison against a literal
 * above 0x7FFFFFFF.
 */
import { WHITE_IDX, BLACK_IDX, PIECES } from './constants.js';

export class BitBoard {
  constructor(low = 0, high = 0) {
    this.low = low >>> 0;
    this.high = high >>> 0;
  }

  setBit(square) {
    if (square < 32) this.low |= (1 << square);
    else this.high |= (1 << (square - 32));
    return this;
  }

  clearBit(square) {
    if (square < 32) this.low &= ~(1 << square);
    else this.high &= ~(1 << (square - 32));
    return this;
  }

  getBit(square) {
    if (square < 0 || square >= 64) return false;
    return square < 32
      ? (this.low & (1 << square)) !== 0
      : (this.high & (1 << (square - 32))) !== 0;
  }

  or(other) { return new BitBoard(this.low | other.low, this.high | other.high); }
  isEmpty() { return this.low === 0 && this.high === 0; }

  popCount() { return popCount32(this.low) + popCount32(this.high); }

  getLSB() {
    if (this.low !== 0)  return 31 - Math.clz32(this.low & -this.low);
    if (this.high !== 0) return 63 - Math.clz32(this.high & -this.high);
    return -1;
  }

  /**
   * DESTRUCTIVE. Retained for setup code (FEN parsing, tests). Every hot-path
   * caller was migrated to BitBoardIterator — `clone().popLSB()` loops were
   * allocating a BitBoard per piece type per evaluation.
   */
  popLSB() {
    const lsb = this.getLSB();
    if (lsb !== -1) this.clearBit(lsb);
    return lsb;
  }

  clone() { return new BitBoard(this.low, this.high); }

  /** Debug only — 8×8 ASCII grid, rank 8 first. */
  toString() {
    let str = '';
    for (let rank = 7; rank >= 0; rank--) {
      for (let file = 0; file < 8; file++) {
        str += this.getBit(rank * 8 + file) ? '1' : '0';
        if (file < 7) str += ' ';
      }
      if (rank > 0) str += '\n';
    }
    return str;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Non-destructive iterator
//
// Holds a SNAPSHOT of the source halves. The source BitBoard is never touched,
// so move generation can walk `bbPieces[us][KNIGHT]` directly instead of
// cloning it. Zero allocation per iteration; one object per *call site*,
// allocated at module load.
//
//   for (let sq = IT.init(bb).next(); sq >= 0; sq = IT.next()) { ... }
//
// NOT REENTRANT. A given iterator instance may not be re-initialised while a
// loop over it is still live. Nested loops need distinct instances; see the
// IT_PIECE / IT_TARGET / IT_SCAN triple in moveGeneration.js.
// ═══════════════════════════════════════════════════════════════════════════
export class BitBoardIterator {
  constructor() { this.lo = 0; this.hi = 0; }

  init(bb)            { this.lo = bb.low | 0; this.hi = bb.high | 0; return this; }
  initRaw(lo, hi)     { this.lo = lo | 0;     this.hi = hi | 0;      return this; }

  hasNext()           { return (this.lo | this.hi) !== 0; }

  /** @returns {number} next set square (ascending), or -1 when exhausted. */
  next() {
    if (this.lo !== 0) { const b = this.lo & -this.lo; this.lo ^= b; return 31 - Math.clz32(b); }
    if (this.hi !== 0) { const b = this.hi & -this.hi; this.hi ^= b; return 63 - Math.clz32(b); }
    return -1;
  }
}

// ── Raw (lo, hi) primitives. These are the C-portable core. ──

/** All bits of one half. Use as an "every square" mask. */
export const FULL = -1;

export function bitLo(sq) { return sq < 32 ? (1 << sq) : 0; }
export function bitHi(sq) { return sq >= 32 ? (1 << (sq - 32)) : 0; }

export function hasBit(lo, hi, sq) {
  return sq < 32 ? (lo & (1 << sq)) !== 0 : (hi & (1 << (sq - 32))) !== 0;
}

export function lsb64(lo, hi) {
  if (lo !== 0) return 31 - Math.clz32(lo & -lo);
  return 63 - Math.clz32(hi & -hi);
}

export function msb64(lo, hi) {
  if (hi !== 0) return 63 - Math.clz32(hi);
  return 31 - Math.clz32(lo);
}

export function popCount64(lo, hi) { return popCount32(lo) + popCount32(hi); }

/** Exactly one bit set across both halves. Caller guarantees (lo|hi) !== 0. */
export function isSingleBit(lo, hi) {
  if (lo === 0) return (hi & (hi - 1)) === 0;
  return hi === 0 && (lo & (lo - 1)) === 0;
}

export function popCount32(x) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

// ── Coordinate conversion ──
export function squareToIndex(square) {
  if (typeof square === 'string' && square.length === 2) {
    const file = square.charCodeAt(0) - 97;
    const rank = square.charCodeAt(1) - 49;
    if (file >= 0 && file < 8 && rank >= 0 && rank < 8) return rank * 8 + file;
  }
  return -1;
}

export function indexToSquare(index) {
  if (index >= 0 && index < 64) {
    return String.fromCharCode(97 + (index & 7)) + ((index >> 3) + 1);
  }
  return null;
}

export function rowColToIndex(row, col) { return ((7 - row) << 3) | col; }
export function indexToRowCol(index)    { return [7 - (index >> 3), index & 7]; }
export function colorToIndex(color)     { return color === 'white' ? WHITE_IDX : BLACK_IDX; }

export function getPieceColor(bbSide, square) {
  if (square < 0 || square >= 64) return null;
  if (bbSide[WHITE_IDX].getBit(square)) return 'white';
  if (bbSide[BLACK_IDX].getBit(square)) return 'black';
  return null;
}

export function initializeBitboards() {
  const bbPieces = { [WHITE_IDX]: {}, [BLACK_IDX]: {} };
  for (let piece = PIECES.KING; piece <= PIECES.PAWN; piece++) {
    bbPieces[WHITE_IDX][piece] = new BitBoard();
    bbPieces[BLACK_IDX][piece] = new BitBoard();
  }
  const bbSide = { [WHITE_IDX]: new BitBoard(), [BLACK_IDX]: new BitBoard() };

  for (let i = 8; i < 16; i++) bbPieces[WHITE_IDX][PIECES.PAWN].setBit(i);
  bbPieces[WHITE_IDX][PIECES.ROOK].setBit(0).setBit(7);
  bbPieces[WHITE_IDX][PIECES.KNIGHT].setBit(1).setBit(6);
  bbPieces[WHITE_IDX][PIECES.BISHOP].setBit(2).setBit(5);
  bbPieces[WHITE_IDX][PIECES.QUEEN].setBit(3);
  bbPieces[WHITE_IDX][PIECES.KING].setBit(4);

  for (let i = 48; i < 56; i++) bbPieces[BLACK_IDX][PIECES.PAWN].setBit(i);
  bbPieces[BLACK_IDX][PIECES.ROOK].setBit(56).setBit(63);
  bbPieces[BLACK_IDX][PIECES.KNIGHT].setBit(57).setBit(62);
  bbPieces[BLACK_IDX][PIECES.BISHOP].setBit(58).setBit(61);
  bbPieces[BLACK_IDX][PIECES.QUEEN].setBit(59);
  bbPieces[BLACK_IDX][PIECES.KING].setBit(60);

  for (let piece = PIECES.KING; piece <= PIECES.PAWN; piece++) {
    bbSide[WHITE_IDX] = bbSide[WHITE_IDX].or(bbPieces[WHITE_IDX][piece]);
    bbSide[BLACK_IDX] = bbSide[BLACK_IDX].or(bbPieces[BLACK_IDX][piece]);
  }
  return { bbPieces, bbSide };
}

export function initializePieceList() {
  const pieceList = new Array(64).fill(PIECES.NONE);
  const back = [PIECES.ROOK, PIECES.KNIGHT, PIECES.BISHOP, PIECES.QUEEN,
                PIECES.KING, PIECES.BISHOP, PIECES.KNIGHT, PIECES.ROOK];
  for (let f = 0; f < 8; f++) { pieceList[f] = back[f]; pieceList[56 + f] = back[f]; }
  for (let i = 8; i < 16; i++) pieceList[i] = PIECES.PAWN;
  for (let i = 48; i < 56; i++) pieceList[i] = PIECES.PAWN;
  return pieceList;
}