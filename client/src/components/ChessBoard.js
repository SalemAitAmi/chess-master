import React, { useMemo, useState, useEffect } from 'react';
import { pieceIcons } from "../constants/gameConstants";
import { parseFenToBoard } from "../utils/chessUtils";

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];
const SQUARE_MIN = 40;
const SQUARE_MAX = 64;
const LABEL_GUTTER = 32;
/** Inner padding of the square grid (Tailwind p-1). The arrow overlay offsets by it. */
const GRID_PAD = 4;
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
/**
 * Presentational board.
 *
 * Decorations (all optional, all inert — the board never interprets them):
 *   marks   { [square]: { bg?: tailwindClass, dot?: {color, size 0..1}, label?: string,
 *                         labelColor?: string, ring?: cssColor } }
 *   arrows  [{ from, to, color, width?, opacity?, label? }]   drawn in an SVG overlay
 * Both are used by the Sandbox to encode candidate moves, lines and lenses
 * directly on the squares instead of in a side tree.
 */
const ChessBoard = ({
  fen,
  selected,
  legalMoves = [],
  lastMove,
  onSquareClick,
  flipped = false,
  disabled = false,
  marks = null,
  arrows = null,
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

  /** Pixel centre of a square inside the overlay SVG (display orientation). */
  const centerOf = (sq) => {
    const col = FILES.indexOf(sq[0]);
    const row = RANKS.indexOf(sq[1]);
    if (col < 0 || row < 0) return null;
    const dc = flipped ? 7 - col : col;
    const dr = flipped ? 7 - row : row;
    return [dc * squareSize + squareSize / 2, dr * squareSize + squareSize / 2];
  };

  // ── Render helpers ──
  const renderSquare = (displayRow, displayCol) => {
    // A board flip mirrors BOTH axes, so a1 stays dark and files run h→a.
    const actualRow = flipped ? 7 - displayRow : displayRow;
    const actualCol = flipped ? 7 - displayCol : displayCol;
    const piece = board[actualRow][actualCol];
    const mark = marks !== null ? marks[FILES[actualCol] + RANKS[actualRow]] : undefined;
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
    else if (mark && mark.bg) squareClass = mark.bg;
    else if (isLastMove) squareClass = "bg-yellow-300 shadow-inner";
    const style = mark && mark.ring ? { ...squareStyle, boxShadow: `inset 0 0 0 3px ${mark.ring}` } : squareStyle;
    return (
      <div
        key={`${displayRow}-${displayCol}`}
        style={style}
        className={`
          relative flex items-center justify-center
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
        {mark && mark.dot && (
          <div className="absolute rounded-full pointer-events-none"
            style={{
              width: `${Math.round(squareSize * mark.dot.size)}px`,
              height: `${Math.round(squareSize * mark.dot.size)}px`,
              left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
              background: mark.dot.color, opacity: 0.8,
            }} />
        )}
        {piece && (
          <i
            style={pieceStyle}
            className={`
              relative fas ${pieceIcons[piece.type]}
              ${piece.color === "white" ? "text-gray-100" : "text-gray-900"}
              drop-shadow-md leading-none
              ${isValidMove ? 'ring-2 ring-red-500 ring-offset-1 rounded-full' : ''}
            `}
          />
        )}
        {mark && mark.label && (
          <span className="absolute top-0 left-0.5 text-[10px] font-bold leading-none pointer-events-none"
            style={{ color: mark.labelColor ?? '#f9fafb', textShadow: '0 0 3px #000, 0 0 3px #000' }}>
            {mark.label}
          </span>
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

  const renderArrows = () => {
    if (!arrows || arrows.length === 0) return null;
    const side = squareSize * 8;
    return (
      <svg className="absolute pointer-events-none" style={{ left: GRID_PAD, top: GRID_PAD, width: side, height: side }}>
        {arrows.map((a, i) => {
          const p = centerOf(a.from), q = centerOf(a.to);
          if (!p || !q) return null;
          const dx = q[0] - p[0], dy = q[1] - p[1];
          const len = Math.hypot(dx, dy);
          if (len < 1) return null;
          const ux = dx / len, uy = dy / len, lx = -uy, ly = ux;
          const w = a.width ?? 5, head = w * 2.4;
          const sx = p[0] + ux * squareSize * 0.28, sy = p[1] + uy * squareSize * 0.28;
          const ex = q[0] - ux * head * 0.9, ey = q[1] - uy * head * 0.9;
          return (
            <g key={i} opacity={a.opacity ?? 0.9}>
              <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={a.color} strokeWidth={w} strokeLinecap="round" />
              <polygon fill={a.color}
                points={`${q[0]},${q[1]} ${ex + lx * head * 0.6},${ey + ly * head * 0.6} ${ex - lx * head * 0.6},${ey - ly * head * 0.6}`} />
              {a.label && (
                <>
                  <circle cx={p[0]} cy={p[1]} r={squareSize * 0.17} fill={a.color} />
                  <text x={p[0]} y={p[1]} textAnchor="middle" dominantBaseline="central"
                    fontSize={squareSize * 0.22} fontWeight="700" fill="#111827">{a.label}</text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    );
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
        {/* Squares (+ overlay) */}
        <div className="relative grid grid-cols-8 gap-0 border-4 border-gray-700 bg-gray-700 rounded-lg shadow-2xl p-1">
          {renderSquares()}
          {renderArrows()}
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