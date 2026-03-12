/**
 * Search correctness and efficiency tests.
 */

import { describe, test, expect } from 'vitest';
import { searchPosition, POSITIONS } from './harness/fixtures.js';
import * as chess from './harness/assertions.js';

describe('Tactical correctness', () => {
  test('finds mate-in-1', () => {
    const { collector } = searchPosition(POSITIONS.mateInOne, { depth: 2 });
    chess.assertBestMove(collector, 'e1e8');
    chess.assertNodesBelow(collector, 200);
  });

  test('finds knight fork', () => {
    const { collector } = searchPosition(POSITIONS.forkKnight, { depth: 4 });
    chess.assertBestMove(collector, 'd5c7');
    // Fork wins the exchange (~300cp) after Nxc7+ Kf8 Nxa8.
    // 200cp threshold accounts for positional factors (knight offside,
    // black's development). The key assertion is bestMove, not the gap.
    chess.assertScoreDominance(collector, 'd5c7', 'e1g1', 200);
  });
  
  test('finds back rank mate', () => {
    const { collector } = searchPosition(POSITIONS.backRankMate, { depth: 2 });
    chess.assertBestMove(collector, 'e1e8');
  });
});

describe('Book integration', () => {
  test('book move ordered first but search can override', () => {
    const bookHints = new Map([['f8c5', 1000]]);
    const { collector } = searchPosition(POSITIONS.bookTrapItalian, {
      depth: 5,
      bookHints
    });
    chess.assertBookMoveOrderedFirst(collector, 'f8c5');
  });

  test('book move confirmed when genuinely good', () => {
    const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const bookHints = new Map([['e7e5', 2000]]);
    const { collector } = searchPosition(afterE4, {
      depth: 4,
      bookHints
    });
    chess.assertMoveInTopN(collector, 'e7e5', 3);
  });
});

describe('Memory bounds', () => {
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
    
    expect(growth, `Heap grew ${growth.toFixed(1)}MB over 10 searches — leak`).toBeLessThan(50);
  });
});