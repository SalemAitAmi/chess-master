/**
 * Canonical UCI option registry.
 *
 * ONE DECLARATION PER KNOB. uciHandler generates both the `uci` option block
 * and the `setoption` dispatch table from this array, so an option cannot be
 * advertised-but-unhandled (or handled-but-unadvertised) — which is how
 * `quiescenceDepth`, the eval weights and the contempt trio ended up
 * configurable in config.json but not over the wire.
 *
 * `apply` selects the mutation path:
 *   'config'  → flat config key (engine.setOption + evaluator rebuild)
 *   'weight'  → config.weights[<key>], value/scale (UCI spin is integral)
 *   'threads' → SmpCoordinator.setThreadCount (clamps, records intent)
 *   'profile' → whole-config swap + fresh search engine + fresh TT
 *   'logmask' / 'logsample' → logger
 *
 * `group` is presentation only; the client mirrors it to lay out the settings
 * modal. `experiment: true` marks knobs the automation harness is allowed to
 * sweep (everything that changes PLAY, excluding logging and hash sizing).
 */
export const OPTION_GROUP = {
  ENGINE:   'engine',
  SEARCH:   'search',
  EVAL:     'evaluation',
  WEIGHTS:  'weights',
  CONTEMPT: 'contempt',
  LOGGING:  'logging',
};

const check  = (uci, key, def, group, extra = {}) =>
  ({ uci, key, type: 'check', def, group, apply: 'config', experiment: true, ...extra });
const spin   = (uci, key, def, min, max, group, extra = {}) =>
  ({ uci, key, type: 'spin', def, min, max, group, apply: 'config', experiment: true, ...extra });
const weight = (uci, key, group = OPTION_GROUP.WEIGHTS) =>
  ({ uci, key, type: 'spin', def: 100, min: 0, max: 400, scale: 100,
     group, apply: 'weight', experiment: true, unit: '%' });

export const OPTIONS = [
  // ── Engine / resources ───────────────────────────────────────────────
  spin('Hash', 'hashSizeMB', 64, 1, 1024, OPTION_GROUP.ENGINE,
       { experiment: false, label: 'Hash size (MB)',
         help: 'Transposition table size. Changing it allocates a FRESH table.' }),
  { uci: 'Threads', key: 'threads', type: 'spin', def: 1, min: 1, max: 64,
    group: OPTION_GROUP.ENGINE, apply: 'threads', experiment: false,
    label: 'Search threads',
    help: 'Recorded by SmpCoordinator. Lazy SMP is not yet routing the search; ' +
          'values >1 run single-threaded and emit an info string.' },
  spin('MoveTime', 'maxSearchTime', 30000, 10, 600000, OPTION_GROUP.ENGINE,
       { experiment: true, label: 'Max search time (ms)' }),
  spin('MaxDepth', 'maxDepth', 64, 1, 64, OPTION_GROUP.ENGINE,
       { label: 'Max iterative-deepening depth' }),
  check('OwnBook', 'useOpeningBook', true, OPTION_GROUP.ENGINE,
        { label: 'Opening book',
          help: 'Book moves are ordering HINTS; a better search result overrides them.' }),

  // ── Evaluation terms ─────────────────────────────────────────────────
  check('UseMaterial', 'useMaterial', true, OPTION_GROUP.EVAL),
  check('UseCenterControl', 'useCenterControl', true, OPTION_GROUP.EVAL),
  check('UseDevelopment', 'useDevelopment', true, OPTION_GROUP.EVAL),
  check('UsePawnStructure', 'usePawnStructure', true, OPTION_GROUP.EVAL),
  check('UseKingSafety', 'useKingSafety', true, OPTION_GROUP.EVAL),
  check('UseInitiative', 'useInitiative', true, OPTION_GROUP.EVAL,
        { help: 'King-zone attack potential, queen asymmetry, tempo. ' +
                'Disabling it removes the evaluation derivative w.r.t. liquidation.' }),

  // ── Evaluation weights ──────────────────────────────────────────────
  weight('WeightMaterial', 'material'),
  weight('WeightCenterControl', 'centerControl'),
  weight('WeightDevelopment', 'development'),
  weight('WeightPawnStructure', 'pawnStructure'),
  weight('WeightKingSafety', 'kingSafety'),
  weight('WeightInitiative', 'initiative'),
  weight('WeightPawnPush', 'pawnPush'),

  // ── Search features ─────────────────────────────────────────────────
  check('UseQuiescence', 'useQuiescence', true, OPTION_GROUP.SEARCH),
  spin('QuiescenceDepth', 'quiescenceDepth', 8, 0, 32, OPTION_GROUP.SEARCH,
       { help: 'Nominal horizon. Forced business (evasions, recaptures on the ' +
               'square that just changed hands) extends past it by a bounded amount.' }),
  check('UseKillerMoves', 'useKillerMoves', true, OPTION_GROUP.SEARCH),
  check('UseHistoryHeuristic', 'useHistoryHeuristic', true, OPTION_GROUP.SEARCH),
  check('UseTranspositionTable', 'useTranspositionTable', true, OPTION_GROUP.SEARCH),
  check('UseNullMovePruning', 'useNullMovePruning', true, OPTION_GROUP.SEARCH),
  check('UseLateMovereduction', 'useLateMovereduction', true, OPTION_GROUP.SEARCH),
  check('UseFutilityPruning', 'useFutilityPruning', true, OPTION_GROUP.SEARCH),
  check('UseSEEPruning', 'useSEEPruning', true, OPTION_GROUP.SEARCH),
  check('UseSoftPinOrdering', 'useSoftPinOrdering', true, OPTION_GROUP.SEARCH),
  check('UseAspirationWindows', 'useAspirationWindows', true, OPTION_GROUP.SEARCH),
  check('UsePVS', 'usePVS', true, OPTION_GROUP.SEARCH),
  check('UseIID', 'useIID', true, OPTION_GROUP.SEARCH),
  check('UseOpeningPrinciples', 'useOpeningPrinciples', true, OPTION_GROUP.SEARCH),
  check('UsePawnPush', 'usePawnPush', true, OPTION_GROUP.SEARCH),

  // ── Draw policy ─────────────────────────────────────────────────────
  spin('Contempt', 'drawContemptMax', 50, 0, 200, OPTION_GROUP.CONTEMPT,
       { label: 'Draw contempt (max, cp)' }),
  spin('NeutralContempt', 'neutralContempt', 25, 0, 200, OPTION_GROUP.CONTEMPT,
       { label: 'Draw cost at level material (cp)' }),
  spin('RepetitionMargin', 'repetitionMargin', 90, 0, 500, OPTION_GROUP.CONTEMPT,
       { label: 'Material to give up rather than repeat (cp)' }),
  spin('RepetitionContempt', 'repetitionContempt', 30, 0, 200, OPTION_GROUP.CONTEMPT),

  // ── Logging ─────────────────────────────────────────────────────────
  // -1 is the SENTINEL "leave the build default alone". The build default is
  // LOG_CATEGORY.ALL in dev (server.js) and a NoopLogger in prod, so a client
  // that pushes its whole settings blob must not be able to accidentally
  // silence a dev run — which is exactly what a `def: 0` mirror did.
  { uci: 'LogMask', key: null, type: 'spin', def: -1, min: -1, max: 4095,
    group: OPTION_GROUP.LOGGING, apply: 'logmask', experiment: false,
    label: 'Log category bitmask', sentinel: -1 },
  { uci: 'LogSampleRate', key: null, type: 'spin', def: -1, min: -1, max: 65536,
    group: OPTION_GROUP.LOGGING, apply: 'logsample', experiment: false,
    label: 'Trace sample rate (1-in-N)', sentinel: -1 },
];

/** Declared separately: its `var` list is built from the profile registry. */
export const PROFILE_OPTION = {
  uci: 'Profile', key: null, type: 'combo', def: 'baseline',
  group: OPTION_GROUP.ENGINE, apply: 'profile', experiment: true,
};

const BY_NAME = new Map();
for (const o of OPTIONS) BY_NAME.set(o.uci.toLowerCase(), o);
BY_NAME.set(PROFILE_OPTION.uci.toLowerCase(), PROFILE_OPTION);

export function findOption(name) { return BY_NAME.get(String(name).toLowerCase()) ?? null; }

/** `option name ...` lines. `profileNames` fills the Profile combo. */
export function formatOptionLines(profileNames = []) {
  const line = (o) => {
    let s = `option name ${o.uci} type ${o.type} default ${o.def}`;
    if (o.type === 'spin') s += ` min ${o.min} max ${o.max}`;
    if (o.type === 'combo') s += ' ' + profileNames.map(n => `var ${n}`).join(' ');
    return s;
  };
  return [line(PROFILE_OPTION), ...OPTIONS.map(line)];
}

/** Current value of every option, for the `options` command / client sync. */
export function readOptionValues(config, logMask) {
  const out = [];
  for (const o of OPTIONS) {
    let v;
    if (o.apply === 'weight') v = Math.round((config.weights?.[o.key] ?? 1) * (o.scale ?? 1));
    else if (o.apply === 'logmask') v = logMask;
    else if (o.apply === 'logsample') v = o.def;
    else v = config[o.key];
    out.push({ uci: o.uci, value: v });
  }
  return out;
}

export default OPTIONS;