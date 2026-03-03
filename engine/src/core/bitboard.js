/**
 * Bitboard utilities for efficient board representation
 */

import { WHITE_IDX, BLACK_IDX, PIECES } from './constants.js';

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

// Utility functions
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

export function colorToIndex(color) {
  return color === 'white' ? WHITE_IDX : BLACK_IDX;
}

export function indexToColor(index) {
  return index === WHITE_IDX ? 'white' : 'black';
}

export function getPieceColor(bbSide, square) {
  if (square < 0 || square >= 64) return null;
  if (bbSide[WHITE_IDX].getBit(square)) return 'white';
  if (bbSide[BLACK_IDX].getBit(square)) return 'black';
  return null;
}

// Initialize bitboards for starting position
export function initializeBitboards() {
  const bbPieces = {
    [WHITE_IDX]: {},
    [BLACK_IDX]: {}
  };
  
  for (let piece = PIECES.KING; piece <= PIECES.PAWN; piece++) {
    bbPieces[WHITE_IDX][piece] = new BitBoard();
    bbPieces[BLACK_IDX][piece] = new BitBoard();
  }

  const bbSide = {
    [WHITE_IDX]: new BitBoard(),
    [BLACK_IDX]: new BitBoard()
  };

  // White pieces
  for (let i = 8; i < 16; i++) bbPieces[WHITE_IDX][PIECES.PAWN].setBit(i);
  bbPieces[WHITE_IDX][PIECES.ROOK].setBit(0).setBit(7);
  bbPieces[WHITE_IDX][PIECES.KNIGHT].setBit(1).setBit(6);
  bbPieces[WHITE_IDX][PIECES.BISHOP].setBit(2).setBit(5);
  bbPieces[WHITE_IDX][PIECES.QUEEN].setBit(3);
  bbPieces[WHITE_IDX][PIECES.KING].setBit(4);

  // Black pieces
  for (let i = 48; i < 56; i++) bbPieces[BLACK_IDX][PIECES.PAWN].setBit(i);
  bbPieces[BLACK_IDX][PIECES.ROOK].setBit(56).setBit(63);
  bbPieces[BLACK_IDX][PIECES.KNIGHT].setBit(57).setBit(62);
  bbPieces[BLACK_IDX][PIECES.BISHOP].setBit(58).setBit(61);
  bbPieces[BLACK_IDX][PIECES.QUEEN].setBit(59);
  bbPieces[BLACK_IDX][PIECES.KING].setBit(60);

  // Side occupancy
  for (let piece = PIECES.KING; piece <= PIECES.PAWN; piece++) {
    bbSide[WHITE_IDX] = bbSide[WHITE_IDX].or(bbPieces[WHITE_IDX][piece]);
    bbSide[BLACK_IDX] = bbSide[BLACK_IDX].or(bbPieces[BLACK_IDX][piece]);
  }

  return { bbPieces, bbSide };
}

export function initializePieceList() {
  const pieceList = new Array(64).fill(PIECES.NONE);
  
  // White pieces
  pieceList[0] = PIECES.ROOK; pieceList[1] = PIECES.KNIGHT;
  pieceList[2] = PIECES.BISHOP; pieceList[3] = PIECES.QUEEN;
  pieceList[4] = PIECES.KING; pieceList[5] = PIECES.BISHOP;
  pieceList[6] = PIECES.KNIGHT; pieceList[7] = PIECES.ROOK;
  for (let i = 8; i < 16; i++) pieceList[i] = PIECES.PAWN;
  
  // Black pieces
  pieceList[56] = PIECES.ROOK; pieceList[57] = PIECES.KNIGHT;
  pieceList[58] = PIECES.BISHOP; pieceList[59] = PIECES.QUEEN;
  pieceList[60] = PIECES.KING; pieceList[61] = PIECES.BISHOP;
  pieceList[62] = PIECES.KNIGHT; pieceList[63] = PIECES.ROOK;
  for (let i = 48; i < 56; i++) pieceList[i] = PIECES.PAWN;
  
  return pieceList;
}