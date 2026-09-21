/**
 * Client mirror of engine/src/config/optionSchema.js.
 *
 * The engine is authoritative: EngineClient captures every advertised
 * `option name ...` line into `engine.options`, and SettingsModal renders only
 * options the engine actually advertises (intersecting this list with that
 * map), clamped to the engine's own min/max. This file supplies the things
 * UCI cannot express: grouping, human labels and help text.
 *
 * `id` is the storage key. Weights are stored as PERCENT INTEGERS, matching
 * the spin option the engine exposes (UCI spin is integral; the engine divides
 * by 100), so no float round-tripping is needed anywhere.
 */
export const OPTION_GROUPS = [
  { id: 'engine',     label: 'Engine & resources' },
  { id: 'search',     label: 'Search features' },
  { id: 'evaluation', label: 'Evaluation terms' },
  { id: 'weights',    label: 'Evaluation weights' },
  { id: 'contempt',   label: 'Draw policy' },
  { id: 'logging',    label: 'Logging' },
  { id: 'local',      label: 'Client behaviour' },
];

const chk = (id, uci, group, label, help) =>
  ({ id, uci, type: 'check', def: true, group, label: label || id, help });
const num = (id, uci, group, def, min, max, step, label, help) =>
  ({ id, uci, type: 'spin', def, min, max, step: step || 1, group, label: label || id, help });
const wgt = (id, uci, label) =>
  ({ id, uci, type: 'spin', def: 100, min: 0, max: 400, step: 5,
     group: 'weights', unit: '%', label, help: 'Multiplier on this evaluation term.' });

export const ENGINE_OPTIONS = [
  // ── Engine ──
  { id: 'profile', uci: 'Profile', type: 'combo', def: 'baseline', group: 'engine',
    label: 'Config profile',
    help: 'Whole config set. Selecting one REPLACES every other value below and ' +
          'allocates a fresh transposition table.' },
  num('hashSizeMB', 'Hash', 'engine', 64, 1, 1024, 1, 'Hash size (MB)',
      'Changing this allocates a fresh, empty transposition table.'),
  num('threads', 'Threads', 'engine', 1, 1, 8, 1, 'Search threads',
      'Recorded by the engine. Lazy SMP is not wired yet — values >1 still run single-threaded.'),
  num('maxSearchTime', 'MoveTime', 'engine', 30000, 1000, 600000, 1000, 'Max search time (ms)'),
  num('maxDepth', 'MaxDepth', 'engine', 64, 1, 64, 1, 'Max depth'),
  chk('useOpeningBook', 'OwnBook', 'engine', 'Opening book',
      'Book moves are ordering hints, not move selection.'),

  // ── Evaluation terms ──
  chk('useMaterial', 'UseMaterial', 'evaluation', 'Material + PST'),
  chk('useCenterControl', 'UseCenterControl', 'evaluation', 'Center control'),
  chk('useDevelopment', 'UseDevelopment', 'evaluation', 'Development'),
  chk('usePawnStructure', 'UsePawnStructure', 'evaluation', 'Pawn structure'),
  chk('useKingSafety', 'UseKingSafety', 'evaluation', 'King safety'),
  chk('useInitiative', 'UseInitiative', 'evaluation', 'Initiative / attack potential',
      'Gives the evaluation a derivative with respect to liquidation. Off = trade-everything behaviour.'),

  // ── Weights ──
  wgt('weightMaterial', 'WeightMaterial', 'Material'),
  wgt('weightCenterControl', 'WeightCenterControl', 'Center control'),
  wgt('weightDevelopment', 'WeightDevelopment', 'Development'),
  wgt('weightPawnStructure', 'WeightPawnStructure', 'Pawn structure'),
  wgt('weightKingSafety', 'WeightKingSafety', 'King safety'),
  wgt('weightInitiative', 'WeightInitiative', 'Initiative'),
  wgt('weightPawnPush', 'WeightPawnPush', 'Pawn push'),

  // ── Search ──
  chk('useQuiescence', 'UseQuiescence', 'search', 'Quiescence search'),
  num('quiescenceDepth', 'QuiescenceDepth', 'search', 8, 0, 32, 1, 'Quiescence depth'),
  chk('useKillerMoves', 'UseKillerMoves', 'search', 'Killer moves'),
  chk('useHistoryHeuristic', 'UseHistoryHeuristic', 'search', 'History heuristic'),
  chk('useTranspositionTable', 'UseTranspositionTable', 'search', 'Transposition table'),
  chk('useNullMovePruning', 'UseNullMovePruning', 'search', 'Null-move pruning'),
  chk('useLateMovereduction', 'UseLateMovereduction', 'search', 'Late move reduction'),
  chk('useFutilityPruning', 'UseFutilityPruning', 'search', 'Futility pruning'),
  chk('useSEEPruning', 'UseSEEPruning', 'search', 'SEE pruning'),
  chk('useSoftPinOrdering', 'UseSoftPinOrdering', 'search', 'Soft-pin ordering'),
  chk('useAspirationWindows', 'UseAspirationWindows', 'search', 'Aspiration windows'),
  chk('usePVS', 'UsePVS', 'search', 'Principal variation search'),
  chk('useIID', 'UseIID', 'search', 'Internal iterative deepening'),
  chk('useOpeningPrinciples', 'UseOpeningPrinciples', 'search', 'Opening principles (root ordering)'),
  chk('usePawnPush', 'UsePawnPush', 'search', 'Pawn-push ordering bonus'),

  // ── Contempt ──
  num('drawContemptMax', 'Contempt', 'contempt', 50, 0, 200, 5, 'Draw contempt max (cp)'),
  num('neutralContempt', 'NeutralContempt', 'contempt', 25, 0, 200, 5, 'Level-material draw cost (cp)'),
  num('repetitionMargin', 'RepetitionMargin', 'contempt', 90, 0, 500, 10, 'Repetition margin (cp)'),
  num('repetitionContempt', 'RepetitionContempt', 'contempt', 30, 0, 200, 5, 'Repetition contempt (cp)'),

  // ── Logging ──
  // -1 = "engine default", which is build-dependent: ALL categories in a dev
  // build, logging stripped entirely in prod. Any other value overrides it.
  num('logMask', 'LogMask', 'logging', -1, -1, 4095, 1, 'Log category bitmask',
      '-1 keeps the engine build default (all categories in dev, off in prod). ' +
      '0 = silent. 4095 = everything. See engine/src/logging/categories.js.'),
  num('logSampleRate', 'LogSampleRate', 'logging', -1, -1, 65536, 1, 'Trace sample rate (1-in-N)',
      '-1 keeps the engine default (256). Lower = more per-node trace records.'),

  // ── Client-only ──
  { id: 'applyOverridesToColosseum', type: 'check', def: false, group: 'local', local: true,
    label: 'Apply these settings to Colosseum engines',
    help: 'OFF keeps a Colosseum match on pure profile configs, which is what ' +
          'profile-vs-profile comparisons require. ON pushes every setting above ' +
          'to BOTH contestants, which is how you test one config set against itself.' },
];

export const OPTION_BY_ID = new Map(ENGINE_OPTIONS.map(o => [o.id, o]));

export const DEFAULT_SETTINGS = Object.freeze(
  Object.fromEntries(ENGINE_OPTIONS.map(o => [o.id, o.def]))
);

/** Back-compat: id → UCI name, for anything still iterating a flat map. */
export const SETTING_TO_UCI = Object.freeze(
  Object.fromEntries(ENGINE_OPTIONS.filter(o => !o.local).map(o => [o.id, o.uci]))
);