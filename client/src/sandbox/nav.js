/**
 * Debugger cursor. Three levels, one position each:
 *
 *   0 GAME      turn index            step = next/previous decision of the game
 *   1 DECISION  frame index           step = next frame in REVERSE chronology:
 *                                     Result → Root policy → d=N … d=1 → Setup,
 *                                     then on into the next turn's Result
 *   2 TRACE     sample index          step = next older sampled record in the
 *                                     frame's seq window; runs into adjacent
 *                                     frames/turns that have samples
 *
 *   step into   descend, positioned at the latest element (the final result)
 *   step out    ascend, keeping the enclosing position
 *
 * Selection (a square / a candidate move) is per turn and is cleared when the
 * turn changes; the lens and the heuristic choice are global.
 */
export const LEVELS = ['Game', 'Decision', 'Trace'];
export const LENSES = [
  { id: 'result',     label: 'Result',     help: 'Played move and principal variation' },
  { id: 'candidates', label: 'Candidates', help: 'Root moves as destination dots, coloured by score loss vs the best' },
  { id: 'effort',     label: 'Effort',     help: 'Root moves sized by the nodes spent under them' },
  { id: 'ordering',   label: 'Ordering',   help: 'Rank each root move had in the initial root ordering' },
  { id: 'heuristic',  label: 'Heuristic',  help: 'Root moves coloured by ONE evaluation term after the move' },
];

export function initialNav() {
  return { game: 0, turn: 0, level: 0, frame: 0, sample: 0, pvPly: 0, after: false, flip: false,
           selected: null, pick: null, lens: 'result', heuristic: 'kingSafety' };
}

const clamp = (v, n) => (n <= 0 ? 0 : Math.max(0, Math.min(n - 1, v)));
const TURN_RESET = { frame: 0, sample: 0, pvPly: 0, selected: null, pick: null };

function advance(s, dir, turns) {
  if (turns.length === 0) return s;
  if (s.level === 0) {
    const nt = s.turn + dir;
    return nt < 0 || nt >= turns.length ? s : { ...s, ...TURN_RESET, turn: nt };
  }
  const frames = turns[s.turn].frames;
  if (s.level === 1) {
    const nf = s.frame + dir;
    if (nf >= 0 && nf < frames.length) return { ...s, frame: nf, sample: 0, pvPly: 0 };
    const nt = s.turn + dir;
    if (nt < 0 || nt >= turns.length) return s;
    const nfr = turns[nt].frames;
    return { ...s, ...TURN_RESET, turn: nt, frame: dir > 0 ? 0 : Math.max(0, nfr.length - 1) };
  }
  const fr0 = frames[s.frame];
  const ns = s.sample + dir;
  if (fr0 && ns >= 0 && ns < fr0.samples.length) return { ...s, sample: ns };
  let t = s.turn, f = s.frame;
  for (let guard = 0; guard < 100000; guard++) {
    f += dir;
    if (f < 0 || f >= turns[t].frames.length) {
      t += dir;
      if (t < 0 || t >= turns.length) return s;
      f = dir > 0 ? 0 : turns[t].frames.length - 1;
    }
    const fr = turns[t].frames[f];
    if (fr && fr.samples.length > 0) {
      return { ...s, ...(t !== s.turn ? TURN_RESET : {}), turn: t, frame: f, sample: dir > 0 ? 0 : fr.samples.length - 1 };
    }
  }
  return s;
}

export function navReduce(s, a, session) {
  const turns = session && session.games[s.game] ? session.games[s.game].turns : [];
  const turn = turns[s.turn] ?? null;
  const frames = turn ? turn.frames : [];
  const frame = frames[s.frame] ?? null;
  switch (a.type) {
    case 'reset': return initialNav();
    case 'set-game': return { ...initialNav(), game: a.game, lens: s.lens, heuristic: s.heuristic, flip: s.flip };
    case 'jump-turn': return { ...s, ...TURN_RESET, turn: clamp(a.turn, turns.length), level: Math.min(s.level, 1) };
    case 'first':
      if (s.level === 0) return { ...s, ...TURN_RESET, turn: 0 };
      if (s.level === 1) return { ...s, frame: 0, sample: 0, pvPly: 0 };
      return { ...s, sample: 0 };
    case 'last':
      if (s.level === 0) return { ...s, ...TURN_RESET, turn: clamp(turns.length - 1, turns.length) };
      if (s.level === 1) return { ...s, frame: clamp(frames.length - 1, frames.length), sample: 0, pvPly: 0 };
      return { ...s, sample: clamp((frame ? frame.samples.length : 1) - 1, frame ? frame.samples.length : 0) };
    case 'step-over': return advance(s, 1, turns);
    case 'step-back': return advance(s, -1, turns);
    case 'step-into':
      if (s.level === 0) return { ...s, level: 1, frame: 0, sample: 0, pvPly: 0 };
      if (s.level === 1) return frame && frame.samples.length > 0 ? { ...s, level: 2, sample: 0 } : s;
      return s;
    case 'step-out': return s.level === 0 ? s : { ...s, level: s.level - 1, sample: 0 };
    case 'set-frame': return { ...s, level: 1, frame: clamp(a.frame, frames.length), sample: 0, pvPly: 0 };
    case 'set-sample': return { ...s, level: 2, sample: clamp(a.sample, frame ? frame.samples.length : 0) };
    case 'select-square':
      return { ...s, selected: a.square === s.selected ? null : a.square, pick: null, pvPly: 0,
               lens: s.lens === 'result' ? 'candidates' : s.lens };
    case 'pick-move':
      return { ...s, pick: a.alg === s.pick ? null : a.alg, selected: a.alg.slice(0, 2), pvPly: 0,
               lens: s.lens === 'result' ? 'candidates' : s.lens };
    case 'clear-selection': return { ...s, selected: null, pick: null };
    case 'set-lens': return { ...s, lens: a.lens };
    case 'set-heuristic': return { ...s, heuristic: a.heuristic, lens: 'heuristic' };
    case 'set-pv': return { ...s, pvPly: Math.max(0, a.ply), after: false };
    case 'pv-step': {
      const len = frame && frame.focus ? frame.focus.pv.length : 0;
      return { ...s, pvPly: Math.max(0, Math.min(len, s.pvPly + a.dir)), after: false };
    }
    case 'toggle-after': return { ...s, after: !s.after, pvPly: 0 };
    case 'toggle-flip': return { ...s, flip: !s.flip };
    default: return s;
  }
}