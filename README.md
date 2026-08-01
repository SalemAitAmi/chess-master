# Chess Master

A chess engine with a UCI interface and a React front-end, featuring bot
opponents of varying strength and a bot-vs-bot analysis mode.

[![chess-master-img.png](https://i.postimg.cc/3rZvRmdV/chess-master-img.png)](https://postimg.cc/9zrMg4PY)

## Architecture

The project is split into two independent packages that communicate **only**
over UCI:

```
┌──────────────────────┐   WebSocket (ws://localhost:8080)   ┌─────────────────────┐
│  client/  (React)    │  ──────── UCI text commands ──────► │  engine/  (Node)    │
│  - rendering only    │  ◄─────── UCI text responses ─────  │  - all chess logic  │
│  - no chess rules    │                                     │  - search + eval    │
└──────────────────────┘                                     └─────────────────────┘
```

The client contains **no chess logic** — no move generation, no legality
checking, no game-over detection. It renders a FEN, sends clicks as UCI move
strings, and displays whatever the engine reports. Every rule question
(is this legal? is this a promotion? is this a draw?) is answered by the engine.

`UCIHandler` is the engine's only public API. There is no importable `Engine`
class, no `BotPlayer`, and no in-process JS API — if you want to drive the
engine, you speak UCI to it.

## Install and run

```bash
git clone https://github.com/salemAitAmi/chess-master.git
cd chess-master

# Engine (terminal 1)
cd engine
npm install
npm run dev                 # source, logging enabled
# or: npm run build:prod && npm run start:prod

# Client (terminal 2)
cd client
npm install
npm start
```

The engine listens on `PORT` (default `8080`). The client connects to
`ws://localhost:8080`; override by passing a URL to `useEngine(url)`.

## Game modes

### Local Play
Two players on one device. The board flips to the side to move.

### vs Computer
Pick a colour and a difficulty. Colours swap on each restart.

| Difficulty | Search depth | Notes |
|------------|--------------|-------|
| Rookie     | 4            | |
| Casual     | 6            | |
| Strategic  | 8            | |
| Master     | 12           | Bounded by the per-search time ceiling |

Depth is the requested iterative-deepening target. A search also stops when the
predicted cost of the next iteration would exceed `maxSearchTime` (default 30s,
settable via `setoption name MoveTime`), so Master is "depth 12 or 30 seconds,
whichever comes first".

### Colosseum (bot vs bot)
Two bots play a match of 1/3/5/10/20 rounds with colours swapping each round.
Live score, per-round results, and full move history.

## UCI interface

### Standard commands
`uci`, `debug`, `isready`, `setoption`, `ucinewgame`, `position`, `go`, `stop`, `quit`

`go` honours `depth` and `movetime`. `wtime`/`btime`/`winc`/`binc`/`movestogo`
are parsed but not yet used (no clock manager). `infinite` and `nodes` are
accepted and ignored.

### Extensions for interactive play

These exist so the client never needs chess rules. All are synchronous and
allocate no search.

| Command | Response |
|---|---|
| `validate <move>` | `valid true` · `valid true needs_promotion` · `valid false <reason>` |
| `legalmoves [square]` | `legalmoves e2e3 e2e4 ...` · `legalmoves none` |
| `makemove <move>` | *gamestate block* · `error <reason>` |
| `undomove` | *gamestate block* · `error no_moves_to_undo` |
| `gamestate` | *gamestate block* |
| `eval` | `eval <centipawns>` (white's perspective) |
| `setlog <mask>` | `info string Log mask set to <mask>` |
| `clearlogs` | `info string Logs cleared` |
| `showstage` | `info string Stage: ...` |

`validate false` reasons: `invalid_format`, `invalid_squares`, `no_piece`,
`wrong_color`, `illegal_move`, `invalid_promotion`, `unexpected_promotion`.

**Promotions require an explicit suffix.** `legalmoves` emits one entry per
promotion piece (`a7a8q a7a8r a7a8b a7a8n`) and never a bare `a7a8`. Sending
`makemove a7a8` returns `error needs_promotion` rather than silently queening.

Any reply beginning with `error ` is an error, never a state block — the client
relies on this to distinguish the two.

### The gamestate block

Newline-separated `key value` pairs:

```
fen <fen>                     turn white|black
fullmove <n>                  halfmove <n>            (halfmove = 50-move clock)
status ongoing|checkmate|stalemate|threefold|fifty_move|insufficient_material
winner white|black|draw|none  incheck true|false
legalmovecount <n>            eval <cp>
material_white <cp>           material_black <cp>      material_diff <cp>
captured_white <chars>|none   captured_black <chars>|none
movecount <n>                 canundo true|false
blunder true|false            repetitions <n>
lastmove <uci>                lastmovesan <san>
lastpiece <char>              lastcaptured <char>|none
history <san> <san> ...|none            (last 20 moves)
historyuci <uci> <uci> ...|none         (last 20 moves)
```

`winner` is `draw` for every drawn termination and `none` only while the game is
undecided — **neither value is a player name**. `captured_*` lists the pieces
that side has *lost*, derived from the board (initial counts minus current
counts, adjusted for promotions), so it is always consistent after `undomove`.

## Engine internals

### Search
- Iterative deepening, alpha-beta, principal variation search
- Aspiration windows (depth ≥ 5)
- Transposition table (struct-of-arrays over typed arrays, 19 bytes/entry)
- Null-move pruning, late move reductions, futility pruning, internal iterative deepening
- Quiescence search with delta pruning and a crude SEE gate
- Move ordering: TT move → book hint → promotions → MVV-LVA captures →
  killers → counter-moves → history → pawn pushes
- Material-aware draw contempt (avoid draws when winning, seek them when losing)

### Evaluation
Material + piece-square tables, center control, development, pawn structure
(doubled / isolated / backward / connected / passed / islands), king safety, and
a mop-up term that only activates when one side is a lone king.

All terms are tapered by game phase. Every term can be toggled at runtime:
`setoption name UseKingSafety value false`.

### Board representation
Bitboards with a zero-allocation make/unmake over a pre-allocated 512-entry undo
ring. Zobrist hashing with incremental updates; repetition detection walks the
undo ring back to the last irreversible move.

### Opening book
Polyglot format (`data/baron30.bin`). Book moves are **ordering hints**, not
move selection: they are searched first, and a search that finds something
better overrides them. `go` reports `info string Book confirmed` or
`Book OVERRIDDEN`.

## Logging

Category bitmask, disabled by default. Set at startup via `LOG_MASK` or at
runtime via `setlog`:

```bash
LOG_MASK=0x005 npm run dev        # SEARCH | MOVE_ORDER
```

| Bit | Category | Bit | Category |
|----:|----------|----:|----------|
| 0x001 | search | 0x040 | heuristics |
| 0x002 | eval | 0x080 | moves |
| 0x004 | move-order | 0x100 | pv |
| 0x008 | transposition | 0x200 | time |
| 0x010 | uci | 0x400 | stage |
| 0x020 | book | 0x7FF | all |

Output goes to `engine/logs/<timestamp>.log` (human-readable) plus
`engine/logs/<category>.ndjson` (machine-readable traces) and
`engine/logs/turns/<gameId>.ndjson` (per-turn summaries). Nothing is written to
stdout except startup lines and `bestmove`.

**Production builds strip logging entirely.** Every call site is guarded by
`if (__LOG__ && LOG.<category>)`, where `__LOG__` is replaced with `false` by
esbuild's `define`; `minifySyntax` then folds the condition and removes the
branch. `npm run build:prod` also installs a no-op logger, so no log files are
created and the file-writing logger is never constructed.

## Testing

```bash
npm test                        # all
npm run test:uci                # UCI string interface (promotion, SAN, captures)
npm run test:search             # tactics, move ordering, memory bounds
npm run test:repetition         # repetition, 50-move, draw contempt
npm run test:endgame            # endgame progress / anti-shuffle regression
npm run test:zobrist            # incremental vs from-scratch hash
npm run test:eval               # per-term evaluation
npm run test:coverage
npm test -- profiling           # perf measurement harness (not pass/fail)
PROFILE_DEEP=1 npm test -- profiling   # adds depth 12
```

Tests are layered via `test/harness/introspect.js`: `evalComponents` (static
eval per term) → `traceQSearch` (quiescence) → `ordering` (move ordering) →
`searchOnce` (single-depth) → `UciSession` (full UCI round-trip). When a
high-level test fails, walk down the layers to localise it.

## Project layout

```
engine/src/
  core/        bitboards, board + make/unmake, move generation, constants
  evaluation/  per-term heuristics, PSTs, orchestrator
  search/      iterative deepening, move ordering, quiescence
  tables/      transposition table, zobrist keys
  book/        polyglot reader, book lookup
  uci/         command parser, protocol handler, SAN
  utils/       game-stage detection
  logging/     category-gated logger
  server.js    WebSocket server — the only entry point
client/src/
  components/  presentational only
  pages/       one per game mode
  engine/      UCI WebSocket client
  hooks/       useEngine (shared singleton connection)
```

## License

MIT