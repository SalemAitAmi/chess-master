/**
 * Log categories — bitmask definitions, tags, and filenames.
 *
 * ┌─────────────┬────────┬─────────────────────────────────────────────────────┐
 * │ Category    │ Bit    │ What it logs                                        │
 * ├─────────────┼────────┼─────────────────────────────────────────────────────┤
 * │ SEARCH      │ 0x001  │ Iteration summaries, turn results, sampled nodes    │
 * │ EVAL        │ 0x002  │ Sampled leaf evaluations, per-component breakdowns  │
 * │ MOVE_ORDER  │ 0x004  │ Root ordering snapshots, sampled interior ordering  │
 * │ TT          │ 0x008  │ Transposition table init, per-turn hit/miss stats   │
 * │ UCI         │ 0x010  │ Every UCI command and response                      │
 * │ BOOK        │ 0x020  │ Opening book lookups, hit/miss, weight sampling     │
 * │ HEURISTICS  │ 0x040  │ Per-term eval contributions (material, center, etc) │
 * │ MOVES       │ 0x080  │ Move generation counts, sampled per node            │
 * │ PV          │ 0x100  │ Principal variation after each completed iteration  │
 * │ TIME        │ 0x200  │ Search start, per-iteration timing, budget stops    │
 * │ STAGE       │ 0x400  │ Game-stage detection (opening/middle/endgame)       │
 * │ SYSTEM      │ 0x800  │ Server lifecycle, game start/end, console redirect  │
 * │ SMP         │ 0x1000 │ Lazy SMP lifecycle, per-helper outcomes, selection  │
 * ├─────────────┼────────┼─────────────────────────────────────────────────────┤
 * │ ALL         │ 0x1FFF │ Everything                                          │
 * └─────────────┴────────┴─────────────────────────────────────────────────────┘
 *
 * SMP records are written ONLY by the main thread (helpers run a NoopLogger and
 * ship their data back in their result message). See smpCoordinator.js.
 */
export const LOG_CATEGORY = {
  NONE:       0,
  SEARCH:     1 << 0,
  EVAL:       1 << 1,
  MOVE_ORDER: 1 << 2,
  TT:         1 << 3,
  UCI:        1 << 4,
  BOOK:       1 << 5,
  HEURISTICS: 1 << 6,
  MOVES:      1 << 7,
  PV:         1 << 8,
  TIME:       1 << 9,
  STAGE:      1 << 10,
  SYSTEM:     1 << 11,
  SMP:        1 << 12,
  ALL:        0x1FFF,
};
export const CAT = {
  SEARCH: 'search', EVAL: 'eval', MOVE_ORDER: 'order', TT: 'tt', UCI: 'uci',
  BOOK: 'book', HEURISTIC: 'heuristics', MOVES: 'moves', PV: 'pv', TIME: 'time',
  STAGE: 'stage', SYSTEM: 'system', SMP: 'smp',
};
export const CAT_BIT = {
  search: LOG_CATEGORY.SEARCH, eval: LOG_CATEGORY.EVAL, order: LOG_CATEGORY.MOVE_ORDER,
  tt: LOG_CATEGORY.TT, uci: LOG_CATEGORY.UCI, book: LOG_CATEGORY.BOOK,
  heuristics: LOG_CATEGORY.HEURISTICS, moves: LOG_CATEGORY.MOVES, pv: LOG_CATEGORY.PV,
  time: LOG_CATEGORY.TIME, stage: LOG_CATEGORY.STAGE, system: LOG_CATEGORY.SYSTEM,
  smp: LOG_CATEGORY.SMP,
};
export const GAME_STAGE = {
  OPENING: 'opening', EARLY_MIDDLE: 'early_middle', MIDDLE: 'middle',
  LATE_MIDDLE: 'late_middle', ENDGAME: 'endgame',
};
export default LOG_CATEGORY;