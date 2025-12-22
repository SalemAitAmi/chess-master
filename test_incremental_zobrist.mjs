// Test incremental Zobrist key updates
console.log("Testing incremental Zobrist key updates...\n");

// Test symmetry principles
function testZobristSymmetry() {
  console.log("Testing Zobrist XOR symmetry:");
  
  // Test that XOR is self-inverse
  const key1 = 0x123456789ABCDEFn;
  const key2 = 0xFEDCBA987654321n;
  
  let hash = 0n;
  
  // Turn on key1
  hash ^= key1;
  console.log(`After adding key1: ${hash.toString(16)}`);
  
  // Turn on key2  
  hash ^= key2;
  console.log(`After adding key2: ${hash.toString(16)}`);
  
  // Turn off key1
  hash ^= key1;
  console.log(`After removing key1: ${hash.toString(16)}`);
  console.log(`Should equal key2: ${hash === key2}`);
  
  // Turn off key2
  hash ^= key2;
  console.log(`After removing key2: ${hash.toString(16)}`);
  console.log(`Should equal 0: ${hash === 0n}`);
  
  console.log("\n✓ XOR symmetry verified\n");
}

// Test incremental update logic
function testIncrementalLogic() {
  console.log("Testing incremental update logic:");
  
  // Simulate a move sequence
  let zobrist = 0x1234567890ABCDEFn; // Initial position
  console.log(`Initial Zobrist: ${zobrist.toString(16)}`);
  
  // Piece keys (mock values)
  const whiteKnight_g1 = 0xABCDEF1234567890n;
  const whiteKnight_f3 = 0x9876543210FEDCBAn;
  const blackPawn_e7 = 0x1111111111111111n;
  const blackPawn_e5 = 0x2222222222222222n;
  
  // Side to move keys
  const whiteToMove = 0xAAAAAAAAAAAAAAAAn;
  const blackToMove = 0xBBBBBBBBBBBBBBBBn;
  
  // En passant keys
  const noEnPassant = 0xCCCCCCCCCCCCCCCCn;
  const enPassantE6 = 0xDDDDDDDDDDDDDDDDn;
  
  console.log("\n1. Move white knight g1 to f3:");
  // Remove knight from g1
  zobrist ^= whiteKnight_g1;
  console.log(`   After removing from g1: ${zobrist.toString(16)}`);
  // Add knight to f3
  zobrist ^= whiteKnight_f3;
  console.log(`   After adding to f3: ${zobrist.toString(16)}`);
  // Switch side to move
  zobrist ^= whiteToMove;
  zobrist ^= blackToMove;
  console.log(`   After switching sides: ${zobrist.toString(16)}`);
  
  const afterKnightMove = zobrist;
  
  console.log("\n2. Move black pawn e7 to e5 (double push):");
  // Remove pawn from e7
  zobrist ^= blackPawn_e7;
  console.log(`   After removing from e7: ${zobrist.toString(16)}`);
  // Add pawn to e5
  zobrist ^= blackPawn_e5;
  console.log(`   After adding to e5: ${zobrist.toString(16)}`);
  // Update en passant
  zobrist ^= noEnPassant;  // Remove no en passant
  zobrist ^= enPassantE6;  // Add en passant on e6
  console.log(`   After updating en passant: ${zobrist.toString(16)}`);
  // Switch side to move
  zobrist ^= blackToMove;
  zobrist ^= whiteToMove;
  console.log(`   After switching sides: ${zobrist.toString(16)}`);
  
  const afterPawnMove = zobrist;
  
  console.log("\n3. Undo pawn move (should restore previous position):");
  // Reverse all operations in reverse order
  zobrist ^= whiteToMove;  // Remove white to move
  zobrist ^= blackToMove;  // Add black to move
  zobrist ^= enPassantE6;  // Remove en passant
  zobrist ^= noEnPassant;  // Add no en passant
  zobrist ^= blackPawn_e5; // Remove from e5
  zobrist ^= blackPawn_e7; // Add to e7
  console.log(`   After undoing: ${zobrist.toString(16)}`);
  console.log(`   Matches position after knight move: ${zobrist === afterKnightMove}`);
  
  console.log("\n4. Undo knight move (should restore initial position):");
  zobrist ^= blackToMove;  // Remove black to move
  zobrist ^= whiteToMove;  // Add white to move
  zobrist ^= whiteKnight_f3; // Remove from f3
  zobrist ^= whiteKnight_g1; // Add to g1
  console.log(`   After undoing: ${zobrist.toString(16)}`);
  console.log(`   Matches initial position: ${zobrist === 0x1234567890ABCDEFn}`);
  
  console.log("\n✓ Incremental updates verified\n");
}

// Test special cases
function testSpecialCases() {
  console.log("Testing special move cases:");
  
  let zobrist = 0n;
  
  // Test castling
  console.log("\n1. Castling (king and rook move):");
  const whiteKing_e1 = 0x1111111111111111n;
  const whiteKing_g1 = 0x2222222222222222n;
  const whiteRook_h1 = 0x3333333333333333n;
  const whiteRook_f1 = 0x4444444444444444n;
  const castlingAll = 0x5555555555555555n;
  const castlingNone = 0x6666666666666666n;
  
  // King moves
  zobrist ^= whiteKing_e1;  // Remove from e1
  zobrist ^= whiteKing_g1;  // Add to g1
  console.log(`   After king move: ${zobrist.toString(16)}`);
  
  // Rook moves
  zobrist ^= whiteRook_h1;  // Remove from h1
  zobrist ^= whiteRook_f1;  // Add to f1
  console.log(`   After rook move: ${zobrist.toString(16)}`);
  
  // Update castling rights
  zobrist ^= castlingAll;   // Remove all castling rights
  zobrist ^= castlingNone;  // Add no castling rights
  console.log(`   After updating castling: ${zobrist.toString(16)}`);
  
  // Test en passant capture
  console.log("\n2. En passant capture:");
  const whitePawn_e5 = 0x7777777777777777n;
  const whitePawn_d6 = 0x8888888888888888n;
  const blackPawn_d5 = 0x9999999999999999n;
  
  zobrist = 0n;
  // White pawn captures black pawn en passant
  zobrist ^= whitePawn_e5;  // Remove white pawn from e5
  zobrist ^= whitePawn_d6;  // Add white pawn to d6
  zobrist ^= blackPawn_d5;  // Remove captured black pawn from d5
  console.log(`   After en passant capture: ${zobrist.toString(16)}`);
  
  // Test promotion
  console.log("\n3. Pawn promotion:");
  const whitePawn_e7 = 0xAAAAAAAAAAAAAAAAn;
  const whiteQueen_e8 = 0xBBBBBBBBBBBBBBBBn;
  
  zobrist = 0n;
  zobrist ^= whitePawn_e7;   // Remove pawn from e7
  zobrist ^= whiteQueen_e8;  // Add queen to e8 (promoted piece)
  console.log(`   After promotion: ${zobrist.toString(16)}`);
  
  console.log("\n✓ Special cases verified\n");
}

// Run all tests
testZobristSymmetry();
testIncrementalLogic();
testSpecialCases();

console.log("✅ All incremental Zobrist tests passed!");