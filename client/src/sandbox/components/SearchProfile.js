import Panel from './Panel';
import { fmtCp, fmtInt } from '../format';

/** Iterations as a scrubber: score line + node bars (log). Click → that iteration's frame. */
const SearchProfile = ({ turn, nav, view, dispatch }) => {
  const its = turn.iterations;
  if (its.length === 0) return null;
  const W = 320, H = 96, padL = 8, padR = 8, padT = 10, padB = 18;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const x = (i) => padL + (its.length === 1 ? innerW / 2 : i * innerW / (its.length - 1));
  const cps = its.map(it => (it.cp === null || Math.abs(it.cp) > 49000) ? null : it.cp);
  const vals = cps.filter(v => v !== null);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const span = Math.max(50, hi - lo);
  const y = (cp) => padT + ((hi - cp) / span) * innerH;
  const maxLog = Math.max(1, ...its.map(it => Math.log10(Math.max(1, it.nodesDelta))));
  const activeD = nav.level >= 1 && view.frame && view.frame.kind === 'iteration' ? view.frame.d : null;
  const frameOf = (d) => turn.frames.findIndex(f => f.kind === 'iteration' && f.d === d);
  const pts = its.map((it, i) => cps[i] === null ? null : `${x(i)},${y(cps[i])}`).filter(Boolean).join(' ');
  return (
    <Panel title="Search profile" sub="score per iteration (line) · nodes per iteration (bars, log) · ↺ root move changed">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 120 }}>
        {its.map((it, i) => {
          const bh = (Math.log10(Math.max(1, it.nodesDelta)) / maxLog) * innerH;
          const fi = frameOf(it.d);
          return (
            <g key={it.d} onClick={() => fi >= 0 && dispatch({ type: 'set-frame', frame: fi })} className="cursor-pointer">
              <rect x={x(i) - 6} y={padT + innerH - bh} width={12} height={bh} fill={activeD === it.d ? '#60a5fa' : '#4b5563'} opacity={0.7} />
              <text x={x(i)} y={H - 4} textAnchor="middle" fontSize={10} fill={activeD === it.d ? '#fff' : '#9ca3af'}>d{it.d}</text>
              <title>{`d=${it.d} ${it.best ?? '?'} ${fmtCp(it.cp)}${it.changed ? ' (changed)' : ''}\n+${fmtInt(it.nodesDelta)} nodes · ${fmtInt(it.ms)}ms · seldepth ${it.seldepth ?? '?'}`}</title>
            </g>
          );
        })}
        {vals.length > 0 && <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="#6b7280" strokeDasharray="3 3" />}
        {pts && <polyline points={pts} fill="none" stroke="#facc15" strokeWidth={2} />}
        {its.map((it, i) => cps[i] === null ? null : (
          <circle key={it.d} cx={x(i)} cy={y(cps[i])} r={it.changed ? 4 : 2.5}
            fill={it.changed ? '#f97316' : '#facc15'} stroke={activeD === it.d ? '#fff' : 'none'} strokeWidth={1.5} />
        ))}
      </svg>
    </Panel>
  );
};
export default SearchProfile;