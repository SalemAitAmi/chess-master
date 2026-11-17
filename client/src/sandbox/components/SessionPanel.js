import { Panel, KV } from '../../components/primitives';
import { fmtInt } from '../format';

const KIND_LABEL = {
  engine: 'engine logs',
  human: 'human game · moves only',
  mixed: 'engine logs + human games',
};

/**
 * What is loaded: game picker, how trace sampling was reconciled, which
 * engine instances played. Loading lives in the header's "Load New Session".
 */
const SessionPanel = ({ session, nav, dispatch }) => {
  // ── Derived ──
  const rate = session.sampleRate;
  const exactClass = rate.exact ? 'text-green-300' : 'text-yellow-300';

  // ── Render ──
  return (
    <Panel title="Session" sub={session.name}>
      {/* Game picker */}
      <label className="block text-xs text-gray-400">
        Game
        <select value={nav.game} onChange={e => dispatch({ type: 'set-game', game: parseInt(e.target.value, 10) })}
          className="w-full mt-1 p-1 bg-gray-700 text-white rounded text-xs">
          {session.games.map((g, i) => (
            <option key={g.index} value={i}>
              game-{g.index} · {g.turns.length} turns · {g.engines.join(' v ')}{g.lite ? ' (replay export)' : ''}
            </option>
          ))}
        </select>
      </label>

      {/* Provenance + sampling. Single column: the values are long, and keys must stay whole. */}
      <div className="mt-2">
        <KV cols={1} items={[
          ['Data', KIND_LABEL[session.kind] ?? session.kind],
          ['Trace sampling', `1 / ${rate.value}`, exactClass],
          ['Rate source', rate.source],
          ['Gaps', rate.exact ? `exact (ti on ${fmtInt(rate.tiCount)} records)` : 'assumed from the rate', exactClass],
          ['Session lock', rate.locked === null ? 'unknown' : rate.locked ? 'locked at game 1' : 'not yet locked'],
          ['Log mask', session.mask === null ? '–' : `0x${session.mask.toString(16)}`],
          ['Records', fmtInt(session.recordCount)],
        ]} />
      </div>

      {/* Engine instances */}
      <div className="mt-2 space-y-1">
        {[...session.engines.values()].map(e => (
          <div key={e.eng} className="text-xs flex items-baseline gap-2 min-w-0">
            <span className={`font-bold ${session.accents[e.eng].text}`}>{e.eng}</span>
            <span className="text-gray-300 truncate">{e.label ?? e.profile ?? '?'}</span>
            <span className="text-gray-600 font-mono">{e.configHash ?? ''}</span>
            {Object.keys(e.overrides).length > 0 && (
              <span className="text-amber-400 whitespace-nowrap" title={JSON.stringify(e.overrides)}>
                +{Object.keys(e.overrides).length} override(s)
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Loader warnings */}
      {session.warnings.length > 0 && (
        <div className="mt-2 text-[11px] text-yellow-300 space-y-0.5">
          {session.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}
    </Panel>
  );
};

export default SessionPanel;