import { LEVELS, LENSES } from '../nav';
import { COMPONENTS, COMPONENT_LABEL } from '../model';
import { plyLabel } from '../format';

const Btn = ({ onClick, disabled = false, title, children, active = false, tone = 'bg-gray-700 hover:bg-gray-600' }) => (
  <button onClick={onClick} disabled={disabled} title={title}
    className={`px-2.5 py-1.5 rounded text-sm font-semibold text-white transition-all
      ${disabled ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : active ? 'bg-blue-600' : tone}`}>
    {children}
  </button>
);

const DebuggerControls = ({ session, nav, dispatch, view }) => {
  const turn = view.turn;
  const frame = view.frame;
  const turns = view.game ? view.game.turns.length : 0;
  const canInto = nav.level === 0 ? turn !== null : nav.level === 1 ? (frame !== null && frame.samples.length > 0) : false;
  const crumbs = [];
  if (view.game) crumbs.push(`game-${view.game.index}`);
  if (turn) crumbs.push(`${plyLabel(turn.t)} ${turn.best ?? '?'} (${turn.eng}, turn ${nav.turn + 1}/${turns})`);
  if (nav.level >= 1 && frame) crumbs.push(frame.title);
  if (nav.level === 2 && frame) crumbs.push(`sample ${nav.sample + 1}/${frame.samples.length}`);
  return (
    <div className="bg-gray-800 rounded-lg px-3 py-2 shadow-lg flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Btn onClick={() => dispatch({ type: 'first' })} title="First (Home)">⏮</Btn>
        <Btn onClick={() => dispatch({ type: 'step-back' })} title="Step back (←)">◀</Btn>
        <Btn onClick={() => dispatch({ type: 'step-over' })} title="Step over (→): next turn / next frame (reverse chronology) / next older sample" tone="bg-green-700 hover:bg-green-600">▶ Step over</Btn>
        <Btn onClick={() => dispatch({ type: 'last' })} title="Last (End)">⏭</Btn>
      </div>
      <div className="flex items-center gap-1">
        <Btn onClick={() => dispatch({ type: 'step-into' })} disabled={!canInto}
          title={nav.level === 1 && !canInto ? 'No sampled traces in this window' : 'Step into (↓): descend to the final element of the next level'}
          tone="bg-amber-700 hover:bg-amber-600">⤵ Step into</Btn>
        <Btn onClick={() => dispatch({ type: 'step-out' })} disabled={nav.level === 0} title="Step out (↑)">⤴ Step out</Btn>
      </div>
      <div className="flex items-center gap-1 text-xs">
        {LEVELS.map((l, i) => (
          <span key={l} className={`px-2 py-0.5 rounded ${i === nav.level ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'}`}>{l}</span>
        ))}
      </div>
      <div className="flex-1 min-w-[12rem] text-xs text-gray-300 font-mono truncate" title={crumbs.join(' › ')}>
        {crumbs.join(' › ')}
      </div>
      <div className="flex items-center gap-1 text-xs">
        <span className="text-gray-500 mr-1">Lens</span>
        {LENSES.map(l => (
          <button key={l.id} onClick={() => dispatch({ type: 'set-lens', lens: l.id })} title={l.help}
            className={`px-2 py-1 rounded ${nav.lens === l.id ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
            {l.label}
          </button>
        ))}
        <select value={nav.heuristic} onChange={e => dispatch({ type: 'set-heuristic', heuristic: e.target.value })}
          className="bg-gray-700 text-white rounded text-xs p-1">
          {COMPONENTS.map(c => <option key={c} value={c}>{COMPONENT_LABEL[c]}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <Btn onClick={() => dispatch({ type: 'toggle-after' })} active={nav.after} title="Show the position AFTER the focused move (a)">after</Btn>
        <Btn onClick={() => dispatch({ type: 'toggle-flip' })} active={nav.flip} title="Flip board (f)">flip</Btn>
        {(nav.selected || nav.pick) && <Btn onClick={() => dispatch({ type: 'clear-selection' })} title="Clear selection (Esc)">✕</Btn>}
      </div>
    </div>
  );
};
export default DebuggerControls;