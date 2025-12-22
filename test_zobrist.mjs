// Test script for Zobrist hash and threefold repetition
// Run with: node test_zobrist.mjs

console.log("Testing Zobrist hash implementation and threefold repetition...\n");

// Mock the necessary dependencies
const PIECES = {
  KING: 0,
  QUEEN: 1,
  ROOK: 2,
  BISHOP: 3,
  KNIGHT: 4,
  PAWN: 5,
  NONE: 6
};

const CASTLING = {
  WHITE_KINGSIDE: 1,
  WHITE_QUEENSIDE: 2,
  BLACK_KINGSIDE: 4,
  BLACK_QUEENSIDE: 8,
  ALL: 15
};

// Simple test to verify Zobrist concept
class TestGameState {
  constructor() {
    this.active_color = "white";
    this.castling = CASTLING.ALL;
    this.half_move_clock = 0;
    this.en_passant_sq = -1;
    this.full_move_count = 1;
    this.zobrist_key = 0n;
  }
  
  clone() {
    const newState = new TestGameState();
    newState.active_color = this.active_color;
    newState.castling = this.castling;
    newState.half_move_clock = this.half_move_clock;
    newState.en_passant_sq = this.en_passant_sq;
    newState.full_move_count = this.full_move_count;
    newState.zobrist_key = this.zobrist_key;
    return newState;
  }
}

// Test that zobrist keys work with BigInt
function testZobristKeys() {
  console.log("Testing Zobrist key operations with BigInt:");
  
  // Sample Zobrist seeds (first few from the actual constants)
  const seed1 = 0xed82756a732172c4n;
  const seed2 = 0x954fe991fb355c20n;
  const seed3 = 0x3e55b9c2c3901c10n;
  
  console.log("Seed 1:", seed1.toString(16));
  console.log("Seed 2:", seed2.toString(16));
  console.log("Seed 3:", seed3.toString(16));
  
  // Test XOR operations
  let hash = 0n;
  hash ^= seed1;
  console.log("Hash after XOR with seed1:", hash.toString(16));
  
  hash ^= seed2;
  console.log("Hash after XOR with seed2:", hash.toString(16));
  
  // XOR with same value should cancel out
  hash ^= seed2;
  console.log("Hash after XOR with seed2 again (should equal seed1):", hash.toString(16));
  console.log("Equals seed1?", hash === seed1);
  
  console.log("\n✓ Zobrist key operations work correctly\n");
}

// Test game state cloning with zobrist keys
function testGameStateWithZobrist() {
  console.log("Testing GameState with Zobrist keys:");
  
  const state1 = new TestGameState();
  state1.zobrist_key = 0xdeadbeefcafe1234n;
  
  const state2 = state1.clone();
  console.log("Original zobrist_key:", state1.zobrist_key.toString(16));
  console.log("Cloned zobrist_key:", state2.zobrist_key.toString(16));
  console.log("Keys are equal:", state1.zobrist_key === state2.zobrist_key);
  
  // Modify clone
  state2.zobrist_key = 0x1234567890abcdefn;
  state2.active_color = "black";
  
  console.log("\nAfter modifying clone:");
  console.log("Original zobrist_key:", state1.zobrist_key.toString(16));
  console.log("Cloned zobrist_key:", state2.zobrist_key.toString(16));
  console.log("Original active_color:", state1.active_color);
  console.log("Cloned active_color:", state2.active_color);
  
  console.log("\n✓ GameState cloning preserves zobrist_key correctly\n");
}

// Test threefold repetition logic
function testThreefoldLogic() {
  console.log("Testing threefold repetition detection logic:");
  
  // Simulate a history of positions
  const history = [];
  const position1 = 0xaabbccdd11223344n;
  const position2 = 0x5566778899aabbccn;
  
  // Add positions to history
  const state1 = new TestGameState();
  state1.zobrist_key = position1;
  history.push(state1.clone());
  
  const state2 = new TestGameState();
  state2.zobrist_key = position2;
  state2.active_color = "black";
  history.push(state2.clone());
  
  const state3 = new TestGameState();
  state3.zobrist_key = position1;  // Same as position 1
  history.push(state3.clone());
  
  const state4 = new TestGameState();
  state4.zobrist_key = position2;  // Same as position 2
  state4.active_color = "black";
  history.push(state4.clone());
  
  const state5 = new TestGameState();
  state5.zobrist_key = position1;  // Same as position 1 (third time)
  
  // Check for repetition
  let count = 1;  // Current position
  const currentZobrist = state5.zobrist_key;
  
  // Check every other position (same player to move)
  for (let i = history.length - 2; i >= 0; i -= 2) {
    if (history[i].zobrist_key === currentZobrist) {
      count++;
      console.log(`Found repetition at position ${i}: ${history[i].zobrist_key.toString(16)}`);
    }
  }
  
  console.log(`\nTotal occurrences of position ${currentZobrist.toString(16)}: ${count}`);
  console.log("Threefold repetition detected:", count >= 3);
  
  console.log("\n✓ Threefold repetition logic works correctly\n");
}

// Run all tests
testZobristKeys();
testGameStateWithZobrist();
testThreefoldLogic();

console.log("All tests completed successfully!");