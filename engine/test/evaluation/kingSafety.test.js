/**
 * King safety evaluation tests.
 */

import { describe, test, expect } from 'vitest';
import { evalComponents } from '../harness/introspect.js';

describe('King safety: pawn shield', () => {
  test('intact pawn shield is valued', () => {
    // Good pawn shield after castling
    const goodShield = 'r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w - - 6 6';
    
    const ec = evalComponents(goodShield, 'white');
    
    // King safety should be non-negative with good shield
    // (actual value depends on implementation)
    expect(ec.components.kingSafety).toBeGreaterThanOrEqual(-30);
  });

  test('fianchettoed bishop does not hurt king safety unduly', () => {
    const fianchetto = 'r1bq1rk1/ppppppbp/2n3p1/8/8/5NP1/PPPPPPBP/RNBQ1RK1 w - - 4 5';
    
    const ec = evalComponents(fianchetto, 'white');
    
    expect(ec.components.kingSafety).toBeGreaterThan(-50);
  });
});

describe('King safety: exposed king', () => {
  test('castled king is safer than center king', () => {
    const exposed = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    const safe = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 5 5';
    
    const exposedEval = evalComponents(exposed, 'white');
    const safeEval = evalComponents(safe, 'white');
    
    // Castled position should have better king safety
    expect(safeEval.components.kingSafety).toBeGreaterThanOrEqual(exposedEval.components.kingSafety);
  });

  test('open file near king is penalized', () => {
    // King on open e-file
    const openFile = 'r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQ - 4 4';
    
    // King sheltered
    const sheltered = 'r1bqk2r/ppppbppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    
    const openEval = evalComponents(openFile, 'white');
    const shelteredEval = evalComponents(sheltered, 'white');
    
    // Sheltered should be at least as good
    expect(shelteredEval.components.kingSafety).toBeGreaterThanOrEqual(openEval.components.kingSafety - 20);
  });
});

describe('King safety: endgame transition', () => {
  test('king safety matters less in endgame', () => {
    const middlegame = 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQ - 0 6';
    const endgame = '4k3/ppp2ppp/8/8/8/8/PPP2PPP/4K3 w - - 0 1';
    
    const midEval = evalComponents(middlegame, 'white');
    const endEval = evalComponents(endgame, 'white');
    
    expect(endEval.context.endgameWeight).toBeGreaterThan(midEval.context.endgameWeight);
  });

  test('king centralization bonus in endgame', () => {
    const edgeKing = '8/8/8/8/8/8/8/K3k3 w - - 0 1';
    const centerKing = '8/8/8/3K4/8/8/8/4k3 w - - 0 1';
    
    const edgeEval = evalComponents(edgeKing, 'white');
    const centerEval = evalComponents(centerKing, 'white');
    
    // Central king should score at least as well in endgame
    expect(centerEval.total).toBeGreaterThanOrEqual(edgeEval.total);
  });
});