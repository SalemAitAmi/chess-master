/**
 * Match score keyed by SIDE IDENTITY, never by colour: colours swap every
 * round, so "White 3 – Black 2" described nothing.
 *
 * sides:   [{ id, name, short?, detail?, accent?, playing?, connected? }] × 2
 * results: [{ round, winnerId|null, winnerColor|null, status, moves, whiteId, blackId }]
 */
import React from 'react';
const PANEL = 'bg-gray-800 rounded-lg p-4 shadow-lg w-64';
const STATUS_SHORT = {
  checkmate: 'mate', resignation: 'resigned', stalemate: 'stalemate',
  threefold: 'threefold', fifty_move: '50-move', insufficient_material: 'material',
};
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
const cap = (c) => (c ? c.charAt(0).toUpperCase() + c.slice(1) : '');
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
    {side.playing && <div className="text-[10px] text-gray-500">plays {cap(side.playing)}</div>}
  </div>
);
const MatchScore = ({ sides, results, status = null, children = null }) => {
  const [a, b] = sides;
  const t = tallyMatch(results, sides);
  const short = (id) => { const s = sides.find(x => x.id === id); return s ? (s.short ?? s.name) : id; };
  const name = (id) => { const s = sides.find(x => x.id === id); return s ? s.name : id; };
  return (
    <div className={PANEL}>
      <h3 className="text-lg font-bold text-white mb-4 border-b border-gray-600 pb-2">Match Score</h3>
      <div className="grid grid-cols-3 gap-2 text-center mb-4">
        <ScoreCell side={a} wins={t[a.id]} />
        <div>
          <div className="text-2xl font-bold text-gray-400">{t.draws}</div>
          <div className="text-xs text-gray-400">Draw</div>
        </div>
        <ScoreCell side={b} wins={t[b.id]} />
      </div>
      {status}
      {children}
      {results.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-600">
          <h4 className="text-sm font-bold text-gray-300 mb-2">History</h4>
          <div className="max-h-40 overflow-y-auto space-y-1 text-xs move-history-scroll">
            {results.map((r) => {
              const winnerSide = sides.find(s => s.id === r.winnerId);
              return (
                <div key={r.round} className="flex justify-between gap-2 text-gray-400">
                  <span className="truncate">R{r.round} {short(r.whiteId)}(W) v {short(r.blackId)}(B)</span>
                  <span className={`flex-shrink-0 ${winnerSide ? (winnerSide.accent ?? 'text-gray-200') : 'text-gray-500'}`}>
                    {winnerSide ? name(r.winnerId) : 'Draw'} ({STATUS_SHORT[r.status] ?? r.status}, {r.moves})
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
export default MatchScore;