import React from 'react';
import { PIECE_VALUES } from '../constants/gameConstants';

const GameInfoPanel = ({ gameState }) => {
  const {
    turn,
    fullmove,
    halfmove,
    incheck,
    eval: evaluation,
    material_white,
    material_black,
    blunder,
    status
  } = gameState;

  // Calculate material advantage
  const materialDiff = material_white - material_black;
  const advantageText = materialDiff > 0 
    ? `White +${Math.round(materialDiff / 100)}`
    : materialDiff < 0 
      ? `Black +${Math.round(Math.abs(materialDiff) / 100)}`
      : 'Equal';

  // Evaluation bar (normalized to -10 to +10 range for display)
  const normalizedEval = Math.max(-1000, Math.min(1000, evaluation)) / 100;
  const evalPercent = 50 + (normalizedEval * 5); // 50% = equal

  return (
    <div className="bg-gray-800 rounded-lg p-4 shadow-lg w-64">
      <h3 className="text-lg font-bold text-white mb-4 border-b border-gray-600 pb-2">
        Game Info
      </h3>

      {/* Turn indicator */}
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Turn:</span>
          <span className={`font-bold ${turn === 'white' ? 'text-yellow-300' : 'text-gray-300'}`}>
            {turn === 'white' ? '⬜ White' : '⬛ Black'}
          </span>
        </div>
        {incheck && (
          <div className="text-red-500 font-bold animate-pulse text-center mt-1">
            CHECK
          </div>
        )}
      </div>

      {/* Move counter */}
      <div className="mb-4 flex justify-between text-sm">
        <span className="text-gray-400">Move:</span>
        <span className="text-white font-mono">{fullmove}</span>
      </div>

      {/* Evaluation bar */}
      <div className="mb-4">
        <div className="text-gray-400 text-sm mb-1">Evaluation:</div>
        <div className="h-4 bg-gray-900 rounded-full overflow-hidden relative">
          <div 
            className="h-full bg-gradient-to-r from-gray-700 to-white transition-all duration-300"
            style={{ width: `${Math.max(5, Math.min(95, evalPercent))}%` }}
          />
          <div className="absolute inset-0 flex items-center justify-center text-xs font-bold">
            <span className={evaluation >= 0 ? 'text-gray-900' : 'text-white'}>
              {evaluation >= 0 ? '+' : ''}{(evaluation / 100).toFixed(1)}
            </span>
          </div>
        </div>
      </div>

      {/* Material */}
      <div className="mb-4">
        <div className="text-gray-400 text-sm mb-1">Material:</div>
        <div className={`text-center font-bold ${
          materialDiff > 0 ? 'text-green-400' : 
          materialDiff < 0 ? 'text-red-400' : 'text-gray-300'
        }`}>
          {advantageText}
        </div>
      </div>

      {/* Blunder indicator */}
      {blunder && (
        <div className="bg-red-900 rounded p-2 text-center animate-pulse">
          <span className="text-red-300 font-bold">⚠️ Blunder!</span>
        </div>
      )}

      {/* 50-move rule warning */}
      {halfmove >= 80 && status === 'ongoing' && (
        <div className="bg-yellow-900 rounded p-2 text-center mt-2">
          <span className="text-yellow-300 text-sm">
            50-move rule: {halfmove}/100
          </span>
        </div>
      )}
    </div>
  );
};

export default GameInfoPanel;