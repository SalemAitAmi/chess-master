import { PIECES } from '../constants/gameConstants';
import { getValidMoves, simulateMove, isInCheck, hasValidMoves } from '../utils/chessLogic';
import { indexToRowCol, colorToIndex } from '../utils/bitboard';

export class Player {
  constructor(color, board, name = null) {
    this.color = color;
    this.board = board;
    this.name = name || (color === "white" ? 'White' : 'Black');
  }

  // Static piece values - can be overridden by subclasses
  static PIECE_VALUES = {
    [PIECES.PAWN]: 100,
    [PIECES.KNIGHT]: 320,
    [PIECES.BISHOP]: 330,
    [PIECES.ROOK]: 500,
    [PIECES.QUEEN]: 900,
    [PIECES.KING]: 0 // King has no material value
  };

  // Get our color
  us() {
    return this.color;
  }

  // Get opponent's color
  them() {
    return this.color === "white" ? "black" : "white";
  }

  // Check if it's our turn
  isOurTurn() {
    return this.board.gameState.active_color === this.color;
  }

  // Check if we're in check
  inCheck() {
    return isInCheck(this.board, this.color);
  }

  // Check if opponent is in check
  opponentInCheck() {
    return isInCheck(this.board, this.them());
  }

  // Calculate material value for a specific color
  calculateMaterialValue(color = this.color) {
    const colorIdx = colorToIndex(color);
    let value = 0;
    
    for (let piece = PIECES.KING; piece <= PIECES.PAWN; piece++) {
      const count = this.board.bbPieces[colorIdx][piece].popCount();
      value += count * this.getPieceValue(piece, color);
    }
    
    return value;
  }

  // Get piece value - can be overridden for positional adjustments
  getPieceValue(piece, color) {
    return Player.PIECE_VALUES[piece];
  }

  // Get material balance (positive = we're ahead)
  getMaterialBalance() {
    return this.calculateMaterialValue(this.color) - this.calculateMaterialValue(this.them());
  }

  // Get total material on board
  getTotalMaterial() {
    return this.calculateMaterialValue("white") + this.calculateMaterialValue("black");
  }

  // Check if game is a draw
  isDraw() {
    // Stalemate
    if (!this.inCheck() && !hasValidMoves(this.color, this.board)) {
      return true;
    }
    
    // 50-move rule
    if (this.board.gameState.half_move_clock >= 100) {
      return true;
    }
    
    // Insufficient material
    if (this.hasInsufficientMaterial()) {
      return true;
    }
    
    // Threefold repetition check
    // The rule is triggered when the same board position occurs three times with:
    // - The same pieces on the same squares
    // - The same player to move
    // - The same castling rights
    // - The same en passant possibilities
    // All of these are encoded in the Zobrist hash
    if (this.hasThreefoldRepetition()) {
      return true;
    }
    
    return false;
  }

  // Check for threefold repetition
  hasThreefoldRepetition() {
    const currentZobrist = this.board.gameState.zobrist_key;
    let count = 1; // Count includes current position
    
    // Check history for matching positions
    // We only need to check positions with the same player to move
    // Since half_move_clock resets on pawn moves and captures, we only need
    // to check back to the last irreversible move
    const historyLength = this.board.history.states.length;
    const maxLookback = Math.min(historyLength, this.board.gameState.half_move_clock);
    
    // Check every other position (same player to move)
    for (let i = historyLength - 2; i >= Math.max(0, historyLength - maxLookback); i -= 2) {
      if (this.board.history.states[i].zobrist_key === currentZobrist) {
        count++;
        if (count >= 3) {
          console.log("Threefold repetition detected!");
          return true;
        }
      }
    }
    
    return false;
  }

  // Check for insufficient material
  hasInsufficientMaterial() {
    const whitePieces = this.countPieces("white");
    const blackPieces = this.countPieces("black");
    
    const totalPieces = Object.values(whitePieces).reduce((a, b) => a + b, 0) +
                       Object.values(blackPieces).reduce((a, b) => a + b, 0);
    
    // King vs King
    if (totalPieces === 2) return true;
    
    // King + Bishop/Knight vs King
    if (totalPieces === 3) {
      if (whitePieces.bishop === 1 || whitePieces.knight === 1 ||
          blackPieces.bishop === 1 || blackPieces.knight === 1) {
        return true;
      }
    }
    
    // King + Bishop vs King + Bishop (same colored bishops)
    if (totalPieces === 4 && whitePieces.bishop === 1 && blackPieces.bishop === 1) {
      // Check if bishops are on same color squares
      const whiteColorIdx = colorToIndex("white");
      const blackColorIdx = colorToIndex("black");
      const whiteBishopSquare = this.board.bbPieces[whiteColorIdx][PIECES.BISHOP].getLSB();
      const blackBishopSquare = this.board.bbPieces[blackColorIdx][PIECES.BISHOP].getLSB();
      
      const whiteSquareColor = (Math.floor(whiteBishopSquare / 8) + whiteBishopSquare % 8) % 2;
      const blackSquareColor = (Math.floor(blackBishopSquare / 8) + blackBishopSquare % 8) % 2;
      
      if (whiteSquareColor === blackSquareColor) return true;
    }
    
    return false;
  }

  // Count pieces for a color
  countPieces(color) {
    const colorIdx = colorToIndex(color);
    return {
      king: this.board.bbPieces[colorIdx][PIECES.KING].popCount(),
      queen: this.board.bbPieces[colorIdx][PIECES.QUEEN].popCount(),
      rook: this.board.bbPieces[colorIdx][PIECES.ROOK].popCount(),
      bishop: this.board.bbPieces[colorIdx][PIECES.BISHOP].popCount(),
      knight: this.board.bbPieces[colorIdx][PIECES.KNIGHT].popCount(),
      pawn: this.board.bbPieces[colorIdx][PIECES.PAWN].popCount()
    };
  }

  // Check if we have bishop pair
  hasBishopPair() {
    const colorIdx = colorToIndex(this.color);
    const bishopCount = this.board.bbPieces[colorIdx][PIECES.BISHOP].popCount();
    if (bishopCount < 2) return false;
    
    // Check if bishops are on different colored squares
    const bishopBB = this.board.bbPieces[colorIdx][PIECES.BISHOP].clone();
    const squares = [];
    
    while (!bishopBB.isEmpty()) {
      squares.push(bishopBB.popLSB());
    }
    
    // Check if we have bishops on both light and dark squares
    let hasLightSquareBishop = false;
    let hasDarkSquareBishop = false;
    
    for (const square of squares) {
      const squareColor = (Math.floor(square / 8) + square % 8) % 2;
      if (squareColor === 0) hasLightSquareBishop = true;
      else hasDarkSquareBishop = true;
    }
    
    return hasLightSquareBishop && hasDarkSquareBishop;
  }

  // Get all legal moves
  getAllLegalMoves() {
    const moves = [];
    const colorIdx = colorToIndex(this.color);
    
    for (let pieceType = PIECES.KING; pieceType <= PIECES.PAWN; pieceType++) {
      const pieceBB = this.board.bbPieces[colorIdx][pieceType].clone();
      
      while (!pieceBB.isEmpty()) {
        const fromSquare = pieceBB.popLSB();
        const [fromRow, fromCol] = indexToRowCol(fromSquare);
        
        const pieceMoves = getValidMoves(fromRow, fromCol, this.board, true);
        
        for (const [toRow, toCol] of pieceMoves) {
          const { board: simulatedBoard } = simulateMove(
            fromRow, fromCol, toRow, toCol, this.board
          );
          
          if (!isInCheck(simulatedBoard, this.color)) {
            moves.push({
              from: [fromRow, fromCol],
              to: [toRow, toCol],
              fromSquare,
              toSquare: toRow * 8 + toCol
            });
          }
        }
      }
    }
    
    return moves;
  }

  // Make a move (to be overridden by subclasses)
  async makeMove() {
    throw new Error('makeMove must be implemented by subclass');
  }

  // Check if a specific move is legal
  isLegalMove(fromRow, fromCol, toRow, toCol) {
    const moves = getValidMoves(fromRow, fromCol, this.board, true);
    
    if (!moves.some(([r, c]) => r === toRow && c === toCol)) {
      return false;
    }
    
    const { board: simulatedBoard } = simulateMove(
      fromRow, fromCol, toRow, toCol, this.board
    );
    
    return !isInCheck(simulatedBoard, this.color);
  }

  // Update board reference (useful when board state changes)
  updateBoard(board) {
    this.board = board;
  }
}

// Human player class
export class HumanPlayer extends Player {
  constructor(color, board, name = null) {
    super(color, board, name || `Human (${color === "white" ? 'White' : 'Black'})`);
  }

  async makeMove() {
    // Human moves are handled by UI interaction
    // This method would be called by the UI when a move is made
    return new Promise((resolve) => {
      // In practice, this would be resolved by the UI handler
      // For now, just return a placeholder
      resolve(null);
    });
  }
}

// Computer player class (placeholder for future engine)
export class ComputerPlayer extends Player {
  constructor(color, board, name = null, level = 1) {
    super(color, board, name || `Computer (${color === "white" ? 'White' : 'Black'})`);
    this.level = level;
  }

  // Override to add positional bonuses in the future
  getPieceValue(piece, color) {
    // For now, just use base values
    // In the future, this can include position-based modifiers
    return super.getPieceValue(piece, color);
  }

  async makeMove() {
    // For now, make a random legal move
    const moves = this.getAllLegalMoves();
    
    if (moves.length === 0) return null;
    
    // Add a small delay to simulate thinking
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Random move for now - will be replaced with engine logic
    const randomMove = moves[Math.floor(Math.random() * moves.length)];
    
    return {
      from: randomMove.from,
      to: randomMove.to
    };
  }
}