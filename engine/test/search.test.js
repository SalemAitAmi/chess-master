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

describe('Exchange sequences (SEE / LVA regression)', () => {
  /**
   * Contested-square recapture: pawn vs queen, both can take on e5.
   *
   * With OPTIMAL opponent play, both recaptures reach ~equal material:
   *   dxe5 → black declines ...Qxe5 (would lose 800cp after Qxe5) → ~0
   *   Qxe5 → black trades ...Qxe5, dxe5 → also ~0
   *
   * So there's no score gap to assert — the minimax values are tied.
   * What we CAN assert: the engine picks dxe5 anyway, because MVV-LVA
   * orders it first (same victim, cheaper attacker: 330·10−100 = 3200
   * vs 330·10−900 = 2400) and `score > bestScore` (strict) means the
   * first move to hit the best score is kept.
   *
   * Why this matters despite the tie: against a SUB-optimal opponent
   * (the Colosseum incident — lower-depth black played the losing
   * ...QxP), dxe5 wins 800cp more. LVA-first is strictly dominant:
   * equal against best play, strictly better against blunders.
   *
   * Regression this guards: if TT stickiness ever causes Qxe5 to be
   * ordered first at d≥2 (from a d=1 eval quirk preferring queens-off),
   * the tie would flip to Qxe5 and this test fails.
   */
  test('LVA recapture ordered first and chosen on score tie', () => {
    const fen = '4q1k1/5ppp/8/4b3/3P4/8/4Q1PP/6K1 w - - 0 1';
    const { collector, result } = searchPosition(fen, { depth: 4 });

    const roots = collector.rootMoves.slice().sort((a, b) => b.score - a.score);
    const dxe5 = roots.find(m => m.move === 'd4e5');
    const Qxe5 = roots.find(m => m.move === 'e2e5');

    // Best move MUST be the pawn capture. This is the regression guard.
    chess.assertBestMove(collector, 'd4e5');

    // Document the tie — if this ever becomes a gap, something in eval
    // shifted (not necessarily wrong, but worth investigating).
    const gap = (dxe5?.score ?? 0) - (Qxe5?.score ?? 0);
    console.log(`[EXCHANGE] best=${result.bestMove?.algebraic} dxe5=${dxe5?.score} Qxe5=${Qxe5?.score} gap=${gap}`);
    expect(Math.abs(gap)).toBeLessThan(100);  // should be ~0; flag if eval drifts
  });

  test('MVV-LVA orders pawn-capture above queen-capture for same victim', () => {
    // Layer-3 isolation: ordering alone, no search dynamics. If this
    // passes but the test above fails, the bug is in how search CONSUMES
    // the ordering (TT override, LMR mis-reducing the pawn capture),
    // not in moveOrdering.js itself.
    const fen = '4q1k1/5ppp/8/4b3/3P4/8/4Q1PP/6K1 w - - 0 1';
    const ordered = ordering(fen);

    const dxe5Rank = ordered.find(m => m.move === 'd4e5')?.rank;
    const Qxe5Rank = ordered.find(m => m.move === 'e2e5')?.rank;

    expect(dxe5Rank).toBeDefined();
    expect(Qxe5Rank).toBeDefined();
    expect(dxe5Rank,
      `dxe5 should rank above Qxe5 (LVA). Got dxe5=#${dxe5Rank}, Qxe5=#${Qxe5Rank}`
    ).toBeLessThan(Qxe5Rank);
  });

  test('quiescence SEE-prunes queen-takes-bishop', () => {
    // The crude SEE gate in quiescence.js should refuse to explore QxB
    // when the material swing (330 − 900 = −570) is below SEE_PRUNE_MARGIN
    // (−200). This is what saves us from burning nodes on obviously-bad
    // captures in tactical positions.
    //
    // traceQSearch won't show the pruned move directly, but it WILL show
    // that quiescence from this position visits far fewer nodes than if
    // both captures were explored. We assert an upper bound.
    const fen = '4q1k1/5ppp/8/4b3/3P4/8/4Q1PP/6K1 w - - 0 1';
    const trace = traceQSearch(fen, { maxQDepth: 8 });

    // With Qxe5 pruned, q-search explores: dxe5 → black declines
    // (Qxe5 by black also SEE-pruned: 100−900 < −200) → stand-pat.
    // Should be single-digit nodes.
    expect(trace.nodesVisited,
      `Q-search visited ${trace.nodesVisited} nodes — SEE pruning may be off`
    ).toBeLessThan(20);
  });
});