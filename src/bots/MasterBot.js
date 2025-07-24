import { BaseBotPlayer } from "./BaseBotPlayer";
import { simulateMove, isInCheck } from "../utils/chessLogic";
import { isWhite } from "../utils/chessUtils";

export class MasterBot extends BaseBotPlayer {
  constructor() {
    super("Master Magnus", "black", 4);
    this.maxDepth = 4;
    this.maxTime = 4000;
    this.killerMoves = {};
    this.historyTable = {};
    this.openingBook = this.createOpeningBook();
  }

  createOpeningBook() {
    // Simple opening book with multiple variations
    return {
      // After 1.e4
      "e2e4": [
        { move: "e7e5", weight: 0.3 },  // e5
        { move: "c7c5", weight: 0.25 }, // Sicilian
        { move: "e7e6", weight: 0.15 }, // French
        { move: "c7c6", weight: 0.15 }, // Caro-Kann
        { move: "d7d5", weight: 0.1 },  // Scandinavian
        { move: "g8f6", weight: 0.05 }  // Alekhine
      ],
      // After 1.d4
      "d2d4": [
        { move: "d7d5", weight: 0.35 },
        { move: "g8f6", weight: 0.35 },
        { move: "e7e6", weight: 0.15 },
        { move: "f7f5", weight: 0.1 },
        { move: "c7c6", weight: 0.05 }
      ],
      // After 1.Nf3
      "g1f3": [
        { move: "d7d5", weight: 0.3 },
        { move: "g8f6", weight: 0.3 },
        { move: "c7c5", weight: 0.2 },
        { move: "e7e6", weight: 0.1 },
        { move: "g7g6", weight: 0.1 }
      ],
      // After 1.c4
      "c2c4": [
        { move: "e7e5", weight: 0.3 },
        { move: "c7c5", weight: 0.25 },
        { move: "g8f6", weight: 0.25 },
        { move: "e7e6", weight: 0.1 },
        { move: "c7c6", weight: 0.1 }
      ]
    };
  }

  selectMove(board, enPassantTarget, castlingRights, kingMoved, rookMoved) {
    this.moveCount++;
    
    // Check opening book for the first few moves
    if (this.moveCount <= 6 && this.lastOpponentMove) {
      const bookMoves = this.openingBook[this.lastOpponentMove];
      if (bookMoves) {
        // Select from book moves based on weights
        const random = Math.random();
        let cumulative = 0;
        
        for (const bookMove of bookMoves) {
          cumulative += bookMove.weight;
          if (random < cumulative) {
            // Convert algebraic notation to move
            const validMoves = this.getAllValidMoves(
              board, this.color, enPassantTarget, castlingRights, kingMoved, rookMoved
            );
            
            const move = validMoves.find(m => 
              this.moveToAlgebraic(m) === bookMove.move
            );
            
            if (move) {
              console.log(`Master Bot playing book move: ${bookMove.move}`);
              return move;
            }
            break;
          }
        }
      }
    }
    
    // Regular search
    this.positionCount = 0;
    this.killerMoves = {};
    this.historyTable = {};
    const startTime = Date.now();
    
    // Quick tactical check first
    const quickWin = this.findQuickTacticalWin(board, enPassantTarget, castlingRights, kingMoved, rookMoved);
    if (quickWin) {
      console.log(`Master Bot found quick tactical win in ${Date.now() - startTime}ms`);
      return quickWin;
    }
    
    // For non-critical positions in the opening/middlegame, add some variation
    if (this.moveCount < 20 && Math.random() < 0.15) {
      const validMoves = this.getAllValidMoves(
        board, this.color, enPassantTarget, castlingRights, kingMoved, rookMoved
      );
      const rankedMoves = this.evaluateAndRankMoves(
        board, validMoves, enPassantTarget, castlingRights, kingMoved, rookMoved
      );
      
      // Use the distribution system even for Master bot occasionally
      return this.selectMoveFromDistribution(rankedMoves);
    }
    
    // Iterative deepening with aspiration windows
    let bestMove = null;
    let bestScore = this.color === "white" ? -Infinity : Infinity;
    let alpha = -Infinity;
    let beta = Infinity;
    
    for (let depth = 1; depth <= this.maxDepth; depth++) {
      if (Date.now() - startTime > this.maxTime * 0.7) break;
      
      // Aspiration window
      if (depth > 1) {
        const window = 50;
        alpha = bestScore - window;
        beta = bestScore + window;
      }
      
      let result = this.minimax(
        board, depth, alpha, beta, this.color,
        enPassantTarget, castlingRights, kingMoved, rookMoved, startTime, 0
      );
      
      // Re-search if we fell outside the aspiration window
      if (result.score <= alpha || result.score >= beta) {
        result = this.minimax(
          board, depth, -Infinity, Infinity, this.color,
          enPassantTarget, castlingRights, kingMoved, rookMoved, startTime, 0
        );
      }
      
      if (result.move) {
        bestMove = result.move;
        bestScore = result.score;
        
        // If we found a forced mate, stop searching
        if (Math.abs(result.score) > 15000) {
          console.log(`Master Bot found mate in ${(20000 - Math.abs(result.score)) / 2} moves`);
          break;
        }
      }
    }
    
    const timeElapsed = Date.now() - startTime;
    console.log(`Master Bot evaluated ${this.positionCount} positions in ${timeElapsed}ms (score: ${bestScore})`);
    
    return bestMove;
  }

  moveToAlgebraic(move) {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    return files[move.from[1]] + (8 - move.from[0]) + 
           files[move.to[1]] + (8 - move.to[0]);
  }

  // Track opponent moves for opening book
  setLastOpponentMove(move) {
    if (move) {
      this.lastOpponentMove = this.moveToAlgebraic(move);
    }
  }

  findQuickTacticalWin(board, enPassantTarget, castlingRights, kingMoved, rookMoved) {
    const moves = this.getAllValidMoves(board, this.color, enPassantTarget, castlingRights, kingMoved, rookMoved);
    const orderedMoves = this.orderMovesAdvanced(moves, board, this.color, 0);
    
    for (const move of orderedMoves.slice(0, 10)) {
      const { board: newBoard } = simulateMove(
        move.from[0], move.from[1], move.to[0], move.to[1], board, enPassantTarget
      );
      
      const opponentColor = this.color === "white" ? "black" : "white";
      
      // Check for immediate checkmate
      if (isInCheck(newBoard, opponentColor)) {
        const gameState = this.updateGameState(
          move, move.piece, isWhite(move.piece), castlingRights, kingMoved, rookMoved
        );
        
        const opponentMoves = this.getAllValidMoves(
          newBoard, opponentColor, gameState.enPassantTarget, 
          gameState.castlingRights, gameState.kingMoved, gameState.rookMoved
        );
        if (opponentMoves.length === 0) {
          return move;
        }
      }
      
      // Check for winning material gain
      if (move.capturedPiece) {
        const captureValue = this.getPieceValue(move.capturedPiece[1]);
        const attackerValue = this.getPieceValue(move.piece[1]);
        
        if (captureValue - attackerValue >= 200) {
          const gameState = this.updateGameState(
            move, move.piece, isWhite(move.piece), castlingRights, kingMoved, rookMoved
          );
          
          const responses = this.getAllValidMoves(
            newBoard, opponentColor, gameState.enPassantTarget,
            gameState.castlingRights, gameState.kingMoved, gameState.rookMoved
          );
          
          let isSafe = true;
          for (const response of responses) {
            if (response.to[0] === move.to[0] && response.to[1] === move.to[1]) {
              if (this.getPieceValue(response.piece[1]) < captureValue) {
                isSafe = false;
                break;
              }
            }
          }
          
          if (isSafe) return move;
        }
      }
    }
    
    return null;
  }

  minimax(board, depth, alpha, beta, currentColor, enPassantTarget, castlingRights, kingMoved, rookMoved, startTime, ply) {
    this.positionCount++;
    
    if (Date.now() - startTime > this.maxTime) {
      return { score: this.evaluateBoard(board), move: null };
    }
    
    if (ply > 0 && this.isDraw(board, currentColor, enPassantTarget, castlingRights, kingMoved, rookMoved)) {
      return { score: 0, move: null };
    }
    
    const moves = this.getAllValidMoves(board, currentColor, enPassantTarget, castlingRights, kingMoved, rookMoved);
    
    if (moves.length === 0) {
      if (isInCheck(board, currentColor)) {
        const mateScore = currentColor === "white" ? -20000 + ply : 20000 - ply;
        return { score: mateScore, move: null };
      } else {
        return { score: 0, move: null };
      }
    }
    
    if (depth >= 3 && !isInCheck(board, currentColor) && ply > 0) {
      const nullMoveResult = this.minimax(
        board, depth - 3, -beta, -beta + 1, 
        currentColor === "white" ? "black" : "white",
        null, castlingRights, kingMoved, rookMoved, startTime, ply + 1
      );
      
      if (currentColor === "white" && -nullMoveResult.score >= beta) return { score: beta, move: null };
      if (currentColor === "black" && -nullMoveResult.score <= alpha) return { score: alpha, move: null };
    }
    
    if (depth === 0) {
      const score = this.quiescence(board, alpha, beta, currentColor, enPassantTarget, castlingRights, kingMoved, rookMoved, 0);
      return { score, move: null };
    }
    
    const orderedMoves = this.orderMovesAdvanced(moves, board, currentColor, ply);
    
    let bestMove = null;
    let bestScore = currentColor === "white" ? -Infinity : Infinity;
    
    for (let i = 0; i < orderedMoves.length; i++) {
      const move = orderedMoves[i];
      
      let searchDepth = depth - 1;
      if (i > 3 && depth >= 3 && !move.capturedPiece && !this.moveCausesCheck(move, board, enPassantTarget)) {
        searchDepth = depth - 2;
        if (i > 10 && depth >= 4) {
          searchDepth = depth - 3;
        }
      }
      
      const { board: newBoard } = simulateMove(
        move.from[0], move.from[1], move.to[0], move.to[1], board, enPassantTarget
      );
      
      const gameState = this.updateGameState(
        move, move.piece, isWhite(move.piece), castlingRights, kingMoved, rookMoved
      );
      
      const result = this.minimax(
        newBoard, searchDepth, alpha, beta, currentColor === "white" ? "black" : "white",
        gameState.enPassantTarget, gameState.castlingRights, gameState.kingMoved, gameState.rookMoved,
        startTime, ply + 1
      );
      
      if (!move.capturedPiece) {
        const moveKey = `${move.from[0]},${move.from[1]}-${move.to[0]},${move.to[1]}`;
        this.historyTable[moveKey] = (this.historyTable[moveKey] || 0) + depth * depth;
      }
      
      if (currentColor === "white") {
        if (result.score > bestScore) {
          bestScore = result.score;
          bestMove = move;
          
          if (!move.capturedPiece && bestScore >= beta) {
            if (!this.killerMoves[ply]) this.killerMoves[ply] = [];
            this.killerMoves[ply].unshift(move);
            if (this.killerMoves[ply].length > 2) this.killerMoves[ply].pop();
          }
        }
        alpha = Math.max(alpha, bestScore);
      } else {
        if (result.score < bestScore) {
          bestScore = result.score;
          bestMove = move;
          
          if (!move.capturedPiece && bestScore <= alpha) {
            if (!this.killerMoves[ply]) this.killerMoves[ply] = [];
            this.killerMoves[ply].unshift(move);
            if (this.killerMoves[ply].length > 2) this.killerMoves[ply].pop();
          }
        }
        beta = Math.min(beta, bestScore);
      }
      
      if (beta <= alpha) {
        break;
      }
    }
    
    return { score: bestScore, move: bestMove };
  }

  orderMovesAdvanced(moves, board, currentColor, ply) {
    const killers = this.killerMoves[ply] || [];
    
    return moves.sort((a, b) => {
      let aScore = 0;
      let bScore = 0;
      
      if (a.capturedPiece) {
        const seeA = this.getPieceValue(a.capturedPiece[1]) - this.getPieceValue(a.piece[1]) / 10;
        aScore += 10000 + seeA;
      }
      if (b.capturedPiece) {
        const seeB = this.getPieceValue(b.capturedPiece[1]) - this.getPieceValue(b.piece[1]) / 10;
        bScore += 10000 + seeB;
      }
      
      for (let i = 0; i < killers.length; i++) {
        const killer = killers[i];
        if (killer && a.from[0] === killer.from[0] && a.from[1] === killer.from[1] &&
            a.to[0] === killer.to[0] && a.to[1] === killer.to[1]) {
          aScore += 9000 - i * 100;
        }
        if (killer && b.from[0] === killer.from[0] && b.from[1] === killer.from[1] &&
            b.to[0] === killer.to[0] && b.to[1] === killer.to[1]) {
          bScore += 9000 - i * 100;
        }
      }
      
      if (this.moveCausesCheck(a, board, null)) aScore += 5000;
      if (this.moveCausesCheck(b, board, null)) bScore += 5000;
      
      if (a.piece[1] === 'p' && (a.to[0] === 0 || a.to[0] === 7)) aScore += 8000;
      if (b.piece[1] === 'p' && (b.to[0] === 0 || b.to[0] === 7)) bScore += 8000;
      
      const aMoveKey = `${a.from[0]},${a.from[1]}-${a.to[0]},${a.to[1]}`;
      const bMoveKey = `${b.from[0]},${b.from[1]}-${b.to[0]},${b.to[1]}`;
      aScore += this.historyTable[aMoveKey] || 0;
      bScore += this.historyTable[bMoveKey] || 0;
      
      if (a.piece[1] === 'k' && Math.abs(a.from[1] - a.to[1]) === 2) aScore += 100;
      if (b.piece[1] === 'k' && Math.abs(b.from[1] - b.to[1]) === 2) bScore += 100;
      
      return bScore - aScore;
    });
  }

  evaluateBoard(board) {
    let score = 0;
    
    let whiteMaterial = 0;
    let blackMaterial = 0;
    let whiteMinorPieces = 0;
    let blackMinorPieces = 0;
    
    const pieceCounts = {
      white: { p: 0, n: 0, b: 0, r: 0, q: 0 },
      black: { p: 0, n: 0, b: 0, r: 0, q: 0 }
    };
    
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece) {
          const pieceType = piece[1];
          const value = this.getPieceValue(pieceType);
          
          if (isWhite(piece)) {
            whiteMaterial += value;
            pieceCounts.white[pieceType]++;
            if (pieceType === 'n' || pieceType === 'b') whiteMinorPieces++;
          } else {
            blackMaterial += value;
            pieceCounts.black[pieceType]++;
            if (pieceType === 'n' || pieceType === 'b') blackMinorPieces++;
          }
          
          score += isWhite(piece) ? value : -value;
        }
      }
    }
    
    const totalMaterial = whiteMaterial + blackMaterial;
    const gamePhase = Math.min(24, whiteMinorPieces + blackMinorPieces + 
                               (pieceCounts.white.q + pieceCounts.black.q) * 4 +
                               (pieceCounts.white.r + pieceCounts.black.r) * 2);
    const endgameWeight = 1 - gamePhase / 24;
    
    score += this.evaluatePieceSquareTables(board, endgameWeight);
    score += this.evaluatePawnStructure(board, pieceCounts);
    score += this.evaluatePieceCoordination(board, pieceCounts);
    score += this.evaluateKingSafety(board, endgameWeight);
    
    if (totalMaterial < 3000) {
      score += this.evaluateEndgame(board, pieceCounts);
    }
    
    return score;
  }

  evaluatePieceSquareTables(board, endgameWeight) {
    let score = 0;
    
    const mgTables = {
      p: [
        [ 0,  0,  0,  0,  0,  0,  0,  0],
        [98,134, 61, 95, 68,126, 34,-11],
        [-6,  7, 26, 31, 65, 56, 25,-20],
        [-14, 13,  6, 21, 23, 12, 17,-23],
        [-27, -2, -5,  12, 17,  6, 10,-25],
        [-26, -4, -4,-10,  3,  3, 33,-12],
        [-35, -1,-20,-23,-15, 24, 38,-22],
        [ 0,  0,  0,  0,  0,  0,  0,  0]
      ],
      n: [
        [-167,-89,-34,-49, 61,-97,-15,-107],
        [-73,-41, 72, 36, 23, 62,  7, -17],
        [-47, 60, 37, 65, 84,129, 73,  44],
        [ -9, 17, 19, 53, 37, 69, 18,  22],
        [-13,  4, 16, 13, 28, 19, 21,  -8],
        [-23, -9, 12, 10, 19, 17, 25, -16],
        [-29,-53,-12, -3, -1, 18,-14, -19],
        [-105,-21,-58,-33,-17,-28,-19, -23]
      ],
      b: [
        [-29,  4,-82,-37,-25,-42,  7, -8],
        [-26, 16,-18,-13, 30, 59, 18,-47],
        [-16, 37, 43, 40, 35, 50, 37, -2],
        [ -4,  5, 19, 50, 37, 37,  7, -2],
        [ -6, 13, 13, 26, 34, 12, 10,  4],
        [  0, 15, 15, 15, 14, 27, 18, 10],
        [  4, 15, 16,  0,  7, 21, 33,  1],
        [-33, -3,-14,-21,-13,-12,-39,-21]
      ],
      r: [
        [ 32, 42, 32, 51, 63,  9, 31, 43],
        [ 27, 32, 58, 62, 80, 67, 26, 44],
        [ -5, 19, 26, 36, 17, 45, 61, 16],
        [-24,-11,  7, 26, 24, 35, -8,-20],
        [-36,-26,-12, -1,  9, -7,  6,-23],
        [-45,-25,-16,-17,  3,  0, -5,-33],
        [-44,-16,-20, -9, -1, 11, -6,-71],
        [-19,-13,  1, 17, 16,  7,-37,-26]
      ],
      q: [
        [-28,  0, 29, 12, 59, 44, 43, 45],
        [-24,-39, -5,  1,-16, 57, 28, 54],
        [-13,-17,  7,  8, 29, 56, 47, 57],
        [-27,-27,-16,-16, -1, 17, -2,  1],
        [ -9,-26, -9,-10, -2, -4,  3, -3],
        [-14,  2,-11, -2, -5,  2, 14,  5],
        [-35, -8, 11,  2,  8, 15, -3,  1],
        [ -1,-18, -9, 10,-15,-25,-31,-50]
      ],
      k: [
        [-65, 23, 16,-15,-56,-34,  2, 13],
        [ 29, -1,-20, -7, -8, -4,-38,-29],
        [ -9, 24,  2,-16,-20,  6, 22,-22],
        [-17,-20,-12,-27,-30,-25,-14,-36],
        [-49, -1,-27,-39,-46,-44,-33,-51],
        [-14,-14,-22,-46,-44,-30,-15,-27],
        [  1,  7, -8,-64,-43,-16,  9,  8],
        [-15, 36, 12,-54,  8,-28, 24, 14]
      ]
    };
    
    const egTables = {
      p: [
        [  0,  0,  0,  0,  0,  0,  0,  0],
        [178,173,158,134,147,132,165,187],
        [ 94,100, 85, 67, 56, 53, 82, 84],
        [ 32, 24, 13,  5, -2,  4, 17, 17],
        [ 13,  9, -3, -7, -7, -8,  3, -1],
        [  4,  7, -6,  1,  0, -5, -1, -8],
        [ 13,  8,  8, 10, 13,  0,  2, -7],
        [  0,  0,  0,  0,  0,  0,  0,  0]
      ],
      n: [
        [-58,-38,-13,-28,-31,-27,-63,-99],
        [-25, -8,-25, -2, -9,-25,-24,-52],
        [-24,-20, 10,  9, -1, -9,-19,-41],
        [-17,  3, 22, 22, 22, 11,  8,-18],
        [-18, -6, 16, 25, 16, 17,  4,-18],
        [-23, -3, -1, 15, 10, -3,-20,-22],
        [-42,-20,-10, -5, -2,-20,-23,-44],
        [-29,-51,-23,-15,-22,-18,-50,-64]
      ],
      b: [
        [-14,-21,-11, -8, -7, -9,-17,-24],
        [ -8, -4,  7,-12, -3,-13, -4,-14],
        [  2, -8,  0, -1, -2,  6,  0,  4],
        [ -3,  9, 12,  9, 14, 10,  3,  2],
        [ -6,  3, 13, 19,  7, 10, -3, -9],
        [-12, -3,  8, 10, 13,  3, -7,-15],
        [-14,-18, -7, -1,  4, -9,-15,-27],
        [-23, -9,-23, -5, -9,-16, -5,-17]
      ],
      r: [
        [ 13, 10, 18, 15, 12, 12,  8,  5],
        [ 11, 13, 13, 11, -3,  3,  8,  3],
        [  7,  7,  7,  5,  4, -3, -5, -3],
        [  4,  3, 13,  1,  2,  1, -1,  2],
        [  3,  5,  8,  4, -5, -6, -8,-11],
        [ -4,  0, -5, -1, -7,-12, -8,-16],
        [ -6,  6,  0,  2, -9, -9,-11, -3],
        [ -9,  2,  3, -1, -5,-13,  4,-20]
      ],
      q: [
        [ -9, 22, 22, 27, 27, 19, 10, 20],
        [-17, 20, 32, 41, 58, 25, 30,  0],
        [-20,  6,  9, 49, 47, 35, 19,  9],
        [  3, 22, 24, 45, 57, 40, 57, 36],
        [-18, 28, 19, 47, 31, 34, 39, 23],
        [-16,-27, 15,  6,  9, 17, 10,  5],
        [-22,-23,-30,-16,-16,-23,-36,-32],
        [-33,-28,-22,-43, -5,-32,-20,-41]
      ],
      k: [
        [-74,-35,-18,-18,-11, 15,  4,-17],
        [-12, 17, 14, 17, 17, 38, 23, 11],
        [ 10, 17, 23, 15, 20, 45, 44, 13],
        [ -8, 22, 24, 27, 26, 33, 26,  3],
        [-18, -4, 21, 24, 27, 23,  9,-11],
        [-19, -3, 11, 21, 23, 16,  7, -9],
        [-27,-11,  4, 13, 14,  4, -5,-17],
        [-53,-34,-21,-11,-28,-14,-24,-43]
      ]
    };
    
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && piece[1] !== 'k') {
          const pieceType = piece[1];
          const row = isWhite(piece) ? 7 - r : r;
          
          if (mgTables[pieceType] && egTables[pieceType]) {
            const mgValue = mgTables[pieceType][row][c];
            const egValue = egTables[pieceType][row][c];
            const interpolated = mgValue * (1 - endgameWeight) + egValue * endgameWeight;
            score += isWhite(piece) ? interpolated : -interpolated;
          }
        }
      }
    }
    
    return score;
  }

  evaluatePawnStructure(board, pieceCounts) {
    let score = 0;
    
    const pawnFiles = { white: new Array(8).fill(0), black: new Array(8).fill(0) };
    const passedPawns = { white: [], black: [] };
    
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && piece[1] === 'p') {
          const color = isWhite(piece) ? 'white' : 'black';
          pawnFiles[color][c]++;
          
          let isPassed = true;
          if (isWhite(piece)) {
            for (let checkR = r - 1; checkR >= 0; checkR--) {
              for (let checkC = Math.max(0, c - 1); checkC <= Math.min(7, c + 1); checkC++) {
                if (board[checkR][checkC] === 'bp') {
                  isPassed = false;
                  break;
                }
              }
              if (!isPassed) break;
            }
          } else {
            for (let checkR = r + 1; checkR < 8; checkR++) {
              for (let checkC = Math.max(0, c - 1); checkC <= Math.min(7, c + 1); checkC++) {
                if (board[checkR][checkC] === 'wp') {
                  isPassed = false;
                  break;
                }
              }
              if (!isPassed) break;
            }
          }
          
          if (isPassed) {
            passedPawns[color].push({ row: r, col: c });
          }
        }
      }
    }
    
    for (let c = 0; c < 8; c++) {
      if (pawnFiles.white[c] > 1) score -= 10 * (pawnFiles.white[c] - 1);
      if (pawnFiles.black[c] > 1) score += 10 * (pawnFiles.black[c] - 1);
      
      const whiteIsolated = pawnFiles.white[c] > 0 && 
        (c === 0 || pawnFiles.white[c-1] === 0) && 
        (c === 7 || pawnFiles.white[c+1] === 0);
      const blackIsolated = pawnFiles.black[c] > 0 && 
        (c === 0 || pawnFiles.black[c-1] === 0) && 
        (c === 7 || pawnFiles.black[c+1] === 0);
        
      if (whiteIsolated) score -= 15;
      if (blackIsolated) score += 15;
    }
    
    const passedPawnBonus = [0, 10, 20, 40, 70, 110, 160, 0];
    passedPawns.white.forEach(pawn => {
      score += passedPawnBonus[7 - pawn.row];
      const kingPos = this.findKing(board, 'white');
      if (kingPos) {
        const kingDistance = Math.max(Math.abs(kingPos[0] - pawn.row), Math.abs(kingPos[1] - pawn.col));
        score += Math.max(0, 5 - kingDistance) * 5;
      }
    });
    
    passedPawns.black.forEach(pawn => {
      score -= passedPawnBonus[pawn.row];
      const kingPos = this.findKing(board, 'black');
      if (kingPos) {
        const kingDistance = Math.max(Math.abs(kingPos[0] - pawn.row), Math.abs(kingPos[1] - pawn.col));
        score -= Math.max(0, 5 - kingDistance) * 5;
      }
    });
    
    return score;
  }

  evaluatePieceCoordination(board, pieceCounts) {
    let score = 0;
    
    if (pieceCounts.white.b >= 2) score += 50;
    if (pieceCounts.black.b >= 2) score -= 50;
    
    for (let c = 0; c < 8; c++) {
      let hasWhitePawn = false;
      let hasBlackPawn = false;
      let whiteRookOnFile = false;
      let blackRookOnFile = false;
      
      for (let r = 0; r < 8; r++) {
        const piece = board[r][c];
        if (piece) {
          if (piece === 'wp') hasWhitePawn = true;
          if (piece === 'bp') hasBlackPawn = true;
          if (piece === 'wr') whiteRookOnFile = true;
          if (piece === 'br') blackRookOnFile = true;
        }
      }
      
      if (whiteRookOnFile && !hasWhitePawn) {
        score += hasBlackPawn ? 20 : 40;
      }
      if (blackRookOnFile && !hasBlackPawn) {
        score -= hasWhitePawn ? 20 : 40;
      }
    }
    
    for (let r = 0; r < 8; r++) {
      let whiteRooks = 0;
      let blackRooks = 0;
      for (let c = 0; c < 8; c++) {
        if (board[r][c] === 'wr') whiteRooks++;
        if (board[r][c] === 'br') blackRooks++;
      }
      if (whiteRooks >= 2) score += 20;
      if (blackRooks >= 2) score -= 20;
    }
    
    return score;
  }

  evaluateKingSafety(board, endgameWeight) {
    if (endgameWeight > 0.7) return 0;
    
    let score = 0;
    const kingSafetyWeight = 1 - endgameWeight;
    
    const whiteKing = this.findKing(board, 'white');
    const blackKing = this.findKing(board, 'black');
    
    if (whiteKing) {
      const [kr, kc] = whiteKing;
      let safety = 0;
      
      if (kr >= 6) {
        for (let c = Math.max(0, kc - 1); c <= Math.min(7, kc + 1); c++) {
          if (board[kr-1] && board[kr-1][c] === 'wp') safety += 10;
          if (board[kr-2] && board[kr-2][c] === 'wp') safety += 5;
        }
      }
      
      for (let c = Math.max(0, kc - 1); c <= Math.min(7, kc + 1); c++) {
        let hasPawn = false;
        for (let r = 0; r < 8; r++) {
          if (board[r][c] && board[r][c][1] === 'p') {
            hasPawn = true;
            break;
          }
        }
        if (!hasPawn) safety -= 20;
      }
      
      score += safety * kingSafetyWeight;
    }
    
    if (blackKing) {
      const [kr, kc] = blackKing;
      let safety = 0;
      
      if (kr <= 1) {
        for (let c = Math.max(0, kc - 1); c <= Math.min(7, kc + 1); c++) {
          if (board[kr+1] && board[kr+1][c] === 'bp') safety += 10;
          if (board[kr+2] && board[kr+2][c] === 'bp') safety += 5;
        }
      }
      
      for (let c = Math.max(0, kc - 1); c <= Math.min(7, kc + 1); c++) {
        let hasPawn = false;
        for (let r = 0; r < 8; r++) {
          if (board[r][c] && board[r][c][1] === 'p') {
            hasPawn = true;
            break;
          }
        }
        if (!hasPawn) safety -= 20;
      }
      
      score -= safety * kingSafetyWeight;
    }
    
    return score;
  }

  evaluateEndgame(board, pieceCounts) {
    let score = 0;
    
    const whiteKing = this.findKing(board, 'white');
    const blackKing = this.findKing(board,

 'black');
    
    if (whiteKing) {
      const centerDistance = Math.abs(whiteKing[0] - 3.5) + Math.abs(whiteKing[1] - 3.5);
      score += (7 - centerDistance) * 10;
    }
    
    if (blackKing) {
      const centerDistance = Math.abs(blackKing[0] - 3.5) + Math.abs(blackKing[1] - 3.5);
      score -= (7 - centerDistance) * 10;
    }
    
    const totalPieces = Object.values(pieceCounts.white).reduce((a, b) => a + b, 0) +
                       Object.values(pieceCounts.black).reduce((a, b) => a + b, 0);
    
    if (pieceCounts.white.b === 1 && pieceCounts.white.n === 1 && 
        pieceCounts.black.p === 0 && totalPieces === 3) {
      if (blackKing) {
        const cornerDistance = Math.min(
          blackKing[0] + blackKing[1],
          blackKing[0] + (7 - blackKing[1]),
          (7 - blackKing[0]) + blackKing[1],
          (7 - blackKing[0]) + (7 - blackKing[1])
        );
        score += (14 - cornerDistance) * 50;
      }
    }
    
    return score;
  }

  findKing(board, color) {
    const kingPiece = color === 'white' ? 'wk' : 'bk';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c] === kingPiece) {
          return [r, c];
        }
      }
    }
    return null;
  }
}