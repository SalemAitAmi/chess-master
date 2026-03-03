import { CASTLING, PIECES, ZOBRIST_SEEDS } from '../constants/gameConstants.js';
import { initializeBitboards, initializePieceList, squareToIndex, indexToSquare, getPieceColor, colorToIndex, BitBoard } from './bitboard.js';

export class GameState {
  constructor() {
    this.active_color = "white";
    this.castling = CASTLING.ALL;
    this.half_move_clock = 0;
    this.en_passant_sq = -1;
    this.full_move_count = 1;
    this.next_move = null;
    this.zobrist_key = 0n;
  }

  clone() {
    const newState = new GameState();
    newState.active_color = this.active_color;
    newState.castling = this.castling;
    newState.half_move_clock = this.half_move_clock;
    newState.en_passant_sq = this.en_passant_sq;
    newState.full_move_count = this.full_move_count;
    newState.next_move = this.next_move;
    newState.zobrist_key = this.zobrist_key;
    return newState;
  }
}

export class History {
  constructor() {
    this.states = [];
    this.moves = [];
  }

  push(gameState, moveInfo = null) {
    this.states.push(gameState.clone());
    if (moveInfo) {
      this.moves.push(moveInfo);
    }
  }

  pop() {
    this.moves.pop();
    return this.states.pop();
  }

  peek() {
    return this.states[this.states.length - 1];
  }

  length() {
    return this.states.length;
  }

  clear() {
    this.states = [];
    this.moves = [];
  }
}

export class Board {
  constructor() {
    const { bbPieces, bbSide } = initializeBitboards();
    this.bbPieces = bbPieces;
    this.bbSide = bbSide;
    this.pieceList = initializePieceList();
    this.gameState = new GameState();
    this.history = new History();
    this.gameState.zobrist_key = this.zobristInit(this.gameState);
  }

  zobristInit(gameState) {
    let hash = 0n;

    for (let color = 0; color <= 1; color++) {
      for (let pieceType = PIECES.KING; pieceType <= PIECES.PAWN; pieceType++) {
        const pieceBB = this.bbPieces[color][pieceType].clone();
        while (!pieceBB.isEmpty()) {
          const square = pieceBB.popLSB();
          hash ^= ZOBRIST_SEEDS.pieces[color][pieceType][square];
        }
      }
    }

    hash ^= ZOBRIST_SEEDS.castling[gameState.castling];

    if (gameState.active_color === "black") {
      hash ^= ZOBRIST_SEEDS.sides[1];
    } else {
      hash ^= ZOBRIST_SEEDS.sides[0];
    }

    if (gameState.en_passant_sq !== -1) {
      const enPassantFile = gameState.en_passant_sq % 8;
      const enPassantRank = Math.floor(gameState.en_passant_sq / 8);
      if (enPassantRank === 2) {
        hash ^= ZOBRIST_SEEDS.en_passant[enPassantFile];
      } else if (enPassantRank === 5) {
        hash ^= ZOBRIST_SEEDS.en_passant[8 + enPassantFile];
      }
    } else {
      hash ^= ZOBRIST_SEEDS.en_passant[16];
    }

    return hash;
  }

  getEnPassantZobristIndex(enPassantSq) {
    if (enPassantSq === -1) return 16;
    const enPassantRank = Math.floor(enPassantSq / 8);
    const enPassantFile = enPassantSq % 8;
    if (enPassantRank === 2) return enPassantFile;
    if (enPassantRank === 5) return 8 + enPassantFile;
    return 16;
  }

  makeMove(fromSquare, toSquare, promotionPiece = null) {
    if (fromSquare < 0 || fromSquare >= 64 || toSquare < 0 || toSquare >= 64) {
      return false;
    }

    if (this.gameState.zobrist_key === 0n) {
      this.gameState.zobrist_key = this.zobristInit(this.gameState);
    }

    const moveInfo = {
      from: fromSquare,
      to: toSquare,
      movingPiece: this.pieceList[fromSquare],
      capturedPiece: this.pieceList[toSquare],
      enPassantCapture: null,
      castlingRook: null,
      promotionPiece: promotionPiece,
      oldEnPassantSq: this.gameState.en_passant_sq,
      oldCastling: this.gameState.castling
    };

    this.history.push(this.gameState, moveInfo);

    const movingPiece = this.pieceList[fromSquare];
    const capturedPiece = this.pieceList[toSquare];
    const movingColor = this.gameState.active_color;
    const oppositeColor = movingColor === "white" ? "black" : "white";

    const previousEnPassantSq = this.gameState.en_passant_sq;
    const previousCastling = this.gameState.castling;

    const movingColorIdx = colorToIndex(movingColor);
    const oppositeColorIdx = colorToIndex(oppositeColor);

    this.gameState.zobrist_key ^= ZOBRIST_SEEDS.pieces[movingColorIdx][movingPiece][fromSquare];
    this.bbPieces[movingColorIdx][movingPiece].clearBit(fromSquare);
    this.bbSide[movingColorIdx].clearBit(fromSquare);
    this.pieceList[fromSquare] = PIECES.NONE;

    if (capturedPiece !== PIECES.NONE) {
      this.gameState.zobrist_key ^= ZOBRIST_SEEDS.pieces[oppositeColorIdx][capturedPiece][toSquare];
      this.bbPieces[oppositeColorIdx][capturedPiece].clearBit(toSquare);
      this.bbSide[oppositeColorIdx].clearBit(toSquare);
      this.gameState.half_move_clock = 0;
    } else {
      this.gameState.half_move_clock++;
    }

    let finalPiece = movingPiece;

    if (movingPiece === PIECES.PAWN) {
      this.gameState.half_move_clock = 0;

      if (previousEnPassantSq !== -1) {
        const fromRank = Math.floor(fromSquare / 8);
        const fromFile = fromSquare % 8;
        const toRank = Math.floor(toSquare / 8);
        const toFile = toSquare % 8;

        const isDiagonalMove = Math.abs(fromFile - toFile) === 1 && Math.abs(fromRank - toRank) === 1;

        if (isDiagonalMove && capturedPiece === PIECES.NONE) {
          const captureSquare = fromRank * 8 + toFile;
          if (this.pieceList[captureSquare] === PIECES.PAWN &&
              getPieceColor(this.bbSide, captureSquare) === oppositeColor) {
            this.gameState.zobrist_key ^= ZOBRIST_SEEDS.pieces[oppositeColorIdx][PIECES.PAWN][captureSquare];
            this.bbPieces[oppositeColorIdx][PIECES.PAWN].clearBit(captureSquare);
            this.bbSide[oppositeColorIdx].clearBit(captureSquare);
            this.pieceList[captureSquare] = PIECES.NONE;
            moveInfo.enPassantCapture = captureSquare;
          }
        }
      }

      this.gameState.en_passant_sq = -1;

      const fromRank = Math.floor(fromSquare / 8);
      const toRank = Math.floor(toSquare / 8);
      const rankDiff = Math.abs(fromRank - toRank);

      if (rankDiff === 2) {
        this.gameState.en_passant_sq = movingColor === "white" ? toSquare - 8 : toSquare + 8;
      }

      if ((movingColor === "white" && toRank === 7) || (movingColor === "black" && toRank === 0)) {
        finalPiece = promotionPiece || PIECES.QUEEN;
      }
    } else {
      this.gameState.en_passant_sq = -1;
    }

    if (movingPiece === PIECES.KING) {
      if (movingColor === "white") {
        this.gameState.castling &= ~(CASTLING.WHITE_KINGSIDE | CASTLING.WHITE_QUEENSIDE);
      } else {
        this.gameState.castling &= ~(CASTLING.BLACK_KINGSIDE | CASTLING.BLACK_QUEENSIDE);
      }

      const fileDiff = (toSquare % 8) - (fromSquare % 8);
      if (Math.abs(fileDiff) === 2) {
        const rank = Math.floor(fromSquare / 8);
        if (fileDiff > 0) {
          const rookFrom = rank * 8 + 7;
          const rookTo = rank * 8 + 5;
          this.gameState.zobrist_key ^= ZOBRIST_SEEDS.pieces[movingColorIdx][PIECES.ROOK][rookFrom];
          this.gameState.zobrist_key ^= ZOBRIST_SEEDS.pieces[movingColorIdx][PIECES.ROOK][rookTo];
          this.bbPieces[movingColorIdx][PIECES.ROOK].clearBit(rookFrom).setBit(rookTo);
          this.bbSide[movingColorIdx].clearBit(rookFrom).setBit(rookTo);
          this.pieceList[rookFrom] = PIECES.NONE;
          this.pieceList[rookTo] = PIECES.ROOK;
          moveInfo.castlingRook = { from: rookFrom, to: rookTo };
        } else {
          const rookFrom = rank * 8;
          const rookTo = rank * 8 + 3;
          this.gameState.zobrist_key ^= ZOBRIST_SEEDS.pieces[movingColorIdx][PIECES.ROOK][rookFrom];
          this.gameState.zobrist_key ^= ZOBRIST_SEEDS.pieces[movingColorIdx][PIECES.ROOK][rookTo];
          this.bbPieces[movingColorIdx][PIECES.ROOK].clearBit(rookFrom).setBit(rookTo);
          this.bbSide[movingColorIdx].clearBit(rookFrom).setBit(rookTo);
          this.pieceList[rookFrom] = PIECES.NONE;
          this.pieceList[rookTo] = PIECES.ROOK;
          moveInfo.castlingRook = { from: rookFrom, to: rookTo };
        }
      }
    }

    if (movingPiece === PIECES.ROOK) {
      if (movingColor === "white") {
        if (fromSquare === squareToIndex('a1')) this.gameState.castling &= ~CASTLING.WHITE_QUEENSIDE;
        if (fromSquare === squareToIndex('h1')) this.gameState.castling &= ~CASTLING.WHITE_KINGSIDE;
      } else {
        if (fromSquare === squareToIndex('a8')) this.gameState.castling &= ~CASTLING.BLACK_QUEENSIDE;
        if (fromSquare === squareToIndex('h8')) this.gameState.castling &= ~CASTLING.BLACK_KINGSIDE;
      }
    }

    if (capturedPiece === PIECES.ROOK) {
      if (toSquare === squareToIndex('a1')) this.gameState.castling &= ~CASTLING.WHITE_QUEENSIDE;
      if (toSquare === squareToIndex('h1')) this.gameState.castling &= ~CASTLING.WHITE_KINGSIDE;
      if (toSquare === squareToIndex('a8')) this.gameState.castling &= ~CASTLING.BLACK_QUEENSIDE;
      if (toSquare === squareToIndex('h8')) this.gameState.castling &= ~CASTLING.BLACK_KINGSIDE;
    }

    this.gameState.zobrist_key ^= ZOBRIST_SEEDS.pieces[movingColorIdx][finalPiece][toSquare];
    this.bbPieces[movingColorIdx][finalPiece].setBit(toSquare);
    this.bbSide[movingColorIdx].setBit(toSquare);
    this.pieceList[toSquare] = finalPiece;

    if (movingColor === "black") {
      this.gameState.full_move_count++;
    }

    if (previousEnPassantSq !== this.gameState.en_passant_sq) {
      this.gameState.zobrist_key ^= ZOBRIST_SEEDS.en_passant[this.getEnPassantZobristIndex(previousEnPassantSq)];
      this.gameState.zobrist_key ^= ZOBRIST_SEEDS.en_passant[this.getEnPassantZobristIndex(this.gameState.en_passant_sq)];
    }

    if (previousCastling !== this.gameState.castling) {
      this.gameState.zobrist_key ^= ZOBRIST_SEEDS.castling[previousCastling];
      this.gameState.zobrist_key ^= ZOBRIST_SEEDS.castling[this.gameState.castling];
    }

    this.gameState.zobrist_key ^= ZOBRIST_SEEDS.sides[movingColor === "white" ? 0 : 1];
    this.gameState.zobrist_key ^= ZOBRIST_SEEDS.sides[oppositeColor === "white" ? 0 : 1];
    this.gameState.active_color = oppositeColor;

    return true;
  }

  undoMove() {
    if (this.history.length() === 0) return false;

    const moveInfo = this.history.moves[this.history.moves.length - 1];
    if (!moveInfo) return false;

    const currentActiveColor = this.gameState.active_color;
    const movingColor = currentActiveColor === "white" ? "black" : "white";

    this.gameState = this.history.pop();

    const { from, to, movingPiece, capturedPiece, enPassantCapture, castlingRook, promotionPiece } = moveInfo;
    const movingColorIdx = colorToIndex(movingColor);
    const oppositeColorIdx = colorToIndex(currentActiveColor);

    const pieceAtDestination = promotionPiece || movingPiece;
    this.bbPieces[movingColorIdx][pieceAtDestination].clearBit(to);
    this.bbSide[movingColorIdx].clearBit(to);

    const restoredPiece = promotionPiece ? PIECES.PAWN : movingPiece;
    this.bbPieces[movingColorIdx][restoredPiece].setBit(from);
    this.bbSide[movingColorIdx].setBit(from);
    this.pieceList[from] = restoredPiece;

    if (capturedPiece !== PIECES.NONE) {
      this.bbPieces[oppositeColorIdx][capturedPiece].setBit(to);
      this.bbSide[oppositeColorIdx].setBit(to);
      this.pieceList[to] = capturedPiece;
    } else {
      this.pieceList[to] = PIECES.NONE;
    }

    if (enPassantCapture !== null) {
      this.bbPieces[oppositeColorIdx][PIECES.PAWN].setBit(enPassantCapture);
      this.bbSide[oppositeColorIdx].setBit(enPassantCapture);
      this.pieceList[enPassantCapture] = PIECES.PAWN;
    }

    if (castlingRook) {
      this.bbPieces[movingColorIdx][PIECES.ROOK].clearBit(castlingRook.to).setBit(castlingRook.from);
      this.bbSide[movingColorIdx].clearBit(castlingRook.to).setBit(castlingRook.from);
      this.pieceList[castlingRook.from] = PIECES.ROOK;
      this.pieceList[castlingRook.to] = PIECES.NONE;
    }

    return true;
  }

  getOccupancy() {
    return this.bbSide[0].or(this.bbSide[1]);
  }

  toFen() {
    let fen = '';

    for (let row = 0; row < 8; row++) {
      let emptyCount = 0;
      for (let col = 0; col < 8; col++) {
        const rank = 7 - row;
        const square = rank * 8 + col;
        const piece = this.pieceList[square];

        if (piece === PIECES.NONE) {
          emptyCount++;
        } else {
          if (emptyCount > 0) {
            fen += emptyCount;
            emptyCount = 0;
          }
          const colorIdx = this.bbSide[0].getBit(square) ? 0 : 1;
          const pieceChar = ['K', 'Q', 'R', 'B', 'N', 'P'][piece];
          fen += colorIdx === 0 ? pieceChar : pieceChar.toLowerCase();
        }
      }
      if (emptyCount > 0) fen += emptyCount;
      if (row < 7) fen += '/';
    }

    fen += ' ' + (this.gameState.active_color === 'white' ? 'w' : 'b');

    let castling = '';
    if (this.gameState.castling & CASTLING.WHITE_KINGSIDE) castling += 'K';
    if (this.gameState.castling & CASTLING.WHITE_QUEENSIDE) castling += 'Q';
    if (this.gameState.castling & CASTLING.BLACK_KINGSIDE) castling += 'k';
    if (this.gameState.castling & CASTLING.BLACK_QUEENSIDE) castling += 'q';
    fen += ' ' + (castling || '-');

    if (this.gameState.en_passant_sq !== -1) {
      fen += ' ' + indexToSquare(this.gameState.en_passant_sq);
    } else {
      fen += ' -';
    }

    fen += ' ' + this.gameState.half_move_clock;
    fen += ' ' + this.gameState.full_move_count;

    return fen;
  }

  clone() {
    const newBoard = new Board();

    for (let color = 0; color <= 1; color++) {
      newBoard.bbSide[color] = this.bbSide[color].clone();
      for (let piece = PIECES.KING; piece <= PIECES.PAWN; piece++) {
        newBoard.bbPieces[color][piece] = this.bbPieces[color][piece].clone();
      }
    }

    newBoard.pieceList = [...this.pieceList];
    newBoard.gameState = this.gameState.clone();

    newBoard.history = new History();
    for (let i = 0; i < this.history.states.length; i++) {
      newBoard.history.states.push(this.history.states[i].clone());
      if (this.history.moves[i]) {
        newBoard.history.moves.push({ ...this.history.moves[i] });
      }
    }

    return newBoard;
  }

  canUndo() {
    return this.history.length() > 0;
  }

  getLastMove() {
    if (this.history.moves.length === 0) return null;
    return this.history.moves[this.history.moves.length - 1];
  }
}