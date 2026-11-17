import { Panel } from '../../components/primitives';
import { plyLabel } from '../format';

/** The focused line as clickable plies; the board follows (display-only positions). */
const LinePanel = ({ view, nav, dispatch }) => {
  const { turn, frame, line } = view;
  if (!turn) return null;

  // ── Derived ──
  const title = frame && frame.kind === 'iteration' ? `Line at d=${frame.d}` : 'Principal variation';
  const plyClass = (ply, first = false) => `px-1.5 py-0.5 rounded-full ${nav.pvPly === ply ? 'bg-blue-600 text-white'
    : first ? 'bg-green-900 text-green-200 hover:bg-green-800' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`;

  // ── Render ──
  return (
    <Panel title={title} className="flex-none w-full"
      sub={`${line.length} plies · click a ply to walk the line · [ ] step · positions after ply 1 are rendered, not validated`}>
      <div className="flex flex-wrap gap-1 text-xs font-mono">
        <button onClick={() => dispatch({ type: 'set-pv', ply: 0 })} className={plyClass(0)}>root</button>
        {line.map((m, i) => (
          <button key={i} onClick={() => dispatch({ type: 'set-pv', ply: i + 1 })} className={plyClass(i + 1, i === 0)}>
            <span className="text-gray-500">{plyLabel(turn.t + i)} </span>{m}
          </button>
        ))}
        {line.length === 0 && <span className="text-gray-500">no line logged for this frame</span>}
      </div>
    </Panel>
  );
};

export default LinePanel;