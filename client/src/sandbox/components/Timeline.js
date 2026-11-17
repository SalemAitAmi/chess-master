import { useEffect } from 'react';
import { useElementSize } from '../../hooks/useElementSize';
import { fmtCp, plyLabel } from '../format';

// Bars stretch to fill the strip; long games fall back to MIN_BAR and scroll.
const MIN_BAR = 4, MAX_BAR = 20;
const H = 52, MARK_H = 14;
/** Score at which a bar reaches full height (white POV, cp). */
const FULL_SCALE_CP = 800;

/**
 * Game as a score strip: one bar per decision (white POV, clipped ±8 pawns),
 * coloured by engine instance. Markers beneath: capture ▲, root instability ●,
 * aborted search ▮, shuffle ≈. This is the Game level's "source view".
 */
const Timeline = ({ game, nav, dispatch, accents }) => {
  // ── Hooks ──
  const [scrollRef, { width }] = useElementSize();

  // ── Derived ──
  const turns = game ? game.turns : [];
  const barW = turns.length > 0 ? Math.max(MIN_BAR, Math.min(MAX_BAR, Math.floor(width / turns.length))) : MAX_BAR;
  const svgW = Math.max(turns.length * barW, width);
  const half = H / 2 - 4;
  const scale = (cp) => Math.max(-half, Math.min(half, ((cp ?? 0) / FULL_SCALE_CP) * half));

  // ── Effects ──
  // Keep the current turn in view when it is stepped off-screen.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = nav.turn * barW;
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - el.clientWidth / 2;
  }, [nav.turn, barW, scrollRef]);

  // ── Render ──
  return (
    <div className="bg-gray-800 rounded-lg p-2 shadow-lg">
      {/* Legend */}
      <div className="flex justify-between gap-4 text-[11px] text-gray-400 px-1 mb-1">
        <span className="truncate">Timeline · game-{game ? game.index : '–'} · {turns.length} decisions · score white POV · click to jump</span>
        <span className="whitespace-nowrap">▲ capture  ● ≥3 root changes  ▮ aborted  ≈ shuffle</span>
      </div>

      {/* Strip */}
      <div ref={scrollRef} className="overflow-x-auto move-history-scroll">
        <svg width={svgW} height={H + MARK_H + 4} className="block">
          <line x1={0} x2={svgW} y1={H / 2} y2={H / 2} stroke="#4b5563" />
          {turns.map((t, i) => {
            const x0 = i * barW;
            const h = t.isMate ? (t.cpWhite > 0 ? half : -half) : scale(t.cpWhite);
            const current = i === nav.turn;
            return (
              <g key={i} onClick={() => dispatch({ type: 'jump-turn', turn: i })} className="cursor-pointer">
                <rect x={x0} y={0} width={barW} height={H + MARK_H} fill={current ? '#374151' : 'transparent'} />
                <rect x={x0 + 1} y={h >= 0 ? H / 2 - h : H / 2} width={Math.max(1, barW - 2)} height={Math.max(1, Math.abs(h))}
                  rx={Math.min(2, barW / 4)} fill={accents[t.eng] ? accents[t.eng].hex : '#9ca3af'} opacity={current ? 1 : 0.75} />
                {/* Markers */}
                {t.cap && <polygon points={`${x0 + 1},${H + 10} ${x0 + barW - 1},${H + 10} ${x0 + barW / 2},${H + 3}`} fill="#fbbf24" />}
                {t.rootChanges !== null && t.rootChanges >= 3 && <circle cx={x0 + barW / 2} cy={H + 13} r={2} fill="#f87171" />}
                {t.aborted && <rect x={x0 + 2} y={H + 2} width={Math.max(1, barW - 4)} height={4} fill="#ef4444" />}
                {t.shuffle && <text x={x0 + barW / 2} y={H + MARK_H} textAnchor="middle" fontSize={9} fill="#a78bfa">≈</text>}
                {current && <rect x={x0} y={0} width={barW} height={H} fill="none" stroke="#fff" strokeWidth={1} />}
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