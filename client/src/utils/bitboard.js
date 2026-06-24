/**
 * Minimal bitboard utilities for UI coordinate conversion
 * Full bitboard implementation is in the engine
 */

// Square name conversion
export function squareToIndex(square) {
  if (typeof square === 'string' && square.length === 2) {
    const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
    const rank = parseInt(square[1]) - 1;
    if (file >= 0 && file < 8 && rank >= 0 && rank < 8) {
      return rank * 8 + file;
    }
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

// Row/Col (UI coordinates) to index conversion
// Row 0 = rank 8 (top of board), Row 7 = rank 1 (bottom)
export function rowColToIndex(row, col) {
  const rank = 7 - row;
  return rank * 8 + col;
}

export function indexToRowCol(index) {
  const rank = Math.floor(index / 8);
  const file = index % 8;
  return [7 - rank, file];
}

// Create UCI move string from UI coordinates
export function createMoveString(fromRow, fromCol, toRow, toCol, promotion = null) {
  const from = indexToSquare(rowColToIndex(fromRow, fromCol));
  const to = indexToSquare(rowColToIndex(toRow, toCol));
  return from + to + (promotion || '');
}

// Parse UCI move string to UI coordinates
export function parseMoveString(moveStr) {
  if (!moveStr || moveStr.length < 4) return null;
  
  const fromSquare = moveStr.slice(0, 2);
  const toSquare = moveStr.slice(2, 4);
  const promotion = moveStr.length > 4 ? moveStr[4] : null;
  
  const fromIndex = squareToIndex(fromSquare);
  const toIndex = squareToIndex(toSquare);
  
  if (fromIndex === -1 || toIndex === -1) return null;
  
  const [fromRow, fromCol] = indexToRowCol(fromIndex);
  const [toRow, toCol] = indexToRowCol(toIndex);
  
  return { fromRow, fromCol, toRow, toCol, promotion };
}