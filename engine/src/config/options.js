/**
 * Option registry — the engine's entire configuration surface.
 *
 * One row per knob: UCI name, internal key, type, DEFAULT (= baseline),
 * bounds, and how a change takes effect. DEFAULT_CONFIG, the `uci` option
 * block, profile validation, parsing and the config hash are all derived from
 * this table. Values are in WIRE units (weights are percent integers); only
 * toEngineConfig() converts, so nothing round-trips through a float.
 *
 * C shape: `static const Option OPTIONS[]` + `struct Config`.
 */
export const SMP_STRATEGIES = Object.freeze(['single', 'lazy', 'lazy-skip', 'root-split', 'pv-split']);
export const SMP_LOG_MODES  = Object.freeze(['winner', 'summary', 'triggered', 'full']);
/** How a change takes effect. Runtime kinds are not hashed and cannot appear in profiles. */
export const APPLY = Object.freeze({
  SEARCH: 'search', WEIGHT: 'weight', THREADS: 'threads',
  LOG_MASK: 'logMask', LOG_SAMPLE: 'logSample', SMP_LOG: 'smpLog',
});
const RUNTIME = new Set([APPLY.LOG_MASK, APPLY.LOG_SAMPLE, APPLY.SMP_LOG]);
const check  = (uci, key, def = true) => ({ uci, key, type: 'check', def, apply: APPLY.SEARCH });
const spin   = (uci, key, def, min, max, apply = APPLY.SEARCH) => ({ uci, key, type: 'spin', def, min, max, apply });
const combo  = (uci, key, def, vars, apply = APPLY.SEARCH) => ({ uci, key, type: 'combo', def, vars, apply });
const weight = (uci, key) => ({ uci, key, type: 'spin', def: 100, min: 0, max: 400, apply: APPLY.WEIGHT });
export const OPTIONS = Object.freeze([
  // ── Resources ──
  spin('Hash', 'hashSizeMB', 64, 1, 1024),
  spin('MoveTime', 'maxSearchTime', 30000, 10, 600000),
  spin('MaxDepth', 'maxDepth', 64, 1, 64),
  check('OwnBook', 'useOpeningBook'),
  // ── SMP ──
  spin('Threads', 'threads', 1, 1, 64, APPLY.THREADS),
  combo('SearchStrategy', 'smpStrategy', 'lazy-skip', SMP_STRATEGIES),
  spin('SmpSplitDepth', 'smpSplitDepth', 4, 1, 32),
  // ── Evaluation terms ──
  check('UseMaterial', 'useMaterial'),
  check('UseCenterControl', 'useCenterControl'),
  check('UseDevelopment', 'useDevelopment'),
  check('UsePawnStructure', 'usePawnStructure'),
  check('UseKingSafety', 'useKingSafety'),
  check('UseInitiative', 'useInitiative'),
  // ── Weights (percent) ──
  weight('WeightMaterial', 'material'),
  weight('WeightCenterControl', 'centerControl'),
  weight('WeightDevelopment', 'development'),
  weight('WeightPawnStructure', 'pawnStructure'),
  weight('WeightKingSafety', 'kingSafety'),
  weight('WeightInitiative', 'initiative'),
  weight('WeightPawnPush', 'pawnPush'),
  // ── Search features ──
  check('UseQuiescence', 'useQuiescence'),
  spin('QuiescenceDepth', 'quiescenceDepth', 8, 0, 32),
  check('UseKillerMoves', 'useKillerMoves'),
  check('UseHistoryHeuristic', 'useHistoryHeuristic'),
  check('UseTranspositionTable', 'useTranspositionTable'),
  check('UseNullMovePruning', 'useNullMovePruning'),
  check('UseLateMovereduction', 'useLateMovereduction'),
  check('UseFutilityPruning', 'useFutilityPruning'),
  check('UseSEEPruning', 'useSEEPruning'),
  check('UseSoftPinOrdering', 'useSoftPinOrdering'),
  check('UseAspirationWindows', 'useAspirationWindows'),
  check('UsePVS', 'usePVS'),
  check('UseIID', 'useIID'),
  check('UseOpeningPrinciples', 'useOpeningPrinciples'),
  check('UsePawnPush', 'usePawnPush'),
  // ── Draw policy ──
  spin('Contempt', 'drawContemptMax', 50, 0, 200),
  spin('NeutralContempt', 'neutralContempt', 25, 0, 200),
  spin('RepetitionMargin', 'repetitionMargin', 90, 0, 500),
  spin('RepetitionContempt', 'repetitionContempt', 30, 0, 200),
  // ── Runtime (process/instance state, not config identity) ──
  spin('LogMask', null, 0, 0, 8191, APPLY.LOG_MASK),
  spin('LogSampleRate', null, 256, 1, 65536, APPLY.LOG_SAMPLE),
  combo('SmpLog', null, 'triggered', SMP_LOG_MODES, APPLY.SMP_LOG),
]);
export const isRuntime = (o) => RUNTIME.has(o.apply);
const BY_NAME = new Map(OPTIONS.map(o => [o.uci.toLowerCase(), o]));
export function findOption(name) { return BY_NAME.get(String(name).toLowerCase()) ?? null; }
/** Parse a wire value. Spins are CLAMPED (the ack reports the effective value); invalid → undefined. */
export function parseValue(o, raw) {
  const s = String(raw).trim();
  if (o.type === 'check') {
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
    return undefined;
  }
  if (o.type === 'spin') {
    if (!/^-?\d+$/.test(s)) return undefined;
    return Math.min(o.max, Math.max(o.min, parseInt(s, 10)));
  }
  return o.vars.includes(s) ? s : undefined;
}