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
import { MATE_THRESHOLD, STARTING_FEN } from '../constants/gameConstants';

/** Candidates shown at once when no piece is selected (a full root list is noise). */
const LENS_LIMIT = 12;

// ═══════════════════════════════════════════════════════════════════════════
// Encodings
// ═══════════════════════════════════════════════════════════════════════════

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

export const cpShort = (cp) => (Math.abs(cp) > MATE_THRESHOLD ? (cp > 0 ? 'M' : '-M') : (cp >= 0 ? '+' : '') + (cp / 100).toFixed(1));

const shortInt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

/** Dot colour/size/label for one candidate under the current lens. */
function lensGlyph(c, nav, maxAbs) {
  switch (nav.lens) {
    case 'effort':
      return {
        size: c.nodeShare === null ? 0.2 : 0.2 + 0.6 * Math.sqrt(c.nodeShare),
        color: c.played ? '#22c55e' : '#a78bfa',
        label: c.nodes !== null ? shortInt(c.nodes) : null,
      };
    case 'ordering':
      return {
        size: 0.36,
        color: c.orderRank === null ? '#6b7280' : c.orderRank === 0 ? '#22c55e' : c.orderRank < 4 ? '#eab308' : '#f97316',
        label: c.orderRank === null ? '?' : String(c.orderRank + 1),
      };
    case 'heuristic': {
      const v = c.breakdown ? c.breakdown[nav.heuristic] : undefined;
      const known = v !== undefined && v !== null;
      return { size: 0.36, color: known ? divergingColor(v, maxAbs) : '#6b7280', label: known ? String(v) : null };
    }
    default:
      return { size: 0.36, color: scoreColor(c.delta), label: c.cp === null ? null : cpShort(c.cp) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Marks + arrows
// ═══════════════════════════════════════════════════════════════════════════

function buildMarks(candidates, nav, picked) {
  const marks = {};
  const showDots = nav.lens !== 'result' || nav.selected !== null;
  if (showDots) {
    const pool = nav.selected ? candidates.filter(c => c.from === nav.selected) : candidates.slice(0, LENS_LIMIT);
    let maxAbs = 1;
    if (nav.lens === 'heuristic') {
      for (const c of pool) {
        const v = c.breakdown ? c.breakdown[nav.heuristic] : undefined;
        if (Number.isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v));
      }
    }
    for (const c of pool) {
      if (marks[c.to]) continue;   // first (best-ranked) candidate wins a contested square
      const g = lensGlyph(c, nav, maxAbs);
      marks[c.to] = { dot: { color: g.color, size: g.size }, label: g.label, labelColor: '#f9fafb', ring: c.played ? '#22c55e' : null };
    }
  }
  if (picked) marks[picked.to] = { ...(marks[picked.to] || {}), ring: '#ffffff' };
  if (nav.selected) marks[nav.selected] = { ...(marks[nav.selected] || {}), bg: 'bg-blue-400 shadow-inner' };
  return marks;
}

function buildArrows(frame, line, nav, picked) {
  const arrows = [];
  if (nav.pvPly > 0 || nav.after) return arrows;
  const showLine = nav.lens === 'result' && nav.selected === null;

  // The first plies of the line, numbered; mover colours alternate.
  if (showLine) {
    for (let i = 0; i < Math.min(4, line.length); i++) {
      arrows.push({
        from: line[i].slice(0, 2), to: line[i].slice(2, 4),
        color: i === 0 ? '#22c55e' : (i % 2 === 1 ? '#f59e0b' : '#60a5fa'),
        width: Math.max(3, 6 - i), opacity: 0.95 - i * 0.18, label: String(i + 1),
      });
    }
  }
  // Root policy: Search's best (S) vs Played (P) when an override fired.
  if (frame.kind === 'policy' && frame.focus.alt && frame.focus.best) {
    arrows.push({ from: frame.focus.alt.slice(0, 2), to: frame.focus.alt.slice(2, 4), color: '#f97316', width: 5, opacity: 0.9, label: 'S' });
    arrows.push({ from: frame.focus.best.slice(0, 2), to: frame.focus.best.slice(2, 4), color: '#22c55e', width: 5, opacity: 0.9, label: 'P' });
  }
  // The picked candidate, unless it is already drawn as the line's first ply.
  if (picked && !(showLine && line[0] === picked.alg)) {
    arrows.push({ from: picked.from, to: picked.to, color: '#ffffff', width: 4, opacity: 0.9 });
  }
  return arrows;
}

// ═══════════════════════════════════════════════════════════════════════════
// View
// ═══════════════════════════════════════════════════════════════════════════

export function deriveView(session, nav) {
  const game = session.games[nav.game] ?? null;
  const turn = game ? (game.turns[nav.turn] ?? null) : null;
  if (!turn) {
    return {
      game, turn: null, frame: null, sample: null, fen: STARTING_FEN, lastMove: null, marks: {}, arrows: [],
      line: [], candidates: [], selectedCandidates: [], picked: null, played: null, sideToMove: 'white', afterApplied: false,
    };
  }

  const frame = turn.frames[nav.level >= 1 ? nav.frame : 0] ?? turn.frames[0];
  const sample = nav.level === 2 ? (frame.samples[nav.sample] ?? null) : null;
  const focus = frame.focus ?? { best: turn.best, pv: turn.pvMoves, alt: null };
  const line = focus.pv ?? [];

  // Position: root, a ply along the line, or the root after the focused move.
  const baseFen = turn.fen ?? STARTING_FEN;
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
  const picked = nav.pick ? (candidates.find(c => c.alg === nav.pick) ?? null) : null;
  return {
    game, turn, frame, sample, fen, lastMove, line, candidates, picked, afterApplied,
    selectedCandidates: nav.selected ? candidates.filter(c => c.from === nav.selected) : [],
    played: candidates.find(c => c.played) ?? null,
    marks: nav.pvPly > 0 || nav.after ? {} : buildMarks(candidates, nav, picked),
    arrows: buildArrows(frame, line, nav, picked),
    sideToMove: sideToMove(fen),
  };
}