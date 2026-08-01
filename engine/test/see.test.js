/**
 * Static exchange evaluation unit tests. These pin the numbers the ordering
 * and quiescence tiers depend on.
 */
import { describe, test, expect } from 'vitest';
import { Board } from '../src/core/board.js';
import { generateAllLegalMoves } from '../src/core/moveGeneration.js';
import { see } from '../src/search/see.js';

function seeOf(fen, algebraic) {
  const board = Board.fromFen(fen);
  const moves = generateAllLegalMoves(board, board.gameState.activeColor);
  const m = moves.find(x => x.algebraic === algebraic);
  if (!m) throw new Error(`${algebraic} illegal in ${fen}: ${moves.map(x => x.algebraic).join(' ')}`);
  return see(board, m);
}

describe('SEE: single exchanges', () => {
  test('capturing an undefended piece wins its full value', () => {
    expect(seeOf('6k1/5ppp/8/8/8/8/4Q1PP/2r3K1 w - - 0 1', 'e2c1')).toBe(500);
  });

  test('equal trade of defended equal pieces is 0', () => {
    // Pawn takes pawn, pawn recaptures.
    expect(seeOf('4k3/3p4/8/4P3/8/8/8/4K3 w - - 0 1', 'e5d6')).toBe(0);
  });

  test('queen takes a pawn defended by a pawn loses 800', () => {
    expect(seeOf('4k3/3p4/8/4Q3/8/8/8/4K3 w - - 0 1', 'e5d6')).toBe(-800);
  });
});

describe('SEE: the defended-bishop fixture', () => {
  const FEN = '6k1/6pp/5p2/4b3/3P4/8/4Q1PP/6K1 w - - 0 1';

  test('pawn takes bishop: +230 (wins B, loses P)', () => {
    expect(seeOf(FEN, 'd4e5')).toBe(230);
  });

  test('queen takes bishop: -570 (wins B, loses Q, wins P back)', () => {
    expect(seeOf(FEN, 'e2e5')).toBe(-570);
  });
});

describe('SEE: the tie fixture (documents why the old test was brittle)', () => {
  // Both captures are worth exactly +330 here — black's queen on e8 and white's
  // queen on e2 both bear on e5, so the exchange balances either way. There is
  // no "right" answer to assert at the search level.
  const FEN = '4q1k1/5ppp/8/4b3/3P4/8/4Q1PP/6K1 w - - 0 1';

  test('both recaptures evaluate to +330', () => {
    expect(seeOf(FEN, 'd4e5')).toBe(330);
    expect(seeOf(FEN, 'e2e5')).toBe(330);
  });
});

describe('SEE: x-rays', () => {
  test('a rook behind a rook joins the exchange', () => {
    // White Rd1+Rd2 vs black Rd8 on an open d-file, black pawn on d5 defended
    // by c6. White Rxd5: R wins P, cxd5 wins R, Rxd5 wins P+... the doubled
    // rook must be counted or the result is wrong by 500.
    const fen = '3r2k1/6pp/2p5/3p4/8/8/3R2PP/3R2K1 w - - 0 1';
    expect(seeOf(fen, 'd2d5')).toBe(-400);   // 100 - 500 (+ nothing recoverable)
  });
});

describe('SEE: promotions', () => {
  test('promoting with capture counts the promoted piece', () => {
    // axb8=Q takes a knight and gains a queen for a pawn; b8 is undefended.
    const fen = '1n6/P7/8/8/8/8/8/k6K w - - 0 1';
    expect(seeOf(fen, 'a7b8q')).toBe(320 + 900 - 100);
  });
});