import { PIECES, WHITE_IDX, BLACK_IDX, SQUARE_NAMES } from '../constants/gameConstants.js';

export function colorToIndex(color) {
  return color === "white" ? WHITE_IDX : BLACK_IDX;
}

export function indexToColor(index) {
  return index === WHITE_IDX ? "white" : "black";
}

export class BitBoard {
  constructor(low = 0, high = 0) {
    this.low = low >>> 0;
    this.high = high >>> 0;
  }

  setBit(square) {
    if (square < 32) {
      this.low |= (1 << square);
    } else {
      this.high |= (1 << (square - 32));
    }
    return this;
  }

  clearBit(square) {
    if (square < 32) {
      this.low &= ~(1 << square);
    } else {
      this.high &= ~(1 << (square - 32));
    }
    return this;
  }

  getBit(square) {
    if (square < 0 || square >= 64) return false;
    if (square < 32) {
      return (this.low & (1 << square)) !== 0;
    }
    return (this.high & (1 << (square - 32))) !== 0;
  }

  toggleBit(square) {
    if (square < 32) {
      this.low ^= (1 << square);
    } else {
      this.high ^= (1 << (square - 32));
    }
    return this;
  }

  and(other) {
    return new BitBoard(this.low & other.low, this.high & other.high);
  }

  or(other) {
    return new BitBoard(this.low | other.low, this.high | other.high);
  }

  xor(other) {
    return new BitBoard(this.low ^ other.low, this.high ^ other.high);
  }

  not() {
    return new BitBoard(~this.low >>> 0, ~this.high >>> 0);
  }

  isEmpty() {
    return this.low === 0 && this.high === 0;
  }

  popCount() {
    let count = 0;
    let low = this.low;
    let high = this.high;
    while (low) { count++; low &= low - 1; }
    while (high) { count++; high &= high - 1; }
    return count;
  }

  getLSB() {
    if (this.low !== 0) {
      let low = this.low;
      let pos = 0;
      while ((low & 1) === 0) { low >>>= 1; pos++; }
      return pos;
    } else if (this.high !== 0) {
      let high = this.high;
      let pos = 32;
      while ((high & 1) === 0) { high >>>= 1; pos++; }
      return pos;
    }
    return -1;
  }

  popLSB() {
    const lsb = this.getLSB();
    if (lsb !== -1) this.clearBit(lsb);
    return lsb;
  }

  clone() {
    return new BitBoard(this.low, this.high);
  }

  equals(other) {
    return this.low === other.low && this.high === other.high;
  }

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

export function squareToIndex(square) {
  if (typeof square === 'string' && square.length === 2) {
    const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
    const rank = parseInt(square[1]) - 1;
    return rank * 8 + file;
  }
  return -1;
}

export function indexToSquare(index) {
  if (index >= 0 && index < 64) {
    const rank = Math.floor(index / 8);
    const file = index % 8;
    return String.fromCharCode('a'.charCodeAt(0) + file) + (rank + 1);
  }
  return null;
}

export function rowColToIndex(row, col) {
  const rank = 7 - row;
  return rank * 8 + col;
}

export function indexToRowCol(index) {
  const rank = Math.floor(index / 8);
  const file = index % 8;
  return [7 - rank, file];
}

export function initializeBitboards() {
  const bbPieces = {
    [WHITE_IDX]: {
      [PIECES.KING]: new BitBoard(),
      [PIECES.QUEEN]: new BitBoard(),
      [PIECES.ROOK]: new BitBoard(),
      [PIECES.BISHOP]: new BitBoard(),
      [PIECES.KNIGHT]: new BitBoard(),
      [PIECES.PAWN]: new BitBoard()
    },
    [BLACK_IDX]: {
      [PIECES.KING]: new BitBoard(),
      [PIECES.QUEEN]: new BitBoard(),
      [PIECES.ROOK]: new BitBoard(),
      [PIECES.BISHOP]: new BitBoard(),
      [PIECES.KNIGHT]: new BitBoard(),
      [PIECES.PAWN]: new BitBoard()
    }
  };

  const bbSide = {
    [WHITE_IDX]: new BitBoard(),
    [BLACK_IDX]: new BitBoard()
  };

  // White pieces
  for (let i = 8; i < 16; i++) bbPieces[WHITE_IDX][PIECES.PAWN].setBit(i);
  bbPieces[WHITE_IDX][PIECES.ROOK].setBit(squareToIndex('a1')).setBit(squareToIndex('h1'));
  bbPieces[WHITE_IDX][PIECES.KNIGHT].setBit(squareToIndex('b1')).setBit(squareToIndex('g1'));
  bbPieces[WHITE_IDX][PIECES.BISHOP].setBit(squareToIndex('c1')).setBit(squareToIndex('f1'));
  bbPieces[WHITE_IDX][PIECES.QUEEN].setBit(squareToIndex('d1'));
  bbPieces[WHITE_IDX][PIECES.KING].setBit(squareToIndex('e1'));

  // Black pieces
  for (let i = 48; i < 56; i++) bbPieces[BLACK_IDX][PIECES.PAWN].setBit(i);
  bbPieces[BLACK_IDX][PIECES.ROOK].setBit(squareToIndex('a8')).setBit(squareToIndex('h8'));
  bbPieces[BLACK_IDX][PIECES.KNIGHT].setBit(squareToIndex('b8')).setBit(squareToIndex('g8'));
  bbPieces[BLACK_IDX][PIECES.BISHOP].setBit(squareToIndex('c8')).setBit(squareToIndex('f8'));
  bbPieces[BLACK_IDX][PIECES.QUEEN].setBit(squareToIndex('d8'));
  bbPieces[BLACK_IDX][PIECES.KING].setBit(squareToIndex('e8'));

  // Side occupancy
  for (let piece = PIECES.KING; piece <= PIECES.PAWN; piece++) {
    bbSide[WHITE_IDX] = bbSide[WHITE_IDX].or(bbPieces[WHITE_IDX][piece]);
    bbSide[BLACK_IDX] = bbSide[BLACK_IDX].or(bbPieces[BLACK_IDX][piece]);
  }

  return { bbPieces, bbSide };
}

export function initializePieceList() {
  const pieceList = new Array(64).fill(PIECES.NONE);

  pieceList[squareToIndex('a1')] = PIECES.ROOK;
  pieceList[squareToIndex('b1')] = PIECES.KNIGHT;
  pieceList[squareToIndex('c1')] = PIECES.BISHOP;
  pieceList[squareToIndex('d1')] = PIECES.QUEEN;
  pieceList[squareToIndex('e1')] = PIECES.KING;
  pieceList[squareToIndex('f1')] = PIECES.BISHOP;
  pieceList[squareToIndex('g1')] = PIECES.KNIGHT;
  pieceList[squareToIndex('h1')] = PIECES.ROOK;

  for (let file = 0; file < 8; file++) {
    pieceList[squareToIndex(String.fromCharCode('a'.charCodeAt(0) + file) + '2')] = PIECES.PAWN;
  }

  pieceList[squareToIndex('a8')] = PIECES.ROOK;
  pieceList[squareToIndex('b8')] = PIECES.KNIGHT;
  pieceList[squareToIndex('c8')] = PIECES.BISHOP;
  pieceList[squareToIndex('d8')] = PIECES.QUEEN;
  pieceList[squareToIndex('e8')] = PIECES.KING;
  pieceList[squareToIndex('f8')] = PIECES.BISHOP;
  pieceList[squareToIndex('g8')] = PIECES.KNIGHT;
  pieceList[squareToIndex('h8')] = PIECES.ROOK;

  for (let file = 0; file < 8; file++) {
    pieceList[squareToIndex(String.fromCharCode('a'.charCodeAt(0) + file) + '7')] = PIECES.PAWN;
  }

  return pieceList;
}

export function getPieceColor(bbSide, square) {
  if (square < 0 || square >= 64) return null;
  if (bbSide[WHITE_IDX].getBit(square)) return "white";
  if (bbSide[BLACK_IDX].getBit(square)) return "black";
  return null;
}

export function getPieceAt(pieceList, square) {
  if (square < 0 || square >= 64) return PIECES.NONE;
  return pieceList[square];
}