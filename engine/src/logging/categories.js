/**
 * Log category bitmask definitions
 * Each category corresponds to a separate log stream for independent analysis
 */

export const LOG_CATEGORY = {
  NONE:       0,
  SEARCH:     1 << 0,   // 0x001 - Search algorithm (depth, nodes, alpha-beta)
  EVAL:       1 << 1,   // 0x002 - Evaluation scores and breakdowns
  MOVE_ORDER: 1 << 2,   // 0x004 - Move ordering decisions
  TT:         1 << 3,   // 0x008 - Transposition table hits/misses/stores
  UCI:        1 << 4,   // 0x010 - UCI protocol communication
  BOOK:       1 << 5,   // 0x020 - Opening book lookups
  HEURISTICS: 1 << 6,   // 0x040 - Individual heuristic contributions
  MOVES:      1 << 7,   // 0x080 - Move generation details
  PV:         1 << 8,   // 0x100 - Principal variation tracking
  TIME:       1 << 9,   // 0x200 - Timing information
  DECISION:   1 << 10,  // 0x400 - Comprehensive move decision logs
  STAGE:      1 << 11,  // 0x800 - Game stage transitions
  ALL:        0xFFF     // All categories enabled
};

export const CATEGORY_NAMES = {
  [LOG_CATEGORY.SEARCH]:     'search',
  [LOG_CATEGORY.EVAL]:       'eval',
  [LOG_CATEGORY.MOVE_ORDER]: 'move-order',
  [LOG_CATEGORY.TT]:         'transposition',
  [LOG_CATEGORY.UCI]:        'uci',
  [LOG_CATEGORY.BOOK]:       'book',
  [LOG_CATEGORY.HEURISTICS]: 'heuristics',
  [LOG_CATEGORY.MOVES]:      'moves',
  [LOG_CATEGORY.PV]:         'pv',
  [LOG_CATEGORY.TIME]:       'time',
  [LOG_CATEGORY.DECISION]:   'decision',
  [LOG_CATEGORY.STAGE]:      'stage'
};

export const CATEGORY_FILES = {
  [LOG_CATEGORY.SEARCH]:     'search.log',
  [LOG_CATEGORY.EVAL]:       'eval.log',
  [LOG_CATEGORY.MOVE_ORDER]: 'move-order.log',
  [LOG_CATEGORY.TT]:         'transposition.log',
  [LOG_CATEGORY.UCI]:        'uci.log',
  [LOG_CATEGORY.BOOK]:       'book.log',
  [LOG_CATEGORY.HEURISTICS]: 'heuristics.log',
  [LOG_CATEGORY.MOVES]:      'moves.log',
  [LOG_CATEGORY.PV]:         'pv.log',
  [LOG_CATEGORY.TIME]:       'time.log',
  [LOG_CATEGORY.DECISION]:   'decision.log',
  [LOG_CATEGORY.STAGE]:      'stage.log'
};

/**
 * Game stage definitions
 */
export const GAME_STAGE = {
  OPENING: 'opening',      // Moves 1-10, focus on development
  EARLY_MIDDLE: 'early_middle', // Moves 11-20, transitioning
  MIDDLE: 'middle',        // Moves 21-35, main battle
  LATE_MIDDLE: 'late_middle',   // Moves 36-50, simplification begins
  ENDGAME: 'endgame'       // Move 50+ or few pieces remain
};

/**
 * Stage-specific log files
 */
export const STAGE_FILES = {
  [GAME_STAGE.OPENING]: 'stage-opening.log',
  [GAME_STAGE.EARLY_MIDDLE]: 'stage-early-middle.log',
  [GAME_STAGE.MIDDLE]: 'stage-middle.log',
  [GAME_STAGE.LATE_MIDDLE]: 'stage-late-middle.log',
  [GAME_STAGE.ENDGAME]: 'stage-endgame.log'
};

export default LOG_CATEGORY;