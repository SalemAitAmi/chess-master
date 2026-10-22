import Panel from './Panel';
import SampleList from './SampleList';
import { fmtCp, fmtInt } from '../format';

const KIND_ICON = { result: '◉', policy: '⚖', iteration: '↻', setup: '⚙' };

function frameLine(f, turn) {
  switch (f.kind) {
    case 'result': return `${turn.best ?? '–'} ${fmtCp(turn.cp, turn.mate)}${turn.aborted ? ' · aborted' : ''}`;
    case 'policy': {
      const bits = [];
      if (turn.rec.rootVerified) bits.push(`${turn.rec.rootVerified} verified`);
      if (turn.policy.repetitionAvoided) bits.push('repetition avoided');
      if (turn.policy.tieBreak) bits.push('tie-break');
      if (turn.policy.openingViolation) bits.push('opening ⚠');
      return bits.length ? bits.join(' · ') : 'no override';
    }
    case 'iteration':
      return `${f.it.best ?? '–'} ${fmtCp(f.it.cp)}${f.it.changed ? ' ↺' : ''} · +${fmtInt(f.it.nodesDelta)}n` +
             (f.it.rootOrders > 1 ? ` · ${f.it.rootOrders - 1} re-search` : '');
    case 'setup': return `${turn.stage ?? '?'} · static ${fmtCp(turn.staticCp)} · ${turn.rootN ?? '?'} moves`;
    default: return '';
  }
}

/** The decision trace: frames newest-first, then the samples of the current frame. */
const FrameList = ({ view, nav, dispatch, session }) => {
  const { turn, frame } = view;
  if (!turn) return null;
  return (
    <Panel title="Decision trace" sub="reverse chronological · ⤵ step into · ⤴ step out">
      <div className="space-y-0.5 max-h-64 overflow-y-auto move-history-scroll">
        {turn.frames.map(f => {
          const active = nav.level >= 1 && f.index === frame.index;
          return (
            <button key={f.index} onClick={() => dispatch({ type: 'set-frame', frame: f.index })}
              className={`w-full text-left px-2 py-1 rounded text-xs flex items-center gap-2
                ${active ? 'bg-gray-600 text-white' : 'hover:bg-gray-700 text-gray-300'} ${f.kind === 'iteration' ? 'pl-5' : ''}`}>
              <span className="w-4 text-center text-gray-400">{KIND_ICON[f.kind]}</span>
              <span className="font-semibold w-24 truncate">{f.title}</span>
              <span className="flex-1 truncate font-mono text-gray-400" title={frameLine(f, turn)}>{frameLine(f, turn)}</span>
              <span className="text-[10px] text-gray-500 w-6 text-right">{f.samples.length > 0 ? `${f.samples.length}s` : ''}</span>
            </button>
          );
        })}
      </div>
      {nav.level >= 1 && <SampleList frame={frame} nav={nav} dispatch={dispatch} rate={session.sampleRate} />}
    </Panel>
  );
};
export default FrameList;