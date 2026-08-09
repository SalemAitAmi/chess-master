/**
 * Performance harness. NOT a pass/fail gate — read the console output and
 * compare across commits.
 *
 * The depth/wall-clock matrix this file used to contain measured the wrong
 * thing: search time at a fixed depth depends on the evaluation (which changes
 * the tree shape) as much as on the code speed, so two commits were never
 * comparable. It is replaced by:
 *
 *   1. perft throughput — move generation only, exact node counts, so nps is
 *      the single variable. This is the number to track.
 *   2. search NODE COUNTS per feature — deterministic, hardware-independent.
 *      A feature that prunes more searches fewer nodes, full stop. Wall time
 *      is printed alongside but is context, not the metric.
 *   3. raw eval throughput — the per-leaf floor.
 *
 *   npm test -- profiling
 *   PROFILE_DEEP=1 npm test -- profiling   # adds depth 10
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { Board } from '../src/core/board.js';
import { perft } from '../src/core/perft.js';
import { SearchEngine } from '../src/search/search.js';
import { Evaluator } from '../src/evaluation/evaluate.js';
import { DEFAULT_CONFIG } from '../src/core/constants.js';
import { installNoopLogger } from '../src/logging/logger.js';

beforeAll(() => installNoopLogger());

const POSITIONS = {
  opening:    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
  kiwipete:   'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  middlegame: 'r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 8',
  endgame:    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Move generation throughput
// ─────────────────────────────────────────────────────────────────────────────
describe.sequential('Profiling: perft throughput', () => {
  const PERFT_DEPTH = { opening: 5, kiwipete: 4, middlegame: 4, endgame: 5 };
  const results = {};

  for (const [name, fen] of Object.entries(POSITIONS)) {
    test(`${name} @ perft ${PERFT_DEPTH[name]}`, { timeout: 300_000 }, () => {
      const depth = PERFT_DEPTH[name];
      // Warmup so we measure JIT'd code, not compilation.
      perft(Board.fromFen(fen), 2);

      const board = Board.fromFen(fen);
      const t0 = process.hrtime.bigint();
      const nodes = perft(board, depth);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;

      results[name] = { nodes, ms, nps: nodes / (ms / 1000) };
      console.log(
        `[MOVEGEN] ${name.padEnd(11)} d${depth}  ` +
        `${nodes.toString().padStart(9)} nodes  ${ms.toFixed(0).padStart(6)}ms  ` +
        `${(results[name].nps / 1e6).toFixed(2)}M nps`
      );
      expect(nodes).toBeGreaterThan(0);
    });
  }

  test('summary', () => {
    const all = Object.values(results);
    const nodes = all.reduce((s, r) => s + r.nodes, 0);
    const ms = all.reduce((s, r) => s + r.ms, 0);
    console.log(`\n═══ movegen: ${(nodes / (ms / 1000) / 1e6).toFixed(2)}M nps over ${nodes.toLocaleString()} nodes ═══\n`);
    expect(nodes).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Search feature isolation — measured in nodes (deterministic)
// ─────────────────────────────────────────────────────────────────────────────
function searchOnce(fen, depth, overrides = {}) {
  const engine = new SearchEngine({ ...DEFAULT_CONFIG, useOpeningBook: false, useMoveVariation: false, ...overrides });
  engine.search(Board.fromFen(fen), 2);     // warmup
  engine.resetSearchState();

  const board = Board.fromFen(fen);
  const t0 = process.hrtime.bigint();
  const r = engine.search(board, depth);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms, nodes: r.nodes, qNodes: r.qNodes, bestMove: r.bestMove?.algebraic, score: r.score, stats: r.stats };
}

describe.sequential('Profiling: search feature isolation', () => {
  const fen = POSITIONS.middlegame;
  const depth = process.env.PROFILE_DEEP === '1' ? 10 : 6;

  const FEATURES = [
    { name: 'baseline',       config: {} },
    { name: 'no-quiescence',  config: { useQuiescence: false } },
    { name: 'no-TT',          config: { useTranspositionTable: false } },
    { name: 'no-null-move',   config: { useNullMovePruning: false } },
    { name: 'no-LMR',         config: { useLateMovereduction: false } },
    { name: 'no-futility',    config: { useFutilityPruning: false } },
    { name: 'no-SEE-prune',   config: { useSEEPruning: false } },
    { name: 'no-PVS',         config: { usePVS: false } },
    { name: 'no-aspiration',  config: { useAspirationWindows: false } },
    { name: 'no-IID',         config: { useIID: false } },
    { name: 'no-killers',     config: { useKillerMoves: false } },
    { name: 'no-history',     config: { useHistoryHeuristic: false } },
  ];

  const results = {};
  for (const f of FEATURES) {
    test(f.name, { timeout: 300_000 }, () => {
      const r = searchOnce(fen, depth, f.config);
      results[f.name] = r;
      const base = results.baseline;
      const pct = base ? `${r.nodes >= base.nodes ? '+' : ''}${((r.nodes / base.nodes - 1) * 100).toFixed(0)}%` : '—';
      console.log(
        `  ${f.name.padEnd(16)} ${r.nodes.toString().padStart(10)}n + ${r.qNodes.toString().padStart(9)}qn  ` +
        `${pct.padStart(7)}  ${r.ms.toFixed(0).padStart(6)}ms  best=${r.bestMove}`
      );
      if (base && r.bestMove !== base.bestMove) {
        console.warn(`    ⚠ best move changed: ${base.bestMove} → ${r.bestMove} (${base.score} → ${r.score})`);
      }
      expect(r.nodes).toBeGreaterThan(0);
    });
  }

  test('ranking by node-count impact', () => {
    const base = results.baseline;
    console.log(`\n═══ nodes searched when each feature is DISABLED (baseline ${base.nodes}) ═══`);
    FEATURES.filter(f => f.name !== 'baseline')
      .map(f => ({ name: f.name, ...results[f.name] }))
      .sort((a, b) => b.nodes - a.nodes)
      .forEach(r => console.log(`  ${r.name.padEnd(16)} ${((r.nodes / base.nodes - 1) * 100).toFixed(0).padStart(5)}%`));
    expect(true).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Raw eval throughput — the per-leaf floor
// ─────────────────────────────────────────────────────────────────────────────
describe('Profiling: raw eval throughput', () => {
  test('evaluations per second', () => {
    const board = Board.fromFen(POSITIONS.middlegame);
    const evaluator = new Evaluator(DEFAULT_CONFIG);
    for (let i = 0; i < 1000; i++) evaluator.evaluate(board, 'white');

    const N = 100_000;
    const t0 = process.hrtime.bigint();
    let sink = 0;
    for (let i = 0; i < N; i++) sink += evaluator.evaluate(board, 'white').score;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;

    console.log(`[EVAL] ${N} evals in ${ms.toFixed(0)}ms = ${(N / ms).toFixed(0)}k eval/s (sink=${sink})`);
    expect(N / (ms / 1000)).toBeGreaterThan(10_000);
  });
});