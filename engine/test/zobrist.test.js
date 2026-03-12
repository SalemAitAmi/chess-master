/**
 * Zobrist hash integrity tests.
 */

import { describe, test, expect } from 'vitest';
import { Board } from '../src/core/board.js';
import { computeZobristKey } from '../src/tables/zobrist.js';
import { generateAllLegalMoves } from '../src/core/moveGeneration.js';
import { POSITIONS } from './harness/fixtures.js';

function assertHashSync(board, context = '') {
  const incremental = board.gameState.zobristKey;
  const scratch = computeZobristKey(board);
  
  expect(
    incremental,
    `Zobrist drift ${context}\n` +
    `  incremental: 0x${incremental.toString(16)}\n` +
    `  scratch:     0x${scratch.toString(16)}\n` +
    `  XOR delta:   0x${(incremental ^ scratch).toString(16)}\n` +
    `  FEN:         ${board.toFen()}`
  ).toBe(scratch);
}

describe('Zobrist: incremental vs scratch consistency', () => {
  test('startpos hash matches immediately after fromFen', () => {
    const board = Board.fromFen(POSITIONS.startpos);
    assertHashSync(board, 'fresh from FEN');
  });

  test('stays synced after single quiet move', () => {
    const board = Board.fromFen(POSITIONS.startpos);
    board.makeMove(6, 21, null);
    assertHashSync(board, 'after g1f3');
  });

  test('stays synced after double pawn push (the historical bug)', () => {
    const board = Board.fromFen(POSITIONS.startpos);
    board.makeMove(12, 28, null);
    assertHashSync(board, 'after e2e4 (EP square set to e3)');

    board.makeMove(52, 36, null);
    assertHashSync(board, 'after e7e5 (EP e3→e6, rank 5 scheme)');

    board.makeMove(6, 21, null);
    assertHashSync(board, 'after g1f3 (EP cleared)');
  });

  test('stays synced after en passant capture', () => {
    const board = Board.fromFen(POSITIONS.startpos);
    board.makeMove(12, 28, null);
    assertHashSync(board, 'after e4');
    board.makeMove(48, 40, null);
    assertHashSync(board, 'after a6');
    board.makeMove(28, 36, null);
    assertHashSync(board, 'after e5');
    board.makeMove(51, 35, null);
    assertHashSync(board, 'after d5 (EP available on d6)');
    board.makeMove(36, 43, null);
    assertHashSync(board, 'after exd6 e.p.');
  });

  test('stays synced after castling', () => {
    const board = Board.fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    assertHashSync(board, 'castling setup');
    board.makeMove(4, 6, null);
    assertHashSync(board, 'after white O-O');
    board.makeMove(60, 58, null);
    assertHashSync(board, 'after black O-O-O');
  });

  test('stays synced after promotion', () => {
    const board = Board.fromFen('8/P7/8/8/8/8/8/k6K w - - 0 1');
    board.makeMove(48, 56, 1);
    assertHashSync(board, 'after a8=Q');
  });

  test('undo restores hash exactly', () => {
    const board = Board.fromFen(POSITIONS.startpos);
    const before = board.gameState.zobristKey;
    board.makeMove(12, 28, null);
    board.undoMove();
    
    expect(board.gameState.zobristKey).toBe(before);
    assertHashSync(board, 'after make+unmake');
  });

  test('random walk stays synced (fuzz)', () => {
    const board = Board.fromFen(POSITIONS.startpos);
    let seed = 0x12345678;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; return seed; };

    const movesPlayed = [];
    for (let ply = 0; ply < 40; ply++) {
      const moves = generateAllLegalMoves(board, board.gameState.activeColor);
      if (moves.length === 0) break;
      const m = moves[rand() % moves.length];
      board.makeMove(m.fromSquare, m.toSquare, m.promotionPiece);
      movesPlayed.push(m.algebraic);
      assertHashSync(board, `ply ${ply + 1} after ${m.algebraic}\n  line: ${movesPlayed.join(' ')}`);
    }

    const startKey = computeZobristKey(Board.fromFen(POSITIONS.startpos));
    while (board.plyCount > 0) board.undoMove();
    expect(board.gameState.zobristKey).toBe(startKey);
  });
});