/**
 * Search correctness and efficiency tests.
 */

import { describe, test, expect } from 'vitest';
import { searchPosition, POSITIONS } from './harness/fixtures.js';
import { ordering, traceQSearch }  from './harness/introspect.js';
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
    const { collector } = searchPosition(POSITIONS.bookTrapItalian, { depth: 5, bookHints });
    chess.assertBookMoveOrderedFirst(collector, 'f8c5');
  });

  /**
   * REWRITTEN. The old version asserted that 1...e5 ranked in the top 3 by
   * SEARCH SCORE at depth 4. That is not a property the book integration
   * provides — the design is explicitly "book moves are ordering hints and the
   * search may override them". At depth 4 the top handful of replies to 1.e4
   * sit within a few centipawns of each other, so the ordinal is noise: any
   * eval or move-ordering change reshuffles it.
   *
   * What IS meaningful and stable: the hint puts e7e5 first in the move
   * ordering (guaranteed by the BOOK_MOVE tier), and the search does not
   * consider it a blunder. Assert those.
   */
  test('book move is ordered first and is not refuted by search', () => {
    const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const bookHints = new Map([['e7e5', 2000]]);
    const { collector } = searchPosition(afterE4, { depth: 4, bookHints });

    chess.assertBookMoveOrderedFirst(collector, 'e7e5');

    const roots = collector.rootMoves.slice().sort((a, b) => b.score - a.score);
    const e5 = roots.find(m => m.move === 'e7e5');
    expect(e5, 'e7e5 missing from root moves').toBeDefined();

    const gap = roots[0].score - e5.score;
    console.log(`[BOOK] best=${roots[0].move}(${roots[0].score}) e7e5=${e5.score} ` +
                `gap=${gap} rank=#${collector.moveRank('e7e5')}`);
    expect(gap, `e7e5 is ${gap}cp behind ${roots[0].move} — book line may be refuted`)
      .toBeLessThan(75);
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

describe('Exchange sequences (SEE / MVV-LVA regression)', () => {
  /**
   * REWRITTEN. The old fixture (4q1k1/5ppp/8/4b3/3P4/8/4Q1PP/6K1) is a genuine
   * minimax TIE: both dxe5 and Qxe5 are worth exactly +330 (SEE agrees —
   * see the unit tests in see.test.js). Asserting which one the engine picks
   * was asserting a tie-break, which any eval or TT-ordering change flips.
   * That is what broke: at depth 1 the tie resolved to Qxe5, the TT made it
   * sticky, and every later iteration inherited it.
   *
   * This fixture removes the tie. Black's f6 pawn defends e5, so:
   *   dxe5  SEE = +230   (pawn takes bishop, fxe5 recaptures a pawn)
   *   Qxe5  SEE = -570   (queen takes bishop, fxe5 wins the queen for a pawn)
   * Now there is a 800cp difference and the correct move is forced. This is
   * also the exact pattern behind the reported "too willing to sacrifice"
   * behaviour, so it guards the thing we actually care about.
   */
  const DEFENDED = '6k1/6pp/5p2/4b3/3P4/8/4Q1PP/6K1 w - - 0 1';

  test('captures the defended bishop with the pawn, not the queen', () => {
    const { collector } = searchPosition(DEFENDED, { depth: 4 });
    chess.assertBestMove(collector, 'd4e5');
    chess.assertScoreDominance(collector, 'd4e5', 'e2e5', 400);
  });

  test('SEE-losing capture is ordered in the losing tier, below quiet moves', () => {
    const ordered = ordering(DEFENDED);
    const dxe5 = ordered.find(m => m.move === 'd4e5');
    const Qxe5 = ordered.find(m => m.move === 'e2e5');

    expect(dxe5.tier).toBe('CAPTURE');
    expect(dxe5.rank, `dxe5 should be ordered before Qxe5`).toBeLessThan(Qxe5.rank);
    // The whole point of the SEE tiers: a capture that loses a queen must not
    // outrank quiet moves. Under the old `victim*10 - attacker` test every
    // capture landed in WINNING_CAPTURE, above killers and counter-moves.
    expect(Qxe5.orderScore,
      `Qxe5 (SEE -570) should sit in LOSING_CAPTURE, got ${Qxe5.orderScore}`
    ).toBeLessThan(600_000);
  });

  test('quiescence explores a winning queen capture it used to prune', () => {
    // Free rook. The old q-search test (victim - attacker = 500-900 = -400,
    // below the -200 margin) pruned this, so the engine could not see that it
    // wins a whole rook for nothing.
    const freeRook = '6k1/5ppp/8/8/8/8/4Q1PP/2r3K1 w - - 0 1';
    const { collector } = searchPosition(freeRook, { depth: 2 });
    chess.assertBestMove(collector, 'e2c1');
  });
});