/**
 * Legal move generation
 */

import { PIECES, CASTLING } from './constants.js';
import { 
  rowColToIndex, 
  indexToRowCol, 
  colorToIndex, 
  getPieceColor,
  indexToSquare
} from './bitboard.js';
import logger from '../logging/logger.js';

export function isInCheck(board, color) {
  const colorIdx = colorToIndex(color);
  const kingBB = board.bbPieces[colorIdx][PIECES.KING];
  const kingSquare = kingBB.getLSB();
  
  if (kingSquare === -1) return false;
  
  const [kingRow, kingCol] = indexToRowCol(kingSquare);
  const oppositeColor = color === 'white' ? 'black' : 'white';
  const oppositeColorIdx = colorToIndex(oppositeColor);
  
  // Check attacks from each piece type
  for (let pieceType = PIECES.KING; pieceType <= PIECES.PAWN; pieceType++) {
    const pieceBB = board.bbPieces[oppositeColorIdx][pieceType].clone();
    
    while (!pieceBB.isEmpty()) {
      const square = pieceBB.popLSB();
      const [row, col] = indexToRowCol(square);
      const attacks = getPieceAttacks(row, col, board, oppositeColor, pieceType);
      
      if (attacks.some(([r, c]) => r === kingRow && c === kingCol)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Lightweight check: is a specific square attacked by the given color?
 * Used for castling validation without cloning the board.
 */
function isSquareAttacked(board, square, byColor) {
  const [targetRow, targetCol] = indexToRowCol(square);
  const colorIdx = colorToIndex(byColor);
  
  for (let pieceType = PIECES.KING; pieceType <= PIECES.PAWN; pieceType++) {
    const pieceBB = board.bbPieces[colorIdx][pieceType].clone();
    
    while (!pieceBB.isEmpty()) {
      const sq = pieceBB.popLSB();
      const [row, col] = indexToRowCol(sq);
      const attacks = getPieceAttacks(row, col, board, byColor, pieceType);
      
      if (attacks.some(([r, c]) => r === targetRow && c === targetCol)) {
        return true;
      }
    }
  }
  
  return false;
}

function getPieceAttacks(row, col, board, color, pieceType) {
  switch (pieceType) {
    case PIECES.PAWN:
      return getPawnAttacks(row, col, color);
    case PIECES.KNIGHT:
      return getKnightMoves(row, col, board, color);
    case PIECES.BISHOP:
      return getBishopMoves(row, col, board, color);
    case PIECES.ROOK:
      return getRookMoves(row, col, board, color);
    case PIECES.QUEEN:
      return [...getRookMoves(row, col, board, color), ...getBishopMoves(row, col, board, color)];
    case PIECES.KING:
      return getKingMoves(row, col, board, color, false);
    default:
      return [];
  }
}

function getPawnAttacks(row, col, color) {
  const attacks = [];
  const direction = color === 'white' ? -1 : 1;
  const targetRow = row + direction;
  
  if (targetRow >= 0 && targetRow < 8) {
    if (col > 0) attacks.push([targetRow, col - 1]);
    if (col < 7) attacks.push([targetRow, col + 1]);
  }
  
  return attacks;
}

function canMoveTo(board, row, col, color) {
  if (row < 0 || row >= 8 || col < 0 || col >= 8) return false;
  const index = rowColToIndex(row, col);
  const pieceColor = getPieceColor(board.bbSide, index);
  return pieceColor === null || pieceColor !== color;
}

function getPawnMoves(row, col, board, color) {
  const moves = [];
  const oppositeColor = color === 'white' ? 'black' : 'white';
  const direction = color === 'white' ? -1 : 1;
  const startingRank = color === 'white' ? 6 : 1;
  const enPassantRank = color === 'white' ? 3 : 4;
  
  // Forward moves
  const oneForward = row + direction;
  if (oneForward >= 0 && oneForward < 8) {
    const forwardIndex = rowColToIndex(oneForward, col);
    if (getPieceColor(board.bbSide, forwardIndex) === null) {
      moves.push([oneForward, col]);
      
      if (row === startingRank) {
        const twoForward = row + (2 * direction);
        const doubleIndex = rowColToIndex(twoForward, col);
        if (getPieceColor(board.bbSide, doubleIndex) === null) {
          moves.push([twoForward, col]);
        }
      }
    }
  }
  
  // Captures
  for (const dcol of [-1, 1]) {
    const targetRow = row + direction;
    const targetCol = col + dcol;
    
    if (targetRow >= 0 && targetRow < 8 && targetCol >= 0 && targetCol < 8) {
      const targetIndex = rowColToIndex(targetRow, targetCol);
      if (getPieceColor(board.bbSide, targetIndex) === oppositeColor) {
        moves.push([targetRow, targetCol]);
      }
    }
  }
  
  // En passant
  if (row === enPassantRank && board.gameState.enPassantSquare !== -1) {
    const [, epCol] = indexToRowCol(board.gameState.enPassantSquare);
    if (Math.abs(epCol - col) === 1) {
      const enemyPawnIndex = rowColToIndex(row, epCol);
      if (getPieceColor(board.bbSide, enemyPawnIndex) === oppositeColor &&
          board.pieceList[enemyPawnIndex] === PIECES.PAWN) {
        moves.push([row + direction, epCol]);
      }
    }
  }
  
  return moves;
}

function getKnightMoves(row, col, board, color) {
  const moves = [];
  const offsets = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
  
  for (const [dr, dc] of offsets) {
    const r = row + dr, c = col + dc;
    if (canMoveTo(board, r, c, color)) {
      moves.push([r, c]);
    }
  }
  
  return moves;
}

function getBishopMoves(row, col, board, color) {
  return getSlidingMoves(row, col, board, color, [[1, 1], [1, -1], [-1, 1], [-1, -1]]);
}

function getRookMoves(row, col, board, color) {
  return getSlidingMoves(row, col, board, color, [[1, 0], [-1, 0], [0, 1], [0, -1]]);
}

function getSlidingMoves(row, col, board, color, directions) {
  const moves = [];
  const oppositeColor = color === 'white' ? 'black' : 'white';
  
  for (const [dr, dc] of directions) {
    let r = row + dr, c = col + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const index = rowColToIndex(r, c);
      const pieceColor = getPieceColor(board.bbSide, index);
      
      if (pieceColor === null) {
        moves.push([r, c]);
      } else {
        if (pieceColor === oppositeColor) {
          moves.push([r, c]);
        }
        break;
      }
      r += dr;
      c += dc;
    }
  }
  
  return moves;
}

function getKingMoves(row, col, board, color, checkCastling = true) {
  const moves = [];
  const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  
  for (const [dr, dc] of offsets) {
    const r = row + dr, c = col + dc;
    if (canMoveTo(board, r, c, color)) {
      moves.push([r, c]);
    }
  }
  
  // Castling - use makeMove/undoMove instead of clone
  if (checkCastling) {
    const castling = board.gameState.castling;
    const backRank = color === 'white' ? 7 : 0;
    const oppositeColor = color === 'white' ? 'black' : 'white';
    
    if (row === backRank && col === 4 && !isInCheck(board, color)) {
      const kingSideMask = color === 'white' ? CASTLING.WHITE_KINGSIDE : CASTLING.BLACK_KINGSIDE;
      if ((castling & kingSideMask) !== 0) {
        const f = rowColToIndex(backRank, 5);
        const g = rowColToIndex(backRank, 6);
        
        if (!board.getOccupancy().getBit(f) && !board.getOccupancy().getBit(g)) {
          // Check that f1/f8 is not attacked (king passes through)
          if (!isSquareAttacked(board, f, oppositeColor)) {
            moves.push([backRank, 6]);
          }
        }
      }
      
      const queenSideMask = color === 'white' ? CASTLING.WHITE_QUEENSIDE : CASTLING.BLACK_QUEENSIDE;
      if ((castling & queenSideMask) !== 0) {
        const b = rowColToIndex(backRank, 1);
        const c = rowColToIndex(backRank, 2);
        const d = rowColToIndex(backRank, 3);
        
        if (!board.getOccupancy().getBit(b) && !board.getOccupancy().getBit(c) && !board.getOccupancy().getBit(d)) {
          // Check that d1/d8 is not attacked (king passes through)
          if (!isSquareAttacked(board, d, oppositeColor)) {
            moves.push([backRank, 2]);
          }
        }
      }
    }
  }
  
  return moves;
}

export function getValidMoves(row, col, board, checkCastling = true) {
  const index = rowColToIndex(row, col);
  const piece = board.pieceList[index];
  
  if (piece === PIECES.NONE) return [];
  
  const color = getPieceColor(board.bbSide, index);
  if (color === null) return [];
  
  let moves = [];
  
  switch (piece) {
    case PIECES.PAWN:
      moves = getPawnMoves(row, col, board, color);
      break;
    case PIECES.KNIGHT:
      moves = getKnightMoves(row, col, board, color);
      break;
    case PIECES.BISHOP:
      moves = getBishopMoves(row, col, board, color);
      break;
    case PIECES.ROOK:
      moves = getRookMoves(row, col, board, color);
      break;
    case PIECES.QUEEN:
      moves = [...getRookMoves(row, col, board, color), ...getBishopMoves(row, col, board, color)];
      break;
    case PIECES.KING:
      moves = getKingMoves(row, col, board, color, checkCastling);
      break;
  }
  
  return moves;
}

export function generateAllLegalMoves(board, color) {
  const colorIdx = colorToIndex(color);
  const moves = [];
  
  logger.moves('trace', { color, fen: board.toFen() }, 'Generating all legal moves');
  
  for (let pieceType = PIECES.KING; pieceType <= PIECES.PAWN; pieceType++) {
    const pieceBB = board.bbPieces[colorIdx][pieceType].clone();
    
    while (!pieceBB.isEmpty()) {
      const fromSquare = pieceBB.popLSB();
      const [fromRow, fromCol] = indexToRowCol(fromSquare);
      const pieceMoves = getValidMoves(fromRow, fromCol, board, true);
      
      for (const [toRow, toCol] of pieceMoves) {
        const toSquare = rowColToIndex(toRow, toCol);
        const capturedPiece = board.pieceList[toSquare];
        
        // Test legality using makeMove/undoMove instead of clone
        board.makeMove(fromSquare, toSquare);
        const legal = !isInCheck(board, color);
        board.undoMove();
        
        if (legal) {
          const isPromotion = pieceType === PIECES.PAWN && 
            ((color === 'white' && toRow === 0) || (color === 'black' && toRow === 7));
          
          const move = {
            from: [fromRow, fromCol],
            to: [toRow, toCol],
            fromSquare,
            toSquare,
            piece: pieceType,
            capturedPiece: capturedPiece !== PIECES.NONE ? capturedPiece : null,
            isPromotion,
            algebraic: indexToSquare(fromSquare) + indexToSquare(toSquare)
          };
          
          moves.push(move);
          
          // Add promotion variants
          if (isPromotion) {
            for (const promoPiece of [PIECES.ROOK, PIECES.BISHOP, PIECES.KNIGHT]) {
              moves.push({
                ...move,
                promotionPiece: promoPiece,
                algebraic: move.algebraic + ['', 'q', 'r', 'b', 'n'][promoPiece]
              });
            }
            move.promotionPiece = PIECES.QUEEN;
            move.algebraic += 'q';
          }
        }
      }
    }
  }
  
  logger.moves('debug', { color, moveCount: moves.length }, `Generated ${moves.length} legal moves`);
  
  return moves;
}

export function hasLegalMoves(board, color) {
  const colorIdx = colorToIndex(color);
  
  for (let pieceType = PIECES.KING; pieceType <= PIECES.PAWN; pieceType++) {
    const pieceBB = board.bbPieces[colorIdx][pieceType].clone();
    
    while (!pieceBB.isEmpty()) {
      const fromSquare = pieceBB.popLSB();
      const [fromRow, fromCol] = indexToRowCol(fromSquare);
      const pieceMoves = getValidMoves(fromRow, fromCol, board, true);
      
      for (const [toRow, toCol] of pieceMoves) {
        const toSquare = rowColToIndex(toRow, toCol);
        
        board.makeMove(fromSquare, toSquare);
        const legal = !isInCheck(board, color);
        board.undoMove();
        
        if (legal) {
          return true;
        }
      }
    }
  }
  
  return false;
}

export function generateCaptures(board, color) {
  const colorIdx = colorToIndex(color);
  const oppositeColorIdx = colorToIndex(color === 'white' ? 'black' : 'white');
  const captures = [];
  
  for (let pieceType = PIECES.KING; pieceType <= PIECES.PAWN; pieceType++) {
    const pieceBB = board.bbPieces[colorIdx][pieceType].clone();
    
    while (!pieceBB.isEmpty()) {
      const fromSquare = pieceBB.popLSB();
      const [fromRow, fromCol] = indexToRowCol(fromSquare);
      const pieceMoves = getValidMoves(fromRow, fromCol, board, true);
      
      for (const [toRow, toCol] of pieceMoves) {
        const toSquare = rowColToIndex(toRow, toCol);
        const capturedPiece = board.pieceList[toSquare];
        
        // Only captures (or en passant, or promotions)
        const isCapture = capturedPiece !== PIECES.NONE;
        const isEnPassant = pieceType === PIECES.PAWN && 
                           toSquare === board.gameState.enPassantSquare + (color === 'white' ? -8 : 8);
        const isPromotion = pieceType === PIECES.PAWN && 
                           ((color === 'white' && toRow === 0) || (color === 'black' && toRow === 7));
        
        if (!isCapture && !isEnPassant && !isPromotion) continue;
        
        // Test legality using makeMove/undoMove
        board.makeMove(fromSquare, toSquare);
        const legal = !isInCheck(board, color);
        board.undoMove();
        
        if (legal) {
          const move = {
            from: [fromRow, fromCol],
            to: [toRow, toCol],
            fromSquare,
            toSquare,
            piece: pieceType,
            capturedPiece: capturedPiece !== PIECES.NONE ? capturedPiece : null,
            isPromotion,
            algebraic: indexToSquare(fromSquare) + indexToSquare(toSquare)
          };
          
          captures.push(move);
          
          if (isPromotion) {
            for (const promoPiece of [PIECES.ROOK, PIECES.BISHOP, PIECES.KNIGHT]) {
              captures.push({
                ...move,
                promotionPiece: promoPiece,
                algebraic: move.algebraic + ['', 'q', 'r', 'b', 'n'][promoPiece]
              });
            }
            move.promotionPiece = PIECES.QUEEN;
            move.algebraic += 'q';
          }
        }
      }
    }
  }
  
  return captures;
}