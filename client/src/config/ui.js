/**
 * Presentation metadata, keyed by UCI option name. Types, bounds and defaults
 * come from the engine (catalog.js). An option the engine advertises but this
 * table does not know still renders, in "Other", with scope 'profile'.
 *
 * scope 'profile'  part of a config set; cleared on profile change; reaches
 *                  Colosseum engines only with applyOverridesToColosseum
 * scope 'session'  resources/threading/logging; kept across profile changes;
 *                  always reaches every engine
 */
export const GROUPS = [
  { id: 'engine', label: 'Engine & resources' }, { id: 'smp', label: 'Multi-threading (SMP)' },
  { id: 'search', label: 'Search features' }, { id: 'evaluation', label: 'Evaluation terms' },
  { id: 'weights', label: 'Evaluation weights' }, { id: 'contempt', label: 'Draw policy' },
  { id: 'logging', label: 'Logging' }, { id: 'other', label: 'Other engine options' },
  { id: 'local', label: 'Client behaviour' },
];
const s = (group, label, help = null, extra = {}) => ({ group, scope: 'session', label, help, ...extra });
const p = (group, label, help = null, extra = {}) => ({ group, scope: 'profile', label, help, ...extra });
const w = (label) => p('weights', label, 'Multiplier on this evaluation term.', { unit: '%', step: 5 });
const UI = {
  Hash: s('engine', 'Hash size (MB)', 'Changing this allocates a fresh, empty table.'),
  MoveTime: s('engine', 'Max search time (ms)', null, { step: 1000 }),
  MaxDepth: p('engine', 'Max depth', 'Ceiling on every search, including difficulty depths.'),
  OwnBook: p('engine', 'Opening book', 'Book moves are ordering hints, not move selection.'),
  Threads: s('smp', 'Search threads', 'Main + helpers, clamped to the server\'s CPUs. Non-deterministic above 1.'),
  SearchStrategy: s('smp', 'Search strategy'),
  SmpSplitDepth: s('smp', 'pv-split first split depth', 'Shallower iterations stay on the main thread.'),
  UseMaterial: p('evaluation', 'Material + PST'), UseCenterControl: p('evaluation', 'Center control'),
  UseDevelopment: p('evaluation', 'Development'), UsePawnStructure: p('evaluation', 'Pawn structure'),
  UseKingSafety: p('evaluation', 'King safety'), UseInitiative: p('evaluation', 'Initiative / attack potential'),
  WeightMaterial: w('Material'), WeightCenterControl: w('Center control'), WeightDevelopment: w('Development'),
  WeightPawnStructure: w('Pawn structure'), WeightKingSafety: w('King safety'),
  WeightInitiative: w('Initiative'), WeightPawnPush: w('Pawn push (ordering)'),
  UseQuiescence: p('search', 'Quiescence search'), QuiescenceDepth: p('search', 'Quiescence depth'),
  UseKillerMoves: p('search', 'Killer moves'), UseHistoryHeuristic: p('search', 'History heuristic'),
  UseTranspositionTable: p('search', 'Transposition table'), UseNullMovePruning: p('search', 'Null-move pruning'),
  UseLateMovereduction: p('search', 'Late move reduction'), UseFutilityPruning: p('search', 'Futility pruning'),
  UseSEEPruning: p('search', 'SEE pruning'), UseSoftPinOrdering: p('search', 'Soft-pin ordering'),
  UseAspirationWindows: p('search', 'Aspiration windows'), UsePVS: p('search', 'Principal variation search'),
  UseIID: p('search', 'Internal iterative deepening'), UseOpeningPrinciples: p('search', 'Opening principles (root ordering)'),
  UsePawnPush: p('search', 'Pawn-push ordering bonus'),
  Contempt: p('contempt', 'Draw contempt max (cp)', null, { step: 5 }),
  NeutralContempt: p('contempt', 'Level-material draw cost (cp)', null, { step: 5 }),
  RepetitionMargin: p('contempt', 'Repetition margin (cp)', null, { step: 10 }),
  RepetitionContempt: p('contempt', 'Repetition contempt (cp)', null, { step: 5 }),
  LogMask: s('logging', 'Log category bitmask', '0 = silent, 8191 = everything (0x1000 = smp).'),
  LogSampleRate: s('logging', 'Trace sample rate (1-in-N)',
                   'Fixed for the whole log session once its first game begins; the engine refuses a later change.'),
  SmpLog: s('logging', 'SMP worker log scheme',
            'winner · summary · triggered (summary + trails on anomalies) · full'),
};
export function uiFor(uci) { return UI[uci] ?? { group: 'other', scope: 'profile', label: uci, help: null }; }
export const scopeOf = (uci) => uiFor(uci).scope;
export const STRATEGY_HELP = {
  'single': 'Ignore Threads. Control arm for every comparison.',
  'lazy': 'Identical helpers sharing the table. Diversity from timing only.',
  'lazy-skip': 'Lazy + depth skipping, aspiration perturbation and root bias (default).',
  'root-split': 'Root moves dealt round-robin; each thread searches its subset. No shared alpha.',
  'pv-split': 'PV move first, then remaining root moves claimed dynamically with a shared alpha.',
};
export const CLIENT_OPTIONS = [
  { id: 'applyOverridesToColosseum', type: 'check', def: false,
    label: 'Apply profile overrides to Colosseum engines',
    help: 'Session settings always apply. This adds your profile-scope overrides on top of each ' +
          'contestant\'s own profile. Contestant profiles are never replaced.' },
  { id: 'startFen', type: 'fen', def: '', label: 'Starting position (FEN)',
    help: 'Empty = standard start. Applied to every mode at the next new game.' },
];
export const CLIENT_DEFAULTS = Object.freeze(Object.fromEntries(CLIENT_OPTIONS.map(o => [o.id, o.def])));
export const FEN_PRESETS = [
  { label: 'Standard start', fen: '' },
  { label: 'K+Q vs K (mating net)', fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1' },
  { label: 'K+P vs K', fen: '8/8/8/4k3/8/8/4P3/4K3 w - - 0 1' },
  { label: 'Lucena (R+P vs R)', fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1' },
  { label: 'Rook endgame (perft 3)', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1' },
  { label: 'Kiwipete (tactical)', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1' },
];