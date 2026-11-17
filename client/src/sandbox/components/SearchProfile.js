import { Panel } from '../../components/primitives';
import { MATE_THRESHOLD } from '../../constants/gameConstants';
import { fmtCp, fmtInt } from '../format';

// SVG geometry (viewBox units; the SVG scales to the panel width).
const W = 320, H = 96, PAD_L = 8, PAD_R = 8, PAD_T = 10, PAD_B = 18;
const INNER_W = W - PAD_L - PAD_R, INNER_H = H - PAD_T - PAD_B;

/** Iterations as a scrubber: score line + node bars (log). Click → that iteration's frame. */
const SearchProfile = ({ turn, nav, view, dispatch }) => {
  const its = turn.iterations;
  if (its.length === 0) return null;

  // ── Derived ──
  const x = (i) => PAD_L + (its.length === 1 ? INNER_W / 2 : i * INNER_W / (its.length - 1));
  // Mate scores would flatten every other point; they are drawn as gaps.
  const cps = its.map(it => (it.cp === null || Math.abs(it.cp) > MATE_THRESHOLD) ? null : it.cp);
  const vals = cps.filter(v => v !== null);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const span = Math.max(50, hi - lo);
  const y = (cp) => PAD_T + ((hi - cp) / span) * INNER_H;
  const maxLog = Math.max(1, ...its.map(it => Math.log10(Math.max(1, it.nodesDelta))));
  const activeD = nav.level >= 1 && view.frame && view.frame.kind === 'iteration' ? view.frame.d : null;
  const frameOf = (d) => turn.frames.findIndex(f => f.kind === 'iteration' && f.d === d);
  const points = its.map((it, i) => (cps[i] === null ? null : `${x(i)},${y(cps[i])}`)).filter(Boolean).join(' ');

  // ── Render ──
  return (
    <Panel title="Search profile" sub="score per iteration (line) · nodes per iteration (bars, log) · ↺ root move changed">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 140 }}>
        {/* Node bars + depth labels (clickable) */}
        {its.map((it, i) => {
          const bh = (Math.log10(Math.max(1, it.nodesDelta)) / maxLog) * INNER_H;
          const fi = frameOf(it.d);
          return (
            <g key={it.d} onClick={() => fi >= 0 && dispatch({ type: 'set-frame', frame: fi })} className="cursor-pointer">
              <rect x={x(i) - 6} y={PAD_T + INNER_H - bh} width={12} height={bh} rx={2}
                fill={activeD === it.d ? '#60a5fa' : '#4b5563'} opacity={0.7} />
              <text x={x(i)} y={H - 4} textAnchor="middle" fontSize={10} fill={activeD === it.d ? '#fff' : '#9ca3af'}>d{it.d}</text>
              <title>{`d=${it.d} ${it.best ?? '?'} ${fmtCp(it.cp)}${it.changed ? ' (changed)' : ''}\n+${fmtInt(it.nodesDelta)} nodes · ${fmtInt(it.ms)}ms · seldepth ${it.seldepth ?? '?'}`}</title>
            </g>
          );
        })}
        {/* Zero line + score line */}
        {vals.length > 0 && <line x1={PAD_L} x2={W - PAD_R} y1={y(0)} y2={y(0)} stroke="#6b7280" strokeDasharray="3 3" />}
        {points && <polyline points={points} fill="none" stroke="#facc15" strokeWidth={2} strokeLinejoin="round" />}
        {its.map((it, i) => cps[i] === null ? null : (
          <circle key={it.d} cx={x(i)} cy={y(cps[i])} r={it.changed ? 4 : 2.5}
            fill={it.changed ? '#f97316' : '#facc15'} stroke={activeD === it.d ? '#fff' : 'none'} strokeWidth={1.5} />
        ))}
      </svg>
    </Panel>
  );
};

export default SearchProfile;