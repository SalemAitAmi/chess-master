import { Panel } from './primitives';
import { pieceIcons, PIECE_VALUES } from '../constants/gameConstants';
import { PIECE_FROM_CHAR } from '../utils/chessUtils';

/** Engine capture string (array of piece letters) → piece types, most valuable first. */
const toPieces = (chars) => (Array.isArray(chars) ? chars : [])
  .map(c => PIECE_FROM_CHAR[c.toLowerCase()])
  .filter(p => p !== undefined)
  .sort((a, b) => (PIECE_VALUES[b] || 0) - (PIECE_VALUES[a] || 0));

const valueOf = (pieces) => pieces.reduce((sum, p) => sum + (PIECE_VALUES[p] || 0), 0);

/** One side's haul: the taken (opposite-colour) pieces as icons. */
const CaptureRow = ({ label, pieces, pieceColor }) => (
  <div>
    <div className="flex justify-between items-center mb-1 text-sm">
      <span className="text-gray-300">{label}</span>
      <span className="text-green-400 font-mono">+{valueOf(pieces)}</span>
    </div>
    <div className="bg-gray-700 rounded p-2 min-h-[40px] flex flex-wrap items-center gap-1">
      {pieces.length === 0 ? <span className="text-gray-500 text-sm">None</span> : pieces.map((p, i) => (
        <i key={i}
          className={`fas ${pieceIcons[p]} text-xl ${pieceColor === 'white' ? 'text-gray-200' : 'text-gray-800'}`}
          style={{ textShadow: pieceColor === 'black' ? '0 0 2px white' : '0 0 2px black' }} />
      ))}
    </div>
  </div>
);

/**
 * `capturedWhite` lists WHITE pieces that were taken (Black's captures) and
 * vice versa — the engine names the victims, not the captors.
 */
const CapturedPieces = ({ capturedWhite, capturedBlack }) => {
  // ── Derived ──
  const whiteLost = toPieces(capturedWhite);
  const blackLost = toPieces(capturedBlack);
  const whiteGain = valueOf(blackLost);
  const blackGain = valueOf(whiteLost);
  const lead = whiteGain - blackGain;

  // ── Render ──
  return (
    <Panel size="md" title="Captured Pieces">
      <div className="space-y-3">
        <CaptureRow label="White captured" pieces={blackLost} pieceColor="black" />
        <CaptureRow label="Black captured" pieces={whiteLost} pieceColor="white" />
      </div>

      {/* Material difference */}
      {(whiteGain !== 0 || blackGain !== 0) && (
        <div className="mt-3 pt-2 border-t border-gray-600 text-center">
          <span className={`font-bold ${lead > 0 ? 'text-yellow-300' : lead < 0 ? 'text-gray-400' : 'text-gray-300'}`}>
            {lead > 0 ? `White leads by ${lead}` : lead < 0 ? `Black leads by ${-lead}` : 'Material equal'}
          </span>
        </div>
      )}
    </Panel>
  );
};

export default CapturedPieces;