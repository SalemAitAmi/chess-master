/**
 * Endgame progress tests — the Colosseum regression guard.
 */

import { describe, test, expect } from 'vitest';
import { Board } from '../src/core/board.js';
import { SearchEngine } from '../src/search/search.js';
import { generateAllLegalMoves, isInCheck } from '../src/core/moveGeneration.js';
import { DEFAULT_CONFIG, PIECES, WHITE_IDX, BLACK_IDX } from '../src/core/constants.js';

// Progress metrics
function cmd(sq) {
  const f = sq & 7, r = sq >> 3;
  return (f < 4 ? 3 - f : f - 4) + (r < 4 ? 3 - r : r - 4);
}

function kdist(a, b) {
  return Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 3) - (b >> 3)));
}

function snapshot(board) {
  const wK = board.bbPieces[WHITE_IDX][PIECES.KING].getLSB();
  const bK = board.bbPieces[BLACK_IDX][PIECES.KING].getLSB();
  return {
    wK, bK,
    wK_cmd: cmd(wK),
    bK_cmd: cmd(bK),
    kingDist: kdist(wK, bK),
    halfMoveClock: board.gameState.halfMoveClock,
  };
}

function selfPlay(fen, { depth = 5, maxPlies = 50 } = {}) {
  const board = Board.fromFen(fen);
  const engine = new SearchEngine(DEFAULT_CONFIG);
  const moves = [];
  const snapshots = [snapshot(board)];
  let termination = 'ply-limit';

  for (let i = 0; i < maxPlies; i++) {
    const color = board.gameState.activeColor;
    const legal = generateAllLegalMoves(board, color);

    if (legal.length === 0) {
      termination = isInCheck(board, color) ? 'checkmate' : 'stalemate';
      break;
    }
    if (board.gameState.halfMoveClock >= 100) { termination = '50-move'; break; }
    if (board.isRepetition(3)) { termination = 'threefold'; break; }

    const { bestMove } = engine.search(board, depth);
    if (!bestMove) { termination = 'no-move'; break; }

    board.makeMove(bestMove.fromSquare, bestMove.toSquare, bestMove.promotionPiece);
    moves.push(bestMove.algebraic);
    snapshots.push(snapshot(board));
  }

  return { moves, termination, snapshots, finalFen: board.toFen() };
}

function longestShuffleRun(moves) {
  let best = 1, cur = 1;
  for (let i = 2; i < moves.length; i++) {
    if (moves[i] === moves[i - 2]) {
      cur++;
      if (cur > best) best = cur;
    } else {
      cur = 1;
    }
  }
  return best;
}

describe('Endgame progress (Colosseum regression)', () => {

  test('K+R vs K: defending king is driven toward a corner', { timeout: 30000 }, () => {
    const r = selfPlay('8/8/8/4k3/8/8/4K3/7R w - - 0 1', {
      depth: 5, maxPlies: 40,
    });

    const start = r.snapshots[0];
    const end = r.snapshots[r.snapshots.length - 1];

    // Core assertion: defender pushed outward
    expect(
      end.bK_cmd >= 5 || r.termination === 'checkmate',
      `Black king should be at rim (CMD≥5) or mated. End CMD: ${end.bK_cmd}, termination: ${r.termination}`
    ).toBe(true);

    // Attacking king engagement
    expect(
      end.kingDist <= 3 || r.termination === 'checkmate',
      `White king should close in. End dist: ${end.kingDist}`
    ).toBe(true);

    // No shuffling
    const shuffle = longestShuffleRun(r.moves);
    expect(shuffle, `Shuffle detected: ${shuffle}× same move`).toBeLessThanOrEqual(2);
  });

  test('K+Q vs K: mates within 25 plies', { timeout: 20000 }, () => {
    const r = selfPlay('8/8/8/4k3/8/8/4K3/7Q w - - 0 1', {
      depth: 4, maxPlies: 25,
    });

    expect(r.termination).toBe('checkmate');
  });

  test('reported Colosseum position: no oscillation', { timeout: 30000 }, () => {
    const r = selfPlay('8/2R2k2/8/3K4/8/8/8/8 w - - 0 1', {
      depth: 5, maxPlies: 40,
    });

    const shuffle = longestShuffleRun(r.moves);
    expect(shuffle, `Colosseum shuffle: ${shuffle}× same move`).toBeLessThanOrEqual(2);

    const end = r.snapshots[r.snapshots.length - 1];
    expect(
      end.bK_cmd >= 5 || r.termination === 'checkmate' || r.termination === 'stalemate',
      `Should make progress. End CMD: ${end.bK_cmd}, termination: ${r.termination}`
    ).toBe(true);

    expect(r.termination).not.toBe('threefold');
  });

  test('progress is monotone across a long KRK game', { timeout: 45000 }, () => {
    const r = selfPlay('8/8/8/4k3/8/8/4K3/7R w - - 0 1', {
      depth: 5, maxPlies: 60,
    });

    const shuffle = longestShuffleRun(r.moves);
    expect(shuffle).toBeLessThanOrEqual(2);

    if (r.snapshots.length > 20) {
      const mid = r.snapshots[20];
      const end = r.snapshots[r.snapshots.length - 1];
      expect(
        end.bK_cmd >= mid.bK_cmd - 1 || r.termination === 'checkmate',
        `Progress regressed: mid CMD=${mid.bK_cmd}, end CMD=${end.bK_cmd}`
      ).toBe(true);
    }
  });
});