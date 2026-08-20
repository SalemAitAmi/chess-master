/**
 * Lazy Symmetric Multiprocessing (SMP) foundation.
 *
 * Architecture:
 *   - Main thread spawns N-1 worker threads (N = CPU cores)
 *   - All threads share a single transposition table via SharedArrayBuffer
 *   - Each worker gets the same root position and searches independently
 *   - Workers have slight biases (different aspiration windows, move ordering
 *     perturbations) to explore different subtrees
 *   - Main thread collects the best result after the time limit
 *
 * Phase 1 (this file): SharedArrayBuffer TT + worker lifecycle
 * Phase 2 (C refactor): per-subtree assignment, work stealing
 *
 * JavaScript limitations:
 *   - worker_threads + SharedArrayBuffer + Atomics
 *   - No lock-free BigInt atomics (Atomics only works on Int32Array views)
 *   - TT key verification uses split hi/lo Int32 instead of BigInt64
 *   - Keep it simple: main thread handles UCI, workers only search
 */
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);

// ═══════════════════════════════════════════════════════════════════════════
// Shared TT layout for SharedArrayBuffer
//
// Entry layout (24 bytes, aligned for Atomics):
//   Int32[0]: key_lo     (lower 32 bits of zobrist)
//   Int32[1]: key_hi     (upper 32 bits of zobrist)
//   Int32[2]: score
//   Int32[3]: move (encoded)
//   Int32[4]: depth | (flag << 8) | (age << 16)
//   Int32[5]: padding (unused, keeps alignment)
//
// 24 bytes/entry. 64MB → ~2.8M entries.
// ═══════════════════════════════════════════════════════════════════════════

const SHARED_ENTRY_INTS = 6;  // Int32s per entry
const SHARED_ENTRY_BYTES = SHARED_ENTRY_INTS * 4;

export class SharedTranspositionTable {
  constructor(sizeMB) {
    const mb = sizeMB || 64;
    let n = Math.floor((mb * 1024 * 1024) / SHARED_ENTRY_BYTES);
    let pow2 = 1;
    while (pow2 * 2 <= n) pow2 *= 2;

    this.size = pow2;
    this.mask = pow2 - 1;
    this.buffer = new SharedArrayBuffer(pow2 * SHARED_ENTRY_BYTES);
    this.view = new Int32Array(this.buffer);
  }

  /** Index into the Int32 view for entry `i`, field `f`. */
  _offset(i, f) { return i * SHARED_ENTRY_INTS + f; }

  /**
   * Lock-free store using Atomics.compareExchange on the key_lo slot.
   * A concurrent read may see a partially written entry — this is the
   * standard "type-1 error" tradeoff in lock-free TTs. The key check
   * on probe detects it.
   */
  store(keyLo, keyHi, score, move, depth, flag, age) {
    const i = (keyLo & this.mask) >>> 0;
    const base = i * SHARED_ENTRY_INTS;
    const v = this.view;

    // Replace if: empty, different key, older age, or shallower depth
    const existingAge = (Atomics.load(v, base + 4) >>> 16) & 0xFF;
    const existingDepth = Atomics.load(v, base + 4) & 0xFF;
    if (Atomics.load(v, base) !== 0 &&
        existingAge === age && existingDepth > depth) {
      return; // existing entry is better
    }

    // Write fields. Not atomic as a group, but each individual store is atomic.
    Atomics.store(v, base + 2, score);
    Atomics.store(v, base + 3, move);
    Atomics.store(v, base + 4, (depth & 0xFF) | ((flag & 0xFF) << 8) | ((age & 0xFF) << 16));
    Atomics.store(v, base + 1, keyHi);
    // Key_lo LAST — acts as the "commit" signal
    Atomics.store(v, base, keyLo);
  }

  /**
   * Lock-free probe. Returns null on miss or key mismatch.
   */
  probe(keyLo, keyHi) {
    const i = (keyLo & this.mask) >>> 0;
    const base = i * SHARED_ENTRY_INTS;
    const v = this.view;

    const storedLo = Atomics.load(v, base);
    if (storedLo !== keyLo) return null;
    const storedHi = Atomics.load(v, base + 1);
    if (storedHi !== keyHi) return null;

    const packed = Atomics.load(v, base + 4);
    return {
      score: Atomics.load(v, base + 2),
      move:  Atomics.load(v, base + 3),
      depth: packed & 0xFF,
      flag:  (packed >>> 8) & 0xFF,
      age:   (packed >>> 16) & 0xFF,
    };
  }

  clear() {
    // Fill with zeros. SharedArrayBuffer, so all threads see it.
    const v = this.view;
    for (let i = 0; i < v.length; i++) Atomics.store(v, i, 0);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Worker pool manager (main thread only)
// ═══════════════════════════════════════════════════════════════════════════

export class LazySMPManager {
  constructor(numThreads, sharedTT) {
    const cpus = os.cpus().length;
    this.threadCount = Math.min(numThreads || Math.max(1, cpus - 1), cpus);
    this.sharedTT = sharedTT || new SharedTranspositionTable(64);
    this.workers = [];
    this.searching = false;
  }

  /**
   * Spawn workers. Each receives the SharedArrayBuffer and a thread index
   * used to perturb aspiration windows and move ordering.
   */
  spawn() {
    for (let i = 0; i < this.threadCount; i++) {
      const w = new Worker(path.join(path.dirname(__filename), 'smpWorker.js'), {
        workerData: {
          threadIndex: i,
          ttBuffer: this.sharedTT.buffer,
          ttSize: this.sharedTT.size,
        },
      });
      w.on('error', err => console.error(`[SMP] Worker ${i} error:`, err));
      w.on('exit', code => {
        if (code !== 0) console.error(`[SMP] Worker ${i} exited with code ${code}`);
      });
      this.workers.push(w);
    }
  }

  /**
   * Start a search on all workers. Returns a promise that resolves with
   * the best result when the time limit expires or all workers finish.
   *
   * @param {string} fen        Position to search
   * @param {number} depth      Max depth
   * @param {number} timeMs     Time budget
   * @returns {Promise<{move: string, score: number, depth: number}>}
   */
  search(fen, depth, timeMs) {
    if (this.workers.length === 0) this.spawn();
    this.searching = true;

    return new Promise((resolve) => {
      const results = [];
      let finished = 0;
      const total = this.workers.length;

      const timer = setTimeout(() => {
        // Time's up — stop all workers, take best result so far
        for (const w of this.workers) w.postMessage({ type: 'stop' });
      }, timeMs);

      const onResult = (msg) => {
        if (msg.type === 'result') {
          results.push(msg);
          finished++;
          if (finished >= total) {
            clearTimeout(timer);
            this.searching = false;
            // Pick the deepest search; break ties by score
            results.sort((a, b) => b.depth - a.depth || b.score - a.score);
            resolve(results[0] || { move: null, score: 0, depth: 0 });
          }
        }
      };

      for (let i = 0; i < this.workers.length; i++) {
        this.workers[i].once('message', onResult);
        this.workers[i].postMessage({
          type: 'search',
          fen,
          depth,
          threadBias: i,  // used to perturb the search
        });
      }
    });
  }

  stop() {
    for (const w of this.workers) w.postMessage({ type: 'stop' });
    this.searching = false;
  }

  terminate() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}