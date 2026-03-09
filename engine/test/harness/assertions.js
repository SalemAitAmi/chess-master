import assert from 'node:assert/strict';

/**
 * Chess-specific assertions. These encode the patterns you're
 * currently hunting for in log files — now they're executable checks.
 */

export function assertBestMove(collector, expected, msg) {
  const actual = collector.bestMove()?.move;
  assert.equal(actual, expected,
    msg ?? `Expected best move ${expected}, got ${actual}\n` +
           `Root moves: ${JSON.stringify(collector.rootMoves, null, 2)}`);
}

export function assertMoveInTopN(collector, move, n, msg) {
  const rank = collector.moveRank(move);
  assert.ok(rank > 0 && rank <= n,
    msg ?? `${move} ranked #${rank}, expected top ${n}`);
}

export function assertMoveAvoided(collector, badMove, msg) {
  const best = collector.bestMove()?.move;
  assert.notEqual(best, badMove,
    msg ?? `Engine chose known-bad move ${badMove}`);
}

export function assertScoreDominance(collector, goodMove, badMove, minGap, msg) {
  const gap = collector.scoreGap(goodMove, badMove);
  assert.ok(gap !== null && gap >= minGap,
    msg ?? `${goodMove} should beat ${badMove} by ≥${minGap}cp, actual gap: ${gap}cp`);
}

export function assertBookMoveOrderedFirst(collector, bookMove, msg) {
  assert.ok(collector.wasOrderedFirst(bookMove),
    msg ?? `Book move ${bookMove} should be ordered first, ` +
           `actual first: ${collector.orderingAtRoot?.[0]?.move}`);
}

export function assertBookOverridden(collector, bookMove, msg) {
  const wasFirst = collector.wasOrderedFirst(bookMove);
  const wasBest = collector.bestMove()?.move === bookMove;
  assert.ok(wasFirst && !wasBest,
    msg ?? `Book move ${bookMove} should be searched first but rejected. ` +
           `ordered first: ${wasFirst}, was best: ${wasBest}`);
}

/**
 * Search efficiency — catches move ordering regressions.
 * If ordering degrades, node count at fixed depth balloons.
 */
export function assertNodesBelow(collector, maxNodes, msg) {
  assert.ok(collector.nodeCount <= maxNodes,
    msg ?? `Node count ${collector.nodeCount} exceeds budget ${maxNodes} — ` +
           `move ordering regression?`);
}

/**
 * Memory assertion — fails the test if heap grew beyond a threshold.
 * Run with --expose-gc for accuracy.
 */
export function assertHeapBelow(maxMB, label = '') {
  if (global.gc) global.gc();
  const heapMB = process.memoryUsage().heapUsed / 1024 / 1024;
  assert.ok(heapMB < maxMB,
    `Heap at ${heapMB.toFixed(1)}MB exceeds ${maxMB}MB limit ${label}`);
}