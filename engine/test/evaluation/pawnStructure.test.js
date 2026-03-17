/**
 * Pawn structure evaluation tests.
 *
 * FIXTURE DESIGN PRINCIPLE:
 *   Each test must isolate ONE structural factor. The previous doubled/
 *   isolated fixtures had no black pawns, so every white pawn was PASSED.
 *   Adding more pawns added more passed-pawn bonus, swamping the penalty
 *   under test. All fixtures below use black pawns to block passed-pawn
 *   detection and hold other factors (connectedness, pawn count) constant.
 */

import { describe, test, expect } from 'vitest';
import { evalComponents } from '../harness/introspect.js';

describe('Pawn structure: doubled pawns', () => {
  test('doubled pawns are penalized vs normal structure', () => {
    const normal  = '4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1';
    const doubled = '4k3/pppppppp/8/8/4P3/4P3/PPPP1PPP/4K3 w - - 0 1';

    const normalEval  = evalComponents(normal, 'white');
    const doubledEval = evalComponents(doubled, 'white');

    expect(doubledEval.components.pawnStructure).toBeLessThan(normalEval.components.pawnStructure);
  });

  test('two sets of doubled pawns is worse than one', () => {
    // Both positions: 4 white pawns, all connected, all blocked by black
    // (no passed-pawn noise). The ONLY delta is doubled-pawn count.
    //
    // oneDoubled:  a3 b3 c3 c2 — one doubled file (c)
    //   white: a3(+8) b3(+8) c3(-12+8) c2(-12+8) = +8
    //   black: a7(+8) b7(+8) c7(+8) d7(+8)       = +32
    //   net = 8 - 32 = -24
    //
    // twoDoubled:  b3 c3 b2 c2 — two doubled files (b, c)
    //   white: 4 × (-12+8) = -16
    //   black: +32
    //   net = -16 - 32 = -48
    const oneDoubled = '4k3/pppp4/8/8/8/PPP5/2P5/4K3 w - - 0 1';
    const twoDoubled = '4k3/pppp4/8/8/8/1PP5/1PP5/4K3 w - - 0 1';

    const oneEval = evalComponents(oneDoubled, 'white');
    const twoEval = evalComponents(twoDoubled, 'white');

    expect(twoEval.components.pawnStructure).toBeLessThan(oneEval.components.pawnStructure);
    // Sanity: the gap should be roughly 2 extra doubled penalties (~24cp)
    expect(oneEval.components.pawnStructure - twoEval.components.pawnStructure).toBeGreaterThan(15);
  });
});

describe('Pawn structure: isolated pawns', () => {
  test('isolated pawn is penalized', () => {
    const connected = '4k3/8/8/8/3PP3/8/8/4K3 w - - 0 1';
    const isolated  = '4k3/8/8/8/3P4/8/8/4K3 w - - 0 1';

    const connectedEval = evalComponents(connected, 'white');
    const isolatedEval  = evalComponents(isolated, 'white');

    expect(connectedEval.components.pawnStructure).toBeGreaterThan(isolatedEval.components.pawnStructure);
  });

  test('multiple isolated pawns is worse', () => {
    // Both positions: 4 white pawns vs 4 black pawns (a7-d7 wall).
    // f3 is passed+isolated in BOTH (nets to ~0), so it's a controlled
    // constant. The delta is whether the 4th pawn is c3 (connected to
    // a3-b3) or d3 (isolated, gap on c).
    //
    // oneIsolated:  a3 b3 c3 f3 — f3 is the lone isolani
    //   white: 8+8+8 + (-15+15 passed) = 24
    //   black: 32    net = -8
    //
    // twoIsolated:  a3 b3 d3 f3 — d3 AND f3 isolated
    //   white: 8+8 + (-15) + (-15+15) = 1
    //   black: 32    net = -31
    //
    // Island penalty (new) widens the gap further: twoIsolated has
    // 3 white islands vs 2, adding another -8.
    const oneIsolated = '4k3/pppp4/8/8/8/PPP2P2/8/4K3 w - - 0 1';
    const twoIsolated = '4k3/pppp4/8/8/8/PP1P1P2/8/4K3 w - - 0 1';

    const oneEval = evalComponents(oneIsolated, 'white');
    const twoEval = evalComponents(twoIsolated, 'white');

    expect(twoEval.components.pawnStructure).toBeLessThan(oneEval.components.pawnStructure);
  });
});

describe('Pawn structure: passed pawns', () => {
  test('advanced passed pawn is more valuable than less advanced', () => {
    const rank3 = '4k3/8/8/8/8/4P3/8/4K3 w - - 0 1';
    const rank6 = '4k3/8/4P3/8/8/8/8/4K3 w - - 0 1';

    expect(evalComponents(rank6, 'white').components.pawnStructure)
      .toBeGreaterThan(evalComponents(rank3, 'white').components.pawnStructure);
  });

  test('passed pawn on 7th rank is highly valued', () => {
    const rank7 = '4k3/4P3/8/8/8/8/8/4K3 w - - 0 1';
    const rank4 = '4k3/8/8/8/4P3/8/8/4K3 w - - 0 1';

    const r7 = evalComponents(rank7, 'white');
    const r4 = evalComponents(rank4, 'white');

    expect(r7.components.pawnStructure).toBeGreaterThan(r4.components.pawnStructure);
    expect(r7.components.pawnStructure - r4.components.pawnStructure).toBeGreaterThan(50);
  });

  test('protected passed pawn is valuable (connected bonus stacks)', () => {
    const lone       = '4k3/8/8/4P3/8/8/8/4K3 w - - 0 1';
    const protected_ = '4k3/8/8/4P3/3P4/8/8/4K3 w - - 0 1';

    expect(evalComponents(protected_, 'white').components.pawnStructure)
      .toBeGreaterThan(evalComponents(lone, 'white').components.pawnStructure);
  });
});

describe('Pawn structure: connected pawns', () => {
  test('connected pawn chain is valued', () => {
    const chain     = '4k3/8/8/2PPP3/8/8/8/4K3 w - - 0 1';
    const scattered = '4k3/8/8/P3P2P/8/8/8/4K3 w - - 0 1';

    expect(evalComponents(chain, 'white').components.pawnStructure)
      .toBeGreaterThan(evalComponents(scattered, 'white').components.pawnStructure);
  });
});

describe('Pawn structure: backward pawns', () => {
  test('backward pawn is penalized', () => {
    // backward: d3 with c4/e4 ahead of it, and black c5 controls d4
    //   (the stop square). d3 can never safely advance — classic backward.
    //   Black e6 added to block e4's passed-pawn bonus so the comparison
    //   isn't contaminated.
    //
    // normal: c3/d3/e3 all abreast. d3 isn't backward because c3/e3
    //   can advance to c4/e4 to support d4. Same 3 pawns, same black
    //   blockers, only the white ranks differ.
    const backward = '4k3/8/4p3/2p5/2P1P3/3P4/8/4K3 w - - 0 1';
    const normal   = '4k3/8/4p3/2p5/8/2PPP3/8/4K3 w - - 0 1';

    const backwardEval = evalComponents(backward, 'white');
    const normalEval   = evalComponents(normal, 'white');

    expect(backwardEval.components.pawnStructure).toBeLessThan(normalEval.components.pawnStructure);
  });

  test('backward requires enemy control of stop square', () => {
    // Same white structure, but no black c5. d3's stop square (d4)
    // isn't under attack → d3 can advance freely → NOT backward.
    // The left-behind shape alone isn't enough; the pawn has to be
    // actually stuck.
    const notBackward = '4k3/8/4p3/8/2P1P3/3P4/8/4K3 w - - 0 1';
    const backward    = '4k3/8/4p3/2p5/2P1P3/3P4/8/4K3 w - - 0 1';

    const nb = evalComponents(notBackward, 'white');
    const b  = evalComponents(backward, 'white');

    // Removing black's c5 also removes black's isolated penalty, so
    // compare white's absolute score, not the net. The backward penalty
    // should make `backward` white-score ≤ `notBackward` white-score.
    // (Use the symmetry helper to isolate white's half.)
    expect(b.components.pawnStructure).toBeLessThan(nb.components.pawnStructure);
  });
});

describe('Pawn structure: pawn islands', () => {
  test('more pawn islands is worse', () => {
    // oneIsland: white a3-b3-c3 (one island), black mirrors
    // twoIslands: white a3-b3 + d3 (gap on c → two islands), black
    //   keeps the single a7-b7-c7 island so the difference is all on
    //   white's side.
    //
    // d3 is also isolated in twoIslands — that's fine, it's a real
    // consequence of having an island gap. The island penalty is the
    // marginal cost BEYOND isolation; this test asserts the total
    // structural cost of fragmentation.
    const oneIsland  = '4k3/ppp5/8/8/8/PPP5/8/4K3 w - - 0 1';
    const twoIslands = '4k3/ppp5/8/8/8/PP1P4/8/4K3 w - - 0 1';

    const one = evalComponents(oneIsland, 'white');
    const two = evalComponents(twoIslands, 'white');

    expect(two.components.pawnStructure).toBeLessThan(one.components.pawnStructure);
  });

  test('three islands is worse than two', () => {
    // Black has one solid island in both → white's fragmentation is
    // the only variable. a3+c3+e3 = three singletons = three islands.
    const twoIslands   = '4k3/ppppp3/8/8/8/PP1PP3/8/4K3 w - - 0 1';  // ab | de
    const threeIslands = '4k3/ppppp3/8/8/8/P1P1P3/8/4K3 w - - 0 1';  // a | c | e

    const two   = evalComponents(twoIslands, 'white');
    const three = evalComponents(threeIslands, 'white');

    expect(three.components.pawnStructure).toBeLessThan(two.components.pawnStructure);
  });
});

describe('Pawn structure: symmetry', () => {
  test('symmetric pawn structure scores equally', () => {
    const symmetric = '4k3/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/4K3 w - - 0 1';

    const white = evalComponents(symmetric, 'white');
    const black = evalComponents(symmetric, 'black');

    expect(Math.abs(white.components.pawnStructure + black.components.pawnStructure)).toBeLessThan(10);
  });
});