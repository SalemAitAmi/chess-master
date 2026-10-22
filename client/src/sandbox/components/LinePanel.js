import Panel from './Panel';
import { plyLabel } from '../format';

/** The principal variation as clickable plies: the board follows the line (display-only positions). */
const LinePanel = ({ view, nav, dispatch }) => {
  const { turn, frame, line } = view;
  if (!turn) return null;
  const title = frame && frame.kind === 'iteration' ? `Line at d=${frame.d}` : 'Principal variation';
  return (
    <Panel title={title} sub={`${line.length} plies · click a ply to walk the line · [ ] step · positions after ply 1 are rendered, not validated`}>
      <div className="flex flex-wrap gap-1 text-xs font-mono">
        <button onClick={() => dispatch({ type: 'set-pv', ply: 0 })}
          className={`px-1.5 py-0.5 rounded ${nav.pvPly === 0 ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>root</button>
        {line.map((m, i) => (
          <button key={i} onClick={() => dispatch({ type: 'set-pv', ply: i + 1 })}
            className={`px-1.5 py-0.5 rounded ${nav.pvPly === i + 1 ? 'bg-blue-600 text-white' : i === 0 ? 'bg-green-900 text-green-200 hover:bg-green-800' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
            <span className="text-gray-500">{plyLabel(turn.t + i)} </span>{m}
          </button>
        ))}
        {line.length === 0 && <span className="text-gray-500">no line logged for this frame</span>}
      </div>
    </Panel>
  );
};
export default LinePanel;