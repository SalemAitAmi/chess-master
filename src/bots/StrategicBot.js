import { BaseBotPlayer } from "./BaseBotPlayer";
import { simulateMove, isInCheck } from "../utils/chessLogic";
import { isWhite } from "../utils/chessUtils";

export class StrategicBot extends BaseBotPlayer {
  constructor() {
    super("Strategic Sam", "black", 3);
    this.maxDepth = 3;
  }

  selectMove(board, enPassantTarget, castlingRights, kingMoved, rookMoved) {
    this.positionCount = 0;
    const startTime = Date.now();
    
    const result = this.minimax(
      board, this.maxDepth, -Infinity, Infinity, this.color,
      enPassantTarget, castlingRights, kingMoved, rookMoved
    );
    
    const timeElapsed = Date.now() - startTime;
    console.log(`Strategic Bot evaluated ${this.positionCount} positions in ${timeElapsed}ms`);
    
    return result.move;
  }

  minimax(board, depth, alpha, beta, currentColor, enPassantTarget, castlingRights, kingMoved, rookMoved) {
    this.positionCount++;
    
    // Check for draw
    if (this.isDraw(board, currentColor, enPassantTarget, castlingRights, kingMoved, rookMoved)) {
      return { score: 0, move: null };
    }
    
    const moves = this.getAllValidMoves(board, currentColor, enPassantTarget, castlingRights, kingMoved, rookMoved);
    
    // Checkmate or stalemate
    if (moves.length === 0) {
      if (isInCheck(board, currentColor)) {  // Fixed: use imported isInCheck
        // Checkmate - very bad for current player
        return { score: currentColor === "white" ? -20000 + depth : 20000 - depth, move: null };
      } else {
        // Stalemate
        return { score: 0, move: null };
      }
    }
    
    // Terminal depth - use quiescence search
    if (depth === 0) {
      const score = this.quiescence(board, alpha, beta, currentColor, enPassantTarget, castlingRights, kingMoved, rookMoved);
      return { score, move: null };
    }
    
    // Order moves for better pruning
    const orderedMoves = this.orderMoves(moves, board);
    
    let bestMove = null;
    let bestScore = currentColor === "white" ? -Infinity : Infinity;
    
    for (const move of orderedMoves) {
      const { board: newBoard } = simulateMove(
        move.from[0], move.from[1], move.to[0], move.to[1], board, enPassantTarget
      );
      
      const gameState = this.updateGameState(
        move, move.piece, isWhite(move.piece), castlingRights, kingMoved, rookMoved
      );
      
      const result = this.minimax(
        newBoard, depth - 1, alpha, beta, currentColor === "white" ? "black" : "white",
        gameState.enPassantTarget, gameState.castlingRights, gameState.kingMoved, gameState.rookMoved
      );
      
      if (currentColor === "white") {
        if (result.score > bestScore) {
          bestScore = result.score;
          bestMove = move;
        }
        alpha = Math.max(alpha, bestScore);
      } else {
        if (result.score < bestScore) {
          bestScore = result.score;
          bestMove = move;
        }
        beta = Math.min(beta, bestScore);
      }
      
      // Alpha-beta pruning
      if (beta <= alpha) {
        break;
      }
    }
    
    return { score: bestScore, move: bestMove };
  }

  evaluateBoard(board) {
    let score = super.evaluateBoard(board);
    
    // Add positional bonuses
    const pieceSquareTables = {
      p: [ // Pawn
        [ 0,  0,  0,  0,  0,  0,  0,  0],
        [50, 50, 50, 50, 50, 50, 50, 50],
        [10, 10, 20, 30, 30, 20, 10, 10],
        [ 5,  5, 10, 25, 25, 10,  5,  5],
        [ 0,  0,  0, 20, 20,  0,  0,  0],
        [ 5, -5,-10,  0,  0,-10, -5,  5],
        [ 5, 10, 10,-20,-20, 10, 10,  5],
        [ 0,  0,  0,  0,  0,  0,  0,  0]
      ],
      n: [ // Knight
        [-50,-40,-30,-30,-30,-30,-40,-50],
        [-40,-20,  0,  0,  0,  0,-20,-40],
        [-30,  0, 10, 15, 15, 10,  0,-30],
        [-30,  5, 15, 20, 20, 15,  5,-30],
        [-30,  0, 15, 20, 20, 15,  0,-30],
        [-30,  5, 10, 15, 15, 10,  5,-30],
        [-40,-20,  0,  5,  5,  0,-20,-40],
        [-50,-40,-30,-30,-30,-30,-40,-50]
      ],
      b: [ // Bishop
        [-20,-10,-10,-10,-10,-10,-10,-20],
        [-10,  0,  0,  0,  0,  0,  0,-10],
        [-10,  0,  5, 10, 10,  5,  0,-10],
        [-10,  5,  5, 10, 10,  5,  5,-10],
        [-10,  0, 10, 10, 10, 10,  0,-10],
        [-10, 10, 10, 10, 10, 10, 10,-10],
        [-10,  5,  0,  0,  0,  0,  5,-10],
        [-20,-10,-10,-10,-10,-10,-10,-20]
      ],
      r: [ // Rook
        [ 0,  0,  0,  0,  0,  0,  0,  0],
        [ 5, 10, 10, 10, 10, 10, 10,  5],
        [-5,  0,  0,  0,  0,  0,  0, -5],
        [-5,  0,  0,  0,  0,  0,  0, -5],
        [-5,  0,  0,  0,  0,  0,  0, -5],
        [-5,  0,  0,  0,  0,  0,  0, -5],
        [-5,  0,  0,  0,  0,  0,  0, -5],
        [ 0,  0,  0,  5,  5,  0,  0,  0]
      ],
      q: [ // Queen
        [-20,-10,-10, -5, -5,-10,-10,-20],
        [-10,  0,  0,  0,  0,  0,  0,-10],
        [-10,  0,  5,  5,  5,  5,  0,-10],
        [ -5,  0,  5,  5,  5,  5,  0, -5],
        [  0,  0,  5,  5,  5,  5,  0, -5],
        [-10,  5,  5,  5,  5,  5,  0,-10],
        [-10,  0,  5,  0,  0,  0,  0,-10],
        [-20,-10,-10, -5, -5,-10,-10,-20]
      ],
      k: [ // King (middlegame)
        [-30,-40,-40,-50,-50,-40,-40,-30],
        [-30,-40,-40,-50,-50,-40,-40,-30],
        [-30,-40,-40,-50,-50,-40,-40,-30],
        [-30,-40,-40,-50,-50,-40,-40,-30],
        [-20,-30,-30,-40,-40,-30,-30,-20],
        [-10,-20,-20,-20,-20,-20,-20,-10],
        [ 20, 20,  0,  0,  0,  0, 20, 20],
        [ 20, 30, 10,  0,  0, 10, 30, 20]
      ]
    };
    
    // Apply piece-square tables
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && pieceSquareTables[piece[1]]) {
          const table = pieceSquareTables[piece[1]];
          const row = isWhite(piece) ? 7 - r : r;
          const bonus = table[row][c];
          score += isWhite(piece) ? bonus : -bonus;
        }
      }
    }
    
    return score;
  }
}