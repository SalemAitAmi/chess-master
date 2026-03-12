/**
 * Pawn structure evaluation tests.
 * 
 * Tests the actual implemented behavior in pawnStructure.js:
 *   - Doubled pawns: -12 per doubled pawn
 *   - Isolated pawns: -15 per isolated pawn
 *   - Connected pawns: +8 per connected pawn
 *   - Passed pawns: +10 to +90 based on advancement
 */

import { describe, test, expect } from 'vitest';
import { evalComponents } from '../harness/introspect.js';

describe('Pawn structure: doubled pawns', () => {
  test('doubled pawns are penalized vs normal structure', () => {
    // Normal pawn structure - 8 pawns, none doubled
    const normal = '4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1';
    
    // Doubled pawns on e-file - 7 files with pawns, e-file has 2
    const doubled = '4k3/pppppppp/8/8/4P3/4P3/PPPP1PPP/4K3 w - - 0 1';
    
    const normalEval = evalComponents(normal, 'white');
    const doubledEval = evalComponents(doubled, 'white');
    
    // Doubled pawns should give worse structure score
    expect(doubledEval.components.pawnStructure).toBeLessThan(normalEval.components.pawnStructure);
  });

  test('two sets of doubled pawns is worse than one', () => {
    // One doubled pawn stack
    const oneDoubled = '4k3/8/8/8/3P4/3P4/8/4K3 w - - 0 1';
    
    // Two doubled pawn stacks  
    const twoDoubled = '4k3/8/8/8/2PP4/2PP4/8/4K3 w - - 0 1';
    
    const oneEval = evalComponents(oneDoubled, 'white');
    const twoEval = evalComponents(twoDoubled, 'white');
    
    // More doubled pawns = worse score
    // Each doubled pawn is -12, so 2 stacks should be worse than 1
    expect(twoEval.components.pawnStructure).toBeLessThan(oneEval.components.pawnStructure);
  });
});

describe('Pawn structure: isolated pawns', () => {
  test('isolated pawn is penalized', () => {
    // Connected pawns (d and e files)
    const connected = '4k3/8/8/8/3PP3/8/8/4K3 w - - 0 1';
    
    // Isolated pawn (d-file alone, no pawns on c or e)
    const isolated = '4k3/8/8/8/3P4/8/8/4K3 w - - 0 1';
    
    const connectedEval = evalComponents(connected, 'white');
    const isolatedEval = evalComponents(isolated, 'white');
    
    // Connected gets +8 each, isolated gets -15
    expect(connectedEval.components.pawnStructure).toBeGreaterThan(isolatedEval.components.pawnStructure);
  });

  test('multiple isolated pawns is worse', () => {
    // One isolated pawn
    const oneIsolated = '4k3/8/8/8/3P4/8/8/4K3 w - - 0 1';
    
    // Two isolated pawns (a-file and h-file, not adjacent)
    const twoIsolated = '4k3/8/8/8/P6P/8/8/4K3 w - - 0 1';
    
    const oneEval = evalComponents(oneIsolated, 'white');
    const twoEval = evalComponents(twoIsolated, 'white');
    
    // Each isolated pawn is -15
    expect(twoEval.components.pawnStructure).toBeLessThan(oneEval.components.pawnStructure);
  });
});

describe('Pawn structure: passed pawns', () => {
  test('advanced passed pawn is more valuable than less advanced', () => {
    // Passed pawn on 3rd rank (advancement = 2 for white)
    const rank3 = '4k3/8/8/8/8/4P3/8/4K3 w - - 0 1';
    
    // Passed pawn on 6th rank (advancement = 5 for white)
    const rank6 = '4k3/8/4P3/8/8/8/8/4K3 w - - 0 1';
    
    const rank3Eval = evalComponents(rank3, 'white');
    const rank6Eval = evalComponents(rank6, 'white');
    
    // rank 6 gets PASSED_PAWN_BONUS[5] = 60
    // rank 3 gets PASSED_PAWN_BONUS[2] = 15
    expect(rank6Eval.components.pawnStructure).toBeGreaterThan(rank3Eval.components.pawnStructure);
  });

  test('passed pawn on 7th rank is highly valued', () => {
    // Passed pawn on 7th rank (one step from promotion)
    const rank7 = '4k3/4P3/8/8/8/8/8/4K3 w - - 0 1';
    
    // Passed pawn on 4th rank
    const rank4 = '4k3/8/8/8/4P3/8/8/4K3 w - - 0 1';
    
    const rank7Eval = evalComponents(rank7, 'white');
    const rank4Eval = evalComponents(rank4, 'white');
    
    // rank 7 gets PASSED_PAWN_BONUS[6] = 90
    // rank 4 gets PASSED_PAWN_BONUS[3] = 25
    expect(rank7Eval.components.pawnStructure).toBeGreaterThan(rank4Eval.components.pawnStructure);
    expect(rank7Eval.components.pawnStructure - rank4Eval.components.pawnStructure).toBeGreaterThan(50);
  });

  test('protected passed pawn is valuable (connected bonus stacks)', () => {
    // Lone passed pawn
    const lone = '4k3/8/8/4P3/8/8/8/4K3 w - - 0 1';
    
    // Protected passed pawn (d-pawn supports e-pawn)
    const protected_ = '4k3/8/8/4P3/3P4/8/8/4K3 w - - 0 1';
    
    const loneEval = evalComponents(lone, 'white');
    const protectedEval = evalComponents(protected_, 'white');
    
    // Protected pawn also gets connected bonus +8
    expect(protectedEval.components.pawnStructure).toBeGreaterThan(loneEval.components.pawnStructure);
  });
});

describe('Pawn structure: connected pawns', () => {
  test('connected pawn chain is valued', () => {
    // Connected pawn chain (c, d, e files)
    const chain = '4k3/8/8/2PPP3/8/8/8/4K3 w - - 0 1';
    
    // Scattered isolated pawns
    const scattered = '4k3/8/8/P3P2P/8/8/8/4K3 w - - 0 1';
    
    const chainEval = evalComponents(chain, 'white');
    const scatteredEval = evalComponents(scattered, 'white');
    
    // Chain: each pawn is connected (+8 each)
    // Scattered: each pawn is isolated (-15 each)
    expect(chainEval.components.pawnStructure).toBeGreaterThan(scatteredEval.components.pawnStructure);
  });
});

describe('Pawn structure: symmetry', () => {
  test('symmetric pawn structure scores equally', () => {
    const symmetric = '4k3/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/4K3 w - - 0 1';
    
    const whiteEval = evalComponents(symmetric, 'white');
    const blackEval = evalComponents(symmetric, 'black');
    
    // Symmetric structure should give equal scores
    const asymmetry = whiteEval.components.pawnStructure + blackEval.components.pawnStructure;
    expect(Math.abs(asymmetry)).toBeLessThan(10);
  });
});

describe('Pawn structure: documented limitations', () => {
  /**
   * NOTE: The following pawn structure concepts are NOT implemented:
   * 
   * - Backward pawns (pawn that cannot advance safely and lacks pawn support)
   * - Hanging pawns (two adjacent pawns with no pawns on adjacent files)
   * - Pawn majority (having more pawns on one side of the board)
   * - Pawn islands (counting groups of connected pawns)
   * - Candidate passed pawns (pawns that could become passed)
   * 
   * These would improve the evaluation but require additional implementation.
   */
  
  test.skip('backward pawn penalty (NOT IMPLEMENTED)', () => {
    // A backward pawn is one that:
    // 1. Cannot advance without being captured
    // 2. Has no friendly pawns that can protect it
    //
    // Example: White pawn on d3 with pawns on c4 and e4
    // The d3 pawn cannot advance to d4 because it would be captured
    // and there are no pawns on c2/e2 to support it
    
    const backward = '4k3/8/8/8/2P1P3/3P4/8/4K3 w - - 0 1';
    const normal = '4k3/8/8/8/2PPP3/8/8/4K3 w - - 0 1';
    
    const backwardEval = evalComponents(backward, 'white');
    const normalEval = evalComponents(normal, 'white');
    
    // TODO: Implement backward pawn detection in pawnStructure.js
    // expect(backwardEval.components.pawnStructure).toBeLessThan(normalEval.components.pawnStructure);
  });

  test.skip('pawn islands penalty (NOT IMPLEMENTED)', () => {
    // Fewer pawn islands is better
    // Each island is a group of connected pawns
    
    const oneIsland = '4k3/8/8/8/2PPP3/8/8/4K3 w - - 0 1';   // 1 island
    const twoIslands = '4k3/8/8/8/P1PPP3/8/8/4K3 w - - 0 1'; // 2 islands
    
    // TODO: Implement pawn island counting
  });
});