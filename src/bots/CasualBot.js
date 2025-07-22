import { BaseBotPlayer } from "./BaseBotPlayer";
import { simulateMove } from "../utils/chessLogic";
import { isWhite } from "../utils/chessUtils";

export class CasualBot extends BaseBotPlayer {
  constructor() {
    super("Casual Casey", "black", 2);
  }

  selectMove(board, enPassantTarget, castlingRights, kingMoved, rookMoved) {
    const validMoves = this.getAllValidMoves(
      board, this.color, enPassantTarget, castlingRights, kingMoved, rookMoved
    );
    
    if (validMoves.length === 0) return null;
    
    // Simple 1-ply evaluation
    const evaluatedMoves = validMoves.map(move => {
      const { board: newBoard } = simulateMove(
        move.from[0], move.from[1], move.to[0], move.to[1], board, enPassantTarget
      );
      
      const gameState = this.updateGameState(
        move, move.piece, isWhite(move.piece), castlingRights, kingMoved, rookMoved
      );
      
      // Basic evaluation
      let score = this.evaluateBoard(newBoard);
      
      // Heavy bonus for captures
      if (move.capturedPiece) {
        score += this.color === "white" ? 
          this.getPieceValue(move.capturedPiece[1]) : 
          -this.getPieceValue(move.capturedPiece[1]);
      }
      
      // Small bonus for checks
      if (this.moveCausesCheck(move, board, enPassantTarget)) {
        score += this.color === "white" ? 20 : -20;
      }
      
      return { move, score };
    });
    
    // Sort moves by score
    evaluatedMoves.sort((a, b) => 
      this.color === "white" ? b.score - a.score : a.score - b.score
    );
    
    // Always play one of the top 3 moves
    const topMoves = evaluatedMoves.slice(0, Math.min(3, evaluatedMoves.length));
    
    // Weighted selection
    const weights = [0.6, 0.3, 0.1];
    const random = Math.random();
    let cumulative = 0;
    
    for (let i = 0; i < topMoves.length; i++) {
      cumulative += weights[i];
      if (random < cumulative) {
        return topMoves[i].move;
      }
    }
    
    return topMoves[0].move;
  }

  evaluateBoard(board) {
    let score = super.evaluateBoard(board);
    
    // Simple center control bonus
    for (let r = 2; r <= 5; r++) {
      for (let c = 2; c <= 5; c++) {
        const piece = board[r][c];
        if (piece) {
          const bonus = (r === 3 || r === 4) && (c === 3 || c === 4) ? 20 : 10;
          score += isWhite(piece) ? bonus : -bonus;
        }
      }
    }
    
    return score;
  }
}