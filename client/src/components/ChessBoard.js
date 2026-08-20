import React, { useMemo, useState, useEffect } from 'react';
import { pieceIcons } from "../constants/gameConstants";
import { parseFenToBoard } from "../utils/chessUtils";

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];
const SQUARE_MIN = 40;
const SQUARE_MAX = 64;
const LABEL_GUTTER = 32;
/** Vertical space taken by header + banner + controls; board must fit the rest. */
const VERTICAL_CHROME = 260;
/** Horizontal share of the viewport the board may take when panels sit beside it. */
const WIDE_SHARE = 0.5;
const NARROW_SHARE = 0.9;
const WIDE_BREAKPOINT = 1280;

// ═══════════════════════════════════════════════════════════════════════════
// Responsive square size — keeps the whole board inside the viewport.
// ═══════════════════════════════════════════════════════════════════════════
function computeSquareSize(width, height) {
  const share = width >= WIDE_BREAKPOINT ? WIDE_SHARE : NARROW_SHARE;
  const byWidth = (width * share - LABEL_GUTTER) / 8;
  const byHeight = (height - VERTICAL_CHROME) / 8;
  const s = Math.floor(Math.min(byWidth, byHeight));
  return Math.max(SQUARE_MIN, Math.min(SQUARE_MAX, s));
}

function useSquareSize() {
  const [size, setSize] = useState(() => computeSquareSize(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const onResize = () => setSize(computeSquareSize(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

// ═══════════════════════════════════════════════════════════════════════════
const ChessBoard = ({
  fen,
  selected,
  legalMoves = [],
  lastMove,
  onSquareClick,
  flipped = false,
  disabled = false
}) => {
  // ── Hooks ──
  const squareSize = useSquareSize();
  const board = useMemo(() => parseFenToBoard(fen), [fen]);
  const validTargets = useMemo(() => {
    if (!selected || !Array.isArray(selected.moves)) return new Set();
    return new Set(selected.moves.map(([r, c]) => `${r},${c}`));
  }, [selected]);

  // ── Derived ──
  const squareStyle = { width: `${squareSize}px`, height: `${squareSize}px` };
  const pieceStyle = { fontSize: `${Math.round(squareSize * 0.62)}px` };
  const displayFiles = flipped ? [...FILES].reverse() : FILES;
  const displayRanks = flipped ? [...RANKS].reverse() : RANKS;

  // ── Render helpers ──
  const renderSquare = (displayRow, displayCol) => {
    // A board flip mirrors BOTH axes, so a1 stays dark and files run h→a.
    const actualRow = flipped ? 7 - displayRow : displayRow;
    const actualCol = flipped ? 7 - displayCol : displayCol;

    const piece = board[actualRow][actualCol];

    const isSelected = selected !== null && selected !== undefined &&
      selected.row === actualRow && selected.col === actualCol;
    const isValidMove = validTargets.has(`${actualRow},${actualCol}`);
    const isLastMove = lastMove !== null && lastMove !== undefined && (
      (lastMove.from[0] === actualRow && lastMove.from[1] === actualCol) ||
      (lastMove.to[0] === actualRow && lastMove.to[1] === actualCol)
    );

    // Square colour follows the ACTUAL square, not the display slot.
    let squareClass = (actualRow + actualCol) % 2 === 0 ? "bg-amber-100" : "bg-amber-700";
    if (isSelected) squareClass = "bg-blue-400 shadow-inner";
    else if (isValidMove) squareClass = "bg-green-400 shadow-inner";
    else if (isLastMove) squareClass = "bg-yellow-300 shadow-inner";

    return (
      <div
        key={`${displayRow}-${displayCol}`}
        style={squareStyle}
        className={`
          flex items-center justify-center
          border border-gray-600 transition-all duration-150
          ${squareClass}
          ${disabled ? 'cursor-default' : 'cursor-pointer hover:brightness-110'}
          ${isValidMove && !disabled ? 'hover:bg-green-500' : ''}
        `}
        onClick={() => { if (!disabled) onSquareClick(actualRow, actualCol); }}
      >
        {isValidMove && !piece && (
          <div className="w-1/4 h-1/4 rounded-full bg-green-600 opacity-60" />
        )}
        {piece && (
          <i
            style={pieceStyle}
            className={`
              fas ${pieceIcons[piece.type]}
              ${piece.color === "white" ? "text-gray-100" : "text-gray-900"}
              drop-shadow-md leading-none
              ${isValidMove ? 'ring-2 ring-red-500 ring-offset-1 rounded-full' : ''}
            `}
          />
        )}
      </div>
    );
  };

  const renderSquares = () => {
    const squares = [];
    for (let displayRow = 0; displayRow < 8; displayRow++) {
      for (let displayCol = 0; displayCol < 8; displayCol++) {
        squares.push(renderSquare(displayRow, displayCol));
      }
    }
    return squares;
  };

  // ── Render ──
  return (
    <div className="flex flex-col select-none">
      <div className="flex">
        {/* Rank labels */}
        <div className="flex flex-col">
          {displayRanks.map((rank) => (
            <div key={rank}
              style={{ height: `${squareSize}px`, width: `${LABEL_GUTTER}px` }}
              className="flex items-center justify-center text-gray-400 text-sm font-semibold">
              {rank}
            </div>
          ))}
        </div>
        {/* Squares */}
        <div className="grid grid-cols-8 gap-0 border-4 border-gray-700 bg-gray-700 rounded-lg shadow-2xl p-1">
          {renderSquares()}
        </div>
      </div>
      {/* File labels */}
      <div className="flex">
        <div style={{ width: `${LABEL_GUTTER}px` }} />
        {displayFiles.map((file) => (
          <div key={file}
            style={{ width: `${squareSize}px` }}
            className="text-center text-gray-400 text-sm font-semibold">
            {file}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ChessBoard;