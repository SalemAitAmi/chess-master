/**
 * Static exchange evaluation unit tests. These pin the numbers the ordering
 * and quiescence tiers depend on.
 *
 * FIXTURE CORRECTIONS (three of these tests asserted on illegal moves):
 *
 *   - "undefended piece": e2->c1 is a knight move, and the old FEN also had
 *     white in check (Rc1 vs Kg1) so every legal move was a check evasion.
 *     The rook is now on c2, en prise to the queen, no check.
 *   - "equal trade" / "queen takes defended pawn": the black pawn was on d7,
 *     so e5xd6 captured nothing. Pawn moved to d6 and a defender added on c7.
 *
 * VALUE CORRECTIONS:
 *
 *   - d4e5 in the defended-bishop fixture is +330, not +230: after dxe5 fxe5
 *     the white QUEEN on e2 recaptures (e3/e4 empty). The old comment
 *     "(wins B, loses P)" omitted it.
 *   - e2e5 is -470, not -570: Qxe5 fxe5 dxe5 = 330 - 900 + 100. The old
 *     comment "(wins B, loses Q, wins P back)" literally computes -470; -570
 *     is what the CPW prune returns when it stops before the d4 recapture.
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
    // Pawn on e7 blocks the e-file: white has no checks anywhere, so the only
    // tactic in the position is Qxc2. (My previous two attempts at this fixture
    // both left a back-rank idea in: with pawns on f7/g7/h7, Qe8 is MATE; with
    // the h-pawn on h6, Qe8+ is a check extension that distorts a depth-2 test.)
    expect(seeOf('6k1/4ppp1/7p/8/8/8/2r1Q1PP/6K1 w - - 0 1', 'e2c2')).toBe(500);
  });

  test('equal trade of defended equal pieces is 0', () => {
    // exd6, cxd6. 100 - 100.
    expect(seeOf('4k3/2p5/3p4/4P3/8/8/8/4K3 w - - 0 1', 'e5d6')).toBe(0);
  });

  test('queen takes a pawn defended by a pawn loses 800', () => {
    // Qxd6, cxd6. 100 - 900.
    expect(seeOf('4k3/2p5/3p4/4Q3/8/8/8/4K3 w - - 0 1', 'e5d6')).toBe(-800);
  });
});

describe('SEE: the defended-bishop fixture', () => {
  const FEN = '6k1/6pp/5p2/4b3/3P4/8/4Q1PP/6K1 w - - 0 1';

  test('pawn takes bishop: +330 (dxe5 fxe5 Qxe5)', () => {
    expect(seeOf(FEN, 'd4e5')).toBe(330);
  });

  test('queen takes bishop: -470 (Qxe5 fxe5 dxe5)', () => {
    expect(seeOf(FEN, 'e2e5')).toBe(-470);
  });

  test('the two differ by 800cp — the gap the search relies on', () => {
    expect(seeOf(FEN, 'd4e5') - seeOf(FEN, 'e2e5')).toBe(800);
  });
});

describe('SEE: the tie fixture (documents why the old search test was brittle)', () => {
  // Black's queen on e8 and white's queen on e2 both bear on e5, so neither
  // side gains by continuing. There is no "right" answer to assert at the
  // search level.
  const FEN = '4q1k1/5ppp/8/4b3/3P4/8/4Q1PP/6K1 w - - 0 1';

  test('both recaptures evaluate to +330', () => {
    expect(seeOf(FEN, 'd4e5')).toBe(330);
    expect(seeOf(FEN, 'e2e5')).toBe(330);
  });
});

describe('SEE: x-rays', () => {
  test('a rook behind a rook joins the exchange', () => {
    // Rxd5 cxd5 Rxd5 Rxd5 — black's d8 rook has the last word, so white's
    // second rook never recaptures. 100 - 500.
    const fen = '3r2k1/6pp/2p5/3p4/8/8/3R2PP/3R2K1 w - - 0 1';
    expect(seeOf(fen, 'd2d5')).toBe(-400);
  });
});

describe('SEE: promotions', () => {
  test('promoting with capture counts the promoted piece', () => {
    const fen = '1n6/P7/8/8/8/8/8/k6K w - - 0 1';
    expect(seeOf(fen, 'a7b8q')).toBe(320 + 900 - 100);
  });
});