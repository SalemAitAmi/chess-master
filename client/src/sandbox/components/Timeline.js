import { useEffect, useRef } from 'react';
import { fmtCp, plyLabel } from '../format';

const BAR_W = 8, H = 64, MARK_H = 14;

/**
 * Game as a score strip: one bar per decision (white POV, clipped ±8 pawns),
 * coloured by engine instance. Markers beneath: capture ▲, root instability ●,
 * aborted search ▮, shuffle ≈. This is the Game level's "source view".
 */
const Timeline = ({ game, nav, dispatch, accents }) => {
  const ref = useRef(null);
  const turns = game ? game.turns : [];
  const W = Math.max(turns.length * BAR_W, 240);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const x = nav.turn * BAR_W;
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - el.clientWidth / 2;
  }, [nav.turn]);
  const half = H / 2 - 4;
  const scale = (cp) => Math.max(-half, Math.min(half, ((cp ?? 0) / 800) * half));
  return (
    <div className="bg-gray-800 rounded-lg p-2 shadow-lg">
      <div className="flex justify-between text-[11px] text-gray-400 px-1 mb-1">
        <span>Timeline · game-{game ? game.index : '–'} · {turns.length} decisions · score white POV · click to jump</span>
        <span>▲ capture  ● ≥3 root changes  ▮ aborted  ≈ shuffle</span>
      </div>
      <div ref={ref} className="overflow-x-auto move-history-scroll">
        <svg width={W} height={H + MARK_H + 4}>
          <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#4b5563" />
          {turns.map((t, i) => {
            const h = t.isMate ? (t.cpWhite > 0 ? half : -half) : scale(t.cpWhite);
            const y = h >= 0 ? H / 2 - h : H / 2;
            const color = accents[t.eng] ? accents[t.eng].hex : '#9ca3af';
            const cur = i === nav.turn;
            return (
              <g key={i} onClick={() => dispatch({ type: 'jump-turn', turn: i })} className="cursor-pointer">
                <rect x={i * BAR_W} y={0} width={BAR_W} height={H + MARK_H} fill={cur ? '#374151' : 'transparent'} />
                <rect x={i * BAR_W + 1} y={y} width={BAR_W - 2} height={Math.max(1, Math.abs(h))}
                  fill={color} opacity={cur ? 1 : 0.75} />
                {t.cap && <polygon points={`${i * BAR_W + 1},${H + 10} ${i * BAR_W + BAR_W - 1},${H + 10} ${i * BAR_W + BAR_W / 2},${H + 3}`} fill="#fbbf24" />}
                {t.rootChanges !== null && t.rootChanges >= 3 && <circle cx={i * BAR_W + BAR_W / 2} cy={H + 13} r={2} fill="#f87171" />}
                {t.aborted && <rect x={i * BAR_W + 2} y={H + 2} width={BAR_W - 4} height={4} fill="#ef4444" />}
                {t.shuffle && <text x={i * BAR_W + BAR_W / 2} y={H + MARK_H} textAnchor="middle" fontSize={9} fill="#a78bfa">≈</text>}
                {cur && <rect x={i * BAR_W} y={0} width={BAR_W} height={H} fill="none" stroke="#fff" strokeWidth={1} />}
                <title>{`${plyLabel(t.t)} ${t.best ?? '?'}  ${fmtCp(t.cp, t.mate)} (${t.eng} as ${t.color})\nd${t.depth ?? '?'} · ${t.nodes ?? '?'} nodes · ${t.ms ?? '?'}ms${t.cap ? ` · x${t.cap}` : ''}${t.aborted ? ` · aborted: ${t.aborted}` : ''}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
export default Timeline;