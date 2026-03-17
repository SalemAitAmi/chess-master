/**
 * Performance profiling — correlate execution time with depth and features.
 *
 * This suite is NOT a pass/fail gate (the assertions are just "ran
 * without hanging"). It's a measurement harness: run it, read the
 * console output, compare across commits.
 *
 *   npm test -- profiling                    # depths 6, 8
 *   PROFILE_DEEP=1 npm test -- profiling     # + depth 12 (slow — minutes)
 *
 * NoopLogger is installed up front so we're measuring search/eval, not
 * the logging subsystem. If you want to profile WITH logging on, comment
 * out the installNoopLogger() call and set LOG_MASK.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { Board } from '../src/core/board.js';
import { SearchEngine } from '../src/search/search.js';
import { Evaluator } from '../src/evaluation/evaluate.js';
import { DEFAULT_CONFIG } from '../src/core/constants.js';
import { installNoopLogger } from '../src/logging/logger.js';

beforeAll(() => {
  // Clean profiling baseline — no logger overhead, no file I/O.
  installNoopLogger();
});

// ─────────────────────────────────────────────────────────────────────────────
// Positions chosen to exercise different engine characteristics:
//   opening    — wide branching, opening book might short-circuit
//   middlegame — tactical complexity, quiescence works hard
//   endgame    — narrow branching, mop-up eval + deep search
// ─────────────────────────────────────────────────────────────────────────────
const PROFILE_POSITIONS = {
  opening:    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
  middlegame: 'r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 8',
  tactical:   'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
  endgame:    '8/8/8/4k3/8/8/4K3/7R w - - 0 1',
};

const RUN_DEEP = process.env.PROFILE_DEEP === '1';
const DEPTHS = RUN_DEEP ? [6, 8, 12] : [6, 8];

// ─────────────────────────────────────────────────────────────────────────────
// Timing helpers
// ─────────────────────────────────────────────────────────────────────────────

function timeSearch(fen, depth, configOverrides = {}) {
  const board = Board.fromFen(fen);
  const engine = new SearchEngine({
    ...DEFAULT_CONFIG,
    useOpeningBook: false,   // book lookup would short-circuit and hide search cost
    ...configOverrides,
  });

  // Warmup: one shallow search so V8 has JIT'd the hot functions.
  // Without this, depth-6 numbers are dominated by compilation.
  engine.search(board, 2);
  engine.resetSearchState();

  const start = process.hrtime.bigint();
  const result = engine.search(board, depth);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

  return {
    elapsedMs,
    nodes: result.nodes,
    qNodes: result.qNodes,
    // NPS is the invariant to watch across depths — if it DROPS at higher
    // depth, something is scaling worse than O(nodes). TT collisions,
    // history table saturation, GC pressure from an allocation leak, etc.
    nps: Math.round(result.nodes / (elapsedMs / 1000)),
    stats: result.stats,
    bestMove: result.bestMove?.algebraic,
    score: result.score,
  };
}

function formatRow(label, r, baseline = null) {
  const pct = baseline
    ? `${r.elapsedMs >= baseline.elapsedMs ? '+' : ''}${((r.elapsedMs / baseline.elapsedMs - 1) * 100).toFixed(0)}%`
    : '—';
  return `  ${label.padEnd(18)} ` +
         `${r.elapsedMs.toFixed(0).padStart(7)}ms  ` +
         `${r.nodes.toString().padStart(10)} nodes  ` +
         `${(r.nps / 1000).toFixed(0).padStart(5)}k nps  ` +
         `${pct.padStart(6)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Depth scaling — the headline numbers the user asked for.
// Difficulty tiers map directly: casual=6, strategic=8, master=12.
// ─────────────────────────────────────────────────────────────────────────────

describe.sequential('Profiling: depth scaling', () => {
  const results = {};

  for (const [posName, fen] of Object.entries(PROFILE_POSITIONS)) {
    for (const depth of DEPTHS) {
      // master-depth endgame is fast (few pieces), but master-depth
      // middlegame can take minutes. Timeout scales with the expected
      // node explosion — roughly 5× per depth step in the middlegame.
      const timeoutMs = depth >= 12 ? 600_000 : depth >= 8 ? 120_000 : 30_000;

      test(`${posName} @ depth ${depth}`, { timeout: timeoutMs }, () => {
        const r = timeSearch(fen, depth);
        results[`${posName}@${depth}`] = r;

        console.log(
          `[DEPTH] ${posName.padEnd(10)} d${depth.toString().padEnd(2)} ` +
          `${r.elapsedMs.toFixed(0).padStart(7)}ms  ` +
          `${r.nodes.toString().padStart(10)}n + ${r.qNodes.toString().padStart(9)}qn  ` +
          `${(r.nps / 1000).toFixed(0).padStart(5)}k nps  ` +
          `best=${r.bestMove} (${r.score}cp)`
        );

        expect(r.elapsedMs).toBeGreaterThan(0);
        expect(r.nodes).toBeGreaterThan(0);
      });
    }
  }

  test('summary: effective branching factor', () => {
    // EBF ≈ (nodes_d+2 / nodes_d)^(1/2). Healthy alpha-beta with good
    // ordering should land around 3-5. If it's >8, move ordering has
    // regressed. If it's <2, something is over-pruning.
    console.log('\n═══ Depth scaling summary ═══');
    for (const posName of Object.keys(PROFILE_POSITIONS)) {
      const rows = DEPTHS.map(d => results[`${posName}@${d}`]).filter(Boolean);
      if (rows.length < 2) continue;

      console.log(`\n  ${posName}:`);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const d = DEPTHS[i];
        let ebf = '—';
        if (i > 0) {
          const prevN = rows[i - 1].nodes;
          const stepD = d - DEPTHS[i - 1];
          ebf = Math.pow(r.nodes / prevN, 1 / stepD).toFixed(2);
        }
        console.log(
          `    d${d.toString().padEnd(2)} ${r.elapsedMs.toFixed(0).padStart(7)}ms  ` +
          `${r.nodes.toString().padStart(10)}n  EBF≈${ebf}  ` +
          `${(r.nps / 1000).toFixed(0).padStart(5)}k nps`
        );
      }
    }
    expect(true).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature isolation — toggle one search feature off at a time and measure
// the delta. A feature that HURTS when disabled was helping; one that
// HELPS when disabled is costing more than it saves (a tuning target).
// ─────────────────────────────────────────────────────────────────────────────

describe.sequential('Profiling: search feature isolation', () => {
  // Middlegame at casual depth — rich enough to exercise every feature,
  // fast enough to run the whole matrix in under a minute.
  const fen = PROFILE_POSITIONS.middlegame;
  const depth = 6;

  const FEATURES = [
    { name: 'baseline',       config: {} },
    { name: 'no-quiescence',  config: { useQuiescence: false } },
    { name: 'no-TT',          config: { useTranspositionTable: false } },
    { name: 'no-null-move',   config: { useNullMovePruning: false } },
    { name: 'no-LMR',         config: { useLateMovereduction: false } },
    { name: 'no-futility',    config: { useFutilityPruning: false } },
    { name: 'no-PVS',         config: { usePVS: false } },
    { name: 'no-aspiration',  config: { useAspirationWindows: false } },
    { name: 'no-IID',         config: { useIID: false } },
    { name: 'no-killers',     config: { useKillerMoves: false } },
    { name: 'no-history',     config: { useHistoryHeuristic: false } },
  ];

  const results = {};

  for (const f of FEATURES) {
    test(f.name, { timeout: 60_000 }, () => {
      const r = timeSearch(fen, depth, f.config);
      results[f.name] = r;

      const baseline = results.baseline;
      console.log(formatRow(f.name, r, baseline));

      // Sanity: disabling a feature shouldn't change the best move in a
      // quiet position. If it does, that feature is influencing correctness,
      // not just speed — worth investigating.
      if (baseline && r.bestMove !== baseline.bestMove) {
        console.warn(
          `    ⚠ best move changed: ${baseline.bestMove} → ${r.bestMove} ` +
          `(${baseline.score}cp → ${r.score}cp)`
        );
      }

      expect(r.elapsedMs).toBeGreaterThan(0);
    });
  }

  test('summary: feature impact ranking', () => {
    const baseline = results.baseline;
    console.log('\n═══ Feature impact (disabling each, vs baseline) ═══');
    console.log(`  Position: ${fen}`);
    console.log(`  Depth: ${depth}  Baseline: ${baseline.elapsedMs.toFixed(0)}ms, ${baseline.nodes} nodes\n`);

    const ranked = FEATURES
      .filter(f => f.name !== 'baseline')
      .map(f => ({ name: f.name, ...results[f.name] }))
      .sort((a, b) => b.elapsedMs - a.elapsedMs);

    for (const r of ranked) {
      const timePct  = ((r.elapsedMs / baseline.elapsedMs - 1) * 100).toFixed(0);
      const nodesPct = ((r.nodes / baseline.nodes - 1) * 100).toFixed(0);
      console.log(
        `  ${r.name.padEnd(18)} ` +
        `time ${timePct >= 0 ? '+' : ''}${timePct}%  ` +
        `nodes ${nodesPct >= 0 ? '+' : ''}${nodesPct}%`
      );
    }
    expect(true).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation component isolation — eval is called at every leaf + qnode,
// so a slow eval term dominates total time at high depth. Toggle each
// term off and measure NPS change.
// ─────────────────────────────────────────────────────────────────────────────

describe.sequential('Profiling: evaluation component cost', () => {
  const fen = PROFILE_POSITIONS.middlegame;
  const depth = 6;

  // Each override disables ONE eval term. Material stays on (otherwise
  // the engine plays garbage and node counts aren't comparable).
  const EVAL_TERMS = [
    { name: 'baseline',         config: {} },
    { name: 'no-centerControl', config: { useCenterControl: false } },
    { name: 'no-development',   config: { useDevelopment: false } },
    { name: 'no-pawnStructure', config: { usePawnStructure: false } },
    { name: 'no-kingSafety',    config: { useKingSafety: false } },
  ];

  const results = {};

  for (const t of EVAL_TERMS) {
    test(t.name, { timeout: 60_000 }, () => {
      const r = timeSearch(fen, depth, t.config);
      results[t.name] = r;
      console.log(formatRow(t.name, r, results.baseline));
      expect(r.elapsedMs).toBeGreaterThan(0);
    });
  }

  test('summary: per-term cost estimate', () => {
    const baseline = results.baseline;
    console.log('\n═══ Eval term cost (NPS gain when term is OFF) ═══');
    console.log(`  Baseline NPS: ${(baseline.nps / 1000).toFixed(0)}k\n`);

    // NPS delta isolates the per-call cost of each term independent of
    // how it shapes the tree. A term that's expensive per-call but prunes
    // well (rare for eval, common for search features) would show low NPS
    // delta but high total-time delta — compare both.
    for (const t of EVAL_TERMS) {
      if (t.name === 'baseline') continue;
      const r = results[t.name];
      const npsGain = r.nps - baseline.nps;
      const npsPct  = ((r.nps / baseline.nps - 1) * 100).toFixed(1);
      console.log(
        `  ${t.name.padEnd(20)} ` +
        `${(r.nps / 1000).toFixed(0).padStart(5)}k nps  ` +
        `(${npsPct >= 0 ? '+' : ''}${npsPct}% = ~${Math.abs(npsGain / 1000).toFixed(0)}k nps saved)`
      );
    }
    expect(true).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Raw eval throughput — how many static evaluations per second, isolated
// from search. This is the per-leaf floor; if search NPS is way below
// this, the overhead is in move generation / make-unmake / TT, not eval.
// ─────────────────────────────────────────────────────────────────────────────

describe('Profiling: raw eval throughput', () => {
  test('evaluations per second (middlegame position)', () => {
    const board = Board.fromFen(PROFILE_POSITIONS.middlegame);
    const evaluator = new Evaluator(DEFAULT_CONFIG);

    // Warmup
    for (let i = 0; i < 1000; i++) evaluator.evaluate(board, 'white');

    const ITERATIONS = 100_000;
    const start = process.hrtime.bigint();
    let sink = 0;   // prevent the loop from being optimized away
    for (let i = 0; i < ITERATIONS; i++) {
      sink += evaluator.evaluate(board, 'white').score;
    }
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    const evalsPerSec = Math.round(ITERATIONS / (elapsedMs / 1000));

    console.log(
      `[EVAL-THROUGHPUT] ${ITERATIONS} evals in ${elapsedMs.toFixed(0)}ms ` +
      `= ${(evalsPerSec / 1000).toFixed(0)}k eval/s  (sink=${sink})`
    );

    // If this is under ~500k/s on modern hardware, an eval term is doing
    // something expensive (allocating, walking bitboards redundantly).
    // Not asserting a threshold — hardware varies — just flagging.
    expect(evalsPerSec).toBeGreaterThan(10_000);   // sanity floor
  });
});