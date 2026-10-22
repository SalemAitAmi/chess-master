/**
 * Board projection of the cursor: which FEN to draw, which move to highlight,
 * and how candidate moves are encoded ON the squares (the "lens").
 *
 * The lens is the Sandbox's answer to "don't reiterate the folder hierarchy":
 * instead of expanding a tree to compare candidates, one glyph per
 * destination square carries the value, and clicking the square opens the
 * detail for exactly that move.
 */
import { applyLine, applyUciToFen, sideToMove } from './fenUtils';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const LENS_LIMIT = 12;

/** Score loss against the best root move → colour. */
export function scoreColor(delta) {
  if (delta === null || delta === undefined) return '#6b7280';
  if (delta <= 0) return '#22c55e';
  if (delta <= 40) return '#84cc16';
  if (delta <= 120) return '#eab308';
  if (delta <= 350) return '#f97316';
  return '#ef4444';
}
/** Signed term value → diverging colour (red = good for the mover, blue = bad). */
export function divergingColor(v, max) {
  const x = max > 0 ? Math.max(-1, Math.min(1, v / max)) : 0;
  return x >= 0 ? `rgba(239,68,68,${0.35 + 0.65 * x})` : `rgba(59,130,246,${0.35 - 0.65 * x})`;
}
export const cpShort = (cp) => Math.abs(cp) > 49000 ? (cp > 0 ? 'M' : '-M') : (cp >= 0 ? '+' : '') + (cp / 100).toFixed(1);
const shortInt = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);

function buildMarks(candidates, nav, picked) {
  const marks = {};
  const pool = nav.selected ? candidates.filter(c => c.from === nav.selected) : candidates;
  const showDots = nav.lens !== 'result' || nav.selected !== null;
  if (showDots) {
    const shown = nav.selected ? pool : pool.slice(0, LENS_LIMIT);
    let maxAbs = 1;
    if (nav.lens === 'heuristic') {
      for (const c of shown) if (c.breakdown && Number.isFinite(c.breakdown[nav.heuristic])) maxAbs = Math.max(maxAbs, Math.abs(c.breakdown[nav.heuristic]));
    }
    for (const c of shown) {
      if (marks[c.to]) continue;   // first (best-ranked) candidate wins a contested square
      let color = '#9ca3af', size = 0.36, label = null;
      if (nav.lens === 'effort') {
        size = c.nodeShare === null ? 0.2 : 0.2 + 0.6 * Math.sqrt(c.nodeShare);
        color = c.played ? '#22c55e' : '#a78bfa';
        label = c.nodes !== null ? shortInt(c.nodes) : null;
      } else if (nav.lens === 'ordering') {
        color = c.orderRank === null ? '#6b7280' : c.orderRank === 0 ? '#22c55e' : c.orderRank < 4 ? '#eab308' : '#f97316';
        label = c.orderRank === null ? '?' : String(c.orderRank + 1);
      } else if (nav.lens === 'heuristic') {
        const v = c.breakdown ? c.breakdown[nav.heuristic] : undefined;
        color = v === undefined || v === null ? '#6b7280' : divergingColor(v, maxAbs);
        label = v === undefined || v === null ? null : String(v);
      } else {
        color = scoreColor(c.delta);
        label = c.cp === null ? null : cpShort(c.cp);
      }
      marks[c.to] = { dot: { color, size }, label, labelColor: '#f9fafb', ring: c.played ? '#22c55e' : null };
    }
  }
  if (picked) marks[picked.to] = { ...(marks[picked.to] || {}), ring: '#ffffff' };
  if (nav.selected) marks[nav.selected] = { ...(marks[nav.selected] || {}), bg: 'bg-blue-400 shadow-inner' };
  return marks;
}

function buildArrows(frame, line, nav, picked) {
  const arrows = [];
  if (nav.pvPly > 0 || nav.after) return arrows;
  if (nav.lens === 'result' && nav.selected === null) {
    const n = Math.min(4, line.length);
    for (let i = 0; i < n; i++) {
      arrows.push({ from: line[i].slice(0, 2), to: line[i].slice(2, 4),
                    color: i === 0 ? '#22c55e' : (i % 2 === 1 ? '#f59e0b' : '#60a5fa'),
                    width: Math.max(3, 6 - i), opacity: 0.95 - i * 0.18, label: String(i + 1) });
    }
  }
  if (frame.kind === 'policy' && frame.focus.alt && frame.focus.best) {
    arrows.push({ from: frame.focus.alt.slice(0, 2), to: frame.focus.alt.slice(2, 4), color: '#f97316', width: 5, opacity: 0.9, label: 'S' });
    arrows.push({ from: frame.focus.best.slice(0, 2), to: frame.focus.best.slice(2, 4), color: '#22c55e', width: 5, opacity: 0.9, label: 'P' });
  }
  if (picked && !(nav.lens === 'result' && nav.selected === null && line[0] === picked.alg)) {
    arrows.push({ from: picked.from, to: picked.to, color: '#ffffff', width: 4, opacity: 0.9 });
  }
  return arrows;
}

export function deriveView(session, nav) {
  const game = session.games[nav.game] ?? null;
  const turn = game ? (game.turns[nav.turn] ?? null) : null;
  if (!turn) {
    return { game, turn: null, frame: null, sample: null, fen: START_FEN, lastMove: null, marks: {}, arrows: [],
             line: [], candidates: [], selectedCandidates: [], picked: null, played: null, sideToMove: 'white', afterApplied: false };
  }
  const frame = turn.frames[nav.level >= 1 ? nav.frame : 0] ?? turn.frames[0];
  const sample = nav.level === 2 ? (frame.samples[nav.sample] ?? null) : null;
  const focus = frame.focus ?? { best: turn.best, pv: turn.pvMoves, alt: null };
  const line = focus.pv ?? [];
  const baseFen = turn.fen ?? START_FEN;
  let fen = baseFen, lastMove = focus.best, afterApplied = false;
  if (nav.pvPly > 0 && line.length > 0) {
    const n = Math.min(nav.pvPly, line.length);
    fen = applyLine(baseFen, line, n);
    lastMove = line[n - 1];
  } else if (nav.after && focus.best) {
    fen = applyUciToFen(baseFen, focus.best);
    afterApplied = true;
  }
  const candidates = turn.candidates;
  const selectedCandidates = nav.selected ? candidates.filter(c => c.from === nav.selected) : [];
  const picked = nav.pick ? (candidates.find(c => c.alg === nav.pick) ?? null) : null;
  const played = candidates.find(c => c.played) ?? null;
  const marks = nav.pvPly > 0 || nav.after ? {} : buildMarks(candidates, nav, picked);
  const arrows = buildArrows(frame, line, nav, picked);
  return { game, turn, frame, sample, fen, lastMove, marks, arrows, line, candidates, selectedCandidates,
           picked, played, sideToMove: sideToMove(fen), afterApplied };
}