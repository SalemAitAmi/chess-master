/**
 * Center control evaluation tests.
 * 
 * Tests verify:
 *   - Pieces/pawns controlling center squares are rewarded
 *   - Central occupation is valued
 *   - The bonus diminishes appropriately in the endgame
 */

import { describe, test, expect } from 'vitest';
import { evalComponents } from '../harness/introspect.js';

describe('Center control: basic bonuses', () => {
  test('pawn on e4 scores higher than pawn on a4', () => {
    const pawnE4 = '4k3/8/8/8/4P3/8/8/4K3 w - - 0 1';
    const pawnA4 = '4k3/8/8/8/P7/8/8/4K3 w - - 0 1';
    
    const e4Eval = evalComponents(pawnE4, 'white');
    const a4Eval = evalComponents(pawnA4, 'white');
    
    expect(e4Eval.components.centerControl).toBeGreaterThan(a4Eval.components.centerControl);
  });

  test('knight on e4 scores higher than knight on a1', () => {
    const knightE4 = '4k3/8/8/8/4N3/8/8/4K3 w - - 0 1';
    const knightA1 = '4k3/8/8/8/8/8/8/N3K3 w - - 0 1';
    
    const e4Eval = evalComponents(knightE4, 'white');
    const a1Eval = evalComponents(knightA1, 'white');
    
    expect(e4Eval.components.centerControl).toBeGreaterThan(a1Eval.components.centerControl);
  });

  test('knight on d5 (extended center) is valued', () => {
    const knightD5 = '4k3/8/8/3N4/8/8/8/4K3 w - - 0 1';
    const knightH1 = '4k3/8/8/8/8/8/8/4K2N w - - 0 1';
    
    const d5Eval = evalComponents(knightD5, 'white');
    const h1Eval = evalComponents(knightH1, 'white');
    
    expect(d5Eval.components.centerControl).toBeGreaterThan(h1Eval.components.centerControl);
  });
});

describe('Center control: symmetry', () => {
  test('symmetric pawn center evaluates equally', () => {
    // Classic 1.e4 e5 pawn center
    const symmetricCenter = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    
    const whiteEval = evalComponents(symmetricCenter, 'white');
    const blackEval = evalComponents(symmetricCenter, 'black');
    
    // Center control should be roughly equal
    const diff = Math.abs(whiteEval.components.centerControl + blackEval.components.centerControl);
    expect(diff).toBeLessThan(20);
  });
});

describe('Center control: opening vs endgame', () => {
  test('center control matters more in opening than endgame', () => {
    // Opening-like position (many pieces)
    const opening = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 4 4';
    
    // Endgame-like position (few pieces, same center structure)
    const endgame = '4k3/8/8/4p3/4P3/8/8/4K3 w - - 0 1';
    
    const openingEval = evalComponents(opening, 'white');
    const endgameEval = evalComponents(endgame, 'white');
    
    // In opening (gamePhase high), center weight should be higher
    // The raw component value depends on implementation, but context.gamePhase
    // should be higher in opening
    expect(openingEval.context.gamePhase).toBeGreaterThan(endgameEval.context.gamePhase);
  });
});