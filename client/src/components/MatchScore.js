/**
 * Match score keyed by SIDE IDENTITY, never by colour: colours swap every
 * round, so "White 3 – Black 2" described nothing.
 *
 * sides:   [{ id, name, short?, detail?, accent?, playing?, connected? }] × 2
 * results: [{ round, winnerId|null, winnerColor|null, status, moves, whiteId, blackId }]
 */
import { Panel } from './primitives';
import { capitalize } from '../utils/text';

const STATUS_SHORT = {
  checkmate: 'mate', resignation: 'resigned', stalemate: 'stalemate',
  threefold: 'threefold', fifty_move: '50-move', insufficient_material: 'material',
};

// ═══════════════════════════════════════════════════════════════════════════
// Tally helpers (also used by ColosseumPage's footer)
// ═══════════════════════════════════════════════════════════════════════════

export function tallyMatch(results, sides) {
  const t = { draws: 0 };
  for (const s of sides) t[s.id] = 0;
  for (const r of results) {
    if (r.winnerId === null || r.winnerId === undefined) t.draws++;
    else if (r.winnerId in t) t[r.winnerId]++;
  }
  return t;
}

export function matchVerdict(results, sides) {
  const t = tallyMatch(results, sides);
  const [a, b] = sides;
  if (t[a.id] > t[b.id]) return `${a.name} wins the match!`;
  if (t[b.id] > t[a.id]) return `${b.name} wins the match!`;
  return 'Match drawn!';
}

// ═══════════════════════════════════════════════════════════════════════════
// Components
// ═══════════════════════════════════════════════════════════════════════════

const ScoreCell = ({ side, wins }) => (
  <div className="min-w-0">
    <div className={`text-2xl font-bold ${side.accent ?? 'text-gray-200'}`}>{wins}</div>
    <div className="text-xs text-gray-300 truncate" title={side.name}>
      {side.connected !== undefined && (
        <span className={side.connected ? 'text-green-400' : 'text-red-400'}>{side.connected ? '● ' : '○ '}</span>
      )}
      {side.name}
    </div>
    {side.detail && <div className="text-[10px] text-gray-500 truncate" title={side.detail}>{side.detail}</div>}
    {side.playing && <div className="text-[10px] text-gray-500">plays {capitalize(side.playing)}</div>}
  </div>
);

const MatchScore = ({ sides, results, status = null, children = null }) => {
  // ── Derived ──
  const [a, b] = sides;
  const tally = tallyMatch(results, sides);
  const sideOf = (id) => sides.find(s => s.id === id) ?? null;
  const shortName = (id) => { const s = sideOf(id); return s ? (s.short ?? s.name) : id; };

  // ── Render ──
  return (
    <Panel size="md" title="Match Score">
      {/* Score line: A · draws · B */}
      <div className="grid grid-cols-3 gap-2 text-center mb-3">
        <ScoreCell side={a} wins={tally[a.id]} />
        <div>
          <div className="text-2xl font-bold text-gray-400">{tally.draws}</div>
          <div className="text-xs text-gray-400">Draw</div>
        </div>
        <ScoreCell side={b} wins={tally[b.id]} />
      </div>

      {/* Mode-specific status + extras */}
      {status}
      {children}

      {/* Round history */}
      {results.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-600">
          <h4 className="text-sm font-bold text-gray-300 mb-2">History</h4>
          <div className="max-h-40 overflow-y-auto space-y-1 text-xs move-history-scroll">
            {results.map(r => {
              const winner = sideOf(r.winnerId);
              return (
                <div key={r.round} className="flex justify-between gap-2 text-gray-400">
                  <span className="truncate">R{r.round} {shortName(r.whiteId)}(W) v {shortName(r.blackId)}(B)</span>
                  <span className={`flex-shrink-0 ${winner ? (winner.accent ?? 'text-gray-200') : 'text-gray-500'}`}>
                    {winner ? winner.name : 'Draw'} ({STATUS_SHORT[r.status] ?? r.status}, {r.moves})
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
};

export default MatchScore;