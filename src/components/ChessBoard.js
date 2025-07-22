import React from "react";
import { pieceIcons } from "../constants/gameConstants";
import { isWhite } from "../utils/chessUtils";

const ChessBoard = ({ board, selected, lastMove, onSquareClick }) => {
  return (
    <div className="grid grid-cols-8 gap-0 w-[520px] h-[520px] border-4 border-gray-700 bg-gray-700 rounded-lg shadow-2xl p-1">
      {board.map((row, r) =>
        row.map((piece, c) => {
          const isSelected =
            selected && selected.row === r && selected.col === c;
          const isValidMove =
            selected &&
            selected.moves.some(([mr, mc]) => mr === r && mc === c);
          const isLastMove =
            lastMove &&
            ((lastMove.from[0] === r && lastMove.from[1] === c) ||
              (lastMove.to[0] === r && lastMove.to[1] === c));

          return (
            <div
              key={`${r}-${c}`}
              className={`flex items-center justify-center w-[64px] h-[64px] cursor-pointer border border-gray-600
                transition-all duration-200 ease-in-out
                ${(r + c) % 2 === 0 ? "bg-amber-100" : "bg-amber-700"}
                ${isSelected ? "bg-blue-400 shadow-inner" : ""}
                ${isValidMove ? "bg-green-400 shadow-inner" : ""}
                ${isLastMove ? "bg-yellow-300 shadow-inner" : ""}
                hover:${isValidMove ? "bg-green-500" : "brightness-110"}`}
              onClick={() => onSquareClick(r, c)}
            >
              {piece && (
                <i
                  className={`fas ${pieceIcons[piece[1]]} 
                    ${isWhite(piece) ? "text-gray-100" : "text-gray-900"} 
                    text-4xl drop-shadow-md transition-transform duration-200
                    hover:scale-110`}
                />
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default ChessBoard;