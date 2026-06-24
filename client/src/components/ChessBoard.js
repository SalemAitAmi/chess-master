import React, { useMemo } from 'react';
import { pieceIcons, PIECES } from "../constants/gameConstants";
import { parseFenToBoard } from "../utils/chessUtils";

const ChessBoard = ({ 
  fen, 
  selected, 
  legalMoves = [], 
  lastMove, 
  onSquareClick, 
  flipped = false,
  disabled = false
}) => {
  const board = useMemo(() => parseFenToBoard(fen), [fen]);

  // Build set of valid target squares
  const validTargets = useMemo(() => {
    if (!selected?.moves) return new Set();
    return new Set(selected.moves.map(([r, c]) => `${r},${c}`));
  }, [selected]);

  const renderSquares = () => {
    const squares = [];
    
    for (let displayRow = 0; displayRow < 8; displayRow++) {
      for (let displayCol = 0; displayCol < 8; displayCol++) {
        const actualRow = flipped ? 7 - displayRow : displayRow;
        const actualCol = displayCol;
        
        const piece = board[actualRow]?.[actualCol];
        
        const isSelected = selected && 
          selected.row === actualRow && 
          selected.col === actualCol;
        
        const isValidMove = validTargets.has(`${actualRow},${actualCol}`);
        
        const isLastMove = lastMove && (
          (lastMove.from[0] === actualRow && lastMove.from[1] === actualCol) ||
          (lastMove.to[0] === actualRow && lastMove.to[1] === actualCol)
        );

        let squareClass = (displayRow + displayCol) % 2 === 0 
          ? "bg-amber-100" 
          : "bg-amber-700";
        
        if (isSelected) {
          squareClass = "bg-blue-400 shadow-inner";
        } else if (isValidMove) {
          squareClass = "bg-green-400 shadow-inner";
        } else if (isLastMove) {
          squareClass = "bg-yellow-300 shadow-inner";
        }

        squares.push(
          <div
            key={`${displayRow}-${displayCol}`}
            className={`
              flex items-center justify-center w-[64px] h-[64px] 
              border border-gray-600 transition-all duration-150
              ${squareClass}
              ${disabled ? 'cursor-default' : 'cursor-pointer hover:brightness-110'}
              ${isValidMove && !disabled ? 'hover:bg-green-500' : ''}
            `}
            onClick={() => !disabled && onSquareClick(actualRow, actualCol)}
          >
            {isValidMove && !piece && (
              <div className="w-4 h-4 rounded-full bg-green-600 opacity-60" />
            )}
            
            {piece && (
              <i
                className={`
                  fas ${pieceIcons[piece.type]} 
                  ${piece.color === "white" ? "text-gray-100" : "text-gray-900"} 
                  text-4xl drop-shadow-md
                  ${isValidMove ? 'ring-2 ring-red-500 ring-offset-1 rounded-full' : ''}
                `}
              />
            )}
          </div>
        );
      }
    }
    
    return squares;
  };

  const renderFileLabels = () => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    return (
      <div className="flex">
        <div className="w-8" />
        {files.map((file) => (
          <div key={file} className="w-[64px] text-center text-gray-400 text-sm font-semibold">
            {file}
          </div>
        ))}
      </div>
    );
  };

  const renderRankLabels = () => {
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    const displayRanks = flipped ? [...ranks].reverse() : ranks;
    return (
      <div className="flex flex-col">
        {displayRanks.map((rank) => (
          <div key={rank} className="h-[64px] flex items-center justify-center text-gray-400 text-sm font-semibold w-8">
            {rank}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col">
      <div className="flex">
        {renderRankLabels()}
        <div className="grid grid-cols-8 gap-0 border-4 border-gray-700 bg-gray-700 rounded-lg shadow-2xl p-1">
          {renderSquares()}
        </div>
      </div>
      {renderFileLabels()}
    </div>
  );
};

export default ChessBoard;