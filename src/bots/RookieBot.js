import { BaseBotPlayer } from "./BaseBotPlayer";

export class RookieBot extends BaseBotPlayer {
  constructor() {
    super("Rookie Riley", "black", 1);
  }

  selectMove(board, enPassantTarget, castlingRights, kingMoved, rookMoved) {
    const validMoves = this.getAllValidMoves(
      board, this.color, enPassantTarget, castlingRights, kingMoved, rookMoved
    );
    
    if (validMoves.length === 0) return null;
    
    // Always capture the highest value piece if possible
    const captures = validMoves.filter(move => move.capturedPiece);
    if (captures.length > 0) {
      captures.sort((a, b) => 
        this.getPieceValue(b.capturedPiece[1]) - this.getPieceValue(a.capturedPiece[1])
      );
      // 80% chance to take the best capture, 20% random
      if (Math.random() < 0.8) {
        return captures[0];
      }
    }
    
    // 30% chance to move towards center
    if (Math.random() < 0.3) {
      const centerMoves = validMoves.filter(move => {
        const [r, c] = move.to;
        return r >= 2 && r <= 5 && c >= 2 && c <= 5;
      });
      if (centerMoves.length > 0) {
        return centerMoves[Math.floor(Math.random() * centerMoves.length)];
      }
    }
    
    // Otherwise random move
    return validMoves[Math.floor(Math.random() * validMoves.length)];
  }
}