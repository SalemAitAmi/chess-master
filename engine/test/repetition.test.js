/**
 * Repetition and 50-move rule tests.
 */

import { describe, test, expect } from 'vitest';
import { Board } from '../src/core/board.js';
import { POSITIONS } from './harness/fixtures.js';
import { searchOnce, evalComponents } from './harness/introspect.js';

describe('Repetition: board-level detection', () => {
  test('fresh position has repetition count 1', () => {
    const board = Board.fromFen(POSITIONS.startpos);
    expect(board.countRepetitions()).toBe(1);
  });

  test('shuffling knights back and forth triggers detection', () => {
    const board = Board.fromFen(POSITIONS.startpos);

    board.makeMove(6, 21, null);
    board.makeMove(62, 45, null);
    board.makeMove(21, 6, null);
    board.makeMove(45, 62, null);

    expect(board.countRepetitions()).toBe(2);
    expect(board.isRepetition(2)).toBe(true);
    expect(board.isRepetition(3)).toBe(false);

    board.makeMove(6, 21, null);
    board.makeMove(62, 45, null);
    board.makeMove(21, 6, null);
    board.makeMove(45, 62, null);

    expect(board.countRepetitions()).toBe(3);
    expect(board.isRepetition(3)).toBe(true);
  });

  test('irreversible move resets the repetition window', () => {
    const board = Board.fromFen(POSITIONS.startpos);

    board.makeMove(6, 21, null);
    board.makeMove(62, 45, null);
    board.makeMove(21, 6, null);
    board.makeMove(45, 62, null);
    expect(board.countRepetitions()).toBe(2);

    board.makeMove(12, 28, null);
    expect(board.countRepetitions()).toBe(1);
  });

  test('50-move counter reaches 100 after 100 reversible plies', () => {
    const board = Board.fromFen('8/8/8/4k3/8/8/4K3/7R w - - 0 1');
    const sq = {
      Rh1h2: [7, 15], Rh2h1: [15, 7],
      Ke5d5: [36, 35], Kd5e5: [35, 36],
    };
    
    for (let i = 0; i < 25; i++) {
      board.makeMove(...sq.Rh1h2, null);
      board.makeMove(...sq.Ke5d5, null);
      board.makeMove(...sq.Rh2h1, null);
      board.makeMove(...sq.Kd5e5, null);
    }
    
    expect(board.gameState.halfMoveClock).toBe(100);
  });
});

describe('Repetition: search scores repeats as draws', () => {
  test('winning side avoids shuffling into repetition', () => {
    const board = Board.fromFen('8/8/8/4k3/8/8/4K3/7R w - - 0 1');

    board.makeMove(7, 15, null);
    board.makeMove(36, 35, null);
    board.makeMove(15, 7, null);
    board.makeMove(35, 36, null);

    const r = searchOnce(board.toFen(), 4);
    expect(r.score).toBeGreaterThan(200);
  });
});

describe('50-move rule: search scores as draw', () => {
  test('position at halfMoveClock=99 with quiet best move scores near draw', () => {
    const fen = '8/8/8/4k3/8/8/4K3/7R w - - 99 50';
    const r = searchOnce(fen, 3);
    expect(Math.abs(r.score)).toBeLessThan(100);
  });

  test('position at halfMoveClock=90 still scores as winning', () => {
    const fen = '8/8/8/4k3/8/8/4K3/7R w - - 90 45';
    const r = searchOnce(fen, 3);
    expect(r.score).toBeGreaterThan(200);
  });
});

describe('Mop-up eval: progress gradient in won endgames', () => {
  test('enemy king at edge scores better than enemy king at center', () => {
    const kingCenter = '8/8/8/4k3/8/8/4K3/7R w - - 0 1';
    const kingEdge   = '8/8/8/8/8/8/4K2k/7R w - - 0 1';

    const centerEval = evalComponents(kingCenter, 'white');
    const edgeEval   = evalComponents(kingEdge, 'white');

    expect(edgeEval.total).toBeGreaterThan(centerEval.total);
  });

  test('our king closer to enemy king scores better', () => {
    const kingsFar   = '7k/8/8/8/8/8/8/K6R w - - 0 1';
    const kingsClose = '7k/5K2/8/8/8/8/8/7R w - - 0 1';

    const farEval   = evalComponents(kingsFar, 'white');
    const closeEval = evalComponents(kingsClose, 'white');

    expect(closeEval.total).toBeGreaterThan(farEval.total);
  });

  test('mop-up is silent in the middlegame', () => {
    const ec = evalComponents(POSITIONS.startpos, 'white');
    expect(Math.abs(ec.total)).toBeLessThan(50);
  });

  test('mop-up sign flips when WE are the lone king', () => {
    const usLosing = '7r/8/8/4k3/8/8/4K3/8 w - - 0 1';
    const ec = evalComponents(usLosing, 'white');
    expect(ec.total).toBeLessThan(-300);
  });
});