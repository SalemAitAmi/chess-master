/**
 * Piece-Square Tables for positional evaluation
 * 
 * DERIVATION AND PATTERNS:
 * 
 * PAWNS:
 * - Value increases as they advance (passed pawn potential)
 * - Central pawns (d,e files) get bonus for center control
 * - Edge pawns (a,h files) worth less - harder to promote, don't control center
 * - 7th rank pawns highly valued (one step from promotion)
 * - Starting position (rank 2) is neutral baseline
 * 
 * KNIGHTS:
 * - STRONGLY prefer center - knights need central squares for max mobility
 * - Corners are terrible ("knight on the rim is dim")
 * - Outpost squares (e.g., d5, e5 supported by pawn) are excellent
 * - Back rank knights are bad (undeveloped)
 * 
 * BISHOPS:
 * - Like long diagonals (more squares to control)
 * - Edge positions are bad (limited scope)
 * - Slightly prefer to stay off back rank
 * - c4/f4/c5/f5 type squares are good (active without being exposed)
 * 
 * ROOKS:
 * - 7th rank is VERY strong (attacks pawns, restricts king)
 * - Open files preferred (any file without own pawns)
 * - Back rank is okay early (connected rooks) but should activate
 * - Semi-open files give bonus
 * 
 * QUEEN:
 * - Generally should stay safe early game
 * - Central squares good in middlegame
 * - Being on enemy side of board is risky but can be good
 * - Avoid being exposed to minor piece attacks
 * 
 * KING:
 * - MIDDLEGAME: Safety is paramount - stay castled (g1/c1 or g8/c8)
 *   - Pawns in front provide shield value
 *   - Center is DANGEROUS
 * - ENDGAME: Completely opposite - king should CENTRALIZE
 *   - Active king can support pawns, attack enemy pawns
 *   - Corners are bad in endgame (can be trapped)
 * 
 * FINE-TUNING APPROACH:
 * 1. Log evaluation breakdown for each position
 * 2. Identify positions where engine made poor moves
 * 3. Analyze which PST values contributed to the misjudgment
 * 4. Adjust specific squares by 5-15 centipawns
 * 5. Test against baseline with hundreds of games
 * 6. Repeat
 * 
 * Values are in centipawns (100 = 1 pawn)
 */

import logger from '../logging/logger.js';

// Middlegame tables - values from White's perspective (a1 = index 0)
// Tables are stored with a1 at index 0, h8 at index 63
// For Black, we mirror vertically
const PST_MIDDLEGAME = {
  // Pawns: Advance is good, center is better, 7th rank is excellent
  pawn: [
    //  a    b    c    d    e    f    g    h
        0,   0,   0,   0,   0,   0,   0,   0,   // rank 1 (impossible)
      -35,  -1, -20, -23, -15,  24,  38, -22,   // rank 2 (starting)
      -26,  -4,  -4, -10,   3,   3,  33, -12,   // rank 3
      -27,  -2,  -5,  12,  17,   6,  10, -25,   // rank 4
      -14,  13,   6,  21,  23,  12,  17, -23,   // rank 5
       -6,   7,  26,  31,  65,  56,  25, -20,   // rank 6
       98, 134,  61,  95,  68, 126,  34, -11,   // rank 7 (one from promotion!)
        0,   0,   0,   0,   0,   0,   0,   0    // rank 8 (impossible)
  ],
  
  // Knights: Center is king, corners are death
  knight: [
    // a     b     c     d     e     f     g     h
    -105, -21, -58, -33, -17, -28, -19, -23,   // rank 1
     -29, -53, -12,  -3,  -1,  18, -14, -19,   // rank 2
     -23,  -9,  12,  10,  19,  17,  25, -16,   // rank 3
     -13,   4,  16,  13,  28,  19,  21,  -8,   // rank 4
      -9,  17,  19,  53,  37,  69,  18,  22,   // rank 5 (outpost heaven)
     -47,  60,  37,  65,  84, 129,  73,  44,   // rank 6
     -73, -41,  72,  36,  23,  62,   7, -17,   // rank 7
    -167, -89, -34, -49,  61, -97, -15,-107    // rank 8
  ],
  
  // Bishops: Long diagonals good, edges bad
  bishop: [
    //  a    b    c    d    e    f    g    h
     -33,  -3, -14, -21, -13, -12, -39, -21,   // rank 1
       4,  15,  16,   0,   7,  21,  33,   1,   // rank 2
       0,  15,  15,  15,  14,  27,  18,  10,   // rank 3
      -6,  13,  13,  26,  34,  12,  10,   4,   // rank 4
      -4,   5,  19,  50,  37,  37,   7,  -2,   // rank 5
     -16,  37,  43,  40,  35,  50,  37,  -2,   // rank 6
     -26,  16, -18, -13,  30,  59,  18, -47,   // rank 7
     -29,   4, -82, -37, -25, -42,   7,  -8    // rank 8
  ],
  
  // Rooks: 7th rank is gold, open files matter
  rook: [
    //  a    b    c    d    e    f    g    h
     -19, -13,   1,  17,  16,   7, -37, -26,   // rank 1
     -44, -16, -20,  -9,  -1,  11,  -6, -71,   // rank 2
     -45, -25, -16, -17,   3,   0,  -5, -33,   // rank 3
     -36, -26, -12,  -1,   9,  -7,   6, -23,   // rank 4
     -24, -11,   7,  26,  24,  35,  -8, -20,   // rank 5
      -5,  19,  26,  36,  17,  45,  61,  16,   // rank 6
      27,  32,  58,  62,  80,  67,  26,  44,   // rank 7 (very strong!)
      32,  42,  32,  51,  63,   9,  31,  43    // rank 8
  ],
  
  // Queen: Central but safe, don't overextend early
  queen: [
    //  a    b    c    d    e    f    g    h
      -1, -18,  -9,  10, -15, -25, -31, -50,   // rank 1
     -35,  -8,  11,   2,   8,  15,  -3,   1,   // rank 2
     -14,   2, -11,  -2,  -5,   2,  14,   5,   // rank 3
      -9, -26,  -9, -10,  -2,  -4,   3,  -3,   // rank 4
     -27, -27, -16, -16,  -1,  17,  -2,   1,   // rank 5
     -13, -17,   7,   8,  29,  56,  47,  57,   // rank 6
     -24, -39,  -5,   1, -16,  57,  28,  54,   // rank 7
     -28,   0,  29,  12,  59,  44,  43,  45    // rank 8
  ],
  
  // King Middlegame: SAFETY! Stay castled!
  king: [
    //  a    b    c    d    e    f    g    h
      15,  36,  12, -54,   8, -28,  24,  14,   // rank 1 (castled = good)
       1,   7,  -8, -64, -43, -16,   9,   8,   // rank 2
     -14, -14, -22, -46, -44, -30, -15, -27,   // rank 3
     -49,  -1, -27, -39, -46, -44, -33, -51,   // rank 4
     -17, -20, -12, -27, -30, -25, -14, -36,   // rank 5
      -9,  24,   2, -16, -20,   6,  22, -22,   // rank 6
      29,  -1, -20,  -7,  -8,  -4, -38, -29,   // rank 7
     -65,  23,  16, -15, -56, -34,   2,  13    // rank 8 (center = death)
  ]
};

// Endgame tables - king centralizes, passed pawns are gold
const PST_ENDGAME = {
  pawn: [
    //  a    b    c    d    e    f    g    h
        0,   0,   0,   0,   0,   0,   0,   0,   // rank 1
       13,   8,   8,  10,  13,   0,   2,  -7,   // rank 2
        4,   7,  -6,   1,   0,  -5,  -1,  -8,   // rank 3
       13,   9,  -3,  -7,  -7,  -8,   3,  -1,   // rank 4
       32,  24,  13,   5,  -2,   4,  17,  17,   // rank 5
       94, 100,  85,  67,  56,  53,  82,  84,   // rank 6
      178, 173, 158, 134, 147, 132, 165, 187,   // rank 7 (promote soon!)
        0,   0,   0,   0,   0,   0,   0,   0    // rank 8
  ],
  
  knight: [
    // a     b     c     d     e     f     g     h
     -29, -51, -23, -15, -22, -18, -50, -64,   // rank 1
     -42, -20, -10,  -5,  -2, -20, -23, -44,   // rank 2
     -23,  -3,  -1,  15,  10,  -3, -20, -22,   // rank 3
     -18,  -6,  16,  25,  16,  17,   4, -18,   // rank 4
     -17,   3,  22,  22,  22,  11,   8, -18,   // rank 5
     -24, -20,  10,   9,  -1,  -9, -19, -41,   // rank 6
     -25,  -8, -25,  -2,  -9, -25, -24, -52,   // rank 7
     -58, -38, -13, -28, -31, -27, -63, -99    // rank 8
  ],
  
  bishop: [
    //  a    b    c    d    e    f    g    h
     -23,  -9, -23,  -5,  -9, -16,  -5, -17,   // rank 1
     -14, -18,  -7,  -1,   4,  -9, -15, -27,   // rank 2
     -12,  -3,   8,  10,  13,   3,  -7, -15,   // rank 3
      -6,   3,  13,  19,   7,  10,  -3,  -9,   // rank 4
      -3,   9,  12,   9,  14,  10,   3,   2,   // rank 5
       2,  -8,   0,  -1,  -2,   6,   0,   4,   // rank 6
      -8,  -4,   7, -12,  -3, -13,  -4, -14,   // rank 7
     -14, -21, -11,  -8,  -7,  -9, -17, -24    // rank 8
  ],
  
  rook: [
    //  a    b    c    d    e    f    g    h
      -9,   2,   3,  -1,  -5, -13,   4, -20,   // rank 1
      -6,  -6,   0,   2,  -9,  -9, -11,  -3,   // rank 2
      -4,   0,  -5,  -1,  -7, -12,  -8, -16,   // rank 3
       3,   5,   8,   4,  -5,  -6,  -8, -11,   // rank 4
       4,   3,  13,   1,   2,   1,  -1,   2,   // rank 5
       7,   7,   7,   5,   4,  -3,  -5,  -3,   // rank 6
      11,  13,  13,  11,  -3,   3,   8,   3,   // rank 7
      13,  10,  18,  15,  12,  12,   8,   5    // rank 8
  ],
  
  queen: [
    //  a    b    c    d    e    f    g    h
     -33, -28, -22, -43,  -5, -32, -20, -41,   // rank 1
     -22, -23, -30, -16, -16, -23, -36, -32,   // rank 2
     -16, -27,  15,   6,   9,  17,  10,   5,   // rank 3
     -18,  28,  19,  47,  31,  34,  39,  23,   // rank 4
       3,  22,  24,  45,  57,  40,  57,  36,   // rank 5
     -20,   6,   9,  49,  47,  35,  19,   9,   // rank 6
     -17,  20,  32,  41,  58,  25,  30,   0,   // rank 7
      -9,  22,  22,  27,  27,  19,  10,  20    // rank 8
  ],
  
  // King Endgame: CENTRALIZE! Active king wins
  king: [
    //  a    b    c    d    e    f    g    h
     -53, -34, -21, -11, -28, -14, -24, -43,   // rank 1
     -27, -11,   4,  13,  14,   4,  -5, -17,   // rank 2
     -19,  -3,  11,  21,  23,  16,   7,  -9,   // rank 3
     -18,  -4,  21,  24,  27,  23,   9, -11,   // rank 4 (center is GOOD!)
      -8,  22,  24,  27,  26,  33,  26,   3,   // rank 5
      10,  17,  23,  15,  20,  45,  44,  13,   // rank 6
     -12,  17,  14,  17,  17,  38,  23,  11,   // rank 7
     -74, -35, -18, -18, -11,  15,   4, -17    // rank 8
  ]
};

/**
 * Mirror a square index for black pieces
 * White sees board with rank 1 at bottom; flip for black
 */
export function mirrorSquare(square) {
  // Flip vertically: XOR with 56 swaps ranks 1<->8, 2<->7, etc.
  return square ^ 56;
}

/**
 * Get piece name for table lookup
 */
function getPieceName(pieceType) {
  const names = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];
  return names[pieceType];
}

/**
 * Get PST value for a piece at a square
 * @param {number} pieceType - Piece type (0=King, 1=Queen, 2=Rook, 3=Bishop, 4=Knight, 5=Pawn)
 * @param {number} square - Square index (0-63, a1=0, h8=63)
 * @param {boolean} isWhite - True for white pieces
 * @param {number} phase - Game phase (0=endgame, 1=middlegame)
 * @returns {number} PST value in centipawns
 */
export function getPSTValue(pieceType, square, isWhite, phase = 1) {
  const pieceName = getPieceName(pieceType);
  
  if (!pieceName || !PST_MIDDLEGAME[pieceName]) {
    logger.heuristics('warn', { pieceType, square }, 'Unknown piece type for PST');
    return 0;
  }
  
  // For white, we use the square directly
  // For black, we mirror the square (flip board)
  const sq = isWhite ? square : mirrorSquare(square);
  
  // Clamp phase to [0, 1]
  const clampedPhase = Math.max(0, Math.min(1, phase));
  
  // Interpolate between middlegame and endgame values
  const mgValue = PST_MIDDLEGAME[pieceName][sq] || 0;
  const egValue = PST_ENDGAME[pieceName][sq] || 0;
  
  const value = Math.round(mgValue * clampedPhase + egValue * (1 - clampedPhase));
  
  logger.heuristics('trace', {
    pieceType,
    pieceName,
    square,
    isWhite,
    phase: clampedPhase.toFixed(2),
    mgValue,
    egValue,
    interpolatedValue: value
  }, `PST ${pieceName} on ${squareToName(square)}: ${value}`);
  
  return value;
}

/**
 * Helper to convert square index to algebraic notation for logging
 */
function squareToName(square) {
  const file = String.fromCharCode('a'.charCodeAt(0) + (square % 8));
  const rank = Math.floor(square / 8) + 1;
  return `${file}${rank}`;
}

/**
 * Calculate total PST bonus for a position
 * @param {Board} board - Board to evaluate
 * @param {string} color - Color to evaluate for
 * @param {number} phase - Game phase (0=endgame, 1=middlegame)
 * @returns {number} PST score in centipawns
 */
export function calculatePSTScore(board, color, phase = 1) {
  const colorIdx = color === 'white' ? 0 : 1;
  const oppositeColorIdx = 1 - colorIdx;
  const isWhite = color === 'white';
  
  let score = 0;
  const breakdown = {};
  
  // For each piece type
  for (let pieceType = 0; pieceType <= 5; pieceType++) {
    const pieceName = getPieceName(pieceType);
    let pieceScore = 0;
    const positions = [];
    
    // Our pieces (positive)
    const ourPieces = board.bbPieces[colorIdx][pieceType].clone();
    while (!ourPieces.isEmpty()) {
      const sq = ourPieces.popLSB();
      const pstValue = getPSTValue(pieceType, sq, isWhite, phase);
      pieceScore += pstValue;
      positions.push({ square: squareToName(sq), value: pstValue, side: 'ours' });
    }
    
    // Their pieces (negative)
    const theirPieces = board.bbPieces[oppositeColorIdx][pieceType].clone();
    while (!theirPieces.isEmpty()) {
      const sq = theirPieces.popLSB();
      const pstValue = getPSTValue(pieceType, sq, !isWhite, phase);
      pieceScore -= pstValue;
      positions.push({ square: squareToName(sq), value: -pstValue, side: 'theirs' });
    }
    
    score += pieceScore;
    if (positions.length > 0) {
      breakdown[pieceName] = { total: pieceScore, positions };
    }
  }
  
  logger.heuristics('debug', {
    color,
    phase: phase.toFixed(2),
    totalPST: score,
    breakdown
  }, `PST evaluation: ${score}`);
  
  return score;
}

export default {
  getPSTValue,
  calculatePSTScore,
  mirrorSquare,
  PST_MIDDLEGAME,
  PST_ENDGAME
};