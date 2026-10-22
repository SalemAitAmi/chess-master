import Panel from './Panel';
import { pieceAt } from '../fenUtils';
import { PIECE_NAME, fmtCp, fmtInt, WHY_LABEL } from '../format';
import { scoreColor } from '../view';

const LETTER = ['K', 'Q', 'R', 'B', 'N', 'P'];

/**
 * Everything logged about the piece on the selected square for this turn:
 * its root moves (score, rank, effort, ordering tier, exactness), where it
 * appears in the line, and which iterations preferred one of its moves.
 */
const PieceView = ({ view, nav, dispatch }) => {
  const { turn, selectedCandidates, line } = view;
  const sq = nav.selected;
  if (!turn || !sq) return null;
  const piece = pieceAt(turn.fen, sq);
  const name = piece ? `${piece.color} ${PIECE_NAME[LETTER[piece.type]] ?? '?'}` : 'empty square';
  const inLine = line.map((m, i) => (m.slice(0, 2) === sq ? i + 1 : null)).filter(Boolean);
  return (
    <Panel title={`${name} on ${sq}`} sub={`${selectedCandidates.length} logged root move(s) · click a row or its destination square`}>
      {selectedCandidates.length === 0 ? (
        <div className="text-xs text-gray-500">No root move from this square in the logs (root-move / root-scores / iterations).</div>
      ) : (
        <div className="space-y-0.5 max-h-56 overflow-y-auto move-history-scroll">
          {selectedCandidates.map(c => (
            <button key={c.alg} onClick={() => dispatch({ type: 'pick-move', alg: c.alg })}
              className={`w-full text-left px-2 py-1 rounded text-xs flex items-center gap-2 ${nav.pick === c.alg ? 'bg-gray-600' : 'hover:bg-gray-700'}`}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: scoreColor(c.delta) }} />
              <span className={`font-mono w-14 ${c.played ? 'text-green-300 font-bold' : 'text-gray-100'}`}>{c.alg}{c.played ? ' ★' : ''}</span>
              <span className="font-mono w-16 text-right text-gray-200">{fmtCp(c.cp)}</span>
              <span className="w-12 text-gray-500">{c.rank === null ? '' : `#${c.rank + 1}`}{c.exact === false ? '~' : ''}</span>
              <span className="w-14 text-right text-gray-500 font-mono">{c.nodes === null ? '' : fmtInt(c.nodes)}</span>
              <span className="flex-1 truncate text-gray-400">{c.why ? WHY_LABEL[c.why] ?? c.why : ''}{c.cap ? ` · x${c.cap}` : ''}</span>
              <span className="text-[10px] text-amber-300">{c.bestAtDepths.length ? `d${c.bestAtDepths.join(',')}` : ''}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 text-[11px] text-gray-500">
        {inLine.length > 0 ? `moves at line ply ${inLine.join(', ')}` : 'not a mover in the line'} ·
        ~ = bound (not exact) · d… = best move at those depths
      </div>
    </Panel>
  );
};
export default PieceView;