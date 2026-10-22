import { useEffect, useRef, useState } from 'react';
import Panel, { KV } from './Panel';
import { fmtInt } from '../format';
import { filesFromDataTransfer } from '../ndjson';

const SessionPanel = ({ session, nav, dispatch, onLoad, loading, error }) => {
  const dirRef = useRef(null);
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    if (dirRef.current) { dirRef.current.setAttribute('webkitdirectory', ''); dirRef.current.setAttribute('directory', ''); }
  }, []);
  const onDrop = async (e) => {
    e.preventDefault(); setDrag(false);
    onLoad(await filesFromDataTransfer(e.dataTransfer));
  };
  const rate = session ? session.sampleRate : null;
  return (
    <Panel title="Session" sub={session ? session.name : 'nothing loaded'}>
      <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
        className={`rounded border border-dashed p-2 text-xs text-center ${drag ? 'border-blue-400 bg-gray-700' : 'border-gray-600'}`}>
        <div className="flex gap-2 justify-center">
          <label className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-white cursor-pointer">
            {loading ? 'Loading…' : 'Open session folder'}
            <input ref={dirRef} type="file" multiple className="hidden" onChange={e => onLoad(e.target.files)} />
          </label>
          <label className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-white cursor-pointer">
            Files
            <input type="file" multiple className="hidden" accept=".ndjson,.json" onChange={e => onLoad(e.target.files)} />
          </label>
        </div>
        <div className="text-gray-500 mt-1">or drop <span className="font-mono">engine/logs/&lt;session&gt;</span> here</div>
      </div>
      {error && <div className="mt-2 text-xs text-red-300 font-mono">{error}</div>}
      {session && (
        <>
          <div className="mt-2">
            <label className="text-xs text-gray-400">Game</label>
            <select value={nav.game} onChange={e => dispatch({ type: 'set-game', game: parseInt(e.target.value, 10) })}
              className="w-full mt-1 p-1 bg-gray-600 text-white rounded text-xs">
              {session.games.map((g, i) => (
                <option key={g.index} value={i}>game-{g.index} · {g.turns.length} turns · {g.engines.join(' v ')}{g.lite ? ' (replay export)' : ''}</option>
              ))}
            </select>
          </div>
          <div className="mt-2">
            <KV items={[
              ['Trace sampling', `1 / ${rate.value}`, rate.exact ? 'text-green-300' : 'text-yellow-300'],
              ['Rate source', rate.source],
              ['Gaps', rate.exact ? `exact (ti on ${fmtInt(rate.tiCount)} records)` : 'assumed from the rate', rate.exact ? 'text-green-300' : 'text-yellow-300'],
              ['Session lock', rate.locked === null ? 'unknown' : rate.locked ? 'locked at game 1' : 'not yet locked'],
              ['Log mask', session.mask === null ? '–' : `0x${session.mask.toString(16)}`],
              ['Records', fmtInt(session.recordCount)],
            ]} />
          </div>
          <div className="mt-2 space-y-1">
            {[...session.engines.values()].map(e => (
              <div key={e.eng} className="text-xs flex items-baseline gap-2">
                <span className={`font-bold ${session.accents[e.eng].text}`}>{e.eng}</span>
                <span className="text-gray-300">{e.label ?? e.profile ?? '?'}</span>
                <span className="text-gray-600 font-mono">{e.configHash ?? ''}</span>
                {e.overrides && Object.keys(e.overrides).length > 0 && (
                  <span className="text-amber-400 truncate" title={JSON.stringify(e.overrides)}>+{Object.keys(e.overrides).length} override(s)</span>
                )}
              </div>
            ))}
          </div>
          {session.warnings.length > 0 && (
            <div className="mt-2 text-[11px] text-yellow-300 space-y-0.5">
              {session.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
        </>
      )}
    </Panel>
  );
};
export default SessionPanel;