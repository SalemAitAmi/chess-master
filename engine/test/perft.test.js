/**
 * perft — exact leaf counts. This is the correctness gate for move generation:
 * pins, double check, capture/push masks, castling through check, en-passant
 * discovered check and under-promotions all show up here as an integer
 * mismatch, not as a subtly-worse engine.
 *
 * On failure we print the root-move divide so the offending move is one
 * bisection away from the offending ply.
 *
 *   npm run test:perft
 *   PERFT_DEEP=1 npm run test:perft     # adds the multi-million-node entries
 */
import { describe, test, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Board } from '../src/core/board.js';
import { perft, perftDivide } from '../src/core/perft.js';
import { installNoopLogger } from '../src/logging/logger.js';

beforeAll(() => installNoopLogger());

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITE = JSON.parse(fs.readFileSync(path.join(HERE, 'perft.json'), 'utf8'));

const STARTPOS  = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const KIWIPETE  = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
const POSITION3 = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1';
const POSITION4 = 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1';
const POSITION5 = 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8';
const POSITION6 = 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10';

// Canonical CPW positions. These are the ones that catch the bugs a random
// game position never will: kiwipete = castling + pins, position 3 = pawn
// endgame + en-passant pins, position 4 = promotions under check.
const CANONICAL = [
  { fen: STARTPOS,  depth: 1, nodes: 20 },
  { fen: STARTPOS,  depth: 2, nodes: 400 },
  { fen: STARTPOS,  depth: 3, nodes: 8902 },
  { fen: STARTPOS,  depth: 4, nodes: 197281 },
  { fen: KIWIPETE,  depth: 1, nodes: 48 },
  { fen: KIWIPETE,  depth: 2, nodes: 2039 },
  { fen: KIWIPETE,  depth: 3, nodes: 97862 },
  { fen: POSITION3, depth: 1, nodes: 14 },
  { fen: POSITION3, depth: 2, nodes: 191 },
  { fen: POSITION3, depth: 3, nodes: 2812 },
  { fen: POSITION3, depth: 4, nodes: 43238 },
  { fen: POSITION3, depth: 5, nodes: 674624 },
  { fen: POSITION4, depth: 1, nodes: 6 },
  { fen: POSITION4, depth: 2, nodes: 264 },
  { fen: POSITION4, depth: 3, nodes: 9467 },
  { fen: POSITION4, depth: 4, nodes: 422333 },
  { fen: POSITION5, depth: 1, nodes: 44 },
  { fen: POSITION5, depth: 2, nodes: 1486 },
  { fen: POSITION5, depth: 3, nodes: 62379 },
  { fen: POSITION6, depth: 1, nodes: 46 },
  { fen: POSITION6, depth: 2, nodes: 2079 },
  { fen: POSITION6, depth: 3, nodes: 89890 },
];

const DEEP = [
  { fen: STARTPOS,  depth: 5, nodes: 4865609 },
  { fen: KIWIPETE,  depth: 4, nodes: 4085603 },
  { fen: POSITION5, depth: 4, nodes: 2103487 },
  { fen: POSITION6, depth: 4, nodes: 3894594 },
];

const totals = { nodes: 0, ms: 0 };

function runCase(pos) {
  const board = Board.fromFen(pos.fen);
  const t0 = process.hrtime.bigint();
  const n = perft(board, pos.depth);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  totals.nodes += n;
  totals.ms += ms;

  if (n !== pos.nodes) {
    const divide = perftDivide(Board.fromFen(pos.fen), pos.depth);
    const rows = [...divide.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    console.error(`\n[perft MISMATCH] ${pos.fen} depth ${pos.depth}: got ${n}, want ${pos.nodes}`);
    console.error('  divide: ' + rows.map(([m, c]) => `${m}:${c}`).join(' '));
    console.error(`  (sum ${rows.reduce((s, [, c]) => s + c, 0)})`);
  } else {
    console.log(
      `[perft] d${pos.depth} ${n.toString().padStart(9)} nodes ` +
      `${ms.toFixed(0).padStart(6)}ms ${(n / Math.max(ms, 0.001)).toFixed(0).padStart(5)}k nps  ${pos.fen}`
    );
  }
  expect(n, `${pos.fen} depth ${pos.depth}`).toBe(pos.nodes);
}

describe.sequential('perft: canonical positions', () => {
  for (const pos of CANONICAL) {
    test(`d${pos.depth} = ${pos.nodes} :: ${pos.fen}`, { timeout: 120_000 }, () => runCase(pos));
  }
});

describe.sequential('perft: suite (test/perft.json)', () => {
  for (const pos of SUITE) {
    test(`d${pos.depth} = ${pos.nodes} :: ${pos.fen}`, { timeout: 180_000 }, () => runCase(pos));
  }
});

describe.sequential('perft: deep', () => {
  const run = process.env.PERFT_DEEP === '1' ? test : test.skip;
  for (const pos of DEEP) {
    run(`d${pos.depth} = ${pos.nodes} :: ${pos.fen}`, { timeout: 600_000 }, () => runCase(pos));
  }
});

describe('perft: throughput summary', () => {
  test('aggregate', () => {
    // Not a gate — hardware varies. Watch the trend across commits: a drop in
    // nps with unchanged node counts means generation got slower, which is the
    // only thing this harness can see (search changes don't affect perft).
    console.log(
      `\n═══ perft totals: ${totals.nodes.toLocaleString()} nodes in ${totals.ms.toFixed(0)}ms ` +
      `= ${(totals.nodes / Math.max(totals.ms, 1) / 1000).toFixed(2)}M nps ═══\n`
    );
    expect(totals.nodes).toBeGreaterThan(0);
  });
});