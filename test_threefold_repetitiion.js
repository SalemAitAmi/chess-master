// Test script for threefold repetition
import { Board } from './src/utils/boardStructure.js';
import { HumanPlayer } from './src/players/Player.js';

// Helper function to make moves in algebraic notation
function makeTestMove(board, from, to) {
  const fromFile = from.charCodeAt(0) - 'a'.charCodeAt(0);
  const fromRank = parseInt(from[1]) - 1;
  const toFile = to.charCodeAt(0) - 'a'.charCodeAt(0);
  const toRank = parseInt(to[1]) - 1;
  
  const fromSquare = fromRank * 8 + fromFile;
  const toSquare = toRank * 8 + toFile;
  
  return board.makeMove(fromSquare, toSquare);
}

function testThreefoldRepetition() {
  console.log("Testing threefold repetition detection...\n");
  
  // Create a new board
  const board = new Board();
  const whitePlayer = new HumanPlayer("white", board);
  const blackPlayer = new HumanPlayer("black", board);
  
  console.log("Initial Zobrist key:", board.gameState.zobrist_key.toString(16));
  
  // Create a simple repetition pattern with knight moves
  console.log("\nCreating repetition pattern with knight moves:");
  
  // Position 1 (initial)
  const initialZobrist = board.gameState.zobrist_key;
  console.log("Position 1 - Initial position, Zobrist:", initialZobrist.toString(16));
  
  // Move 1: White knight g1-f3
  makeTestMove(board, 'g1', 'f3');
  console.log("After Ng1-f3, Zobrist:", board.gameState.zobrist_key.toString(16));
  
  // Move 2: Black knight b8-c6
  makeTestMove(board, 'b8', 'c6');
  console.log("After Nb8-c6, Zobrist:", board.gameState.zobrist_key.toString(16));
  
  // Move 3: White knight f3-g1 (back)
  makeTestMove(board, 'f3', 'g1');
  console.log("After Nf3-g1, Zobrist:", board.gameState.zobrist_key.toString(16));
  
  // Move 4: Black knight c6-b8 (back)
  makeTestMove(board, 'c6', 'b8');
  const secondZobrist = board.gameState.zobrist_key;
  console.log("Position 2 - Back to initial, Zobrist:", secondZobrist.toString(16));
  console.log("Position 2 matches Position 1:", initialZobrist === secondZobrist);
  
  // Check for draw (should be false - only 2 repetitions)
  console.log("\nAfter 2nd occurrence - Is draw?", whitePlayer.isDraw());
  
  // Move 5: White knight g1-f3 (again)
  makeTestMove(board, 'g1', 'f3');
  console.log("After Ng1-f3, Zobrist:", board.gameState.zobrist_key.toString(16));
  
  // Move 6: Black knight b8-c6 (again)
  makeTestMove(board, 'b8', 'c6');
  console.log("After Nb8-c6, Zobrist:", board.gameState.zobrist_key.toString(16));
  
  // Move 7: White knight f3-g1 (back again)
  makeTestMove(board, 'f3', 'g1');
  console.log("After Nf3-g1, Zobrist:", board.gameState.zobrist_key.toString(16));
  
  // Move 8: Black knight c6-b8 (back again)
  makeTestMove(board, 'c6', 'b8');
  const thirdZobrist = board.gameState.zobrist_key;
  console.log("Position 3 - Back to initial again, Zobrist:", thirdZobrist.toString(16));
  console.log("Position 3 matches Position 1:", initialZobrist === thirdZobrist);
  
  // Check for draw (should be true - 3 repetitions)
  console.log("\nAfter 3rd occurrence - Is draw?", whitePlayer.isDraw());
  
  // Print history length and positions
  console.log("\nHistory length:", board.history.states.length);
  console.log("Zobrist keys in history:");
  for (let i = 0; i < board.history.states.length; i++) {
    const state = board.history.states[i];
    console.log(`  Position ${i}: ${state.zobrist_key.toString(16)} (${state.active_color} to move)`);
  }
}

// Run the test
testThreefoldRepetition();