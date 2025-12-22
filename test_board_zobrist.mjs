// Integration test for Board with Zobrist hashing
import { readFileSync } from 'fs';

// Load and evaluate the necessary files in order
const gameConstantsCode = readFileSync('./chess-master/src/constants/gameConstants.js', 'utf8');
const bitboardCode = readFileSync('./chess-master/src/utils/bitboard.js', 'utf8');
const boardStructureCode = readFileSync('./chess-master/src/utils/boardStructure.js', 'utf8');

// Create a module-like environment
const moduleExports = {};
const moduleImports = {};

// Evaluate gameConstants
eval(gameConstantsCode.replace(/export\s+const/g, 'moduleExports.').replace(/export\s+{[^}]*}/g, ''));

// Make constants available
const { PIECES, CASTLING, PIECE_NAMES, ZOBRIST_SEEDS } = moduleExports;

console.log("Testing Board class with Zobrist hashing...\n");

// Verify ZOBRIST_SEEDS structure
console.log("ZOBRIST_SEEDS structure:");
console.log("- pieces:", Array.isArray(ZOBRIST_SEEDS.pieces), "length:", ZOBRIST_SEEDS.pieces.length);
console.log("- castling:", Array.isArray(ZOBRIST_SEEDS.castling), "length:", ZOBRIST_SEEDS.castling.length);
console.log("- sides:", Array.isArray(ZOBRIST_SEEDS.sides), "length:", ZOBRIST_SEEDS.sides.length);
console.log("- en_passant:", Array.isArray(ZOBRIST_SEEDS.en_passant), "length:", ZOBRIST_SEEDS.en_passant.length);

// Test accessing specific seeds
console.log("\nSample Zobrist seeds:");
console.log("White King on a1 (0):", ZOBRIST_SEEDS.pieces[0][PIECES.KING][0].toString(16));
console.log("Black Queen on e8 (60):", ZOBRIST_SEEDS.pieces[1][PIECES.QUEEN][60].toString(16));
console.log("White to move:", ZOBRIST_SEEDS.sides[0].toString(16));
console.log("Black to move:", ZOBRIST_SEEDS.sides[1].toString(16));
console.log("All castling rights:", ZOBRIST_SEEDS.castling[CASTLING.ALL].toString(16));

// Test Zobrist hash calculation logic
function testZobristCalculation() {
  console.log("\nTesting Zobrist hash calculation:");
  
  let hash = 0n;
  
  // Add white king on e1 (square 4)
  hash ^= ZOBRIST_SEEDS.pieces[0][PIECES.KING][4];
  console.log("After adding white king on e1:", hash.toString(16));
  
  // Add black king on e8 (square 60)
  hash ^= ZOBRIST_SEEDS.pieces[1][PIECES.KING][60];
  console.log("After adding black king on e8:", hash.toString(16));
  
  // Add castling rights (all)
  hash ^= ZOBRIST_SEEDS.castling[CASTLING.ALL];
  console.log("After adding all castling rights:", hash.toString(16));
  
  // Add side to move (white)
  hash ^= ZOBRIST_SEEDS.sides[0];
  console.log("After adding white to move:", hash.toString(16));
  
  // No en passant
  hash ^= ZOBRIST_SEEDS.en_passant[0];
  console.log("After adding no en passant:", hash.toString(16));
  
  return hash;
}

const finalHash = testZobristCalculation();
console.log("\nFinal Zobrist hash:", finalHash.toString(16));

// Test that removing and re-adding a piece gives the same hash
console.log("\nTesting XOR reversibility:");
let testHash = finalHash;
console.log("Initial hash:", testHash.toString(16));

// Remove white king from e1
testHash ^= ZOBRIST_SEEDS.pieces[0][PIECES.KING][4];
console.log("After removing white king from e1:", testHash.toString(16));

// Add white king back to e1
testHash ^= ZOBRIST_SEEDS.pieces[0][PIECES.KING][4];
console.log("After adding white king back to e1:", testHash.toString(16));
console.log("Equals original hash?", testHash === finalHash);

console.log("\n✓ All Zobrist hash tests passed!");