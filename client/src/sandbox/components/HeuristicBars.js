/** Diverging horizontal bars; `ref` draws a grey comparison bar behind `value`. */
const HeuristicBars = ({ rows, max = null, height = 10 }) => {
  let m = max;
  if (m === null) {
    m = 1;
    for (const r of rows) m = Math.max(m, Math.abs(r.value ?? 0), Math.abs(r.ref ?? 0));
  }
  const style = (v) => {
    const x = Math.max(-1, Math.min(1, (v ?? 0) / m));
    return x >= 0 ? { left: '50%', width: `${x * 50}%` } : { left: `${50 + x * 50}%`, width: `${-x * 50}%` };
  };
  const hasRef = rows.some(r => r.ref !== undefined);
  return (
    <div className="space-y-1">
      {rows.map(r => (
        <div key={r.key} className="flex items-center gap-2 text-xs">
          <div className="w-24 text-gray-400 truncate" title={r.label}>{r.label}</div>
          <div className="flex-1 relative bg-gray-900 rounded" style={{ height }}>
            <div className="absolute top-0 bottom-0 w-px bg-gray-600" style={{ left: '50%' }} />
            {r.ref !== undefined && r.ref !== null && (
              <div className="absolute top-0 bottom-0 bg-gray-500 opacity-60 rounded" style={style(r.ref)} />
            )}
            <div className="absolute rounded" style={{ ...style(r.value), top: 2, bottom: 2, background: (r.value ?? 0) >= 0 ? '#22c55e' : '#ef4444' }} />
          </div>
          <div className="w-11 text-right font-mono text-gray-200">{r.value === null || r.value === undefined ? '–' : r.value}</div>
          {hasRef && <div className="w-11 text-right font-mono text-gray-500">{r.ref === null || r.ref === undefined ? '–' : r.ref}</div>}
        </div>
      ))}
    </div>
  );
};
export default HeuristicBars;