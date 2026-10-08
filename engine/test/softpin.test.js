import { describe, it, expect } from 'vitest';
import { Board } from '../src/core/board.js';
import {
  generateMoves, freshList, ANALYSIS, softPinPartner, softPinPinner,
} from '../src/core/moveGeneration.js';
import { MoveOrderer, softPinRisk } from '../src/search/moveOrdering.js';
import { evaluateMopUp } from '../src/evaluation/evaluate.js';
import { PIECES } from '../src/core/constants.js';
// White K e1, R e2, N e4; black R e8: two friendly blockers on the e-file.
const FEN = '4r2k/8/8/8/4N3/8/4R3/4K3 w - - 0 1';
describe('soft-pin analysis', () => {
  it('records both blockers, their partner and the pinner', () => {
    const b = Board.fromFen(FEN);
    generateMoves(b, 'white', freshList());
    expect((ANALYSIS.softLo >>> 12) & 1).toBe(1);
    expect(softPinPartner(12)).toBe(28);
    expect(softPinPinner(12)).toBe(60);
  });
  it('re-analyses instead of silently skipping when ANALYSIS is stale', () => {
    const b = Board.fromFen(FEN);
    const moves = generateMoves(b, 'white', freshList());
    generateMoves(Board.fromFen('8/8/8/8/8/8/8/K6k w - - 0 1'), 'white', freshList());
    const o = new MoveOrderer({});
    o.scoreMoves(moves, 1, b, 'white');
    expect(o.softRefreshes).toBe(1);
    expect(ANALYSIS.key).toBe(b.gameState.zobristKey);
  });
  it('charges real pins, not illusory ones, and never along-line moves', () => {
    expect(softPinRisk(PIECES.ROOK, PIECES.ROOK, false, 0, 0)).toBe(0);      // trade offer
    expect(softPinRisk(PIECES.KNIGHT, PIECES.ROOK, false, 0, 0)).toBe(140);  // frozen + attacked
    expect(softPinRisk(PIECES.QUEEN, PIECES.ROOK, false, 0, 0)).toBe(360);   // queen hangs to a rook
    const b = Board.fromFen(FEN);
    const moves = generateMoves(b, 'white', freshList(), false, true);
    const o = new MoveOrderer({});
    o.scoreMoves(moves, 1, b, 'white');
    const pen = (alg) => o._softPinPenalty(moves.find(m => m.algebraic === alg), o._ctx, b);
    expect(pen('e2e3')).toBe(0);                 // stays on the line
    expect(pen('e2d2')).toBeGreaterThan(0);      // rook leaves: knight is frozen and attacked
    expect(pen('e2d2')).toBeLessThan(140);       // tapered: only two rooks and a knight left
    expect(pen('e4f6')).toBe(0);                 // knight leaves: rook just trades with e8
  });
});
describe('mop-up defender cover', () => {
  it('an attacker pawn beside the defending king relieves the corral score', () => {
    const near = Board.fromFen('k7/P7/8/8/4K3/8/8/3Q4 b - - 0 1');
    const far  = Board.fromFen('k7/8/8/8/4K3/8/7P/3Q4 b - - 0 1');
    expect(evaluateMopUp(far, 'white', 1) - evaluateMopUp(near, 'white', 1)).toBe(35);
  });
});