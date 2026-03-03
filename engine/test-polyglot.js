/**
 * Test the custom Polyglot reader
 */

import { PolyglotBook, generatePolyglotHash, debugBookEntries, findStartingPositionHash  } from './src/book/polyglotReader.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BOOK_PATH = path.join(__dirname, 'data/baron30.bin');

async function test() {
  console.log('=== Testing Custom Polyglot Reader ===\n');
  
  // Test hash generation
  console.log('1. Testing hash generation...');
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const hash = generatePolyglotHash(startFen);
  const hashHex = hash.toString(16).padStart(16, '0');
  console.log(`   Starting position hash: ${hashHex}`);
  
  // Known correct Polyglot hash for starting position
  const EXPECTED_START_HASH = '463b96181691fc9c';
  console.log(`   Expected:               ${EXPECTED_START_HASH}`);
  console.log(`   Match: ${hashHex === EXPECTED_START_HASH ? '✓ YES' : '✗ NO'}`);
  
  // Test book loading
  console.log('\n2. Loading book...');
  const book = new PolyglotBook(BOOK_PATH);
  await book.load();
  console.log(`   Loaded: ${book.loaded}`);
  console.log(`   Total entries: ${book.totalEntries}`);
  console.log(`   Unique positions: ${book.entries.size}`);
  
  // Test lookups
  console.log('\n3. Testing lookups...');
  const testPositions = [
    { name: 'Starting position', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
    { name: 'After 1.e4', fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1' },
    { name: 'After 1.d4', fen: 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 1' },
    { name: 'After 1.e4 e5', fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2' },
    { name: 'Sicilian', fen: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2' },
  ];
  
  for (const test of testPositions) {
    const entries = book.find(test.fen);
    const hashVal = generatePolyglotHash(test.fen).toString(16).padStart(16, '0');
    console.log(`\n   ${test.name}:`);
    console.log(`     Hash: ${hashVal}`);
    console.log(`     Moves found: ${entries.length}`);
    if (entries.length > 0) {
      const sorted = entries.sort((a, b) => b.weight - a.weight);
      const topMoves = sorted.slice(0, 5).map(e => `${e.move}(w:${e.weight})`).join(', ');
      console.log(`     Top moves: ${topMoves}`);
    }
  }

  console.log('\n4. First 5 book entries:');
  const firstEntries = debugBookEntries(BOOK_PATH);
  for (const entry of firstEntries) {
    console.log(`   ${entry.keyHex}: ${entry.move} (weight: ${entry.weight})`);
  }

  console.log('\n5. Searching for starting position in book...');
  const startPos = findStartingPositionHash(BOOK_PATH);
  console.log(`   Found hash: ${startPos.hash}`);
  console.log(`   Moves: ${startPos.moves.map(m => `${m.move}(${m.weight})`).join(', ')}`);
  console.log(`   Our hash:   ${hashHex}`);
  console.log(`   Match: ${startPos.hash === hashHex ? '✓ YES' : '✗ NO'}`);
    
    console.log('\n=== Test Complete ===');
  }

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});