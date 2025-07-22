import { getValidMoves, simulateMove, isInCheck } from "../utils/chessLogic";
import { isWhite, isBlack } from "../utils/chessUtils";

export class BaseBotPlayer {
  constructor(name, color = "black", difficulty = 1) {
    this.name = name;
    this.color = color;
    this.difficulty = difficulty;
    this.positionCount = 0;
    this.moveCount = 0; // Track move count for opening variation
  }

  // Get all valid moves for a given color
  getAllValidMoves(board, color, enPassantTarget, castlingRights, kingMoved, rookMoved) {
    const moves = [];
    
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (
          piece &&
          ((color === "white" && isWhite(piece)) ||
           (color === "black" && isBlack(piece)))
        ) {
          const pieceMoves = getValidMoves(
            r, c, board, true, enPassantTarget, castlingRights, kingMoved, rookMoved
          ).filter(([toRow, toCol]) => {
            const { board: simulatedBoard } = simulateMove(
              r, c, toRow, toCol, board, enPassantTarget
            );
            return !isInCheck(simulatedBoard, color);
          });
          
          pieceMoves.forEach(([toRow, toCol]) => {
            moves.push({
              from: [r, c],
              to: [toRow, toCol],
              piece: piece,
              capturedPiece: board[toRow][toCol]
            });
          });
        }
      }
    }
    
    return moves;
  }

  // Evaluate all moves and return them sorted by quality
  evaluateAndRankMoves(board, moves, enPassantTarget, castlingRights, kingMoved, rookMoved) {
    const evaluatedMoves = moves.map(move => {
      const { board: newBoard } = simulateMove(
        move.from[0], move.from[1], move.to[0], move.to[1], board, enPassantTarget
      );
      
      // Basic evaluation
      let score = this.evaluateBoard(newBoard);
      
      // Tactical bonuses
      if (move.capturedPiece) {
        score += this.color === "white" ? 
          this.getPieceValue(move.capturedPiece[1]) * 10 : 
          -this.getPieceValue(move.capturedPiece[1]) * 10;
      }
      
      // Check bonus
      if (this.moveCausesCheck(move, board, enPassantTarget)) {
        score += this.color === "white" ? 50 : -50;
      }
      
      // Promotion bonus
      if (move.piece[1] === 'p' && (move.to[0] === 0 || move.to[0] === 7)) {
        score += this.color === "white" ? 800 : -800;
      }
      
      // Development bonus in opening
      if (this.moveCount < 10) {
        // Encourage knight and bishop development
        if ((move.piece[1] === 'n' || move.piece[1] === 'b') && 
            (move.from[0] === 0 || move.from[0] === 7)) {
          score += this.color === "white" ? 30 : -30;
        }
        // Discourage moving same piece twice
        if (this.lastMove && move.from[0] === this.lastMove.to[0] && 
            move.from[1] === this.lastMove.to[1]) {
          score += this.color === "white" ? -20 : 20;
        }
      }
      
      return { move, score };
    });
    
    // Sort by score
    evaluatedMoves.sort((a, b) => 
      this.color === "white" ? b.score - a.score : a.score - b.score
    );
    
    return evaluatedMoves;
  }

  // Select move based on difficulty-specific distribution
  selectMoveFromDistribution(rankedMoves) {
    if (rankedMoves.length === 0) return null;
    
    // Define move selection distributions for each difficulty
    const distributions = {
      1: { // Rookie - mostly picks from moves 7-12
        weights: [0.02, 0.02, 0.03, 0.05, 0.08, 0.10, 0.15, 0.15, 0.15, 0.10, 0.10, 0.05],
        randomness: 0.3
      },
      2: { // Casual - mostly picks from moves 4-9
        weights: [0.05, 0.08, 0.10, 0.15, 0.17, 0.15, 0.12, 0.08, 0.05, 0.03, 0.02, 0.00],
        randomness: 0.2
      },
      3: { // Strategic - mostly picks from moves 2-6
        weights: [0.15, 0.20, 0.20, 0.15, 0.10, 0.08, 0.05, 0.03, 0.02, 0.02, 0.00, 0.00],
        randomness: 0.1
      },
      4: { // Master - mostly picks from top 3 moves
        weights: [0.50, 0.30, 0.15, 0.03, 0.01, 0.01, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00],
        randomness: 0.05
      }
    };
    
    const dist = distributions[this.difficulty] || distributions[1];
    
    // Add some pure randomness occasionally
    if (Math.random() < dist.randomness) {
      return rankedMoves[Math.floor(Math.random() * Math.min(rankedMoves.length, 12))].move;
    }
    
    // Use weighted distribution
    const weights = dist.weights.slice(0, Math.min(rankedMoves.length, 12));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    
    let random = Math.random() * totalWeight;
    let cumulative = 0;
    
    for (let i = 0; i < weights.length; i++) {
      cumulative += weights[i];
      if (random < cumulative) {
        return rankedMoves[i].move;
      }
    }
    
    return rankedMoves[0].move;
  }

  // Order moves for better alpha-beta pruning
  orderMoves(moves, board) {
    return moves.sort((a, b) => {
      // Prioritize captures
      const aCapture = a.capturedPiece ? this.getPieceValue(a.capturedPiece[1]) : 0;
      const bCapture = b.capturedPiece ? this.getPieceValue(b.capturedPiece[1]) : 0;
      
      if (aCapture !== bCapture) {
        return bCapture - aCapture; // Higher value captures first
      }
      
      // Then prioritize center control
      const aCenterDistance = Math.abs(a.to[0] - 3.5) + Math.abs(a.to[1] - 3.5);
      const bCenterDistance = Math.abs(b.to[0] - 3.5) + Math.abs(b.to[1] - 3.5);
      
      return aCenterDistance - bCenterDistance;
    });
  }

  // Check if a position is a draw (simplified - only checks for stalemate)
  isDraw(board, color, enPassantTarget, castlingRights, kingMoved, rookMoved) {
    // Check for stalemate
    const moves = this.getAllValidMoves(board, color, enPassantTarget, castlingRights, kingMoved, rookMoved);
    if (moves.length === 0 && !isInCheck(board, color)) {
      return true;
    }
    
    // TODO: Add checks for:
    // - Insufficient material
    // - Threefold repetition
    // - 50-move rule
    
    return false;
  }

  // Update game state after a move
  updateGameState(move, piece, isWhitePiece, castlingRights, kingMoved, rookMoved) {
    const newCastlingRights = { 
      white: { ...castlingRights.white },
      black: { ...castlingRights.black }
    };
    const newKingMoved = { ...kingMoved };
    const newRookMoved = { 
      white: { ...rookMoved.white },
      black: { ...rookMoved.black }
    };
    
    const color = isWhitePiece ? "white" : "black";
    const [fromRow, fromCol] = move.from;
    
    // Update for king moves
    if (piece[1] === "k") {
      newKingMoved[color] = true;
      newCastlingRights[color] = { kingSide: false, queenSide: false };
    }
    
    // Update for rook moves
    if (piece[1] === "r") {
      const backRank = isWhitePiece ? 7 : 0;
      if (fromRow === backRank) {
        if (fromCol === 0) {
          newRookMoved[color].a1 = color === "white";
          newRookMoved[color].a8 = color === "black";
          newCastlingRights[color].queenSide = false;
        } else if (fromCol === 7) {
          newRookMoved[color].h1 = color === "white";
          newRookMoved[color].h8 = color === "black";
          newCastlingRights[color].kingSide = false;
        }
      }
    }
    
    // Update en passant target
    let newEnPassantTarget = null;
    if (piece[1] === "p" && Math.abs(move.from[0] - move.to[0]) === 2) {
      newEnPassantTarget = [move.to[0] + (isWhitePiece ? 1 : -1), move.to[1]];
    }
    
    return {
      castlingRights: newCastlingRights,
      kingMoved: newKingMoved,
      rookMoved: newRookMoved,
      enPassantTarget: newEnPassantTarget
    };
  }

  // Basic move selection - override in subclasses
  selectMove(board, enPassantTarget, castlingRights, kingMoved, rookMoved) {
    this.moveCount++;
    const validMoves = this.getAllValidMoves(
      board, this.color, enPassantTarget, castlingRights, kingMoved, rookMoved
    );
    
    if (validMoves.length === 0) return null;
    
    // Evaluate and rank all moves
    const rankedMoves = this.evaluateAndRankMoves(
      board, validMoves, enPassantTarget, castlingRights, kingMoved, rookMoved
    );
    
    // Select move based on difficulty distribution
    const selectedMove = this.selectMoveFromDistribution(rankedMoves);
    this.lastMove = selectedMove;
    return selectedMove;
  }

  // Get raw piece values
  getPieceValue(pieceType) {
    const values = {
      'p': 100,
      'n': 320,
      'b': 330,
      'r': 500,
      'q': 900,
      'k': 20000
    };
    
    return values[pieceType] || 0;
  }

  // Evaluate board from white's perspective
  // Positive = white is better, negative = black is better
  evaluateBoard(board) {
    let score = 0;
    
    // Material evaluation
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece) {
          const value = this.getPieceValue(piece[1]);
          score += isWhite(piece) ? value : -value;
        }
      }
    }
    
    return score;
  }

  // Check if a move results in check
  moveCausesCheck(move, board, enPassantTarget) {
    const { board: newBoard } = simulateMove(
      move.from[0], move.from[1], move.to[0], move.to[1], board, enPassantTarget
    );
    const opponentColor = isWhite(move.piece) ? "black" : "white";
    return isInCheck(newBoard, opponentColor);
  }

  // Quiescence search to handle captures
  quiescence(board, alpha, beta, color, enPassantTarget, castlingRights, kingMoved, rookMoved, depth = 0) {
    this.positionCount++;
    
    const standPat = this.evaluateBoard(board);
    
    if (depth >= 4) { // Limit quiescence depth
      return standPat;
    }
    
    if (color === "white") {
      if (standPat >= beta) return beta;
      alpha = Math.max(alpha, standPat);
    } else {
      if (standPat <= alpha) return alpha;
      beta = Math.min(beta, standPat);
    }
    
    // Get only captures
    const moves = this.getAllValidMoves(board, color, enPassantTarget, castlingRights, kingMoved, rookMoved)
      .filter(move => move.capturedPiece);
    
    if (moves.length === 0) return standPat;
    
    // Order captures by MVV-LVA (Most Valuable Victim - Least Valuable Attacker)
    moves.sort((a, b) => {
      const aScore = this.getPieceValue(a.capturedPiece[1]) - this.getPieceValue(a.piece[1]) / 10;
      const bScore = this.getPieceValue(b.capturedPiece[1]) - this.getPieceValue(b.piece[1]) / 10;
      return bScore - aScore;
    });
    
    for (const move of moves) {
      const { board: newBoard } = simulateMove(
        move.from[0], move.from[1], move.to[0], move.to[1], board, enPassantTarget
      );
      
      const gameState = this.updateGameState(
        move, move.piece, isWhite(move.piece), castlingRights, kingMoved, rookMoved
      );
      
      const score = this.quiescence(
        newBoard, alpha, beta, color === "white" ? "black" : "white",
        gameState.enPassantTarget, gameState.castlingRights, gameState.kingMoved, gameState.rookMoved,
        depth + 1
      );
      
      if (color === "white") {
        alpha = Math.max(alpha, score);
        if (alpha >= beta) break;
      } else {
        beta = Math.min(beta, score);
        if (beta <= alpha) break;
      }
    }
    
    return color === "white" ? alpha : beta;
  }
}