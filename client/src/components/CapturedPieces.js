import React from 'react';
import { PIECES, pieceIcons, PIECE_VALUES } from '../constants/gameConstants';

const CapturedPieces = ({ capturedWhite, capturedBlack }) => {
  // Convert piece characters to piece types
  const charToPiece = {
    'k': PIECES.KING, 'q': PIECES.QUEEN, 'r': PIECES.ROOK,
    'b': PIECES.BISHOP, 'n': PIECES.KNIGHT, 'p': PIECES.PAWN
  };

  const parseCaptured = (captured) => {
    if (!Array.isArray(captured)) return [];
    return captured.map(c => charToPiece[c.toLowerCase()]).filter(p => p !== undefined);
  };

  const whitePieces = parseCaptured(capturedWhite);
  const blackPieces = parseCaptured(capturedBlack);

  // Calculate material value
  const whiteValue = whitePieces.reduce((sum, p) => sum + (PIECE_VALUES[p] || 0), 0);
  const blackValue = blackPieces.reduce((sum, p) => sum + (PIECE_VALUES[p] || 0), 0);

  // Sort pieces by value (highest first)
  const sortPieces = (pieces) => {
    return [...pieces].sort((a, b) => (PIECE_VALUES[b] || 0) - (PIECE_VALUES[a] || 0));
  };

  const renderPieces = (pieces, color) => {
    const sorted = sortPieces(pieces);
    
    return (
      <div className="flex flex-wrap gap-1">
        {sorted.length === 0 ? (
          <span className="text-gray-500 text-sm">None</span>
        ) : (
          sorted.map((piece, idx) => (
            <i 
              key={idx}
              className={`fas ${pieceIcons[piece]} text-xl ${
                color === 'white' ? 'text-gray-200' : 'text-gray-800'
              }`}
              style={{
                textShadow: color === 'black' ? '0 0 2px white' : '0 0 2px black'
              }}
            />
          ))
        )}
      </div>
    );
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 shadow-lg w-64">
      <h3 className="text-lg font-bold text-white mb-4 border-b border-gray-600 pb-2">
        Captured Pieces
      </h3>

      {/* White's captures (black pieces) */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-300 text-sm">White captured:</span>
          <span className="text-green-400 text-sm font-mono">+{blackValue}</span>
        </div>
        <div className="bg-gray-700 rounded p-2 min-h-[36px]">
          {renderPieces(blackPieces, 'black')}
        </div>
      </div>

      {/* Black's captures (white pieces) */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-300 text-sm">Black captured:</span>
          <span className="text-green-400 text-sm font-mono">+{whiteValue}</span>
        </div>
        <div className="bg-gray-700 rounded p-2 min-h-[36px]">
          {renderPieces(whitePieces, 'white')}
        </div>
      </div>

      {/* Material difference */}
      {(whiteValue !== 0 || blackValue !== 0) && (
        <div className="mt-4 pt-2 border-t border-gray-600 text-center">
          <span className={`font-bold ${
            blackValue > whiteValue ? 'text-yellow-300' : 
            whiteValue > blackValue ? 'text-gray-400' : 'text-gray-300'
          }`}>
            {blackValue > whiteValue 
              ? `White leads by ${blackValue - whiteValue}` 
              : whiteValue > blackValue
                ? `Black leads by ${whiteValue - blackValue}`
                : 'Material equal'}
          </span>
        </div>
      )}
    </div>
  );
};

export default CapturedPieces;