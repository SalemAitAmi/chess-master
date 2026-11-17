import { Panel } from './primitives';

/** ±10 pawns → 0–100 %, kept within 5–95 % so both colours stay visible. */
const evalPercent = (cp) => Math.max(5, Math.min(95, 50 + Math.max(-1000, Math.min(1000, cp)) / 20));

/** Turn, move number, evaluation bar, material balance and rule warnings. */
const GameInfoPanel = ({ gameState }) => {
  const {
    turn, fullmove, halfmove, incheck, eval: evaluation,
    material_white: white, material_black: black, blunder, status,
  } = gameState;

  // ── Derived ──
  const materialDiff = white - black;
  const advantage = materialDiff > 0 ? `White +${Math.round(materialDiff / 100)}`
                  : materialDiff < 0 ? `Black +${Math.round(-materialDiff / 100)}`
                  : 'Equal';
  const advantageClass = materialDiff > 0 ? 'text-green-400' : materialDiff < 0 ? 'text-red-400' : 'text-gray-300';

  // ── Render ──
  return (
    <Panel size="md" title="Game Info">
      {/* Turn + move number */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-gray-900/50 rounded p-2">
          <div className="text-gray-400 text-xs">Turn</div>
          <div className={`font-bold ${turn === 'white' ? 'text-yellow-300' : 'text-gray-300'}`}>
            {turn === 'white' ? '⬜ White' : '⬛ Black'}
          </div>
        </div>
        <div className="bg-gray-900/50 rounded p-2">
          <div className="text-gray-400 text-xs">Move</div>
          <div className="text-white font-mono font-bold">{fullmove}</div>
        </div>
      </div>
      {incheck && <div className="text-red-500 font-bold animate-pulse text-center mb-2">CHECK</div>}

      {/* Evaluation bar */}
      <div className="mb-3">
        <div className="text-gray-400 text-sm mb-1">Evaluation</div>
        <div className="h-4 bg-gray-900 rounded-full overflow-hidden relative">
          <div className="h-full bg-gradient-to-r from-gray-700 to-white transition-all duration-300"
            style={{ width: `${evalPercent(evaluation)}%` }} />
          <div className="absolute inset-0 flex items-center justify-center text-xs font-bold">
            <span className={evaluation >= 0 ? 'text-gray-900' : 'text-white'}>
              {evaluation >= 0 ? '+' : ''}{(evaluation / 100).toFixed(1)}
            </span>
          </div>
        </div>
      </div>

      {/* Material */}
      <div className="flex justify-between items-baseline text-sm">
        <span className="text-gray-400">Material</span>
        <span className={`font-bold ${advantageClass}`}>{advantage}</span>
      </div>

      {/* Warnings */}
      {blunder && (
        <div className="bg-red-900 rounded p-2 text-center animate-pulse mt-3">
          <span className="text-red-300 font-bold">⚠️ Blunder!</span>
        </div>
      )}
      {halfmove >= 80 && status === 'ongoing' && (
        <div className="bg-yellow-900 rounded p-2 text-center mt-2">
          <span className="text-yellow-300 text-sm">50-move rule: {halfmove}/100</span>
        </div>
      )}
    </Panel>
  );
};

export default GameInfoPanel;