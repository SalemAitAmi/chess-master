import { deepCopyBoard } from "./chessUtils";
import { PIECES, CASTLING } from '../constants/gameConstants';
import { rowColToIndex, indexToRowCol, getPieceColor, colorToIndex } from './bitboard';

export const isInCheck = (board, color) => {
  // Find king position
  const colorIdx = colorToIndex(color);
  const kingBB = board.bbPieces[colorIdx][PIECES.KING];
  const kingSquare = kingBB.getLSB();
  
  if (kingSquare === -1) {
    // console.error("No king found!");
    return false;
  }
  
  const [kingRow, kingCol] = indexToRowCol(kingSquare);
  const oppositeColor = color === "white" ? "black" : "white";
  const oppositeColorIdx = colorToIndex(oppositeColor);
  
  // Check all opponent pieces
  for (let pieceType = PIECES.KING; pieceType <= PIECES.PAWN; pieceType++) {
    const pieceBB = board.bbPieces[oppositeColorIdx][pieceType].clone();
    
    while (!pieceBB.isEmpty()) {
      const square = pieceBB.popLSB();
      const [row, col] = indexToRowCol(square);
      
      // Get valid moves for this piece (without checking for castling to avoid recursion)
      const moves = getValidMoves(row, col, board, false);
      
      // Check if any move attacks the king
      if (moves.some(([mr, mc]) => mr === kingRow && mc === kingCol)) {
        return true;
      }
    }
  }
  
  return false;
};

// Helper function to check if a square can be moved to
const canMoveTo = (board, targetRow, targetCol, color) => {
  if (targetRow < 0 || targetRow >= 8 || targetCol < 0 || targetCol >= 8) {
    return false;
  }
  
  const targetIndex = rowColToIndex(targetRow, targetCol);
  const targetColor = getPieceColor(board.bbSide, targetIndex);
  
  // Can move to empty square or capture opponent piece
  const oppositeColor = color === "white" ? "black" : "white";
  return targetColor === null || targetColor === oppositeColor;
};

// Get valid pawn moves
const getValidPawnMoves = (row, col, board, color) => {
  const moves = [];
  const oppositeColor = color === "white" ? "black" : "white";
  const direction = color === "white" ? -1 : 1;
  const startingRank = color === "white" ? 6 : 1;
  const enPassantRank = color === "white" ? 3 : 4;
  
  // Forward moves
  const oneSquareForward = row + direction;
  if (oneSquareForward >= 0 && oneSquareForward < 8) {
    const forwardIndex = rowColToIndex(oneSquareForward, col);
    if (getPieceColor(board.bbSide, forwardIndex) === null) {
      moves.push([oneSquareForward, col]);
      
      // Double push from starting position
      if (row === startingRank) {
        const twoSquaresForward = row + (2 * direction);
        const doublePushIndex = rowColToIndex(twoSquaresForward, col);
        if (getPieceColor(board.bbSide, doublePushIndex) === null) {
          moves.push([twoSquaresForward, col]);
        }
      }
    }
  }
  
  // Diagonal captures
  for (const dcol of [-1, 1]) {
    const targetRow = row + direction;
    const targetCol = col + dcol;
    
    if (targetRow >= 0 && targetRow < 8 && targetCol >= 0 && targetCol < 8) {
      const targetIndex = rowColToIndex(targetRow, targetCol);
      const targetColor = getPieceColor(board.bbSide, targetIndex);
      
      if (targetColor === oppositeColor) {
        moves.push([targetRow, targetCol]);
      }
    }
  }
  
  // En passant
  if (row === enPassantRank && board.gameState.en_passant_sq !== -1) {
    const [, epCol] = indexToRowCol(board.gameState.en_passant_sq);
    
    // The en passant square is where the enemy pawn passed over
    // We need to check if we're adjacent to the enemy pawn
    if (Math.abs(epCol - col) === 1) {
      // The enemy pawn is on the same rank as us
      const enemyPawnIndex = rowColToIndex(row, epCol);
      
      // Verify there's an enemy pawn at the expected position
      if (getPieceColor(board.bbSide, enemyPawnIndex) === oppositeColor &&
          board.pieceList[enemyPawnIndex] === PIECES.PAWN) {
        // We move diagonally forward to capture
        const captureRow = row + direction;
        moves.push([captureRow, epCol]);
        // console.log(`En passant move available: from ${SQUARE_NAMES[7-row][col]} to ${SQUARE_NAMES[7-captureRow][epCol]}`);
      }
    }
  }
  
  return moves;
};

// Get valid rook moves
const getValidRookMoves = (row, col, board, color) => {
  const moves = [];
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const oppositeColor = color === "white" ? "black" : "white";
  
  for (const [dr, dc] of directions) {
    let r = row + dr, c = col + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const targetIndex = rowColToIndex(r, c);
      const targetColor = getPieceColor(board.bbSide, targetIndex);
      
      if (targetColor === null) {
        moves.push([r, c]);
      } else {
        if (targetColor === oppositeColor) {
          moves.push([r, c]);
        }
        break;
      }
      r += dr;
      c += dc;
    }
  }
  
  return moves;
};

// Get valid knight moves
const getValidKnightMoves = (row, col, board, color) => {
  const moves = [];
  const knightMoves = [
    [2, 1], [2, -1], [-2, 1], [-2, -1],
    [1, 2], [1, -2], [-1, 2], [-1, -2]
  ];
  
  for (const [dr, dc] of knightMoves) {
    const targetRow = row + dr;
    const targetCol = col + dc;
    
    if (canMoveTo(board, targetRow, targetCol, color)) {
      moves.push([targetRow, targetCol]);
    }
  }
  
  return moves;
};

// Get valid bishop moves
const getValidBishopMoves = (row, col, board, color) => {
  const moves = [];
  const directions = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const oppositeColor = color === "white" ? "black" : "white";
  
  for (const [dr, dc] of directions) {
    let r = row + dr, c = col + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const targetIndex = rowColToIndex(r, c);
      const targetColor = getPieceColor(board.bbSide, targetIndex);
      
      if (targetColor === null) {
        moves.push([r, c]);
      } else {
        if (targetColor === oppositeColor) {
          moves.push([r, c]);
        }
        break;
      }
      r += dr;
      c += dc;
    }
  }
  
  return moves;
};

// Get valid queen moves
const getValidQueenMoves = (row, col, board, color) => {
  // Queen moves like both rook and bishop
  return [
    ...getValidRookMoves(row, col, board, color),
    ...getValidBishopMoves(row, col, board, color)
  ];
};

// Get valid king moves
const getValidKingMoves = (row, col, board, color, checkCastling = true) => {
  const moves = [];
  const kingMoves = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];
  
  for (const [dr, dc] of kingMoves) {
    const targetRow = row + dr;
    const targetCol = col + dc;
    
    if (canMoveTo(board, targetRow, targetCol, color)) {
      moves.push([targetRow, targetCol]);
    }
  }
  
  // Castling
  if (checkCastling && board.gameState) {
    const castling = board.gameState.castling;
    const backRank = color === "white" ? 7 : 0;
    
    if (row === backRank && col === 4 && !isInCheck(board, color)) {
      // King-side castling
      const kingSideMask = color === "white" ? CASTLING.WHITE_KINGSIDE : CASTLING.BLACK_KINGSIDE;
      if ((castling & kingSideMask) !== 0) {
        // Check if path is clear
        const f = rowColToIndex(backRank, 5);
        const g = rowColToIndex(backRank, 6);
        
        if (!board.getOccupancy().getBit(f) && !board.getOccupancy().getBit(g)) {
          // Check if squares king passes through are not under attack
          const testBoard1 = deepCopyBoard(board);
          const kingIndex = rowColToIndex(row, col);
          testBoard1.makeMove(kingIndex, f);
          
          if (!isInCheck(testBoard1, color)) {
            moves.push([backRank, 6]);
          }
        }
      }
      
      // Queen-side castling
      const queenSideMask = color === "white" ? CASTLING.WHITE_QUEENSIDE : CASTLING.BLACK_QUEENSIDE;
      if ((castling & queenSideMask) !== 0) {
        // Check if path is clear
        const b = rowColToIndex(backRank, 1);
        const c = rowColToIndex(backRank, 2);
        const d = rowColToIndex(backRank, 3);
        
        if (!board.getOccupancy().getBit(b) && 
            !board.getOccupancy().getBit(c) && 
            !board.getOccupancy().getBit(d)) {
          // Check if squares king passes through are not under attack
          const testBoard1 = deepCopyBoard(board);
          const kingIndex = rowColToIndex(row, col);
          testBoard1.makeMove(kingIndex, d);
          
          if (!isInCheck(testBoard1, color)) {
            moves.push([backRank, 2]);
          }
        }
      }
    }
  }
  
  return moves;
};

// Main function to get valid moves - removed deprecated parameters
export const getValidMoves = (row, col, board, checkCastling = true) => {
  const index = rowColToIndex(row, col);
  const piece = board.pieceList[index];
  
  if (piece === PIECES.NONE) {
    return [];
  }
  
  const color = getPieceColor(board.bbSide, index);
  if (color === null) {
    return [];
  }
  
  // console.log(`Getting valid moves for ${color} ${PIECE_NAMES[piece]} at ${SQUARE_NAMES[7-row][col]}`);
  
  let moves = [];
  
  switch (piece) {
    case PIECES.PAWN:
      moves = getValidPawnMoves(row, col, board, color);
      break;
      
    case PIECES.ROOK:
      moves = getValidRookMoves(row, col, board, color);
      break;
      
    case PIECES.KNIGHT:
      moves = getValidKnightMoves(row, col, board, color);
      break;
      
    case PIECES.BISHOP:
      moves = getValidBishopMoves(row, col, board, color);
      break;
      
    case PIECES.QUEEN:
      moves = getValidQueenMoves(row, col, board, color);
      break;
      
    case PIECES.KING:
      moves = getValidKingMoves(row, col, board, color, checkCastling);
      break;
  }
  
  return moves;
};

export const simulateMove = (fromRow, fromCol, toRow, toCol, board) => {
  const newBoard = deepCopyBoard(board);
  const fromIndex = rowColToIndex(fromRow, fromCol);
  const toIndex = rowColToIndex(toRow, toCol);
  const piece = newBoard.pieceList[fromIndex];
  const color = getPieceColor(newBoard.bbSide, fromIndex);
  
  // Check for pawn promotion
  if (piece === PIECES.PAWN && 
      ((color === "white" && toRow === 0) || (color === "black" && toRow === 7))) {
    return { board: newBoard, needsPromotion: true };
  }
  
  // Make the move
  newBoard.makeMove(fromIndex, toIndex);
  
  return { board: newBoard, needsPromotion: false };
};

export const hasValidMoves = (color, board) => {
  const colorIdx = colorToIndex(color);
  
  // Check all pieces of the given color
  for (let pieceType = PIECES.KING; pieceType <= PIECES.PAWN; pieceType++) {
    const pieceBB = board.bbPieces[colorIdx][pieceType].clone();
    
    while (!pieceBB.isEmpty()) {
      const square = pieceBB.popLSB();
      const [row, col] = indexToRowCol(square);
      
      const moves = getValidMoves(row, col, board, true);
      
      // Check if any move is legal
      for (const [toRow, toCol] of moves) {
        const { board: simulatedBoard } = simulateMove(row, col, toRow, toCol, board);
        
        if (!isInCheck(simulatedBoard, color)) {
          return true;
        }
      }
    }
  }
  
  return false;
};