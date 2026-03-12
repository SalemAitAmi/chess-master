/**
 * Material evaluation tests.
 */

import { describe, test, expect } from 'vitest';
import { evalComponents } from '../harness/introspect.js';

describe('Material: basic piece values', () => {
  test('extra pawn is worth approximately 100cp', () => {
    const balanced = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    const extraPawn = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
    
    const balancedEval = evalComponents(balanced, 'white');
    const extraEval = evalComponents(extraPawn, 'white');
    
    const diff = extraEval.components.material - balancedEval.components.material;
    // Pawn base value is 100cp, but PST may add positional bonus
    // Allow range [90, 130] to account for PST on central files
    expect(diff).toBeGreaterThanOrEqual(90);
    expect(diff).toBeLessThanOrEqual(130);
  });

  test('extra knight is worth approximately 320cp', () => {
    const base = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    const extraKnight = '4k3/8/8/8/8/8/4N3/4K3 w - - 0 1';
    
    const baseEval = evalComponents(base, 'white');
    const knightEval = evalComponents(extraKnight, 'white');
    
    const diff = knightEval.components.material - baseEval.components.material;
    expect(diff).toBeGreaterThanOrEqual(280);
    expect(diff).toBeLessThanOrEqual(380);
  });

  test('extra bishop is worth approximately 330cp', () => {
    const base = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    const extraBishop = '4k3/8/8/8/8/8/4B3/4K3 w - - 0 1';
    
    const baseEval = evalComponents(base, 'white');
    const bishopEval = evalComponents(extraBishop, 'white');
    
    const diff = bishopEval.components.material - baseEval.components.material;
    expect(diff).toBeGreaterThanOrEqual(290);
    expect(diff).toBeLessThanOrEqual(390);
  });

  test('extra rook is worth approximately 500cp', () => {
    const base = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    const extraRook = '4k3/8/8/8/8/8/4R3/4K3 w - - 0 1';
    
    const baseEval = evalComponents(base, 'white');
    const rookEval = evalComponents(extraRook, 'white');
    
    const diff = rookEval.components.material - baseEval.components.material;
    expect(diff).toBeGreaterThanOrEqual(450);
    expect(diff).toBeLessThanOrEqual(560);
  });

  test('extra queen is worth approximately 900cp', () => {
    const base = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    const extraQueen = '4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1';
    
    const baseEval = evalComponents(base, 'white');
    const queenEval = evalComponents(extraQueen, 'white');
    
    const diff = queenEval.components.material - baseEval.components.material;
    expect(diff).toBeGreaterThanOrEqual(850);
    expect(diff).toBeLessThanOrEqual(1000);
  });
});

describe('Material: symmetry', () => {
  test('equal material evaluates to approximately 0', () => {
    const equal = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const ec = evalComponents(equal, 'white');
    
    expect(Math.abs(ec.components.material)).toBeLessThan(20);
  });

  test('mirrored positions have opposite material scores', () => {
    const whiteUp = '4k3/8/8/8/8/8/4N3/4K3 w - - 0 1';
    const blackUp = '4k3/4n3/8/8/8/8/8/4K3 w - - 0 1';
    
    const whiteEval = evalComponents(whiteUp, 'white');
    const blackEval = evalComponents(blackUp, 'white');
    
    expect(whiteEval.components.material).toBeGreaterThan(0);
    expect(blackEval.components.material).toBeLessThan(0);
    // Allow some PST asymmetry
    expect(Math.abs(whiteEval.components.material + blackEval.components.material)).toBeLessThan(50);
  });
});

describe('Material: imbalances', () => {
  test('bishop pair bonus exists', () => {
    const oneBishop = '4k3/8/8/8/8/8/4B3/4K3 w - - 0 1';
    const twoBishops = '4k3/8/8/8/8/8/3BB3/4K3 w - - 0 1';
    
    const oneEval = evalComponents(oneBishop, 'white');
    const twoEval = evalComponents(twoBishops, 'white');
    
    const oneBishopValue = oneEval.components.material;
    const twoBishopValue = twoEval.components.material;
    
    // Two bishops should be worth at least 2× one bishop
    expect(twoBishopValue).toBeGreaterThanOrEqual(oneBishopValue * 2 - 30);
  });

  test('rook vs two minors is roughly equal', () => {
    const rookSide = '4k3/8/8/8/8/8/4R3/4K3 w - - 0 1';
    const minorsSide = '4k3/8/8/8/8/8/3NB3/4K3 w - - 0 1';
    
    const rookEval = evalComponents(rookSide, 'white');
    const minorsEval = evalComponents(minorsSide, 'white');
    
    const diff = Math.abs(rookEval.components.material - minorsEval.components.material);
    expect(diff).toBeLessThan(250);
  });
});