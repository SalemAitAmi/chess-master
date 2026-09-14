/**
 * Engine profiles — named config deltas merged over config.json.
 *
 * A profile is a PARTIAL config in the same nested shape as config.json. It is
 * deep-merged over the base, then flattened into the flat shape the engine
 * consumes (DEFAULT_CONFIG keys). Unknown profile names fail LOUD: a silent
 * fallback to baseline would invalidate a whole comparison run.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_CONFIG } from '../core/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_PATH     = path.join(__dirname, '../../config.json');
const PROFILES_PATH = path.join(__dirname, '../../config/profiles.json');

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return fallback; }
}

const BASE     = readJson(BASE_PATH, {});
const PROFILES = readJson(PROFILES_PATH, { baseline: { label: 'Baseline' } });

function deepMerge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) {
    const v = b[k];
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) &&
              a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]))
      ? deepMerge(a[k], v) : v;
  }
  return out;
}

/** Nested config.json shape → the flat shape SearchEngine/Evaluator read. */
function flatten(nested) {
  const flat = { ...DEFAULT_CONFIG };
  for (const section of ['engine', 'evaluation', 'search', 'contempt']) {
    const s = nested[section];
    if (!s) continue;
    for (const k of Object.keys(s)) {
      if (k === 'weights') flat.weights = { ...flat.weights, ...s.weights };
      else flat[k] = s[k];
    }
  }
  return flat;
}

/** Stable 32-bit hash of the resolved config — the run identity in the logs. */
function hashConfig(flat) {
  const json = JSON.stringify(flat, Object.keys(flat).sort());
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) { h ^= json.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function listProfiles() {
  return Object.keys(PROFILES).map(name => ({
    name,
    label: PROFILES[name].label ?? name,
    description: PROFILES[name].description ?? '',
  }));
}

export function resolveProfile(name = 'baseline') {
  const p = PROFILES[name];
  if (p === undefined) {
    throw new Error(`unknown profile "${name}"; known: ${Object.keys(PROFILES).join(', ')}`);
  }
  const { label, description, ...delta } = p;
  const nested = deepMerge(BASE, delta);
  const flat = flatten(nested);
  return { name, label: label ?? name, description: description ?? '', config: flat,
           hash: hashConfig(flat) };
}