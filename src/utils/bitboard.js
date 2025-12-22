import { PIECES, WHITE_IDX, BLACK_IDX, SQUARE_NAMES, PIECE_NAMES } from '../constants/gameConstants';

export function colorToIndex(color) {
  return color === "white" ? WHITE_IDX : BLACK_IDX;
}

export function indexToColor(index) {
  return index === WHITE_IDX ? "white" : "black";
}

// BitBoard class to handle 64-bit board operations using two 32-bit integers
export class BitBoard {
  constructor(low = 0, high = 0) {
    this.low = low >>> 0;  // Lower 32 bits (squares 0-31)
    this.high = high >>> 0; // Higher 32 bits (squares 32-63)
  }

  // Set a bit at given square index (0-63)
  setBit(square) {
    if (square < 32) {
      this.low |= (1 << square);
    } else {
      this.high |= (1 << (square - 32));
    }
    return this;
  }

  // Clear a bit at given square index
  clearBit(square) {
    if (square < 32) {
      this.low &= ~(1 << square);
    } else {
      this.high &= ~(1 << (square - 32));
    }
    return this;
  }

  // Check if bit is set at given square
  getBit(square) {
    if (square < 0 || square >= 64) {
      console.error(`BitBoard.getBit: Invalid square ${square}`);
      return false;
    }
    if (square < 32) {
      return (this.low & (1 << square)) !== 0;
    } else {
      return (this.high & (1 << (square - 32))) !== 0;
    }
  }

  // Toggle a bit at given square
  toggleBit(square) {
    if (square < 32) {
      this.low ^= (1 << square);
    } else {
      this.high ^= (1 << (square - 32));
    }
    return this;
  }

  // Bitwise AND operation
  and(other) {
    return new BitBoard(
      this.low & other.low,
      this.high & other.high
    );
  }

  // Bitwise OR operation
  or(other) {
    return new BitBoard(
      this.low | other.low,
      this.high | other.high
    );
  }

  // Bitwise XOR operation
  xor(other) {
    return new BitBoard(
      this.low ^ other.low,
      this.high ^ other.high
    );
  }

  // Bitwise NOT operation
  not() {
    return new BitBoard(~this.low >>> 0, ~this.high >>> 0);
  }

  // Check if bitboard is empty
  isEmpty() {
    return this.low === 0 && this.high === 0;
  }

  // Count number of set bits
  popCount() {
    // Count bits in low and high parts
    let count = 0;
    let low = this.low;
    let high = this.high;
    
    while (low) {
      count++;
      low &= low - 1;
    }
    
    while (high) {
      count++;
      high &= high - 1;
    }
    
    return count;
  }

  // Get index of least significant bit
  getLSB() {
    if (this.low !== 0) {
      // Find the position of the least significant bit
      let low = this.low;
      let pos = 0;
      while ((low & 1) === 0) {
        low >>>= 1;
        pos++;
      }
      return pos;
    } else if (this.high !== 0) {
      let high = this.high;
      let pos = 32;
      while ((high & 1) === 0) {
        high >>>= 1;
        pos++;
      }
      return pos;
    }
    return -1;
  }

  // Pop least significant bit and return its index
  popLSB() {
    const lsb = this.getLSB();
    if (lsb !== -1) {
      this.clearBit(lsb);
    }
    return lsb;
  }

  // Clone the bitboard
  clone() {
    return new BitBoard(this.low, this.high);
  }

  // Check equality
  equals(other) {
    return this.low === other.low && this.high === other.high;
  }

  // Convert to string for debugging
  toString() {
    let str = '';
    for (let rank = 7; rank >= 0; rank--) {
      for (let file = 0; file < 8; file++) {
        const square = rank * 8 + file;
        str += this.getBit(square) ? '1' : '0';
        if (file < 7) str += ' ';
      }
      if (rank > 0) str += '\n';
    }
    return str;
  }
}

// Helper function to convert square notation (e.g., "e4") to index (0-63)
export function squareToIndex(square) {
  if (typeof square === 'string' && square.length === 2) {
    const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
    const rank = parseInt(square[1]) - 1;
    const index = rank * 8 + file;
    return index;
  }
  return -1;
}

// Helper function to convert index (0-63) to square notation
export function indexToSquare(index) {
  if (index >= 0 && index < 64) {
    const rank = Math.floor(index / 8);
    const file = index % 8;
    return SQUARE_NAMES[rank][file];
  }
  return null;
}

// Helper function to convert row/col to bitboard index
export function rowColToIndex(row, col) {
  // In the UI, row 0 is rank 8, so we need to invert
  const rank = 7 - row;
  const index = rank * 8 + col;
  return index;
}

// Helper function to convert bitboard index to row/col
export function indexToRowCol(index) {
  const rank = Math.floor(index / 8);
  const file = index % 8;
  // In the UI, row 0 is rank 8, so we need to invert
  const row = 7 - rank;
  const col = file;
  return [row, col];
}

// Initialize bitboards for starting position
export function initializeBitboards() {
  console.log("Initializing bitboards...");
  
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
  // Pawns on rank 2 (indices 8-15)
  for (let i = 8; i < 16; i++) {
    bbPieces[WHITE_IDX][PIECES.PAWN].setBit(i);
  }
  
  bbPieces[WHITE_IDX][PIECES.ROOK].setBit(squareToIndex('a1')).setBit(squareToIndex('h1'));
  bbPieces[WHITE_IDX][PIECES.KNIGHT].setBit(squareToIndex('b1')).setBit(squareToIndex('g1'));
  bbPieces[WHITE_IDX][PIECES.BISHOP].setBit(squareToIndex('c1')).setBit(squareToIndex('f1'));
  bbPieces[WHITE_IDX][PIECES.QUEEN].setBit(squareToIndex('d1'));
  bbPieces[WHITE_IDX][PIECES.KING].setBit(squareToIndex('e1'));

  // Black pieces
  // Pawns on rank 7 (indices 48-55)
  for (let i = 48; i < 56; i++) {
    bbPieces[BLACK_IDX][PIECES.PAWN].setBit(i);
  }
  
  bbPieces[BLACK_IDX][PIECES.ROOK].setBit(squareToIndex('a8')).setBit(squareToIndex('h8'));
  bbPieces[BLACK_IDX][PIECES.KNIGHT].setBit(squareToIndex('b8')).setBit(squareToIndex('g8'));
  bbPieces[BLACK_IDX][PIECES.BISHOP].setBit(squareToIndex('c8')).setBit(squareToIndex('f8'));
  bbPieces[BLACK_IDX][PIECES.QUEEN].setBit(squareToIndex('d8'));
  bbPieces[BLACK_IDX][PIECES.KING].setBit(squareToIndex('e8'));

  // Calculate side occupancy
  for (let piece = PIECES.KING; piece <= PIECES.PAWN; piece++) {
    bbSide[WHITE_IDX] = bbSide[WHITE_IDX].or(bbPieces[WHITE_IDX][piece]);
    bbSide[BLACK_IDX] = bbSide[BLACK_IDX].or(bbPieces[BLACK_IDX][piece]);
  }

  return { bbPieces, bbSide };
}

// Initialize piece list for starting position
export function initializePieceList() {
  console.log("Initializing piece list...");
  const pieceList = new Array(64).fill(PIECES.NONE);
  
  // White pieces
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
  
  // Black pieces
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
  
  // Log piece positions with names
  console.log("Piece list initialized. Non-empty squares:");
  for (let i = 0; i < 64; i++) {
    if (pieceList[i] !== PIECES.NONE) {
      console.log(`Square ${i} (${indexToSquare(i)}): ${PIECE_NAMES[pieceList[i]]}`);
    }
  }
  
  return pieceList;
}

// Get color of piece at given square
export function getPieceColor(bbSide, square) {
  if (square < 0 || square >= 64) {
    console.error(`getPieceColor: Invalid square ${square}`);
    return null;
  }
  if (bbSide[WHITE_IDX].getBit(square)) return "white";
  if (bbSide[BLACK_IDX].getBit(square)) return "black";
  return null;
}

// Get piece type at given square
export function getPieceAt(pieceList, square) {
  if (square < 0 || square >= 64) {
    console.error(`getPieceAt: Invalid square ${square}`);
    return PIECES.NONE;
  }
  return pieceList[square];
}