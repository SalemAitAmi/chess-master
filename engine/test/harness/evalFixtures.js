/**
 * Evaluation test fixtures — pre-built board states for targeted testing.
 * 
 * These avoid the overhead of parsing FENs and playing moves in every test.
 * Each fixture is a function that returns a fresh Board instance.
 */

import { Board } from '../../src/core/board.js';
import { generateAllLegalMoves } from '../../src/core/moveGeneration.js';

/**
 * Create a board and play a sequence of moves.
 * Throws with detailed context if any move is illegal.
 */
export function boardAfterMoves(startFen, moves) {
  const board = Board.fromFen(startFen);
  
  for (let i = 0; i < moves.length; i++) {
    const alg = moves[i];
    const legal = generateAllLegalMoves(board, board.gameState.activeColor);
    const m = legal.find(x => x.algebraic === alg);
    
    if (!m) {
      throw new Error(
        `evalFixtures: '${alg}' illegal at ply ${i} (${board.toFen()})\n` +
        `  sequence so far: ${moves.slice(0, i).join(' ')}\n` +
        `  legal here: ${legal.map(x => x.algebraic).sort().join(' ')}\n` +
        `  hint: check that the piece can reach this square and it's not blocked`
      );
    }
    
    board.makeMove(m.fromSquare, m.toSquare, m.promotionPiece);
  }
  
  return board;
}

/**
 * Common test positions as FEN strings.
 * Use these for direct Board.fromFen() calls when you don't need move sequences.
 */
export const FENS = {
  // Starting position
  startpos: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  
  // Development test positions
  knightsOnStarting: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1',
  knightsDeveloped: 'rnbqkbnr/pppppppp/8/8/4P3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 0 1',
  
  whiteHasCastled: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 5 5',
  whiteNotCastled: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
  
  // Pawn structure test positions
  normalPawns: '4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1',
  doubledEFile: '4k3/pppppppp/8/8/4P3/4P3/PPPP1PPP/4K3 w - - 0 1',
  isolatedDPawn: '4k3/ppp1pppp/8/8/3P4/8/PPP1PPPP/4K3 w - - 0 1',
  passedPawnRank6: '4k3/8/4P3/8/8/8/8/4K3 w - - 0 1',
  passedPawnRank3: '4k3/8/8/8/8/4P3/8/4K3 w - - 0 1',
  
  // King safety test positions
  safeKingCastled: 'r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w - - 6 6',
  exposedKingCenter: 'r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQ - 4 4',
  
  // Endgame positions
  krkBasic: '8/8/8/4k3/8/8/4K3/7R w - - 0 1',
  kqkBasic: '8/8/8/4k3/8/8/4K3/7Q w - - 0 1',
  pawnEndgame: '4k3/8/8/8/8/4P3/8/4K3 w - - 0 1',
};

// Re-export Board for convenience
export { Board };