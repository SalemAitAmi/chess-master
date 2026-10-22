/**
 * Session loader: browser-side parser for the engine's log session.
 *
 * Accepts a FileList (directory picker) or drop items. Recognised paths:
 *   <session>/session.json              sample rate (+lock) and mask, written by the logger
 *   <session>/instances.ndjson          engine instance → profile + config
 *   <session>/game-N/<category>.ndjson  per-game records, every engine instance
 *   …/replay/game-N.json                analyze_logs.py --export-replay (LITE: turns +
 *                                       iterations + root moves, no sampled traces)
 *   …/replay/index.json                 replay index (engines, sampleRate)
 * boot/, session.log and analysis tables are ignored.
 *
 * Nothing here interprets chess or search. It turns text into records tagged
 * with { cat, label } and hands them to model.js.
 */
const CATS = new Set(['search', 'eval', 'order', 'tt', 'uci', 'book', 'heuristics', 'moves',
                      'pv', 'time', 'stage', 'system', 'smp']);

/** Normalise File / {file, path} inputs to { file, path }. */
function normalise(inputs) {
  return Array.from(inputs).map(x => {
    if (typeof File !== 'undefined' && x instanceof File) {
      return { file: x, path: x.webkitRelativePath && x.webkitRelativePath.length > 0 ? x.webkitRelativePath : x.name };
    }
    return x;
  });
}

export function classify(path) {
  const parts = path.split('/');
  const name = parts[parts.length - 1];
  if (parts.includes('boot')) return null;
  if (name === 'session.json') return { kind: 'meta' };
  if (name === 'instances.ndjson') return { kind: 'instances' };
  const gm = path.match(/(?:^|\/)game-(\d+)\//);
  if (gm && name.endsWith('.ndjson')) {
    const cat = name.slice(0, -'.ndjson'.length);
    return CATS.has(cat) ? { kind: 'ndjson', game: parseInt(gm[1], 10), cat } : null;
  }
  const rm = name.match(/^game-(\d+)\.json$/);
  if (rm) return { kind: 'replay', game: parseInt(rm[1], 10) };
  if (name === 'index.json') return { kind: 'replay-index' };
  if (name.endsWith('.ndjson')) {
    // Loose file without a game directory: treat as game 1.
    const cat = name.slice(0, -'.ndjson'.length);
    return CATS.has(cat) ? { kind: 'ndjson', game: 1, cat } : null;
  }
  return null;
}

export function parseNdjson(text) {
  const rows = [];
  let bad = 0;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { rows.push(JSON.parse(s)); } catch { bad++; }
  }
  return { rows, bad };
}

function gameSlot(raw, idx) {
  let g = raw.games.get(idx);
  if (!g) { g = { index: idx, records: [], replay: null }; raw.games.set(idx, g); }
  return g;
}

/**
 * @returns raw session: { name, meta, instances, replayIndex, games: Map<idx, {records, replay}>, warnings, fileCount }
 */
export async function loadSessionFiles(inputs) {
  const items = normalise(inputs);
  const raw = { name: null, meta: null, instances: [], replayIndex: null, games: new Map(), warnings: [], fileCount: 0 };
  for (const { file, path } of items) {
    const c = classify(path);
    if (c === null) continue;
    raw.fileCount++;
    if (raw.name === null) {
      const parts = path.split('/');
      raw.name = parts.length > 1 ? parts[0] : file.name;
    }
    const text = await file.text();
    switch (c.kind) {
      case 'meta':
        try { raw.meta = JSON.parse(text); } catch { raw.warnings.push('session.json is malformed'); }
        break;
      case 'instances': {
        const { rows, bad } = parseNdjson(text);
        raw.instances.push(...rows);
        if (bad) raw.warnings.push(`instances.ndjson: ${bad} malformed line(s)`);
        break;
      }
      case 'ndjson': {
        const { rows, bad } = parseNdjson(text);
        const g = gameSlot(raw, c.game);
        for (const r of rows) { r.cat = c.cat; r.label = r.msg ?? r.cmd ?? '?'; g.records.push(r); }
        if (bad) raw.warnings.push(`game-${c.game}/${c.cat}.ndjson: ${bad} malformed line(s)`);
        break;
      }
      case 'replay':
        try { gameSlot(raw, c.game).replay = JSON.parse(text); }
        catch { raw.warnings.push(`replay game-${c.game}.json is malformed`); }
        break;
      case 'replay-index':
        try { raw.replayIndex = JSON.parse(text); } catch { /* optional */ }
        break;
      default: break;
    }
  }
  if (raw.games.size === 0) throw new Error('No game-N/*.ndjson or replay game-N.json files found in the selection');
  return raw;
}

/** Directory drops: walk the FileSystem entries (readEntries returns batches). */
export async function filesFromDataTransfer(dt) {
  const out = [];
  const walk = (entry) => new Promise((resolve) => {
    if (entry.isFile) {
      entry.file(f => { out.push({ file: f, path: entry.fullPath.replace(/^\//, '') }); resolve(); }, () => resolve());
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readBatch = () => reader.readEntries(async (entries) => {
        if (entries.length === 0) { resolve(); return; }
        for (const e of entries) await walk(e);
        readBatch();
      }, () => resolve());
      readBatch();
    } else resolve();
  });
  const items = dt.items ? Array.from(dt.items) : [];
  const entries = items.map(it => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
  if (entries.length === 0) return Array.from(dt.files).map(f => ({ file: f, path: f.name }));
  for (const e of entries) await walk(e);
  return out;
}