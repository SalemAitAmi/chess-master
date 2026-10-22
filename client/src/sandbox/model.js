/**
 * Replay model — turns the logger's records into a navigable structure.
 *
 * ATTRIBUTION. Every record carries (eng, t, seq). A turn is a search `turn`
 * event; every other record of the same (eng, t) is attributed to the nearest
 * turn by seq (an engine decides a given position at most a handful of times,
 * and never twice without an undo in between). The turn's WINDOW is the seq
 * span of everything attributed to it.
 *
 * FRAMES. Inside a turn the decision is navigated in REVERSE chronological
 * order, which is what a debugger's "step into" should reveal — the final
 * result first, then what overrode it, then the iterations from deepest to
 * shallowest, then the setup. Each frame owns a seq sub-window, so sampled
 * traces can be placed inside the iteration that produced them.
 *
 * SAMPLING. `event` records are complete; `trace` records (node, qnode, leaf,
 * heuristic terms, gen) are kept 1-in-N per category per game. The logger
 * writes the per-category trace counter `ti` on every sampled record, so the
 * number of traces dropped between two samples is exact: ti[k] - ti[k-1] - 1.
 * Older logs without `ti` fall back to the rate. The rate is fixed for the
 * whole log session (the engine refuses to change it once game 1 begins), so
 * ONE value applies to every game here; `sampleRate.source` says where it
 * came from and `warnings` lists any record that contradicts it.
 */
import { pieceLetterAt } from './fenUtils';

export const MATE_THRESHOLD = 49000;
export const DEFAULT_SAMPLE_RATE = 256;
export const COMPONENTS = ['material', 'centerControl', 'development', 'pawnStructure', 'kingSafety', 'initiative', 'mopUp'];
export const COMPONENT_LABEL = {
  material: 'Material + PST', centerControl: 'Center control', development: 'Development',
  pawnStructure: 'Pawn structure', kingSafety: 'King safety', initiative: 'Initiative', mopUp: 'Mop-up',
};
const ACCENTS = [
  { text: 'text-cyan-300', hex: '#67e8f9', bg: 'bg-cyan-900' },
  { text: 'text-pink-300', hex: '#f9a8d4', bg: 'bg-pink-900' },
  { text: 'text-lime-300', hex: '#bef264', bg: 'bg-lime-900' },
  { text: 'text-amber-300', hex: '#fcd34d', bg: 'bg-amber-900' },
  { text: 'text-violet-300', hex: '#c4b5fd', bg: 'bg-violet-900' },
];

export const winProb = (cp) => 1 / (1 + Math.pow(10, -cp / 400));
const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
const gcd = (a, b) => { while (b) { [a, b] = [b, a % b]; } return a; };

export function isSampledRecord(r) {
  if (r.cat === 'heuristics') return true;
  if (r.cat === 'search') return r.label === 'node' || r.label === 'qnode';
  if (r.cat === 'eval') return r.label === 'leaf';
  if (r.cat === 'moves') return r.label === 'gen';
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// Session
// ═══════════════════════════════════════════════════════════════════════════
export function buildSession(raw) {
  const warnings = [...raw.warnings];
  const engines = new Map();
  for (const r of raw.instances) {
    if (!r.eng) continue;
    engines.set(r.eng, {
      eng: r.eng, profile: r.profile ?? null, label: r.label ?? r.profile ?? null,
      configHash: r.configHash ?? null, description: r.description ?? '',
      overrides: r.overrides ?? {}, tt: r.tt ?? null, rev: r.rev ?? null,
    });
  }
  if (raw.replayIndex && raw.replayIndex.engines) {
    for (const [eng, e] of Object.entries(raw.replayIndex.engines)) {
      if (!engines.has(eng)) engines.set(eng, { eng, profile: e.profile ?? null, label: e.label ?? null, configHash: e.configHash ?? null, description: e.description ?? '', overrides: {}, tt: e.tt ?? null, rev: null });
    }
  }
  const all = [];
  for (const g of raw.games.values()) for (const r of g.records) all.push(r);
  const sampleRate = resolveSampleRate(raw, all, warnings);
  const games = [...raw.games.values()].sort((a, b) => a.index - b.index).map(g => buildGame(g, sampleRate.value));
  for (const g of games) for (const t of g.turns) {
    if (!engines.has(t.eng)) engines.set(t.eng, { eng: t.eng, profile: null, label: null, configHash: null, description: '', overrides: {}, tt: null, rev: null });
  }
  const accents = {};
  [...engines.keys()].sort().forEach((e, i) => { accents[e] = ACCENTS[i % ACCENTS.length]; });
  return {
    name: raw.name, meta: raw.meta, sampleRate,
    mask: raw.meta ? (raw.meta.mask ?? null) : null,
    engines, accents, games, warnings,
    turnCount: games.reduce((s, g) => s + g.turns.length, 0),
    recordCount: all.length,
  };
}

function resolveSampleRate(raw, all, warnings) {
  let out = null;
  if (raw.meta && num(raw.meta.sampleRate) !== null) {
    out = { value: raw.meta.sampleRate, source: 'session.json', locked: raw.meta.sampleRateLocked === true };
  }
  if (out === null) {
    const gb = all.find(r => r.cat === 'system' && r.label === 'game-begin' && num(r.sampleRate) !== null);
    if (gb) out = { value: gb.sampleRate, source: 'game-begin record', locked: true };
  }
  if (out === null && raw.replayIndex && num(raw.replayIndex.sampleRate) !== null) {
    out = { value: raw.replayIndex.sampleRate, source: 'replay index.json', locked: true };
  }
  let g = 0, tiCount = 0;
  for (const r of all) if (num(r.ti) !== null && isSampledRecord(r)) { g = gcd(g, r.ti); tiCount++; }
  if (out === null) {
    out = tiCount > 0
      ? { value: g, source: `inferred (gcd of ${tiCount} ti fields)`, locked: null }
      : { value: DEFAULT_SAMPLE_RATE, source: 'assumed (engine default; no ti fields, no session.json)', locked: null };
  }
  out.tiCount = tiCount;
  out.exact = tiCount > 0;
  if (tiCount > 0) {
    let bad = 0;
    for (const r of all) if (num(r.ti) !== null && isSampledRecord(r) && r.ti % out.value !== 0) bad++;
    if (bad > 0) warnings.push(`${bad} sampled record(s) have ti not divisible by ${out.value}: the sample rate changed mid-session (engine without the session lock?)`);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Game
// ═══════════════════════════════════════════════════════════════════════════
function replayRecords(p) {
  const out = [];
  for (const t of p.turns || []) {
    const { iterations, rootMoves, ...rest } = t;
    out.push({ ...rest, cat: 'search', label: 'turn', seq: num(t.seq) ?? 0 });
    for (const it of iterations || []) out.push({ ...it, cat: 'search', label: 'iteration', eng: t.eng, t: t.t, seq: null });
    for (const rm of rootMoves || []) out.push({ ...rm, cat: 'order', label: 'root-move', eng: t.eng, t: t.t, seq: null });
  }
  return out;
}

function buildGame(g, rate) {
  let records = g.records;
  if (g.replay) records = records.concat(replayRecords(g.replay));
  records.sort((a, b) => (num(a.seq) ?? 0) - (num(b.seq) ?? 0));
  const game = { index: g.index, turns: [], system: [], orphans: 0, records: records.length, engines: [], lite: g.records.length === 0 && g.replay !== null };
  const byKey = new Map();
  for (const r of records) {
    if (r.cat === 'search' && r.label === 'turn' && num(r.t) !== null && r.t >= 0) {
      const turn = newTurn(r, g.index);
      game.turns.push(turn);
      const k = `${r.eng}|${r.t}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(turn);
    }
  }
  game.turns.sort((a, b) => a.seq - b.seq || a.t - b.t);
  game.turns.forEach((t, i) => { t.index = i; });
  for (const r of records) {
    if (r.cat === 'search' && r.label === 'turn') continue;
    if (r.cat === 'system') { game.system.push(r); continue; }
    const list = byKey.get(`${r.eng}|${r.t}`);
    if (!list) { game.orphans++; continue; }
    let best = list[0], bd = Math.abs((num(r.seq) ?? 0) - best.seq);
    for (let i = 1; i < list.length; i++) {
      const d = Math.abs((num(r.seq) ?? 0) - list[i].seq);
      if (d < bd) { best = list[i]; bd = d; }
    }
    attach(best, r);
  }
  for (const t of game.turns) finalizeTurn(t, rate);
  deriveAcrossTurns(game.turns);
  game.engines = [...new Set(game.turns.map(t => t.eng))].sort();
  return game;
}

// ═══════════════════════════════════════════════════════════════════════════
// Turn
// ═══════════════════════════════════════════════════════════════════════════
function newTurn(rec, gameIndex) {
  const cp = num(rec.cp);
  return {
    rec, game: gameIndex, index: 0, eng: rec.eng, t: rec.t, seq: rec.seq,
    color: rec.color ?? 'white', fen: rec.fen ?? null,
    best: rec.best ?? null, cp, mate: num(rec.mate),
    isMate: cp !== null && Math.abs(cp) > MATE_THRESHOLD,
    cpWhite: cp === null ? null : (rec.color === 'black' ? -cp : cp),
    bestCp: num(rec.bestCp), secondCp: num(rec.secondCp), margin: num(rec.margin), qual: num(rec.qual),
    bestRank: num(rec.bestRank), rootN: num(rec.rootN), rootCaps: num(rec.rootCaps),
    depth: num(rec.depth), seldepth: num(rec.seldepth), nodes: num(rec.nodes), qnodes: num(rec.qnodes), ms: num(rec.ms),
    firstSeenMs: num(rec.firstSeenMs), firstSeenDepth: num(rec.firstSeenDepth), rootChanges: num(rec.rootChanges),
    aborted: rec.aborted ?? null,
    pvMoves: typeof rec.pv === 'string' && rec.pv.length ? rec.pv.split(' ') : [],
    staticCp: num(rec.staticCp), stage: rec.stage ?? null, phase: num(rec.phase), bal: num(rec.bal),
    cap: rec.cap ?? null, capSee: num(rec.capSee), promo: rec.promo === 1,
    window: { start: rec.seq, end: rec.seq },
    iterations: [], pvLines: new Map(), rootOrders: [], rootScores: [], rootMoves: [],
    policy: { repetitionAvoided: null, tieBreak: null, openingViolation: null },
    setup: { start: null, stage: null, book: null, ttInit: null },
    tt: null, timing: { end: null, events: [] }, timeIters: new Map(),
    samples: [], uci: [], smp: [],
    frames: [], candidates: [], sampling: null,
    cpNextOwn: null, evalDrop: null, wpLoss: null, shuffle: false,
  };
}

function parseRootScores(top) {
  if (typeof top !== 'string' || !top) return [];
  return top.split('|').map(s => {
    const [alg, sc, ex] = s.split(':');
    return { alg, score: parseInt(sc, 10), exact: ex === '1' };
  }).filter(x => x.alg && Number.isFinite(x.score));
}

function attach(turn, r) {
  const seq = num(r.seq);
  if (seq !== null) {
    if (seq < turn.window.start) turn.window.start = seq;
    if (seq > turn.window.end) turn.window.end = seq;
  }
  if (isSampledRecord(r)) { turn.samples.push(r); return; }
  switch (r.cat) {
    case 'search':
      if (r.label === 'iteration') {
        turn.iterations.push({
          d: r.d, best: r.best ?? null, cp: num(r.cp), changed: r.changed === 1, seldepth: num(r.seldepth),
          nodes: num(r.nodes), qnodes: num(r.qnodes), ms: num(r.ms), seq, pv: [], nodesDelta: 0,
          totalMs: null, rootOrders: 0,
        });
      } else if (r.label === 'repetition-avoided') turn.policy.repetitionAvoided = r;
      else if (r.label === 'tie-break') turn.policy.tieBreak = r;
      else if (r.label === 'opening-violation') turn.policy.openingViolation = r;
      return;
    case 'pv':
      if (r.label === 'line' && num(r.d) !== null) turn.pvLines.set(r.d, typeof r.pv === 'string' && r.pv ? r.pv.split(' ') : []);
      return;
    case 'order':
      if (r.label === 'root') turn.rootOrders.push(r);
      else if (r.label === 'root-scores') turn.rootScores = parseRootScores(r.top);
      else if (r.label === 'root-move') turn.rootMoves.push(r);
      return;
    case 'tt':
      if (r.label === 'stats') turn.tt = r; else if (r.label === 'init') turn.setup.ttInit = r;
      return;
    case 'time':
      if (r.label === 'search-start') turn.setup.start = r;
      else if (r.label === 'iteration') turn.timeIters.set(r.d, r);
      else if (r.label === 'search-end') turn.timing.end = r;
      else turn.timing.events.push(r);
      return;
    case 'stage': if (r.label === 'detect') turn.setup.stage = r; return;
    case 'book': if (r.label === 'hints') turn.setup.book = r; return;
    case 'uci': turn.uci.push(r); return;
    case 'smp': turn.smp.push(r); return;
    default: return;
  }
}

function finalizeTurn(turn, rate) {
  turn.iterations.sort((a, b) => a.d - b.d || ((a.seq ?? 0) - (b.seq ?? 0)));
  let prevNodes = 0;
  for (const it of turn.iterations) {
    it.pv = turn.pvLines.get(it.d) ?? (it.d === turn.depth && turn.pvMoves.length ? turn.pvMoves : (it.best ? [it.best] : []));
    it.nodesDelta = it.nodes !== null ? it.nodes - prevNodes : 0;
    if (it.nodes !== null) prevNodes = it.nodes;
    const ti = turn.timeIters.get(it.d);
    if (ti) it.totalMs = num(ti.totalMs);
  }
  turn.samples.sort((a, b) => a.seq - b.seq);
  turn.rootOrders.sort((a, b) => (num(a.seq) ?? 0) - (num(b.seq) ?? 0));
  turn.rootMoves.sort((a, b) => (num(a.rank) ?? 0) - (num(b.rank) ?? 0));
  turn.frames = buildFrames(turn);
  turn.candidates = buildCandidates(turn);
  turn.sampling = summarizeSampling(turn.samples, rate);
  turn.nps = turn.ms > 0 && turn.nodes !== null ? turn.nodes / turn.ms * 1000 : null;
  turn.latency = turn.ms > 0 && turn.firstSeenMs !== null ? Math.max(0, Math.min(1, turn.firstSeenMs / turn.ms)) : null;
  turn.fmcRate = turn.rec.cutoffs > 0 ? turn.rec.firstMoveCutoffs / turn.rec.cutoffs : null;
}

function frame(kind, title, lo, hi, turn) {
  return { kind, title, lo, hi, samples: [], rootOrders: [], focus: null, it: null, d: null, index: 0, turnIndex: turn.index };
}

function buildFrames(turn) {
  const start = turn.window.start, end = turn.window.end;
  const firstRoot = turn.rootOrders.length > 0 ? num(turn.rootOrders[0].seq) : null;
  const setupEnd = firstRoot !== null ? firstRoot : start;
  const setup = frame('setup', 'Setup', start, setupEnd, turn);
  const iterFrames = [];
  let prevEnd = setupEnd;
  for (const it of turn.iterations) {
    const hi = it.seq !== null ? Math.max(it.seq, prevEnd) : prevEnd;
    const f = frame('iteration', `Iteration d=${it.d}`, prevEnd + 1, hi, turn);
    f.it = it; f.d = it.d;
    iterFrames.push(f);
    prevEnd = hi;
  }
  const policy = frame('policy', 'Root policy', prevEnd + 1, turn.seq, turn);
  const result = frame('result', 'Result', turn.seq + 1, Math.max(end, turn.seq + 1), turn);
  const frames = [result, policy, ...iterFrames.slice().reverse(), setup];
  const chrono = [setup, ...iterFrames, policy, result];

  const searchBest = turn.rootScores.length > 0 ? turn.rootScores[0].alg : null;
  result.focus = { best: turn.best, pv: turn.pvMoves, alt: null };
  policy.focus = { best: turn.best, pv: turn.pvMoves, alt: searchBest !== null && searchBest !== turn.best ? searchBest : null };
  for (const f of iterFrames) f.focus = { best: f.it.best, pv: f.it.pv, alt: null };
  setup.focus = { best: turn.rootOrders.length > 0 ? (turn.rootOrders[0].top ?? null) : null, pv: [], alt: null };

  const locate = (seq) => {
    for (const f of chrono) if (seq >= f.lo && seq <= f.hi) return f;
    return seq < setup.lo ? setup : result;
  };
  for (const s of turn.samples) if (num(s.seq) !== null) locate(s.seq).samples.push(s);
  for (const ro of turn.rootOrders) {
    if (num(ro.seq) === null) continue;
    const f = locate(ro.seq);
    f.rootOrders.push(ro);
    if (f.it) f.it.rootOrders++;
  }
  for (const f of frames) f.samples.reverse();          // latest first: reverse chronology
  frames.forEach((f, i) => { f.index = i; });
  return frames;
}

function buildCandidates(turn) {
  const byAlg = new Map();
  const add = (alg, fields) => {
    if (!alg) return null;
    let c = byAlg.get(alg);
    if (!c) {
      c = { alg, from: alg.slice(0, 2), to: alg.slice(2, 4), promoChar: alg.length > 4 ? alg[4] : null,
            cp: null, exact: null, rank: null, nodes: null, order: null, why: null, piece: null, cap: null,
            see: null, staticCp: null, breakdown: null, played: false, bestAtDepths: [], source: null,
            delta: null, orderRank: null, nodeShare: null };
      byAlg.set(alg, c);
    }
    Object.assign(c, fields);
    return c;
  };
  for (const rm of turn.rootMoves) {
    const bd = {};
    let has = false;
    for (const k of COMPONENTS) if (num(rm[k]) !== null) { bd[k] = rm[k]; has = true; }
    add(rm.alg, {
      cp: num(rm.cp), exact: rm.exact === 1, rank: num(rm.rank), nodes: num(rm.nodes), order: num(rm.order),
      why: rm.why ?? null, piece: rm.piece ?? null, cap: rm.cap ?? null, see: num(rm.see),
      staticCp: num(rm.staticCp), breakdown: has ? bd : null, source: 'root-move',
    });
  }
  turn.rootScores.forEach((rs, i) => {
    const c = byAlg.get(rs.alg);
    if (c) {
      if (c.cp === null) c.cp = rs.score;
      if (c.exact === null) c.exact = rs.exact;
      if (c.rank === null) c.rank = i;
    } else add(rs.alg, { cp: rs.score, exact: rs.exact, rank: i, source: 'root-scores' });
  });
  for (const it of turn.iterations) {
    if (!it.best) continue;
    const c = byAlg.get(it.best) ?? add(it.best, { cp: it.cp, source: 'iteration' });
    c.bestAtDepths.push(it.d);
  }
  if (turn.best) {
    const c = byAlg.get(turn.best) ?? add(turn.best, { cp: turn.cp, source: 'turn' });
    c.played = true;
    if (c.cp === null) c.cp = turn.cp;
  }
  const list = [...byAlg.values()];
  let topCp = null;
  for (const c of list) if (c.cp !== null && (topCp === null || c.cp > topCp)) topCp = c.cp;
  let maxNodes = 0;
  for (const c of list) if (c.nodes !== null && c.nodes > maxNodes) maxNodes = c.nodes;
  for (const c of list) {
    c.delta = (c.cp !== null && topCp !== null) ? topCp - c.cp : null;
    if (c.piece === null && turn.fen) c.piece = pieceLetterAt(turn.fen, c.from);
    c.nodeShare = maxNodes > 0 && c.nodes !== null ? c.nodes / maxNodes : null;
  }
  list.sort((a, b) => {
    const ra = a.rank ?? 1e9, rb = b.rank ?? 1e9;
    if (ra !== rb) return ra - rb;
    return (b.cp ?? -1e9) - (a.cp ?? -1e9);
  });
  list.filter(c => c.order !== null).sort((a, b) => b.order - a.order).forEach((c, i) => { c.orderRank = i; });
  return list;
}

/** Per-category sample counts with the exact (ti) or assumed (rate) number of traces they stand for. */
export function summarizeSampling(samples, rate) {
  const cats = {};
  for (const s of samples) {
    let c = cats[s.cat];
    if (!c) c = cats[s.cat] = { cat: s.cat, count: 0, firstTi: null, lastTi: null, withTi: 0 };
    c.count++;
    if (num(s.ti) !== null) {
      c.withTi++;
      if (c.firstTi === null || s.ti < c.firstTi) c.firstTi = s.ti;
      if (c.lastTi === null || s.ti > c.lastTi) c.lastTi = s.ti;
    }
  }
  let estimatedTotal = 0;
  for (const c of Object.values(cats)) {
    c.exact = c.count > 0 && c.withTi === c.count;
    c.estimated = c.exact ? (c.lastTi - c.firstTi) + rate : c.count * rate;
    estimatedTotal += c.estimated;
  }
  return { rate, cats, total: samples.length, estimatedTotal };
}

/**
 * Self-reported quality, as in analyze_logs.py: the same engine's own score
 * at its NEXT decision (two plies later in self-play), same point of view.
 */
function deriveAcrossTurns(turns) {
  const byEng = new Map();
  for (const t of turns) {
    if (!byEng.has(t.eng)) byEng.set(t.eng, []);
    byEng.get(t.eng).push(t);
  }
  for (const list of byEng.values()) {
    list.sort((a, b) => a.t - b.t || a.seq - b.seq);
    for (let i = 0; i < list.length; i++) {
      const t = list[i], n = list[i + 1] ?? null, p = list[i - 1] ?? null;
      const cpEff = t.isMate ? null : t.cp;
      const nextEff = n && !n.isMate ? n.cp : null;
      t.cpNextOwn = nextEff;
      t.evalDrop = (cpEff !== null && nextEff !== null) ? cpEff - nextEff : null;
      t.wpLoss = (cpEff !== null && nextEff !== null) ? Math.max(0, winProb(cpEff) - winProb(nextEff)) : null;
      t.shuffle = !!(p && p.best && t.best && t.best.length >= 4 && p.best.length >= 4 &&
                     t.best.slice(0, 4) === p.best.slice(2, 4) + p.best.slice(0, 2));
    }
  }
}