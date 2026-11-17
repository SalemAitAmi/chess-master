import { useEffect, useMemo, useRef } from 'react';
import { Panel } from './primitives';

/**
 * SAN list → numbered pairs. A black-to-move start FEN begins with a "…"
 * white slot, and numbering starts at the FEN's fullmove counter.
 */
function pairMoves(history, startFen) {
  const parts = startFen.trim().split(/\s+/);
  let number = parseInt(parts[5], 10) || 1;
  const pairs = [];
  let i = 0;
  if (parts[1] === 'b' && history.length > 0) {
    pairs.push({ number: number++, white: '…', black: history[0] });
    i = 1;
  }
  for (; i < history.length; i += 2) pairs.push({ number: number++, white: history[i], black: history[i + 1] ?? null });
  return pairs;
}

/** Full game score; fills its column and keeps the newest move in view. */
const MoveHistory = ({ history, startFen = '' }) => {
  // ── Refs ──
  const scrollRef = useRef(null);

  // ── Derived ──
  const pairs = useMemo(() => pairMoves(history, startFen), [history, startFen]);

  // ── Effects ──
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history.length]);

  // ── Render ──
  return (
    <Panel size="md" title="Move History" fill className="xl:flex-1"
      right={history.length > 0 && <span className="text-gray-400 text-xs whitespace-nowrap">{history.length} plies</span>}>
      <div ref={scrollRef}
        className="flex-1 min-h-0 max-h-80 xl:max-h-none overflow-y-auto space-y-0.5 font-mono text-sm move-history-scroll">
        {pairs.length === 0 ? (
          <div className="text-gray-500 text-center py-4">No moves yet</div>
        ) : pairs.map((pair, idx) => (
          <div key={pair.number}
            className={`flex items-center py-1 px-2 rounded ${idx === pairs.length - 1 ? 'bg-gray-700' : 'odd:bg-gray-900/30'}`}>
            <span className="text-gray-500 w-10">{pair.number}.</span>
            <span className="text-white flex-1">{pair.white}</span>
            <span className="text-gray-300 flex-1">{pair.black ?? ''}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
};

export default MoveHistory;