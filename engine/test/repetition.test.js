/**
 * Repetition, 50-move rule, and draw-contempt tests.
 */
import { describe, test, expect } from 'vitest';
import { Board } from '../src/core/board.js';
import { SearchEngine } from '../src/search/search.js';
import { DEFAULT_CONFIG, PIECES } from '../src/core/constants.js';
import { UciSession } from './harness/uciSession.js';
import { POSITIONS } from './harness/fixtures.js';
import { searchOnce, evalComponents } from './harness/introspect.js';

// ═══════════════════════════════════════════════════════════════════════════
// Board-level repetition detection
// ═══════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════
// isGameOver — full threefold / 50-move / insufficient material
// ═══════════════════════════════════════════════════════════════════════════
describe('UCI gamestate detects terminal conditions', () => {
  test('threefold repetition ends the game', async () => {
    const s = new UciSession();
    await s.setPosition('8/8/8/4k3/8/8/4K3/7R w - - 0 1');
    for (const uci of ['h1h2', 'e5d5', 'h2h1', 'd5e5',
                       'h1h2', 'e5d5', 'h2h1', 'd5e5']) {
      await s.play(uci);
    }
    const st = await s.state();
    expect(st.repetitions).toBe(3);
    expect(st.status).toBe('threefold');
    expect(st.winner).toBe('draw');
  });

  test('insufficient material K vs K', async () => {
    const s = new UciSession();
    await s.setPosition('8/8/8/4k3/8/8/4K3/8 w - - 0 1');
    expect((await s.state()).status).toBe('insufficient_material');
  });
  
  test('K+R vs K is NOT insufficient material', async () => {
    const s = new UciSession();
    await s.setPosition('8/8/8/4k3/8/8/4K3/7R w - - 0 1');
    expect((await s.state()).status).toBe('ongoing');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Search-level draw handling
// ═══════════════════════════════════════════════════════════════════════════
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
    // With material-aware contempt the draw scores ≈ -50 from white's POV
    // (white is winning so draws are bad). Either way |score| < 100.
    expect(Math.abs(r.score)).toBeLessThan(100);
  });

  test('position at halfMoveClock=90 still scores as winning', () => {
    const fen = '8/8/8/4k3/8/8/4K3/7R w - - 90 45';
    const r = searchOnce(fen, 3);
    expect(r.score).toBeGreaterThan(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Draw contempt: material-aware behaviour
// ═══════════════════════════════════════════════════════════════════════════
describe('Draw contempt: material-aware scoring', () => {
  test('winning side gets negative contempt (avoids draws)', () => {
    // White has K+R vs K — winning.  Engine search colour = white.
    const engine = new SearchEngine(DEFAULT_CONFIG);
    const board = Board.fromFen('8/8/8/4k3/8/8/4K3/7R w - - 0 1');
    engine.searchColor = 'white';
    // At ply 0 (white's node): contempt should be negative (avoid draw)
    const c0 = engine._drawContempt(board, 0);
    expect(c0).toBeLessThan(0);
    // At ply 1 (opponent's node): negated → positive
    const c1 = engine._drawContempt(board, 1);
    expect(c1).toBeGreaterThan(0);
  });

  test('losing side gets positive contempt (seeks draws)', () => {
    // Black has K vs K+R — losing.  Engine search colour = black.
    const engine = new SearchEngine(DEFAULT_CONFIG);
    const board = Board.fromFen('8/8/8/4k3/8/8/4K3/7R b - - 0 1');
    engine.searchColor = 'black';
    // At ply 0 (black's node): contempt should be positive (seek draw)
    const c0 = engine._drawContempt(board, 0);
    expect(c0).toBeGreaterThan(0);
  });

  test('equal material gives tiny negative contempt (play on)', () => {
    const engine = new SearchEngine(DEFAULT_CONFIG);
    const board = Board.fromFen('8/8/8/4k3/8/8/4K3/8 w - - 0 1');
    engine.searchColor = 'white';
    const c0 = engine._drawContempt(board, 0);
    expect(c0).toBe(-1);
  });

  test('contempt magnitude scales with material gap', () => {
    const engine = new SearchEngine(DEFAULT_CONFIG);
    engine.searchColor = 'white';
    // K+Q vs K  (900cp gap) → larger |contempt| than K+N vs K (320cp gap)
    const boardQ = Board.fromFen('8/8/8/4k3/8/8/4K3/7Q w - - 0 1');
    const boardN = Board.fromFen('8/8/8/4k3/8/8/4K3/7N w - - 0 1');
    const cQ = Math.abs(engine._drawContempt(boardQ, 0));
    const cN = Math.abs(engine._drawContempt(boardN, 0));
    expect(cQ).toBeGreaterThan(cN);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Mop-up eval
// ═══════════════════════════════════════════════════════════════════════════
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