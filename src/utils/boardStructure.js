import { CASTLING, PIECES, PIECE_NAMES, ZOBRIST_SEEDS } from '../constants/gameConstants';
import { initializeBitboards, initializePieceList, squareToIndex, indexToSquare, getPieceColor, colorToIndex } from './bitboard';

// GameState object definition
export class GameState {
  constructor() {
    this.active_color = "white";
    this.castling = CASTLING.ALL;
    this.half_move_clock = 0;
    this.en_passant_sq = -1;
    this.full_move_count = 1;
    this.next_move = null;
    this.zobrist_key = 0n; // Zobrist hash for position identification
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

// History object - maintains game states in a stack-like way
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

// Main Board object
export class Board {
  constructor() {
    console.log("Creating new Board...");
    
    // Initialize bitboards
    const { bbPieces, bbSide } = initializeBitboards();
    this.bbPieces = bbPieces;
    this.bbSide = bbSide;
    
    // Initialize piece list
    this.pieceList = initializePieceList();
    
    // Initialize game state
    this.gameState = new GameState();
    
    // Initialize history
    this.history = new History();
    
    // Calculate initial Zobrist key
    this.gameState.zobrist_key = this.zobristInit(this.gameState);
    
    console.log("Board created successfully");
  }

  // Initialize Zobrist hash from scratch (only called when zobrist_key is 0)
  zobristInit(gameState) {
    let hash = 0n;
    
    // Hash pieces on the board
    for (let color = 0; color <= 1; color++) {
      for (let pieceType = PIECES.KING; pieceType <= PIECES.PAWN; pieceType++) {
        const pieceBB = this.bbPieces[color][pieceType].clone();
        
        while (!pieceBB.isEmpty()) {
          const square = pieceBB.popLSB();
          hash ^= ZOBRIST_SEEDS.pieces[color][pieceType][square];
        }
      }
    }
    
    // Hash castling rights
    hash ^= ZOBRIST_SEEDS.castling[gameState.castling];
    
    // Hash side to move
    if (gameState.active_color === "black") {
      hash ^= ZOBRIST_SEEDS.sides[1];
    } else {
      hash ^= ZOBRIST_SEEDS.sides[0];
    }
    
    // Hash en passant square if exists
    if (gameState.en_passant_sq !== -1) {
      // En passant squares are indexed by color and file:
      // - Indices 0-7: White pawns that can be captured (ranks 3-4)
      // - Indices 8-15: Black pawns that can be captured (ranks 5-6) 
      // - Index 16: No en passant
      const enPassantFile = gameState.en_passant_sq % 8;
      const enPassantRank = Math.floor(gameState.en_passant_sq / 8);
      
      // Rank 2 (index for white pawn that moved to rank 3) or 
      // Rank 5 (index for black pawn that moved to rank 4)
      if (enPassantRank === 2) {
        // White pawn can be captured en passant
        hash ^= ZOBRIST_SEEDS.en_passant[enPassantFile];
      } else if (enPassantRank === 5) {
        // Black pawn can be captured en passant  
        hash ^= ZOBRIST_SEEDS.en_passant[8 + enPassantFile];
      }
    } else {
      // No en passant - use index 16 (last entry)
      hash ^= ZOBRIST_SEEDS.en_passant[16];
    }
    
    return hash;
  }
  
  // Helper function to get en passant Zobrist index
  getEnPassantZobristIndex(enPassantSq) {
    if (enPassantSq === -1) {
      return 16; // No en passant
    }
    
    const enPassantRank = Math.floor(enPassantSq / 8);
    const enPassantFile = enPassantSq % 8;
    
    if (enPassantRank === 2) {
      return enPassantFile; // White pawn (0-7)
    } else if (enPassantRank === 5) {
      return 8 + enPassantFile; // Black pawn (8-15)
    }
    
    return 16; // Should not happen, but default to no en passant
  }

  // Make a move on the board
  makeMove(fromSquare, toSquare, promotionPiece = null) {
    console.log(`Board.makeMove: ${indexToSquare(fromSquare)} -> ${indexToSquare(toSquare)}, promotion: ${promotionPiece ? PIECE_NAMES[promotionPiece] : 'none'}`);
    
    // Validate squares
    if (fromSquare < 0 || fromSquare >= 64 || toSquare < 0 || toSquare >= 64) {
      console.error(`Invalid move squares: ${fromSquare} -> ${toSquare}`);
      return false;
    }
    
    // Initialize Zobrist key if it's 0 (shouldn't happen in normal play but good for safety)
    if (this.gameState.zobrist_key === 0n) {
      this.gameState.zobrist_key = this.zobristInit(this.gameState);
    }
    
    // Save current state to history (including current Zobrist key)
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
    
    console.log(`Moving ${PIECE_NAMES[movingPiece]} (${movingColor}) from ${indexToSquare(fromSquare)} to ${indexToSquare(toSquare)}`);
    
    // Store the previous en passant square and castling rights for Zobrist updates
    const previousEnPassantSq = this.gameState.en_passant_sq;
    const previousCastling = this.gameState.castling;
    
    /// Clear moving piece from source
    const movingColorIdx = colorToIndex(movingColor);
    const oppositeColorIdx = colorToIndex(oppositeColor);
    
    // Zobrist: Remove piece from 'from' square
    this.gameState.zobrist_key ^= ZOBRIST_SEEDS.pieces[movingColorIdx][movingPiece][fromSquare];
    
    this.bbPieces[movingColorIdx][movingPiece].clearBit(fromSquare);
    this.bbSide[movingColorIdx].clearBit(fromSquare);
    this.pieceList[fromSquare] = PIECES.NONE;

    // Handle capture
    if (capturedPiece !==PIECES.NONE) {
      console.log(`Capturing ${PIECE_NAMES[capturedPiece]} at ${indexToSquare(toSquare)}`);
      
      // Zobrist: Remove captured piece
      this.gameState.zobrist_key ^= ZOBRIST_SEEDS.pieces[oppositeColorIdx][capturedPiece][toSquare];
      
      this.bbPieces[oppositeColorIdx][capturedPiece].clearBit(toSquare);
      this.bbSide[oppositeColorIdx].clearBit(toSquare);
      this.gameState.half_move_clock = 0;
    } else {
      this.gameState.half_move_clock++;
    }
    
    // Handle special moves
    let finalPiece = movingPiece;
    
    // Pawn moves
    if (movingPiece === PIECES.PAWN) {
      this.gameState.half_move_clock = 0;
      
      // En passant capture
      if (previousEnPassantSq !== -1) {
        const fromRank = Math.floor(fromSquare / 8);
        const fromFile = fromSquare % 8;
        const toRank = Math.floor(toSquare / 8);
        const toFile = toSquare % 8;
        
        const isdiagonalMove = Math.abs(fromFile - toFile) === 1 && Math.abs(fromRank - toRank) === 1;
        
        if (isdiagonalMove && capturedPiece === PIECES.NONE) {
          const captureSquare = fromRank * 8 + toFile;
          
          if (this.pieceList[captureSquare] === PIECES.PAWN && 
              getPieceColor(this.bbSide, captureSquare) === oppositeColor) {
            console.log(`En passant capture: capturing pawn at square ${captureSquare} (${indexToSquare(captureSquare)})`);
            
            // Zobrist: Remove captured en passant pawn
            this.gameState.zobrist_key ^= ZOBRIST_SEEDS.pieces[oppositeColorIdx][PIECES.PAWN][captureSquare];
            
            this.bbPieces[oppositeColorIdx][PIECES.PAWN].clearBit(captureSquare);
            this.bbSide[oppositeColorIdx].clearBit(captureSquare);
            this.pieceList[captureSquare] = PIECES.NONE;
            moveInfo.enPassantCapture = captureSquare;
          }
        }
      }
      
      // Clear en passant square
      this.gameState.en_passant_sq = -1;
      
      // Check for double pawn push
      const fromRank = Math.floor(fromSquare / 8);
      const toRank = Math.floor(toSquare / 8);
      const rankDiff = Math.abs(fromRank - toRank);
      
      if (rankDiff === 2) {
        this.gameState.en_passant_sq = movingColor === "white" ? toSquare + 8 : toSquare - 8;
        console.log(`En passant square set to ${this.gameState.en_passant_sq} (${indexToSquare(this.gameState.en_passant_sq)})`);
      }
      
      // Promotion
      if ((movingColor === "white" && toRank === 7) || (movingColor === "black" && toRank === 0)) {
        finalPiece = promotionPiece || PIECES.QUEEN;
        console.log(`Pawn promoted to ${PIECE_NAMES[finalPiece]}`);
      }
    } else {
      // Non-pawn move - clear en passant square
      this.gameState.en_passant_sq = -1;
    }
    
    // King moves
    if (movingPiece === PIECES.KING) {
      // Remove castling rights
      if (movingColor === "white") {
        this.gameState.castling &= ~(CASTLING.WHITE_KINGSIDE | CASTLING.WHITE_QUEENSIDE);
      } else {
        this.gameState.castling &= ~(CASTLING.BLACK_KINGSIDE | CASTLING.BLACK_QUEENSIDE);
      }
      
      // Check for castling
      const fileDiff = (toSquare % 8) - (fromSquare % 8);
      if (Math.abs(fileDiff) === 2) {
        const rank = Math.floor(fromSquare / 8);
        if (fileDiff > 0) {
          // Kingside castling
          const rookFrom = rank * 8 + 7;
          const rookTo = rank * 8 + 5;
          console.log(`Kingside castling: moving rook from ${rookFrom} to ${rookTo}`);
          
          // Zobrist: Move rook for castling
          this.gameState.zobrist_key ^= ZOBRIST_SEEDS.pieces[movingColorIdx][PIECES.ROOK][rookFrom];
          this.gameState.zobrist_key ^= ZOBRIST_SEEDS.pieces[movingColorIdx][PIECES.ROOK][rookTo];
          
          this.bbPieces[movingColorIdx][PIECES.ROOK].clearBit(rookFrom).setBit(rookTo);
          this.bbSide[movingColorIdx].clearBit(rookFrom).setBit(rookTo);
          this.pieceList[rookFrom] = PIECES.NONE;
          this.pieceList[rookTo] = PIECES.ROOK;
          moveInfo.castlingRook = { from: rookFrom, to: rookTo };
        } else {
          // Queenside castling
          const rookFrom = rank * 8;
          const rookTo = rank * 8 + 3;
          console.log(`Queenside castling: moving rook from ${rookFrom} to ${rookTo}`);
          
          // Zobrist: Move rook for castling
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
    
    // Rook moves - update castling rights
    if (movingPiece === PIECES.ROOK) {
      if (movingColor === "white") {
        if (fromSquare === squareToIndex('a1')) {
          this.gameState.castling &= ~CASTLING.WHITE_QUEENSIDE;
        } else if (fromSquare === squareToIndex('h1')) {
          this.gameState.castling &= ~CASTLING.WHITE_KINGSIDE;
        }
      } else {
        if (fromSquare === squareToIndex('a8')) {
          this.gameState.castling &= ~CASTLING.BLACK_QUEENSIDE;
        } else if (fromSquare === squareToIndex('h8')) {
          this.gameState.castling &= ~CASTLING.BLACK_KINGSIDE;
        }
      }
    }
    
    // Rook captures - update castling rights
    if (capturedPiece === PIECES.ROOK) {
      if (toSquare === squareToIndex('a1')) {
        this.gameState.castling &= ~CASTLING.WHITE_QUEENSIDE;
      } else if (toSquare === squareToIndex('h1')) {
        this.gameState.castling &= ~CASTLING.WHITE_KINGSIDE;
      } else if (toSquare === squareToIndex('a8')) {
        this.gameState.castling &= ~CASTLING.BLACK_QUEENSIDE;
      } else if (toSquare === squareToIndex('h8')) {
        this.gameState.castling &= ~CASTLING.BLACK_KINGSIDE;
      }
    }
    
    // Place piece at destination
    // Zobrist: Add piece to 'to' square (finalPiece in case of promotion)
    this.gameState.zobrist_key ^= ZOBRIST_SEEDS.pieces[movingColorIdx][finalPiece][toSquare];
    
    this.bbPieces[movingColorIdx][finalPiece].setBit(toSquare);
    this.bbSide[movingColorIdx].setBit(toSquare);
    this.pieceList[toSquare] = finalPiece;
    
    // Update move counters
    if (movingColor === "black") {
      this.gameState.full_move_count++;
    }
    
    // Zobrist: Update en passant if changed
    if (previousEnPassantSq !== this.gameState.en_passant_sq) {
      // Remove old en passant
      this.gameState.zobrist_key ^= ZOBRIST_SEEDS.en_passant[this.getEnPassantZobristIndex(previousEnPassantSq)];
      // Add new en passant
      this.gameState.zobrist_key ^= ZOBRIST_SEEDS.en_passant[this.getEnPassantZobristIndex(this.gameState.en_passant_sq)];
    }
    
    // Zobrist: Update castling rights if changed
    if (previousCastling !== this.gameState.castling) {
      // Remove old castling rights
      this.gameState.zobrist_key ^= ZOBRIST_SEEDS.castling[previousCastling];
      // Add new castling rights
      this.gameState.zobrist_key ^= ZOBRIST_SEEDS.castling[this.gameState.castling];
    }
    
    // Zobrist: Switch side to move
    // Remove current side
    this.gameState.zobrist_key ^= ZOBRIST_SEEDS.sides[movingColor === "white" ? 0 : 1];
    // Add opposite side
    this.gameState.zobrist_key ^= ZOBRIST_SEEDS.sides[oppositeColor === "white" ? 0 : 1];
    
    // Switch active color
    this.gameState.active_color = oppositeColor;
    
    console.log(`Move completed. New active color: ${this.gameState.active_color}`);
    
    return true;
  }

  // Undo the last move
  undoMove() {
    if (this.history.length() === 0) return false;
    
    console.log("Undoing last move...");
    
    const moveInfo = this.history.moves[this.history.moves.length - 1];
    if (!moveInfo) {
      console.error("No move info found for undo");
      return false;
    }
    
    // Get the color that made the move we're undoing
    const currentActiveColor = this.gameState.active_color;
    const movingColor = currentActiveColor === "white" ? "black" : "white";
    
    // Restore previous state (including the Zobrist key)
    // This restores the complete game state including zobrist_key, so no incremental updates needed
    this.gameState = this.history.pop();
    
    const { from, to, movingPiece, capturedPiece, enPassantCapture, castlingRook, promotionPiece } = moveInfo;
    
    const movingColorIdx = colorToIndex(movingColor);
    const oppositeColorIdx = colorToIndex(currentActiveColor);
    
    console.log(`Undoing move: ${movingColor} piece from ${from} to ${to}`);
    
    // Remove the piece from destination first
    const pieceAtDestination = promotionPiece || movingPiece;
    this.bbPieces[movingColorIdx][pieceAtDestination].clearBit(to);
    this.bbSide[movingColorIdx].clearBit(to);
    
    // Restore moving piece to original square
    const restoredPiece = promotionPiece ? PIECES.PAWN : movingPiece;
    this.bbPieces[movingColorIdx][restoredPiece].setBit(from);
    this.bbSide[movingColorIdx].setBit(from);
    this.pieceList[from] = restoredPiece;
    
    // Restore captured piece if any
    if (capturedPiece !== PIECES.NONE) {
      this.bbPieces[oppositeColorIdx][capturedPiece].setBit(to);
      this.bbSide[oppositeColorIdx].setBit(to);
      this.pieceList[to] = capturedPiece;
    } else {
      this.pieceList[to] = PIECES.NONE;
    }
    
    // Restore en passant capture
    if (enPassantCapture !== null) {
      console.log(`Restoring en passant captured pawn at ${enPassantCapture}`);
      this.bbPieces[oppositeColorIdx][PIECES.PAWN].setBit(enPassantCapture);
      this.bbSide[oppositeColorIdx].setBit(enPassantCapture);
      this.pieceList[enPassantCapture] = PIECES.PAWN;
    }
    
    // Restore castling rook
    if (castlingRook) {
      console.log(`Restoring castling rook from ${castlingRook.to} to ${castlingRook.from}`);
      this.bbPieces[movingColorIdx][PIECES.ROOK].clearBit(castlingRook.to).setBit(castlingRook.from);
      this.bbSide[movingColorIdx].clearBit(castlingRook.to).setBit(castlingRook.from);
      this.pieceList[castlingRook.from] = PIECES.ROOK;
      this.pieceList[castlingRook.to] = PIECES.NONE;
    }
    
    console.log(`Move undone successfully. Active color is now: ${this.gameState.active_color}`);
    return true;
  }

  // Get occupancy bitboard (all pieces)
  getOccupancy() {
    return this.bbSide[0].or(this.bbSide[1]);
  }

  // Clone the board
  clone() {
    const newBoard = new Board();
    
    // Deep copy bitboards
    for (let color = 0; color <= 1; color++) {
      newBoard.bbSide[color] = this.bbSide[color].clone();
      for (let piece = PIECES.KING; piece <= PIECES.PAWN; piece++) {
        newBoard.bbPieces[color][piece] = this.bbPieces[color][piece].clone();
      }
    }
    
    // Copy piece list
    newBoard.pieceList = [...this.pieceList];
    
    // Clone game state
    newBoard.gameState = this.gameState.clone();
    
    // Clone history
    newBoard.history = new History();
    for (let i = 0; i < this.history.states.length; i++) {
      newBoard.history.states.push(this.history.states[i].clone());
      if (this.history.moves[i]) {
        newBoard.history.moves.push({ ...this.history.moves[i] });
      }
    }
    
    return newBoard;
  }
  
  // Add helper methods
  canUndo() {
    return this.history.length() > 0;
  }

  getLastMove() {
    if (this.history.moves.length === 0) return null;
    return this.history.moves[this.history.moves.length - 1];
  }
}