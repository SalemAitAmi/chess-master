/**
 * Board representation with move making/unmaking
 */

import { PIECES, CASTLING, WHITE_IDX, BLACK_IDX } from './constants.js';
import { 
  BitBoard, 
  initializeBitboards, 
  initializePieceList, 
  squareToIndex,
  indexToSquare,
  colorToIndex,
  getPieceColor
} from './bitboard.js';
import { computeZobristKey, PIECE_SQUARE_KEYS, CASTLING_KEYS, SIDE_KEYS, EN_PASSANT_KEYS } from '../tables/zobrist.js';
import logger from '../logging/logger.js';

export class GameState {
  constructor() {
    this.activeColor = 'white';
    this.castling = CASTLING.ALL;
    this.halfMoveClock = 0;
    this.enPassantSquare = -1;
    this.fullMoveCount = 1;
    this.zobristKey = 0n;
  }

  clone() {
    const state = new GameState();
    state.activeColor = this.activeColor;
    state.castling = this.castling;
    state.halfMoveClock = this.halfMoveClock;
    state.enPassantSquare = this.enPassantSquare;
    state.fullMoveCount = this.fullMoveCount;
    state.zobristKey = this.zobristKey;
    return state;
  }
}

export class Board {
  constructor() {
    const { bbPieces, bbSide } = initializeBitboards();
    this.bbPieces = bbPieces;
    this.bbSide = bbSide;
    this.pieceList = initializePieceList();
    this.gameState = new GameState();
    this.history = [];
    this.moveHistory = [];
    
    this.gameState.zobristKey = computeZobristKey(this);
  }

  /**
   * Lightweight clone for search — shares history arrays by reference
   * since search clones are temporary and won't modify past history.
   * Only use for read-only or short-lived copies.
   */
  clone() {
    const board = Object.create(Board.prototype);
    
    // Clone bitboards (required — search modifies these)
    board.bbPieces = {
      [WHITE_IDX]: {},
      [BLACK_IDX]: {}
    };
    board.bbSide = {
      [WHITE_IDX]: this.bbSide[WHITE_IDX].clone(),
      [BLACK_IDX]: this.bbSide[BLACK_IDX].clone()
    };
    for (let piece = PIECES.KING; piece <= PIECES.PAWN; piece++) {
      board.bbPieces[WHITE_IDX][piece] = this.bbPieces[WHITE_IDX][piece].clone();
      board.bbPieces[BLACK_IDX][piece] = this.bbPieces[BLACK_IDX][piece].clone();
    }
    
    // Shallow copy of piece list (will be modified by makeMove)
    board.pieceList = this.pieceList.slice();
    
    // Clone current game state
    board.gameState = this.gameState.clone();
    
    // Share history by reference — clone is temporary, only
    // makeMove/undoMove on the ORIGINAL board mutate these.
    // If the clone needs its own makeMove/undoMove, it starts fresh.
    board.history = [];
    board.moveHistory = [];
    
    return board;
  }

  /**
   * Full deep clone preserving complete history (for external use, not search)
   */
  deepClone() {
    const board = this.clone();
    board.history = this.history.map(state => state.clone());
    board.moveHistory = this.moveHistory.map(move => ({ ...move }));
    return board;
  }

  makeMove(fromSquare, toSquare, promotionPiece = null) {
    if (fromSquare < 0 || fromSquare >= 64 || toSquare < 0 || toSquare >= 64) {
      return false;
    }

    const moveInfo = {
      from: fromSquare,
      to: toSquare,
      movingPiece: this.pieceList[fromSquare],
      capturedPiece: this.pieceList[toSquare],
      enPassantCapture: null,
      castlingRook: null,
      promotionPiece,
      previousState: this.gameState.clone()
    };

    this.history.push(this.gameState.clone());

    const movingPiece = this.pieceList[fromSquare];
    const capturedPiece = this.pieceList[toSquare];
    const movingColor = this.gameState.activeColor;
    const oppositeColor = movingColor === 'white' ? 'black' : 'white';
    const movingColorIdx = colorToIndex(movingColor);
    const oppositeColorIdx = colorToIndex(oppositeColor);

    const previousEnPassant = this.gameState.enPassantSquare;
    const previousCastling = this.gameState.castling;

    // Remove piece from source
    this.gameState.zobristKey ^= PIECE_SQUARE_KEYS[movingColorIdx][movingPiece][fromSquare];
    this.bbPieces[movingColorIdx][movingPiece].clearBit(fromSquare);
    this.bbSide[movingColorIdx].clearBit(fromSquare);
    this.pieceList[fromSquare] = PIECES.NONE;

    // Handle capture
    if (capturedPiece !== PIECES.NONE) {
      this.gameState.zobristKey ^= PIECE_SQUARE_KEYS[oppositeColorIdx][capturedPiece][toSquare];
      this.bbPieces[oppositeColorIdx][capturedPiece].clearBit(toSquare);
      this.bbSide[oppositeColorIdx].clearBit(toSquare);
      this.gameState.halfMoveClock = 0;
    } else {
      this.gameState.halfMoveClock++;
    }

    let finalPiece = movingPiece;

    // Handle pawn moves
    if (movingPiece === PIECES.PAWN) {
      this.gameState.halfMoveClock = 0;

      // En passant capture
      if (previousEnPassant !== -1) {
        const fromRank = Math.floor(fromSquare / 8);
        const fromFile = fromSquare % 8;
        const toRank = Math.floor(toSquare / 8);
        const toFile = toSquare % 8;

        if (Math.abs(fromFile - toFile) === 1 && Math.abs(fromRank - toRank) === 1 && capturedPiece === PIECES.NONE) {
          const captureSquare = fromRank * 8 + toFile;
          if (this.pieceList[captureSquare] === PIECES.PAWN && 
              getPieceColor(this.bbSide, captureSquare) === oppositeColor) {
            this.gameState.zobristKey ^= PIECE_SQUARE_KEYS[oppositeColorIdx][PIECES.PAWN][captureSquare];
            this.bbPieces[oppositeColorIdx][PIECES.PAWN].clearBit(captureSquare);
            this.bbSide[oppositeColorIdx].clearBit(captureSquare);
            this.pieceList[captureSquare] = PIECES.NONE;
            moveInfo.enPassantCapture = captureSquare;
          }
        }
      }

      this.gameState.enPassantSquare = -1;

      // Double push
      const fromRank = Math.floor(fromSquare / 8);
      const toRank = Math.floor(toSquare / 8);
      if (Math.abs(fromRank - toRank) === 2) {
        this.gameState.enPassantSquare = movingColor === 'white' ? toSquare - 8 : toSquare + 8;
      }

      // Promotion
      if ((movingColor === 'white' && toRank === 7) || (movingColor === 'black' && toRank === 0)) {
        finalPiece = promotionPiece || PIECES.QUEEN;
      }
    } else {
      this.gameState.enPassantSquare = -1;
    }

    // Handle king moves
    if (movingPiece === PIECES.KING) {
      if (movingColor === 'white') {
        this.gameState.castling &= ~(CASTLING.WHITE_KINGSIDE | CASTLING.WHITE_QUEENSIDE);
      } else {
        this.gameState.castling &= ~(CASTLING.BLACK_KINGSIDE | CASTLING.BLACK_QUEENSIDE);
      }

      // Castling
      const fileDiff = (toSquare % 8) - (fromSquare % 8);
      if (Math.abs(fileDiff) === 2) {
        const rank = Math.floor(fromSquare / 8);
        if (fileDiff > 0) {
          // Kingside
          const rookFrom = rank * 8 + 7;
          const rookTo = rank * 8 + 5;
          this.gameState.zobristKey ^= PIECE_SQUARE_KEYS[movingColorIdx][PIECES.ROOK][rookFrom];
          this.gameState.zobristKey ^= PIECE_SQUARE_KEYS[movingColorIdx][PIECES.ROOK][rookTo];
          this.bbPieces[movingColorIdx][PIECES.ROOK].clearBit(rookFrom).setBit(rookTo);
          this.bbSide[movingColorIdx].clearBit(rookFrom).setBit(rookTo);
          this.pieceList[rookFrom] = PIECES.NONE;
          this.pieceList[rookTo] = PIECES.ROOK;
          moveInfo.castlingRook = { from: rookFrom, to: rookTo };
        } else {
          // Queenside
          const rookFrom = rank * 8;
          const rookTo = rank * 8 + 3;
          this.gameState.zobristKey ^= PIECE_SQUARE_KEYS[movingColorIdx][PIECES.ROOK][rookFrom];
          this.gameState.zobristKey ^= PIECE_SQUARE_KEYS[movingColorIdx][PIECES.ROOK][rookTo];
          this.bbPieces[movingColorIdx][PIECES.ROOK].clearBit(rookFrom).setBit(rookTo);
          this.bbSide[movingColorIdx].clearBit(rookFrom).setBit(rookTo);
          this.pieceList[rookFrom] = PIECES.NONE;
          this.pieceList[rookTo] = PIECES.ROOK;
          moveInfo.castlingRook = { from: rookFrom, to: rookTo };
        }
      }
    }

    // Handle rook moves (castling rights)
    if (movingPiece === PIECES.ROOK) {
      if (movingColor === 'white') {
        if (fromSquare === 0) this.gameState.castling &= ~CASTLING.WHITE_QUEENSIDE;
        if (fromSquare === 7) this.gameState.castling &= ~CASTLING.WHITE_KINGSIDE;
      } else {
        if (fromSquare === 56) this.gameState.castling &= ~CASTLING.BLACK_QUEENSIDE;
        if (fromSquare === 63) this.gameState.castling &= ~CASTLING.BLACK_KINGSIDE;
      }
    }

    // Handle rook captures (castling rights)
    if (capturedPiece === PIECES.ROOK) {
      if (toSquare === 0) this.gameState.castling &= ~CASTLING.WHITE_QUEENSIDE;
      if (toSquare === 7) this.gameState.castling &= ~CASTLING.WHITE_KINGSIDE;
      if (toSquare === 56) this.gameState.castling &= ~CASTLING.BLACK_QUEENSIDE;
      if (toSquare === 63) this.gameState.castling &= ~CASTLING.BLACK_KINGSIDE;
    }

    // Place piece at destination
    this.gameState.zobristKey ^= PIECE_SQUARE_KEYS[movingColorIdx][finalPiece][toSquare];
    this.bbPieces[movingColorIdx][finalPiece].setBit(toSquare);
    this.bbSide[movingColorIdx].setBit(toSquare);
    this.pieceList[toSquare] = finalPiece;

    // Update move counters
    if (movingColor === 'black') {
      this.gameState.fullMoveCount++;
    }

    // Update Zobrist for en passant
    if (previousEnPassant !== this.gameState.enPassantSquare) {
      const prevFile = previousEnPassant !== -1 ? previousEnPassant % 8 : 8;
      const newFile = this.gameState.enPassantSquare !== -1 ? this.gameState.enPassantSquare % 8 : 8;
      this.gameState.zobristKey ^= EN_PASSANT_KEYS[prevFile];
      this.gameState.zobristKey ^= EN_PASSANT_KEYS[newFile];
    }

    // Update Zobrist for castling
    if (previousCastling !== this.gameState.castling) {
      this.gameState.zobristKey ^= CASTLING_KEYS[previousCastling];
      this.gameState.zobristKey ^= CASTLING_KEYS[this.gameState.castling];
    }

    // Switch side
    this.gameState.zobristKey ^= SIDE_KEYS[movingColor === 'white' ? 0 : 1];
    this.gameState.zobristKey ^= SIDE_KEYS[oppositeColor === 'white' ? 0 : 1];
    this.gameState.activeColor = oppositeColor;

    this.moveHistory.push(moveInfo);
    return true;
  }

  undoMove() {
    if (this.history.length === 0) return false;

    const moveInfo = this.moveHistory.pop();
    if (!moveInfo) return false;

    const { from, to, movingPiece, capturedPiece, enPassantCapture, castlingRook, promotionPiece } = moveInfo;
    
    this.gameState = this.history.pop();

    const movingColor = this.gameState.activeColor;
    const oppositeColor = movingColor === 'white' ? 'black' : 'white';
    const movingColorIdx = colorToIndex(movingColor);
    const oppositeColorIdx = colorToIndex(oppositeColor);

    // Remove piece from destination
    const pieceAtDest = promotionPiece || movingPiece;
    this.bbPieces[movingColorIdx][pieceAtDest].clearBit(to);
    this.bbSide[movingColorIdx].clearBit(to);

    // Restore moving piece
    const restoredPiece = promotionPiece ? PIECES.PAWN : movingPiece;
    this.bbPieces[movingColorIdx][restoredPiece].setBit(from);
    this.bbSide[movingColorIdx].setBit(from);
    this.pieceList[from] = restoredPiece;

    // Restore captured piece
    if (capturedPiece !== PIECES.NONE) {
      this.bbPieces[oppositeColorIdx][capturedPiece].setBit(to);
      this.bbSide[oppositeColorIdx].setBit(to);
      this.pieceList[to] = capturedPiece;
    } else {
      this.pieceList[to] = PIECES.NONE;
    }

    // Restore en passant capture
    if (enPassantCapture !== null) {
      this.bbPieces[oppositeColorIdx][PIECES.PAWN].setBit(enPassantCapture);
      this.bbSide[oppositeColorIdx].setBit(enPassantCapture);
      this.pieceList[enPassantCapture] = PIECES.PAWN;
    }

    // Restore castling rook
    if (castlingRook) {
      this.bbPieces[movingColorIdx][PIECES.ROOK].clearBit(castlingRook.to).setBit(castlingRook.from);
      this.bbSide[movingColorIdx].clearBit(castlingRook.to).setBit(castlingRook.from);
      this.pieceList[castlingRook.from] = PIECES.ROOK;
      this.pieceList[castlingRook.to] = PIECES.NONE;
    }

    return true;
  }

  getOccupancy() {
    return this.bbSide[WHITE_IDX].or(this.bbSide[BLACK_IDX]);
  }

  toFen() {
    let fen = '';
    
    for (let rank = 7; rank >= 0; rank--) {
      let emptyCount = 0;
      for (let file = 0; file < 8; file++) {
        const square = rank * 8 + file;
        const piece = this.pieceList[square];
        
        if (piece === PIECES.NONE) {
          emptyCount++;
        } else {
          if (emptyCount > 0) {
            fen += emptyCount;
            emptyCount = 0;
          }
          const isWhite = this.bbSide[WHITE_IDX].getBit(square);
          const pieceChar = ['K', 'Q', 'R', 'B', 'N', 'P'][piece];
          fen += isWhite ? pieceChar : pieceChar.toLowerCase();
        }
      }
      if (emptyCount > 0) fen += emptyCount;
      if (rank > 0) fen += '/';
    }
    
    fen += ' ' + (this.gameState.activeColor === 'white' ? 'w' : 'b');
    
    let castling = '';
    if (this.gameState.castling & CASTLING.WHITE_KINGSIDE) castling += 'K';
    if (this.gameState.castling & CASTLING.WHITE_QUEENSIDE) castling += 'Q';
    if (this.gameState.castling & CASTLING.BLACK_KINGSIDE) castling += 'k';
    if (this.gameState.castling & CASTLING.BLACK_QUEENSIDE) castling += 'q';
    fen += ' ' + (castling || '-');
    
    if (this.gameState.enPassantSquare !== -1) {
      fen += ' ' + indexToSquare(this.gameState.enPassantSquare);
    } else {
      fen += ' -';
    }
    
    fen += ' ' + this.gameState.halfMoveClock;
    fen += ' ' + this.gameState.fullMoveCount;
    
    return fen;
  }

  static fromFen(fen) {
    const board = new Board();
    const parts = fen.split(' ');
    const rows = parts[0].split('/');
    
    // Clear board
    for (let color = 0; color <= 1; color++) {
      board.bbSide[color] = new BitBoard();
      for (let piece = PIECES.KING; piece <= PIECES.PAWN; piece++) {
        board.bbPieces[color][piece] = new BitBoard();
      }
    }
    board.pieceList.fill(PIECES.NONE);
    
    // Parse piece placement
    for (let rank = 7; rank >= 0; rank--) {
      const row = rows[7 - rank];
      let file = 0;
      
      for (const char of row) {
        if (char >= '1' && char <= '8') {
          file += parseInt(char);
        } else {
          const isWhite = char === char.toUpperCase();
          const colorIdx = isWhite ? WHITE_IDX : BLACK_IDX;
          const pieceChar = char.toUpperCase();
          const pieceMap = { K: PIECES.KING, Q: PIECES.QUEEN, R: PIECES.ROOK, 
                           B: PIECES.BISHOP, N: PIECES.KNIGHT, P: PIECES.PAWN };
          const piece = pieceMap[pieceChar];
          const square = rank * 8 + file;
          
          board.pieceList[square] = piece;
          board.bbPieces[colorIdx][piece].setBit(square);
          board.bbSide[colorIdx].setBit(square);
          file++;
        }
      }
    }
    
    // Active color
    board.gameState.activeColor = parts[1] === 'w' ? 'white' : 'black';
    
    // Castling
    board.gameState.castling = 0;
    if (parts[2] !== '-') {
      if (parts[2].includes('K')) board.gameState.castling |= CASTLING.WHITE_KINGSIDE;
      if (parts[2].includes('Q')) board.gameState.castling |= CASTLING.WHITE_QUEENSIDE;
      if (parts[2].includes('k')) board.gameState.castling |= CASTLING.BLACK_KINGSIDE;
      if (parts[2].includes('q')) board.gameState.castling |= CASTLING.BLACK_QUEENSIDE;
    }
    
    // En passant
    if (parts[3] !== '-') {
      board.gameState.enPassantSquare = squareToIndex(parts[3]);
    } else {
      board.gameState.enPassantSquare = -1;
    }
    
    // Halfmove clock and fullmove number
    board.gameState.halfMoveClock = parseInt(parts[4]) || 0;
    board.gameState.fullMoveCount = parseInt(parts[5]) || 1;
    
    // Compute Zobrist
    board.gameState.zobristKey = computeZobristKey(board);
    
    return board;
  }
}

export default Board;