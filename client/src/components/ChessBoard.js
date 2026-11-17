/**
 * Presentational chess board that FILLS its container.
 *
 * SIZING. The root is a `flex-1` item: it takes its size from the parent slot
 * (a `flex` container with a definite size), measures itself, and renders the
 * largest square that fits both dimensions. The board content never feeds
 * back into the root's size, so there is no resize loop.
 *
 * DECORATIONS (optional, inert — the board never interprets them):
 *   marks   { [square]: { bg?: tailwindClass, dot?: {color, size 0..1}, label?: string,
 *                         labelColor?: string, ring?: cssColor } }
 *   arrows  [{ from, to, color, width?, opacity?, label? }]   SVG overlay
 * The Sandbox uses both to encode candidate moves, lines and lenses directly
 * on the squares instead of in a side tree.
 */
import { useMemo } from 'react';
import { pieceIcons } from '../constants/gameConstants';
import { parseFenToBoard } from '../utils/chessUtils';
import { useElementSize } from '../hooks/useElementSize';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

// ── Geometry (px) ──
const RANK_GUTTER = 24;              // rank labels, left of the grid
const FILE_ROW = 20;                 // file labels, under the grid (h-5)
const GRID_PAD = 4;                  // p-1 inside the frame; the arrow overlay offsets by it
const FRAME = 2 * (4 + GRID_PAD);    // border-4 + p-1, both sides
const SQUARE_MIN = 20;
const SQUARE_MAX = 112;

/** Largest square for which the framed, labelled board fits w×h. 0 = not measured yet. */
function fitSquare(w, h) {
  if (w <= 0 || h <= 0) return 0;
  const s = Math.floor(Math.min(w - RANK_GUTTER - FRAME, h - FILE_ROW - FRAME) / 8);
  return Math.max(SQUARE_MIN, Math.min(SQUARE_MAX, s));
}

// ═══════════════════════════════════════════════════════════════════════════
// Arrow overlay
// ═══════════════════════════════════════════════════════════════════════════

/** One shaft + head per arrow; an optional numbered disc marks the tail. */
const ArrowOverlay = ({ arrows, square, centerOf }) => {
  const side = square * 8;
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
        // Shaft starts just off the centre so the tail disc stays readable and
        // ends where the head begins.
        const sx = p[0] + ux * square * 0.28, sy = p[1] + uy * square * 0.28;
        const ex = q[0] - ux * head * 0.9, ey = q[1] - uy * head * 0.9;
        return (
          <g key={i} opacity={a.opacity ?? 0.9}>
            <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={a.color} strokeWidth={w} strokeLinecap="round" />
            <polygon fill={a.color}
              points={`${q[0]},${q[1]} ${ex + lx * head * 0.6},${ey + ly * head * 0.6} ${ex - lx * head * 0.6},${ey - ly * head * 0.6}`} />
            {a.label && (
              <>
                <circle cx={p[0]} cy={p[1]} r={square * 0.17} fill={a.color} />
                <text x={p[0]} y={p[1]} textAnchor="middle" dominantBaseline="central"
                  fontSize={square * 0.22} fontWeight="700" fill="#111827">{a.label}</text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Board
// ═══════════════════════════════════════════════════════════════════════════

const ChessBoard = ({
  fen,
  selected = null,
  lastMove = null,
  onSquareClick,
  flipped = false,
  disabled = false,
  marks = null,
  arrows = null,
}) => {
  // ── Hooks ──
  const [boxRef, box] = useElementSize();
  const board = useMemo(() => parseFenToBoard(fen), [fen]);
  const validTargets = useMemo(() => {
    if (!selected || !Array.isArray(selected.moves)) return new Set();
    return new Set(selected.moves.map(([r, c]) => `${r},${c}`));
  }, [selected]);

  // ── Derived ──
  const square = fitSquare(box.width, box.height);
  const squareStyle = { width: square, height: square };
  const pieceStyle = { fontSize: Math.round(square * 0.62) };
  const labelSize = Math.max(10, Math.round(square * 0.17));
  const displayFiles = flipped ? [...FILES].reverse() : FILES;
  const displayRanks = flipped ? [...RANKS].reverse() : RANKS;

  /** Pixel centre of a square inside the overlay (display orientation). */
  const centerOf = (sq) => {
    const col = FILES.indexOf(sq[0]);
    const row = RANKS.indexOf(sq[1]);
    if (col < 0 || row < 0) return null;
    const dc = flipped ? 7 - col : col;
    const dr = flipped ? 7 - row : row;
    return [dc * square + square / 2, dr * square + square / 2];
  };

  // ── Render helpers ──
  const renderSquare = (displayRow, displayCol) => {
    // A flip mirrors BOTH axes, so a1 stays dark and files run h→a.
    const row = flipped ? 7 - displayRow : displayRow;
    const col = flipped ? 7 - displayCol : displayCol;
    const piece = board[row][col];
    const mark = marks !== null ? marks[FILES[col] + RANKS[row]] : undefined;
    const isSelected = selected !== null && selected.row === row && selected.col === col;
    const isTarget = validTargets.has(`${row},${col}`);
    const isLastMove = lastMove !== null && (
      (lastMove.from[0] === row && lastMove.from[1] === col) ||
      (lastMove.to[0] === row && lastMove.to[1] === col)
    );

    // Colour follows the ACTUAL square, not the display slot. Precedence:
    // selection > legal target > decoration > last move > base colour.
    let squareClass = (row + col) % 2 === 0 ? 'bg-amber-100' : 'bg-amber-700';
    if (isSelected) squareClass = 'bg-blue-400 shadow-inner';
    else if (isTarget) squareClass = 'bg-green-400 shadow-inner';
    else if (mark && mark.bg) squareClass = mark.bg;
    else if (isLastMove) squareClass = 'bg-yellow-300 shadow-inner';

    const style = mark && mark.ring ? { ...squareStyle, boxShadow: `inset 0 0 0 3px ${mark.ring}` } : squareStyle;

    return (
      <div key={`${displayRow}-${displayCol}`} style={style}
        className={`relative flex items-center justify-center border border-gray-600 transition-all duration-150 ${squareClass}
          ${disabled ? 'cursor-default' : 'cursor-pointer hover:brightness-110'}
          ${isTarget && !disabled ? 'hover:bg-green-500' : ''}`}
        onClick={() => { if (!disabled) onSquareClick(row, col); }}>
        {/* Legal-move dot on an empty target */}
        {isTarget && !piece && <div className="w-1/4 h-1/4 rounded-full bg-green-600 opacity-60" />}

        {/* Decoration dot (Sandbox lenses) */}
        {mark && mark.dot && (
          <div className="absolute rounded-full pointer-events-none"
            style={{
              width: Math.round(square * mark.dot.size), height: Math.round(square * mark.dot.size),
              left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
              background: mark.dot.color, opacity: 0.8,
            }} />
        )}

        {/* Piece */}
        {piece && (
          <i style={pieceStyle}
            className={`relative fas ${pieceIcons[piece.type]} ${piece.color === 'white' ? 'text-gray-100' : 'text-gray-900'}
              drop-shadow-md leading-none ${isTarget ? 'ring-2 ring-red-500 ring-offset-1 rounded-full' : ''}`} />
        )}

        {/* Decoration label (top-left corner) */}
        {mark && mark.label && (
          <span className="absolute top-0 left-0.5 font-bold leading-none pointer-events-none"
            style={{ fontSize: labelSize, color: mark.labelColor ?? '#f9fafb', textShadow: '0 0 3px #000, 0 0 3px #000' }}>
            {mark.label}
          </span>
        )}
      </div>
    );
  };

  // ── Render ──
  return (
    <div ref={boxRef} className="flex-1 min-w-0 min-h-0 overflow-hidden flex items-center justify-center select-none">
      {square > 0 && (
        <div className="flex flex-col">
          <div className="flex">
            {/* Rank labels */}
            <div className="flex flex-col justify-center">
              {displayRanks.map(rank => (
                <div key={rank} style={{ height: square, width: RANK_GUTTER }}
                  className="flex items-center justify-center text-gray-400 text-sm font-semibold">{rank}</div>
              ))}
            </div>
            {/* Squares + arrow overlay */}
            <div className="relative grid grid-cols-8 border-4 border-gray-700 bg-gray-700 rounded-lg shadow-2xl p-1">
              {Array.from({ length: 64 }, (_, i) => renderSquare(i >> 3, i & 7))}
              {arrows && arrows.length > 0 && <ArrowOverlay arrows={arrows} square={square} centerOf={centerOf} />}
            </div>
          </div>
          {/* File labels */}
          <div className="flex h-5 leading-5" style={{ paddingLeft: RANK_GUTTER + FRAME / 2 }}>
            {displayFiles.map(file => (
              <div key={file} style={{ width: square }} className="text-center text-gray-400 text-sm font-semibold">{file}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ChessBoard;