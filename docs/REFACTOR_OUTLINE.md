# Streamlining outline (pre-C)

Goal: module boundaries that map 1:1 onto future C translation units, with
flat data and one owner per concern. JS stays idiomatic; the LOGICAL model is
what must be C-shaped.

## Target layout

```
engine/src/
  config/    options.js · profiles.json · index.js                 (done)
  core/      board · fen · bitboard · attacks · zobrist · rules · movegen/{analysis,emit,list} · perft
  eval/      evaluate (orchestrator, taper, weights) · terms/* · pst · mopup
  search/    engine · thread · iterate · node · quiescence · root · ordering/{orderer,tables,softpin,see} · units
  smp/       coordinator · strategies/{lazy,rootSplit,pvSplit} · table · control · helper · worker
  uci/       protocol · commands/{config,game,search,diag} · game · san · parser
  session/   transport (server.js) · registry (sessions/instances)
  logging/   categories · writer · context · records/turn
  book/      polyglot · lookup
```

## Split (largest wins)

**search/search.js** (~1000 lines, five concerns)
- `engine.js`: lifecycle, config, table ownership, reconfigure.
- `thread.js`: per-search mutable state as ONE struct (nodes, stats, deadline,
  stop, root lists, smp ctx). This is `struct SearchThread`.
- `iterate.js`: iterative deepening + aspiration.
- `node.js`: alphaBeta, with pruning/reduction decisions as small pure functions
  (`futilityMargin`, `lmrReduction`, `canNullMove`).
- `root.js`: verify / repetition avoidance / tension / `chooseRootMove`.
- `units.js`: the pv-split unit API.
- Move the turn-record builder to `logging/records/turn.js`. The coordinator
  already augments it, so the record should own both inputs.

**uci/uciHandler.js** (~600 lines)
- `protocol.js`: a table `command → handler`, replacing the switch.
- `game.js`: a `Game` object (board, history, rootFen, captured derivation,
  status, gamestate block).
- `commands/search.js`: go + smpbench.
- The handler becomes a composition: `ConfigState + Game + SearchEngine + SmpCoordinator`.

**search/smpCoordinator.js**
- Split into one file per strategy, each exporting `run(ctx)` and `assemble(ctx, out)`.
- The coordinator keeps lifecycle, validation and logging.
- `lazySMP.js` splits into `smp/{table,control,helper}.js`.

**core/moveGeneration.js**
- `analysis.js`: checkers, pins and soft pins as a per-thread `Analysis` struct
  instead of module scalars plus the published `ANALYSIS` object.
- `emit.js`: the move emitters.
- `list.js`: move lists, ready for the Int32 encoding.

## Aggregate (same thing, several places)

- **Game rules.** Terminal detection lives in `UCIHandler.getGameState`,
  `_isInsufficientMaterial`, and the search's 50-move/repetition early exits.
  Consolidate into one `core/rules.js`.
- **Phase.** Computed by `evaluate._computePhase`, `moveOrdering.phaseOf` and
  `gameStage.materialPhase`. Use one function, or better, an incremental phase
  on the board updated in make/unmake.
- **Ply / turn index.** Computed in `logger._boardTurn` and `gameStage.halfMoveCount`.
  Keep one.
- **Weights.** Every eval term applies its own `Math.round(score * weight)` and
  logs itself. Terms should return raw ints; `evaluate.js` applies integer
  percent weights once (fixed point, C-friendly) and logs once.
- **Attack geometry.** `see.js` walks `[dr, df]` tuples over the legacy
  `KNIGHT_ATTACKS` / `KING_ATTACKS` / `ORTHO` / `DIAG` tables while `attacks.js`
  already has bitboard sliders. Rewrite SEE on `attacks.js` and delete the
  legacy tables.
- **Build flags.** Every module redeclares `const __LOG__ = globalThis.__LOG__ ?? true`.
  Export the flag from one `build/flags.js`. (`docs/C_REFACTOR_PREP.md` already
  references a `utils/flags.js` that does not exist.)

## Less obvious gains

- **One TT implementation.** The shared XOR-checked 16-byte entry works
  single-threaded too. Dropping the 19-byte BigUint64 local table removes the
  `kind` branch, a second replacement policy and a second stats path.
- **Zobrist as (lo, hi) int32.** This removes the BigInt allocation in every
  `makeMove`, and the per-probe BigInt → int32 splits that make the shared table
  slower (measured by `smpbench` as per-thread NPS loss). The repetition scan
  becomes two integer compares.
- **Encoded moves everywhere.** SMP messages ship root lists and PVs as
  algebraic strings, and `bookHints` is keyed by strings. A 16-bit move code
  (already in `transposition.js`) removes string building below the root and in
  worker traffic.
- **Colours as 0/1.** `'white'` / `'black'` strings run through search, eval,
  ordering and the undo path. The `color === 'white' ? …` branches become `us ^ 1`.
- **Root spec.** `{ rootFen, moves }` is rebuilt and shipped per strategy. Make
  it one `RootSpec` built once per `go`; it becomes `memcpy(Board)` in C.
- **Logger Proxy.** A Proxy adds dynamic dispatch on every log call. Replace it
  with a module-level `let sink` and exported functions; the noop build assigns
  noops.
- **Game directory lifecycle.** arm / begin / rotate lives inside the writer.
  Move it to `session/registry`, which already owns game numbering.

## Remove

- `assignRootBiases` (the planner computes biases inline).
- `logger.startGame` alias, `printBookKeys`, `listSessions`.
- Unused `info` parsing on the client (`parseInfo` / `searchInfo`).
- `client/public/baron30.bin` (the client never reads the book).
- `evaluation/pawnPush.js` is an ordering term; move it to `search/ordering/`.
- `Board.getOccupancy` (allocates; verify no callers first).

## Client

- **Pages.** All three duplicate undo / surrender / restart and the banner logic.
  Extract `useGameControls` and `useColosseumMatch` (the move loop plus round
  transitions), leaving the page components as layout only.
- **EngineClient.** Route responses through a prefix table instead of an if-chain.
  SAN history is accumulated client-side from a 20-move window; the engine could
  send the full history on request and the client copy disappears.
- **Overlays.** `GameOverModal` and `PromotionModal` share an overlay shell.
- **Naming.** `utils/bitboard.js` is coordinate conversion; rename it `coords.js`.

## Tools

- `analyze_logs.py` (~900 lines) → a package: `load` · `derive` · `aggregate` ·
  `figures` · `report`, with NOTES/GLOSSARY moved to data files.
- `run_experiments.mjs` re-implements the UCI socket. Share a small protocol
  module between tools (not with the client) and use `setoptions` batches.