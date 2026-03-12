/**
 * Chess-specific assertions for Vitest.
 * 
 * These encode the patterns you're hunting for — now executable checks
 * with clear diagnostic output when they fail.
 */

import { expect } from 'vitest';

/**
 * Assert the engine found the expected best move.
 */
export function assertBestMove(collector, expected, msg) {
  const actual = collector.bestMove()?.move;
  expect(actual, msg ?? `Expected best move ${expected}, got ${actual}`).toBe(expected);
}

/**
 * Assert a move is ranked within the top N.
 * Rank 0 means "not found" — almost always a fixture bug.
 */
export function assertMoveInTopN(collector, move, n, msg) {
  const rank = collector.moveRank(move);
  
  if (rank === 0) {
    const available = collector.rootMoves.map(m => m.move).join(', ');
    expect.fail(
      msg ?? `${move} not found in root moves — fixture bug? ` +
             `(wrong side to move, or move is illegal)\n` +
             `Available root moves: [${available}]`
    );
  }
  
  expect(rank, msg ?? `${move} ranked #${rank}, expected top ${n}`).toBeLessThanOrEqual(n);
}

/**
 * Assert the engine did NOT choose a specific bad move.
 */
export function assertMoveAvoided(collector, badMove, msg) {
  const best = collector.bestMove()?.move;
  expect(best, msg ?? `Engine chose known-bad move ${badMove}`).not.toBe(badMove);
}

/**
 * Assert one move's score beats another by at least minGap centipawns.
 */
export function assertScoreDominance(collector, goodMove, badMove, minGap, msg) {
  const gap = collector.scoreGap(goodMove, badMove);
  
  expect(gap, `Could not compute gap: one of ${goodMove}/${badMove} missing from root moves`)
    .not.toBeNull();
  
  expect(
    gap,
    msg ?? `${goodMove} should beat ${badMove} by ≥${minGap}cp, actual gap: ${gap}cp\n` +
           `Scores: ${goodMove}=${collector.rootMoves.find(m => m.move === goodMove)?.score}, ` +
           `${badMove}=${collector.rootMoves.find(m => m.move === badMove)?.score}`
  ).toBeGreaterThanOrEqual(minGap);
}

/**
 * Assert a book move was ordered first in move ordering.
 */
export function assertBookMoveOrderedFirst(collector, bookMove, msg) {
  expect(
    collector.wasOrderedFirst(bookMove),
    msg ?? `Book move ${bookMove} should be ordered first, ` +
           `actual first: ${collector.orderingAtRoot?.[0]?.move}`
  ).toBe(true);
}

/**
 * Assert a book move was searched first but ultimately rejected.
 */
export function assertBookOverridden(collector, bookMove, msg) {
  const wasFirst = collector.wasOrderedFirst(bookMove);
  const wasBest = collector.bestMove()?.move === bookMove;
  
  expect(
    wasFirst && !wasBest,
    msg ?? `Book move ${bookMove} should be searched first but rejected. ` +
           `ordered first: ${wasFirst}, was best: ${wasBest}`
  ).toBe(true);
}

/**
 * Assert search stayed within a node budget.
 * Catches move-ordering regressions (worse ordering → more nodes).
 */
export function assertNodesBelow(collector, maxNodes, msg) {
  expect(
    collector.nodeCount,
    msg ?? `Node count ${collector.nodeCount} exceeds budget ${maxNodes} — ` +
           `move ordering regression?`
  ).toBeLessThanOrEqual(maxNodes);
}

/**
 * Assert heap usage is below a threshold.
 * Run with --expose-gc for accuracy.
 */
export function assertHeapBelow(maxMB, label = '') {
  if (global.gc) global.gc();
  const heapMB = process.memoryUsage().heapUsed / 1024 / 1024;
  
  expect(
    heapMB,
    `Heap at ${heapMB.toFixed(1)}MB exceeds ${maxMB}MB limit ${label}`
  ).toBeLessThan(maxMB);
}

// ═══════════════════════════════════════════════════════════════════════════
// Evaluation-specific assertions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Assert a specific eval component contributes within an expected range.
 */
export function assertComponentInRange(evalResult, component, min, max, msg) {
  const value = evalResult.components[component];
  
  expect(value, `Component ${component} not found in eval result`).toBeDefined();
  expect(
    value,
    msg ?? `${component} = ${value}cp, expected [${min}, ${max}]`
  ).toBeGreaterThanOrEqual(min);
  expect(
    value,
    msg ?? `${component} = ${value}cp, expected [${min}, ${max}]`
  ).toBeLessThanOrEqual(max);
}

/**
 * Assert one position evaluates higher than another for a given component.
 */
export function assertComponentHigher(evalA, evalB, component, msg) {
  const a = evalA.components[component];
  const b = evalB.components[component];
  
  expect(
    a,
    msg ?? `${component}: position A (${a}cp) should be > position B (${b}cp)`
  ).toBeGreaterThan(b);
}

/**
 * Assert total evaluation is within expected range.
 */
export function assertTotalInRange(evalResult, min, max, msg) {
  expect(
    evalResult.total,
    msg ?? `Total ${evalResult.total}cp not in expected range [${min}, ${max}]`
  ).toBeGreaterThanOrEqual(min);
  expect(
    evalResult.total,
    msg ?? `Total ${evalResult.total}cp not in expected range [${min}, ${max}]`
  ).toBeLessThanOrEqual(max);
}

/**
 * Assert evaluation is symmetric (white's eval ≈ -black's eval).
 * Tolerance accounts for tempo and minor asymmetries.
 */
export function assertEvalSymmetric(whiteEval, blackEval, tolerance = 30, msg) {
  const asymmetry = whiteEval.total + blackEval.total;
  
  expect(
    Math.abs(asymmetry),
    msg ?? `Evaluation asymmetry: white=${whiteEval.total}, black=${blackEval.total}, ` +
           `sum=${asymmetry}cp (expected ≈0 within ±${tolerance})`
  ).toBeLessThanOrEqual(tolerance);
}