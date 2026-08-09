# Preparing this codebase for a C refactor

## The goal

A function is **C-friendly** when porting it is a *transcription*, not a
rewrite. You change syntax and you decide who owns the memory. You do not
re-derive the algorithm, re-discover the data layout, or re-debug the logic.

The test is simple: read a function and ask *"could I hand this to someone who
knows C but not chess, and would the C come out right?"* If the answer involves
"well, first you'd have to figure out what shape this object is" — it isn't
ready.

This document is about the habits that get us there. It is not a porting plan.

---

## 1. One semantic model, two syntaxes

Everything in the engine should have exactly one representation, and that
representation should be the one C wants. JavaScript then *emulates* it.

We already do this in places:

- `BitBoard` is a `(lo, hi)` pair of int32 because JS has no `uint64_t`. The C
  port collapses the pair into one `uint64_t` and every `foo(lo, hi)` becomes
  `foo(bb)`. That is a mechanical edit across a known set of call sites.
- `BitBoardIterator.next()` is literally `sq = ctz(bb); bb &= bb - 1;`.
- The undo ring is a fixed array of fixed-shape frames — a `struct Undo[512]`.
- The transposition table is already a struct-of-arrays over typed arrays.

We do *not* do it in places that will hurt:

| JS today | Problem | C shape |
|---|---|---|
| `color` is `'white'` / `'black'` | string compare in the hot path, and every `color === 'white' ? A : B` is a branch on a pointer | `int us` ∈ {0,1} |
| `move.capturedPiece === null` | `null` is not a piece | `PIECE_NONE` |
| `board.bbPieces[0][PIECES.ROOK]` | object-of-objects, two pointer chases | `u64 pieces[2][6]` or `u64 pieces[12]` |
| `gameState.zobristKey` is a `BigInt` | heap-allocated, slow, and the only BigInt in the engine | `uint64_t` |
| move objects in `slot.objs[]` | 35 objects per node kept alive forever | `uint32_t moves[MAX_MOVES]` arena |
| `pieceList` is `Array(64)` | boxed doubles | `int8_t piece_at[64]` |
| stage names are strings | `Set.has('opening')` | `enum Stage` + bitmask |

None of these are emergencies. All of them are *translation debt*: work that
gets paid at port time instead of now, with interest, because by then the
reference implementation no longer exists to diff against.

**Rule of thumb: if C would use an `int`, use an `int` now.** The only reason to
use a string is that a human reads it, and humans only read the UCI layer.

---

## 2. Memory is the whole refactor

C has no GC. Every allocation becomes a decision about lifetime and ownership.
The more of those decisions you make *now*, while you can still test, the less
of the port is guesswork.

Three patterns, in order of preference:

**(a) Static, module-scoped, preallocated.** Tables, scratch buffers, pools.
These become file-static arrays. Already done: attack tables, `PIN_LO/HI`,
`GAIN[]`, `PS_ROW/COL`, the undo ring.

**(b) Caller-allocates, callee-fills.** The caller owns the buffer and passes it
in; the function writes into it. `generateMoves(board, color, slot, ...)` does
this. So does `computeAttackSet(...)` writing into `ATTACKS`. In C these are
`void gen_moves(const Board*, int us, MoveList* out)`.

**(c) Return by value into a shared out-struct.** `SLIDE`, `ATTACKS`,
`ATTACKERS`, `this._result`. Works, but it is the weakest form because the
contract ("read it before the next call") is a comment, not a type. Prefer (b).

What to avoid, always:

- **Closures over mutable state in hot paths.** A closure is a heap object plus
  an indirect call. `moves.sort((a,b) => b.orderScore - a.orderScore)` allocates
  nothing but is an indirect call per comparison and has no C equivalent without
  `qsort` + a comparator function pointer. We already replaced the interior-node
  sort with `pickMove()` — a selection step over an index. Finish the job: the
  root sort should sort an `Int32Array` of indices.
- **`Array.prototype.map/filter/reduce` anywhere a loop will run more than once
  per turn.** Each one allocates. Each one is a closure. They are fine in
  `uciHandler` and in tests; they are poison below `search()`.
- **Objects as tuples.** `{ from, to, score }` is three pointer derefs and a
  hidden class. Pack it: `(from) | (to << 6) | (promo << 12)` already exists in
  `transposition.js`. Use the same encoding for the move list.
- **`Map` / `Set` below the root.** `bookHints` is a `Map` consulted once per
  root node — acceptable. `VARIATION_STAGES` is a `Set` consulted once per
  search — acceptable but trivially a bitmask. Anything per-node: no.

---

## 3. Shape stability

V8 assigns a hidden class per object shape. Adding a property after
construction, or leaving one `undefined` sometimes and a number other times,
*deoptimises every call site that touches that object*. This is not just a JS
performance concern — it is a signal that the "struct" isn't really a struct.

Rules:

- Every object that appears in a hot path must have **every field assigned in
  its constructor**, in the same order, always the same type.
  `blankMove()` does this. `createUndoFrame()` does this. Keep it.
- Never `delete` a property. Never add one conditionally. `move.scoreBreakdown`
  is assigned only when logging is on — that is a shape change. It should be a
  permanent field initialised to `null`, or (better) not live on the move at all.
- `null` for "absent pointer" is fine. `undefined` is not: it means "this slot
  was never initialised," which in C is a read of uninitialised memory.

---

## 4. Control flow that survives translation

- **No exceptions for control flow.** `board.makeMove()` throws on undo-stack
  overflow. In C that is an `assert()` or a returned error code. Keep throws for
  *programmer errors only* (invariant violations), never for expected conditions.
  Anything an adversary can trigger must be a return value.
- **No `try/finally` around hot code.** `_runSearch()` uses it to restore
  `maxSearchTime`; that runs once per turn and is fine. Inside `alphaBeta`, save
  and restore explicitly (the null-move code already does this correctly).
- **Recursion is fine.** `alphaBeta` recurses; so does the C version. Just keep
  the frame small: every local in a recursive function becomes stack space
  multiplied by 64 plies. Prefer `int` locals over objects.
- **No dynamic dispatch.** No polymorphism, no `this` that could be one of two
  classes at the same call site. `Evaluator` and `SearchEngine` are each
  instantiated exactly once per search — monomorphic. `logger` is a `Proxy`,
  which is as dynamic as JS gets; it must be *fully removed* by the build, not
  merely unused. (Check: `__LOG__` folds to `false`, every call site is inside
  `if (__LOG__ && ...)`, esbuild's `minifySyntax` deletes the branch, tree
  shaking drops the import.)
- **Early exit over accumulation.** `squareAttackedBy` returns on the first
  attacker. `leastValuableAttacker` scans in value order. Both translate to
  identical C.

---

## 5. Numbers

JavaScript has one number type. C has twelve. Pretend you have C's.

- **Annotate int32 intent.** `x | 0`, `x >>> 0`, `x & mask`. Not for speed — V8
  mostly figures it out — but because it documents the type for the translator.
  Every `lo`/`hi` read in the codebase already does `| 0`.
- **Never let a float sneak into an integer path.** `Math.floor(a / b)` →
  `(a / b) | 0` → `a / b` in C. `Math.max(0, 14 - 2 * dist) * 20` is integer
  arithmetic written in float syntax; it is fine only because the inputs are
  small ints. Where it matters (eval scores, masks, squares), keep everything in
  int32 range and say so.
- **BigInt is a trap.** `zobristKey` is the only one, and it is on the hot path:
  every `makeMove` does ~6 BigInt XORs, each allocating. It is also the one value
  that *is* genuinely a `uint64_t`. Two options, both fine: (a) leave it, and
  accept that the port replaces `BigInt` with `uint64_t` and gets faster; (b)
  split it into `(lo, hi)` like the bitboards, which makes JS faster *and* maps
  to C. Pick (b) if you ever profile `makeMove` and see allocation. Do not
  introduce a second BigInt anywhere.
- **Shifts are 32-bit.** `1 << 32` is `1`. Every `bitLo`/`bitHi` pair exists
  because of this. When the port collapses them, `1ULL << sq` replaces both.

---

## 6. Strings

Strings are the single largest source of "this will have to be rewritten."

- Algebraic notation (`"e2e4"`) should be generated **only at the boundary** —
  UCI output, SAN, logs, tests. `generateMoves(..., withAlgebraic)` already gates
  this, and the search passes `false` everywhere except the root. Keep auditing:
  any `move.algebraic` read below the root is a bug.
- `bookHints` is `Map<string, number>` keyed on algebraic, which forces the root
  to generate algebraic for every root move. In C this becomes
  `{ uint16_t move; uint16_t weight; }[]` with an integer compare. Worth
  converting before the port — it removes the last string from the search.
- `color === 'white'` appears ~60 times. Each one is a pointer comparison that
  happens to be fast because V8 interns literals. In C it is `us == WHITE`. The
  conversion is mechanical and should happen *before* the port, so the tests
  catch the sign errors in JS rather than in C.

---

## 7. Build-time switches

`__LOG__` and `__DEV__` are `#ifdef` by another name. They already work:
esbuild's `define` replaces them with literals, `minifySyntax` folds the
conditions, dead branches vanish.

Extend the discipline:

- **No `process.env` anywhere.** Done. Runtime switches are argv flags parsed
  once in `utils/flags.js`. In C that is one `getopt` loop in `main()`.
- **No feature detection.** No `typeof x !== 'undefined'` guards in engine code.
  The `flags.js` guard on `process.argv` is a boundary concession; it should not
  spread.
- **Config flags are read once.** `this.config.useNullMovePruning` is read per
  node. In C that's a branch on a global, which the branch predictor nails — fine
  — but if any of these ever become hot, the C version will want
  `#if ENABLE_NULL_MOVE`. Keep the flag set small and the names stable.

---

## 8. Reentrancy is a contract, and it should be written down

Several modules use file-static scratch: `see.js` (`remLo/remHi`, `GAIN`),
`moveGeneration.js` (the whole analysis block, three iterators),
`attacks.js` (`SLIDE`, `ATTACKS`, `ATTACKERS`), `pawnStructure.js` (`PS_*`).

This is correct, it is fast, and it is exactly what C does. But in C the compiler
will not warn you either. So:

- Every module with static scratch must say **"NOT REENTRANT"** at the top, and
  say *why it's safe* (single-threaded, never recurses, never calls anything that
  calls it).
- When a function acquires a second nesting level, it gets a second iterator
  instance, statically allocated, named for its level — `IT_PIECE` /
  `IT_TARGET` / `IT_SCAN` / `IT_PAIR`. Not a pool, not an allocation.
- If the engine ever goes multi-threaded (Lazy SMP is the obvious next step after
  C), every one of these becomes a field on a per-thread context struct. Writing
  them as module statics now is correct; writing them as *implicit globals buried
  in a closure* would not be. Keep them visible.

A useful discipline: imagine the eventual `struct SearchThread`. Anything that is
per-search mutable state (`nodes`, `killers`, `history`, `pv`, scratch buffers)
belongs in it. Anything that is read-only after init (attack tables, PSTs, zobrist
keys) is a true global. Our `SearchEngine` instance is already approximately that
struct. The module-static scratch in `see.js` and `moveGeneration.js` is *not*,
and will have to move — which is a good argument for keeping it small.

---

## 9. Testing is what makes the port survivable

The port is a rewrite of ~6000 lines with no compiler to catch semantic drift.
The only thing that catches it is a reference implementation and a differential
test.

- **`perft` is the contract.** It is exact, it is hardware-independent, and it
  exercises every corner of move generation. The C port is correct when it
  reproduces every number in `perft.json` and the six canonical positions. Before
  the port, grow the suite — especially positions with soft pins, e.p.
  discovered checks, and castling through attacked squares.
- **Zobrist keys are a second contract.** `computeZobristKey(board)` from scratch
  must equal the incrementally-maintained key after every move. `zobrist.test.js`
  checks this; the C port should check it too, under an `#ifdef DEBUG`.
- **Make eval bit-exact and comparable.** `evalComponents()` returns per-term
  integers. A port that produces the same integers for the same FEN is correct.
  This is only possible because eval is integer-only — do not introduce a float.
- **Search is not bit-exact, and that's OK.** Node counts will differ (different
  `sort` tie-breaks, different `Math.log2`). What must match: the best move in
  tactical fixtures, the SEE values, the mate scores. Keep
  `search.test.js` / `see.test.js` as the behavioural contract, and accept that
  `assertNodesBelow` is a JS-only guard.

---

## 10. A short checklist

Before the port, in rough priority order:

1. Replace `color: string` with `us: int` throughout. Biggest mechanical win,
   and the tests will catch every sign error.
2. Replace the move-object list with a `Int32Array` arena + encoded moves. Keep
   a thin accessor layer so `uciHandler` and tests still see objects.
3. Convert `bookHints` to integer-keyed.
4. Split the Zobrist key into `(lo, hi)`, or accept BigInt and isolate it.
5. Flatten `bbPieces[color][piece]` to a single indexed array.
6. `pieceList` → `Int8Array`.
7. Remove `map/filter/reduce/sort` from everything below `search()`.
8. Audit every object for shape stability (`move.scoreBreakdown`).
9. Grow `perft.json`; add positions that specifically exercise soft pins and
   e.p. discovered check.
10. Write the `struct SearchThread` on paper. Anything that doesn't fit in it,
    and isn't a read-only table, is a problem.

Items 1–6 each make the JavaScript faster. That is not a coincidence: C-friendly
and V8-friendly are nearly the same thing, because both reward flat data, stable
shapes, and no allocation. The refactor is not a cost you pay for the port — it
is the port, done incrementally, in a language where the tests still run.