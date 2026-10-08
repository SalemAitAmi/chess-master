/**
 * User settings: { version, profile, overrides: { UciName: value }, client }.
 *
 * Only what the user changed is stored. Each EngineClient subscribes while
 * connected; commitSettings() persists and returns every engine's sync result.
 * Pushing is always a DELTA: desiredFor() says what an engine should run,
 * batchFor() diffs that against the engine's mirror.
 */
import { hasOption, hasProfile, profileValues } from './catalog';
import { scopeOf, CLIENT_DEFAULTS } from './ui';
const STORAGE_KEY = 'chess-master-settings';
const VERSION = 3;
export function emptySettings() {
  return { version: VERSION, profile: 'baseline', overrides: {}, client: { ...CLIENT_DEFAULTS } };
}
/** Older versions keyed overrides by client ids; only profile and client settings survive migration. */
export function normalizeSettings(raw) {
  const out = emptySettings();
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.profile === 'string' && raw.profile) out.profile = raw.profile;
  const client = raw.client && typeof raw.client === 'object' ? raw.client : raw;
  for (const k of Object.keys(CLIENT_DEFAULTS)) {
    if (typeof client[k] === typeof CLIENT_DEFAULTS[k]) out.client[k] = client[k];
  }
  if (raw.version === VERSION && raw.overrides && typeof raw.overrides === 'object') {
    for (const [k, v] of Object.entries(raw.overrides)) {
      if (['boolean', 'number', 'string'].includes(typeof v)) out.overrides[k] = v;
    }
  }
  return out;
}
function load() {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')); }
  catch { return emptySettings(); }
}
let current = load();
const listeners = new Set();
export const getSettings = () => current;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** Persist, then let every live engine sync. @returns {Promise<object[]>} one result per engine */
export async function commitSettings(next) {
  current = normalizeSettings(next);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); }
  catch (e) { console.warn('[settings] save failed:', e); }
  return Promise.all([...listeners].map(fn =>
    Promise.resolve().then(() => fn(current)).catch(err => ({ engine: '?', ok: false, error: err.message }))));
}
/**
 * role 'primary'     the user's engine: Profile + every override
 * role 'contestant'  keeps its own profile; session overrides always,
 *                    profile overrides only with applyOverridesToColosseum
 */
export function desiredFor(settings, role) {
  const withProfileScope = role === 'primary' || settings.client.applyOverridesToColosseum === true;
  const overrides = {};
  for (const [k, v] of Object.entries(settings.overrides)) {
    if (!hasOption(k)) continue;
    if (scopeOf(k) === 'profile' && !withProfileScope) continue;
    overrides[k] = v;
  }
  const profile = role === 'primary' ? (hasProfile(settings.profile) ? settings.profile : 'baseline') : null;
  return { profile, overrides };
}
/**
 * The minimal batch that takes an engine from `applied` to `desired`.
 * `applied.values === null` (state unknown after a failed sync) forces a
 * Profile reload, which makes the engine's state known again.
 */
export function batchFor(applied, desired) {
  const profile = desired.profile ?? applied.profile;
  const reset = profile !== applied.profile || applied.values === null;
  const base = profileValues(profile);
  const target = { ...base, ...desired.overrides };
  const current = reset ? base : applied.values;
  const entries = reset ? [['Profile', profile]] : [];
  for (const [k, v] of Object.entries(target)) if (current[k] !== v) entries.push([k, v]);
  return { entries, profile, reset };
}