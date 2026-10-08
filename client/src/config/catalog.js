/**
 * Engine-provided catalog: option definitions and profiles, ingested from the
 * `uci` reply and kept in memory for the page's lifetime. Every connection to
 * one server advertises the same catalog, so re-ingesting is idempotent.
 *
 * Option defaults are the engine BASELINE; a profile is defaults + its `set`.
 * Values are typed: check → boolean, spin → number, combo → string.
 */
const options = new Map();    // uci → { uci, type, def, min, max, vars }
const profiles = new Map();   // name → { name, label, description, set }
export function parseWire(opt, s) {
  if (opt.type === 'check') return s === 'true';
  if (opt.type === 'spin') { const n = parseInt(s, 10); return Number.isFinite(n) ? n : opt.def; }
  return s ?? '';
}
export const toWire = (v) => String(v);
/** @returns {boolean} true when the line belonged to the catalog. */
export function ingestUciLine(line) {
  if (line.startsWith('option name ')) { parseOption(line); return true; }
  if (line.startsWith('profile ')) { parseProfile(line); return true; }
  return false;
}
function parseOption(line) {
  const t = line.split(/\s+/);
  let i = 2;
  const name = [];
  while (i < t.length && t[i] !== 'type') name.push(t[i++]);
  const o = { uci: name.join(' '), type: null, def: '', min: null, max: null, vars: [] };
  for (; i < t.length; i++) {
    if (t[i] === 'type') o.type = t[++i];
    else if (t[i] === 'default') o.def = t[++i] ?? '';
    else if (t[i] === 'min') o.min = Number(t[++i]);
    else if (t[i] === 'max') o.max = Number(t[++i]);
    else if (t[i] === 'var') o.vars.push(t[++i]);
  }
  if (o.uci === 'Profile') return;          // profiles come from `profile` lines
  o.def = parseWire(o, o.def);
  options.set(o.uci, o);
}
function parseProfile(line) {
  const t = line.split(/\s+/);
  const name = t[1];
  let i = 2, label = name;
  if (t[i] === 'label') { label = (t[i + 1] || name).replace(/_/g, ' '); i += 2; }
  if (t[i] === 'set') i++;
  const set = {};
  for (; i < t.length && t[i] !== 'desc'; i++) {
    const eq = t[i].indexOf('=');
    if (eq <= 0) continue;
    const k = t[i].slice(0, eq);
    const o = options.get(k);
    set[k] = o ? parseWire(o, t[i].slice(eq + 1)) : t[i].slice(eq + 1);
  }
  profiles.set(name, { name, label, description: i < t.length ? t.slice(i + 1).join(' ') : '', set });
}
export const catalogReady = () => options.size > 0;
export const getOption = (uci) => options.get(uci) ?? null;
export const hasOption = (uci) => options.has(uci);
export const listOptions = () => [...options.values()];
export const hasProfile = (name) => profiles.has(name);
export const listProfiles = () => [...profiles.values()];
/** Full typed value set of a profile (unknown → baseline). */
export function profileValues(name) {
  const out = {};
  for (const o of options.values()) out[o.uci] = o.def;
  const p = profiles.get(name) ?? profiles.get('baseline');
  if (p) Object.assign(out, p.set);
  return out;
}