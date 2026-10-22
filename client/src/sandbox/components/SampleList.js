import { summarizeSampling, COMPONENTS } from '../model';
import { fmtCp, fmtInt } from '../format';

const WINDOW = 40;
const BOUND = 1000;

const Bound = ({ a, b }) => {
  const clip = (v) => Math.max(-BOUND, Math.min(BOUND, v));
  const l = (clip(a) + BOUND) / (2 * BOUND) * 100, r = (clip(b) + BOUND) / (2 * BOUND) * 100;
  return (
    <div className="relative h-2 bg-gray-900 rounded w-24 flex-shrink-0" title={`α ${a} · β ${b}`}>
      <div className="absolute top-0 bottom-0 w-px bg-gray-600" style={{ left: '50%' }} />
      <div className="absolute top-0 bottom-0 bg-sky-500 rounded" style={{ left: `${l}%`, width: `${Math.max(1, r - l)}%` }} />
    </div>
  );
};

function describe(s) {
  switch (s.label) {
    case 'node': return { tag: 'node', text: `d${s.d} ply${s.p} · move #${s.mc} · window ${fmtCp(s.a)} … ${fmtCp(s.b)}`, bound: [s.a, s.b] };
    case 'qnode': return { tag: 'qnode', text: `q${s.q} ply${s.ply} · ${s.n} tactical · first ${s.top}${s.frontier ? ' · frontier' : ''}`, bound: null };
    case 'leaf': return { tag: 'leaf', text: `eval ${fmtCp(s.s)} · phase ${Number.isFinite(s.ph) ? s.ph.toFixed(2) : '?'} · ` + COMPONENTS.filter(k => Number.isFinite(s[k])).map(k => `${k.slice(0, 4)} ${s[k]}`).join(' '), bound: null };
    case 'gen': return { tag: 'gen', text: `${s.color} · ${s.n} moves · ${s.capturesOnly ? 'captures only' : 'all'}${s.check ? ` · in check (${s.check})` : ''}`, bound: null };
    default: return { tag: s.label, text: `${s.c ?? ''} · ${fmtCp(s.s)}${s.mat !== undefined ? ` (mat ${s.mat}, pst ${s.pst})` : ''}${s.sw !== undefined ? ` · sw ${s.sw}%` : ''}${s.dq !== undefined ? ` · Δq ${s.dq}` : ''}`, bound: null };
  }
}
const TAG_COLOR = { node: 'bg-sky-900 text-sky-200', qnode: 'bg-indigo-900 text-indigo-200', leaf: 'bg-emerald-900 text-emerald-200', gen: 'bg-gray-700 text-gray-300' };

/**
 * Sampled records of one frame, newest first, with a ruler that places each
 * sample in the frame's seq window and states how many traces it stands for.
 */
const SampleList = ({ frame, nav, dispatch, rate }) => {
  const samples = frame.samples;
  const active = nav.level === 2 ? nav.sample : -1;
  if (samples.length === 0) {
    return (
      <div className="mt-3 text-xs text-gray-500 italic">
        No sampled traces fell in this window (seq {frame.lo}–{frame.hi}). With 1-in-{rate.value} sampling,
        windows shorter than ~{rate.value} trace calls are usually empty — step to a deeper iteration.
      </div>
    );
  }
  const sum = summarizeSampling(samples, rate.value);
  const span = Math.max(1, frame.hi - frame.lo);
  const lo = Math.max(0, Math.min(active < 0 ? 0 : active - WINDOW / 2, samples.length - WINDOW));
  const shown = samples.slice(lo, lo + WINDOW);
  const gapAfter = (i) => {   // traces dropped between sample i and the next OLDER one (i+1)
    const a = samples[i], b = samples[i + 1];
    if (!b || a.cat !== b.cat) return null;
    return Number.isFinite(a.ti) && Number.isFinite(b.ti) ? a.ti - b.ti - 1 : rate.value - 1;
  };
  return (
    <div className="mt-3">
      <div className="text-[11px] text-gray-400 mb-1">
        {samples.length} samples ≈ {fmtInt(sum.estimatedTotal)} traces · {Object.values(sum.cats).map(c => `${c.cat} ${c.count}${c.exact ? '' : '~'}`).join(' · ')}
        {sum.total > 0 && !Object.values(sum.cats).every(c => c.exact) && <span className="text-yellow-400"> · ~ = gaps assumed from the rate</span>}
      </div>
      <div className="relative h-3 bg-gray-900 rounded mb-2" title={`seq ${frame.lo}–${frame.hi}`}>
        {samples.map((s, i) => (
          <div key={i} onClick={() => dispatch({ type: 'set-sample', sample: i })}
            className={`absolute top-0 bottom-0 cursor-pointer ${i === active ? 'bg-white w-0.5' : 'bg-sky-400 w-px opacity-60'}`}
            style={{ left: `${((s.seq - frame.lo) / span) * 100}%` }} />
        ))}
      </div>
      <div className="space-y-0.5 max-h-72 overflow-y-auto move-history-scroll">
        {lo > 0 && <div className="text-[10px] text-gray-500 px-2">… {lo} newer</div>}
        {shown.map((s, k) => {
          const i = lo + k;
          const d = describe(s);
          const gap = gapAfter(i);
          return (
            <button key={i} onClick={() => dispatch({ type: 'set-sample', sample: i })}
              className={`w-full text-left px-2 py-1 rounded text-[11px] flex items-center gap-2 ${i === active ? 'bg-gray-600 text-white' : 'hover:bg-gray-700 text-gray-300'}`}>
              <span className={`px-1 rounded font-mono ${TAG_COLOR[d.tag] ?? 'bg-amber-900 text-amber-200'}`}>{d.tag}</span>
              <span className="flex-1 truncate" title={d.text}>{d.text}</span>
              {d.bound && <Bound a={d.bound[0]} b={d.bound[1]} />}
              <span className="text-gray-500 font-mono w-14 text-right" title={`seq ${s.seq}${Number.isFinite(s.ti) ? ` · ti ${s.ti}` : ''}`}>
                {gap === null ? `#${s.seq}` : `↓${gap}`}
              </span>
            </button>
          );
        })}
        {lo + WINDOW < samples.length && <div className="text-[10px] text-gray-500 px-2">… {samples.length - lo - WINDOW} older</div>}
      </div>
      <div className="text-[10px] text-gray-500 mt-1">↓n = traces of the same category dropped before the next older sample</div>
    </div>
  );
};
export default SampleList;