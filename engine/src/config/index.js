/**
 * Engine configuration: profiles, per-instance state, identity, UCI lines.
 *
 * ConfigState is the ONLY mutable config in an instance. Every change —
 * standard `setoption` or batched `setoptions` — goes through apply(), which
 * validates the whole batch before touching anything.
 */
import PROFILE_DATA from './profiles.json' with { type: 'json' };
import { OPTIONS, APPLY, findOption, parseValue, isRuntime, SMP_STRATEGIES, SMP_LOG_MODES } from './options.js';
export { OPTIONS, APPLY, findOption, parseValue, isRuntime, SMP_STRATEGIES, SMP_LOG_MODES };
/** Wire values (Map uci → value) → the flat object SearchEngine/Evaluator consume. */
export function toEngineConfig(values) {
  const cfg = { weights: {} };
  for (const o of OPTIONS) {
    if (o.key === null) continue;
    const v = values.get(o.uci);
    if (o.apply === APPLY.WEIGHT) cfg.weights[o.key] = v / 100;
    else cfg[o.key] = v;
  }
  return cfg;
}
export const DEFAULT_VALUES = new Map(OPTIONS.map(o => [o.uci, o.def]));
export const DEFAULT_CONFIG = (() => {
  const c = toEngineConfig(DEFAULT_VALUES);
  Object.freeze(c.weights);
  return Object.freeze(c);
})();
// ── Profiles (validated at load: a bad profile fails the process start) ──
const PROFILES = new Map();
for (const [name, p] of Object.entries(PROFILE_DATA)) {
  const set = new Map();
  for (const [k, raw] of Object.entries(p.set ?? {})) {
    const o = findOption(k);
    if (o === null) throw new Error(`profiles.json: ${name}.${k} is not an option`);
    if (isRuntime(o)) throw new Error(`profiles.json: ${name}.${k} is a runtime option`);
    const v = parseValue(o, raw);
    if (v === undefined) throw new Error(`profiles.json: ${name}.${k}=${raw} is invalid`);
    set.set(o.uci, v);
  }
  PROFILES.set(name, { name, label: p.label ?? name, description: p.description ?? '', set });
}
if (!PROFILES.has('baseline')) PROFILES.set('baseline', { name: 'baseline', label: 'Baseline', description: '', set: new Map() });
export const hasProfile = (name) => PROFILES.has(name);
export const profileInfo = (name) => PROFILES.get(name) ?? PROFILES.get('baseline');
export const listProfiles = () => [...PROFILES.values()];
/** FNV-1a over every non-runtime value, in registry order: the config identity. */
function hashValues(values) {
  let h = 0x811c9dc5;
  for (const o of OPTIONS) {
    if (isRuntime(o)) continue;
    const s = `${o.uci}=${values.get(o.uci)};`;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
export class ConfigState {
  /** @param {object} runtime  seeds for runtime options, e.g. the process's current LogMask */
  constructor(profileName = 'baseline', runtime = {}) {
    this.values = new Map(DEFAULT_VALUES);
    for (const [k, v] of Object.entries(runtime)) {
      const o = findOption(k);
      if (o !== null && isRuntime(o)) this.values.set(o.uci, v);
    }
    this.rev = 0;
    this._load(hasProfile(profileName) ? profileName : 'baseline');
  }
  _load(name) {
    const p = profileInfo(name);
    for (const o of OPTIONS) {
      if (!isRuntime(o)) this.values.set(o.uci, p.set.has(o.uci) ? p.set.get(o.uci) : o.def);
    }
    this.profile = p.name;
    this.hash = hashValues(this.values);
  }
  get(uci) { return this.values.get(uci); }
  engineConfig() { return toEngineConfig(this.values); }
  /** Non-runtime values that differ from the active profile — the delta in force. */
  overrides() {
    const p = profileInfo(this.profile);
    const out = {};
    for (const o of OPTIONS) {
      if (isRuntime(o)) continue;
      const base = p.set.has(o.uci) ? p.set.get(o.uci) : o.def;
      const v = this.values.get(o.uci);
      if (v !== base) out[o.uci] = v;
    }
    return out;
  }
  /**
   * Atomic batch. `Profile` (any position) is applied first and reloads the
   * profile; the remaining entries are applied over it.
   * @param {Array<[string,string]>} entries
   * @returns {{ok:true, hash, profileChanged, changed:Set<string>, identityChanged, effective:Array<[string,*]>}
   *          | {ok:false, name, reason}}
   */
  apply(entries) {
    let profile = null;
    const parsed = [];
    for (const [name, raw] of entries) {
      if (String(name).toLowerCase() === 'profile') {
        if (!hasProfile(raw)) return { ok: false, name, reason: 'unknown_profile' };
        profile = raw;
        continue;
      }
      const o = findOption(name);
      if (o === null) return { ok: false, name, reason: 'unknown_option' };
      const v = parseValue(o, raw);
      if (v === undefined) return { ok: false, name, reason: 'invalid_value' };
      parsed.push([o, v]);
    }
    const before = this.hash;
    if (profile !== null) this._load(profile);
    const changed = new Set();
    for (const [o, v] of parsed) {
      if (this.values.get(o.uci) === v) continue;
      this.values.set(o.uci, v);
      changed.add(o.apply);
    }
    this.hash = hashValues(this.values);
    const identityChanged = profile !== null || this.hash !== before;
    if (identityChanged) this.rev++;
    const effective = [];
    if (profile !== null) effective.push(['Profile', this.profile]);
    for (const [o] of parsed) effective.push([o.uci, this.values.get(o.uci)]);
    return { ok: true, hash: this.hash, profileChanged: profile !== null, changed, identityChanged, effective };
  }
}
/**
 * `option` lines. Defaults are the BASELINE values (so a client can rebuild
 * every profile as defaults + delta), except runtime options, which report the
 * instance's current value.
 */
export function formatUciOptions(state) {
  const lines = [`option name Profile type combo default baseline ${listProfiles().map(p => `var ${p.name}`).join(' ')}`];
  for (const o of OPTIONS) {
    let s = `option name ${o.uci} type ${o.type} default ${isRuntime(o) ? state.get(o.uci) : o.def}`;
    if (o.type === 'spin') s += ` min ${o.min} max ${o.max}`;
    if (o.type === 'combo') s += ' ' + o.vars.map(v => `var ${v}`).join(' ');
    lines.push(s);
  }
  return lines;
}
/** `profile <name> label <Label> set k=v … desc <text>` — UCI GUIs ignore unknown lines. */
export function formatProfileLines() {
  return listProfiles().map(p =>
    `profile ${p.name} label ${p.label.replace(/\s+/g, '_')} set ` +
    [...p.set].map(([k, v]) => `${k}=${v}`).join(' ') + ` desc ${p.description}`);
}