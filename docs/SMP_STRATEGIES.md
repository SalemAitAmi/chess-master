# SMP search strategies

One engine instance = one main thread + N-1 helper threads + one shared
transposition table + one control block. A strategy is the rule set that
decides what each helper searches, when it stops, and how its answer is
combined. Select with `setoption name SearchStrategy value <name>` (or the
settings modal, "Multi-threading (SMP)").

## Rule sets

| | single | lazy | lazy-skip | root-split | pv-split |
|---|---|---|---|---|---|
| Work per helper | — | whole tree | whole tree | fixed subset of root moves | root-move units claimed one at a time |
| Diversity source | — | timing only | depth skip + aspiration + root bias | disjoint subsets | disjoint units |
| Shared state | — | TT | TT | TT | TT + alpha + unit queue |
| Sync points / search | 0 | 1 | 1 | 1 | 1 + one per iteration ≥ SmpSplitDepth |
| Stop rule | — | main finishes (or a helper reaches the target → main stops early) | same | deadline only | deadline only |
| Result | main | deepest depth; proven mate; tie → main | same | merged root list → main's root policy | merged root list per iteration |
| Failure mode | — | helper ignored | helper ignored | its subset unsearched (`unsearched` > 0) | main re-runs orphaned units |

### lazy / lazy-skip
Every helper searches the full tree against the shared table. Under
`go depth N`, helpers cannot run past N, so the gain is the main thread
reaching N sooner through table hits. `lazy-skip` adds the Stockfish-8 skip
tables (helper k skips some intermediate depths), a per-helper aspiration
delta, and a root bias on even helpers, so they stop mirroring the main thread.

### root-split (static subtree per thread)
Root moves are ordered once, then dealt round-robin. The main thread gets the
PV move, because it is usually the largest subtree. Each thread runs its own
iterative deepening over its subset; there is no shared alpha, so each
subset is searched with weaker bounds. Expect `nodeRatio` well above 1, and
a speedup limited by the largest subset (`barrierMs` = idle time waiting for it).

### pv-split (Young Brothers Wait at the root, dynamic)
Per iteration d:
1. The main thread searches the PV move with a full window. Its score becomes the shared alpha.
2. The remaining moves become units 1..n-1. `NEXT_UNIT` is reset to 1 and
   `units` is posted to the live helpers.
3. Every thread, main included, loops: `i = atomic_add(NEXT_UNIT, 1)`, scout
   unit i with a null window at the current shared alpha, re-search with an
   open window on fail-high, and CAS-max alpha on an exact score. Each unit's
   STATE is written last.
4. Barrier: the main thread waits for every helper's `units-done`. Units left
   non-DONE by a failed helper are re-run by the main thread (`orphans`).
5. Sort: best exact first. Record the iteration. That order drives d+1.

Iterations below `SmpSplitDepth` stay on the main thread, because the barrier costs more than it saves.

## Control block (Int32, one SharedArrayBuffer per instance)

```
header   0 AGE  1 SEARCH_ID  2 STOP_ID  3 TARGET_DEPTH
         4 NEXT_UNIT  5 UNIT_COUNT  6 ALPHA  7 ITER
slot k   STATE SEARCH_ID DEPTH COMPLETED NODES SELDEPTH POLL_MS BEST SCORE POLLS   (stride 10, k ≤ 64)
unit i   STATE SCORE FLAG THREAD NODES MICROS                                       (stride 6, i < 256)
```

## Invariants (the safety contract)
1. One table and one control block per engine instance. Helpers never clear
   the table or advance its age.
2. `STOP_ID` is monotone: a helper stops when `STOP_ID >= its searchId`.
3. No helper output influences a move without passing the search-id,
   root-key (Zobrist) and legality checks.
4. Every wait is bounded: ready 10s, stop grace 2s, barrier = remaining budget + grace.
   A late helper is terminated and respawned on the next search.
5. A partial pv-split iteration is discarded, never merged.
6. Only the main thread writes logs.

## Overhead model

    T_smp = prepare + plan + dispatch + main + collect + barrier + assemble

- **Serial overhead** (`overheadMs`) = prepare + plan + dispatch + collect + assemble.
- **Helper dead time** = recvLag + setup (worker busy replaying, not searching).
- **Idle** (`barrierMs`) = main waiting at barriers; this is load imbalance, not overhead.

Measure with `smpbench depth 7` (Threads > 1):

| field | meaning |
|---|---|
| speedup | single.ms / strategy.ms over the bench positions |
| eff | speedup / threads (1.0 = perfect scaling) |
| nodeRatio | total nodes / single nodes (search overhead) |
| nps | total nodes per wall second |
| agree | positions whose move matched single (nondeterminism) |

## JavaScript cost vs model cost

| cost | present in JS | present in C | in the model? |
|---|---|---|---|
| structured clone of messages | yes | no (shared structs) | no |
| replaying the root from FEN + moves | yes | no (`memcpy(Board)`) | no |
| cold JIT in new workers (mitigated by warm-up) | yes | no | no |
| event-loop wake-up at collect/barrier | yes | no (condvar, µs) | barrier only |
| BigInt → int32 key split per probe | yes | no (`uint64_t`) | no |
| duplicated work (lazy) | yes | yes | **yes** |
| load imbalance (root-split) | yes | yes | **yes** |
| serial PV move + tail wait (pv-split) | yes | yes | **yes** |

The model costs are the ones worth optimizing ahead of the port.

## C mapping

```c
typedef struct {
  _Atomic int32_t age, search_id, stop_id, target_depth;
  _Atomic int32_t next_unit, unit_count, alpha, iter;
  Slot slots[MAX_THREADS];          /* written by owner thread only      */
  Unit units[MAX_UNITS];            /* STATE written last (release)      */
} Control;
typedef struct {                    /* one per thread; today's SearchEngine */
  Board board;                      /* memcpy of the root, not a replay  */
  Killers killers; History history; Counters counters;
  uint64_t nodes; int32_t unit_score, unit_flag;
} SearchThread;
```

- Dispatch becomes `pthread_cond_broadcast`.
- Collect becomes `pthread_barrier_wait` (or a joined counter).
- Helper messages disappear: results are read directly from `Slot` / `Unit`.
- The next step beyond pv-split is splitting interior nodes (YBWC/DTS). A unit
  becomes `(position, depth, window)` at any ply, which needs per-thread stacks
  that JS workers cannot share, so it is deferred to the port.