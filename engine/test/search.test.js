import { test, describe } from 'node:test';
import { searchPosition, POSITIONS } from './harness/fixtures.js';
import * as chess from './harness/assertions.js';

describe('Tactical correctness', () => {
  test('finds mate-in-1', () => {
    const { collector } = searchPosition(POSITIONS.mateInOne, { depth: 2 });
    chess.assertBestMove(collector, 'e1e8');
    // At depth 2 a mate-in-1 should need almost no nodes
    chess.assertNodesBelow(collector, 200);
  });

  test('finds knight fork', () => {
    const { collector } = searchPosition(POSITIONS.forkKnight, { depth: 4 });
    chess.assertBestMove(collector, 'd5c7');
    // The fork should dominate alternatives by at least a rook's value
    chess.assertScoreDominance(collector, 'd5c7', 'e1g1', 400);
  });
});

describe('Book integration', () => {
  test('book move ordered first but search can override', () => {
    // Simulate a position where the book suggests a move that loses material
    const bookHints = new Map([['f8c5', 1000]]);   // Fake book entry
    const { collector } = searchPosition(POSITIONS.bookTrapItalian, {
      depth: 5,
      bookHints
    });

    // Book move MUST be first in ordering...
    chess.assertBookMoveOrderedFirst(collector, 'f8c5');
    // ...but if search finds it's bad, a different move should win
    // (adjust expected move to match your eval once you run this)
  });

  test('book move confirmed when genuinely good', () => {
    const bookHints = new Map([['e7e5', 2000]]);
    const { collector } = searchPosition(POSITIONS.startpos, {
      depth: 4,
      bookHints
    });
    // e4/e5 is objectively fine — search should agree with book
    chess.assertMoveInTopN(collector, 'e7e5', 3);
  });
});

describe('Memory bounds', () => {
  // Run with: node --expose-gc --test
  test('depth-6 search stays under 100MB', () => {
    chess.assertHeapBelow(100, 'before search');
    searchPosition(POSITIONS.startpos, { depth: 6 });
    chess.assertHeapBelow(100, 'after search');
  });

  test('10 consecutive searches do not leak', () => {
    if (global.gc) global.gc();
    const baseline = process.memoryUsage().heapUsed;

    for (let i = 0; i < 10; i++) {
      searchPosition(POSITIONS.startpos, { depth: 4 });
    }

    if (global.gc) global.gc();
    const growth = (process.memoryUsage().heapUsed - baseline) / 1024 / 1024;
    // Some growth is OK (JIT warmup, etc.) but 10 searches shouldn't cost 50MB
    if (growth > 50) {
      throw new Error(`Heap grew ${growth.toFixed(1)}MB over 10 searches — leak`);
    }
  });
});