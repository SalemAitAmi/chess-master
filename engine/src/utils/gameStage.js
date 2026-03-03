/**
 * Game stage detection and management
 */

import { PIECES } from '../core/constants.js';
import { colorToIndex } from '../core/bitboard.js';
import { GAME_STAGE } from '../logging/categories.js';

/**
 * Thresholds for stage detection
 */
const STAGE_CONFIG = {
  openingEndMove: 20,
  earlyMiddleEndMove: 40,
  middleEndMove: 70,
  lateMiddleEndMove: 100,
  endgameMaterialThreshold: 13,
  
  phaseWeights: {
    [PIECES.QUEEN]: 4,
    [PIECES.ROOK]: 2,
    [PIECES.BISHOP]: 1,
    [PIECES.KNIGHT]: 1
  }
};

const PIECE_NAMES = {
  [PIECES.KING]: 'king',
  [PIECES.QUEEN]: 'queen',
  [PIECES.ROOK]: 'rook',
  [PIECES.BISHOP]: 'bishop',
  [PIECES.KNIGHT]: 'knight',
  [PIECES.PAWN]: 'pawn'
};

export function calculateMaterialPhase(board) {
  const whiteIdx = colorToIndex('white');
  const blackIdx = colorToIndex('black');
  
  let phase = 0;
  const pieceCounts = {};
  
  for (const [pieceType, weight] of Object.entries(STAGE_CONFIG.phaseWeights)) {
    const piece = parseInt(pieceType);
    const whiteCount = board.bbPieces[whiteIdx][piece].popCount();
    const blackCount = board.bbPieces[blackIdx][piece].popCount();
    const total = whiteCount + blackCount;
    
    phase += total * weight;
    pieceCounts[PIECE_NAMES[piece]] = { white: whiteCount, black: blackCount, total };
  }
  
  return { phase, maxPhase: 24, pieceCounts };
}

export function detectGameStage(board) {
  const moveCount = board.moveHistory?.length || 0;
  const fullMoveNumber = Math.floor(moveCount / 2) + 1;
  const { phase, maxPhase, pieceCounts } = calculateMaterialPhase(board);
  
  const phasePercent = phase / maxPhase;
  
  let stage;
  let stageReasons = [];
  let priorities = [];
  
  if (phase <= STAGE_CONFIG.endgameMaterialThreshold) {
    stage = GAME_STAGE.ENDGAME;
    stageReasons.push(`Low material (phase ${phase}/${maxPhase})`);
    priorities = [
      'King activation',
      'Pawn promotion',
      'Piece coordination',
      'Opposition and key squares'
    ];
  } else if (moveCount <= STAGE_CONFIG.openingEndMove) {
    stage = GAME_STAGE.OPENING;
    stageReasons.push(`Move ${fullMoveNumber} (opening phase)`);
    priorities = [
      'Control center with pawns',
      'Develop knights before bishops',
      'Castle early for king safety',
      'Connect rooks',
      'Avoid moving same piece twice',
      'Avoid early queen development'
    ];
  } else if (moveCount <= STAGE_CONFIG.earlyMiddleEndMove) {
    stage = GAME_STAGE.EARLY_MIDDLE;
    stageReasons.push(`Move ${fullMoveNumber} (early middlegame)`);
    priorities = [
      'Complete development',
      'Improve piece placement',
      'Create pawn structure',
      'Identify targets',
      'Coordinate pieces'
    ];
  } else if (moveCount <= STAGE_CONFIG.middleEndMove) {
    stage = GAME_STAGE.MIDDLE;
    stageReasons.push(`Move ${fullMoveNumber} (middlegame)`);
    priorities = [
      'Execute plans',
      'Attack weaknesses',
      'Improve worst placed piece',
      'Control open files',
      'Create threats'
    ];
  } else if (moveCount <= STAGE_CONFIG.lateMiddleEndMove) {
    stage = GAME_STAGE.LATE_MIDDLE;
    stageReasons.push(`Move ${fullMoveNumber} (late middlegame)`);
    priorities = [
      'Simplify if ahead',
      'Avoid simplification if behind',
      'Transition to favorable endgame',
      'Activate king if safe',
      'Create passed pawns'
    ];
  } else {
    stage = GAME_STAGE.ENDGAME;
    stageReasons.push(`Move ${fullMoveNumber} (endgame by move count)`);
    priorities = [
      'King activation',
      'Pawn promotion',
      'Piece coordination'
    ];
  }
  
  if (phasePercent < 0.5 && stage !== GAME_STAGE.ENDGAME) {
    stageReasons.push(`Material suggests late stage (${(phasePercent * 100).toFixed(0)}%)`);
  }
  
  return {
    stage,
    fullMoveNumber,
    halfMoveCount: moveCount,
    materialPhase: phase,
    maxMaterialPhase: maxPhase,
    phasePercent,
    pieceCounts,
    stageReasons,
    priorities,
    config: STAGE_CONFIG
  };
}

export function getStageWeights(stage) {
  const weights = {
    [GAME_STAGE.OPENING]: {
      material: 1.0,
      centerControl: 1.3,
      development: 1.5,
      pawnStructure: 0.8,
      kingSafety: 1.2,
      pst: 1.0,
      mobility: 0.7
    },
    [GAME_STAGE.EARLY_MIDDLE]: {
      material: 1.0,
      centerControl: 1.2,
      development: 1.0,
      pawnStructure: 1.0,
      kingSafety: 1.1,
      pst: 1.0,
      mobility: 1.0
    },
    [GAME_STAGE.MIDDLE]: {
      material: 1.0,
      centerControl: 1.0,
      development: 0.5,
      pawnStructure: 1.1,
      kingSafety: 1.0,
      pst: 1.0,
      mobility: 1.2
    },
    [GAME_STAGE.LATE_MIDDLE]: {
      material: 1.1,
      centerControl: 0.9,
      development: 0.2,
      pawnStructure: 1.2,
      kingSafety: 0.9,
      pst: 1.0,
      mobility: 1.1
    },
    [GAME_STAGE.ENDGAME]: {
      material: 1.2,
      centerControl: 0.6,
      development: 0.0,
      pawnStructure: 1.3,
      kingSafety: 0.3,
      pst: 1.0,
      mobility: 1.0
    }
  };
  
  return weights[stage] || weights[GAME_STAGE.MIDDLE];
}

export function checkOpeningPrinciples(board, move, color) {
  const violations = [];
  const bonuses = [];
  const moveCount = board.moveHistory?.length || 0;
  const colorIdx = colorToIndex(color);
  
  if (moveCount > 20) {
    return { violations: [], bonuses: [], isOpening: false, totalPenalty: 0, totalBonus: 0 };
  }
  
  // Check 1: Moving same piece twice
  if (moveCount >= 2 && move.capturedPiece === null) {
    const lastMoves = board.moveHistory.slice(-4);
    for (let i = lastMoves.length - 2; i >= 0; i -= 2) {
      const prevMove = lastMoves[i];
      if (prevMove && prevMove.to === move.fromSquare) {
        violations.push({
          principle: 'SAME_PIECE_TWICE',
          description: 'Moving the same piece twice in the opening',
          severity: 'medium',
          penalty: -15
        });
        break;
      }
    }
  }
  
  // Check 2: Early queen development
  if (move.piece === PIECES.QUEEN && moveCount < 12) {
    let undevelopedMinors = 0;
    const knightStarts = color === 'white' ? [1, 6] : [57, 62];
    const bishopStarts = color === 'white' ? [2, 5] : [58, 61];
    
    for (const sq of knightStarts) {
      if (board.bbPieces[colorIdx][PIECES.KNIGHT].getBit(sq)) {
        undevelopedMinors++;
      }
    }
    for (const sq of bishopStarts) {
      if (board.bbPieces[colorIdx][PIECES.BISHOP].getBit(sq)) {
        undevelopedMinors++;
      }
    }
    
    if (undevelopedMinors >= 2) {
      violations.push({
        principle: 'EARLY_QUEEN',
        description: `Queen out with ${undevelopedMinors} undeveloped minor pieces`,
        severity: 'high',
        penalty: -30
      });
    }
  }
  
  // Check 3: Moving edge pawns before center
  if (move.piece === PIECES.PAWN && moveCount < 8) {
    const fromFile = move.from[1];
    if (fromFile === 0 || fromFile === 7) {
      const dPawn = color === 'white' ? 11 : 51;
      const ePawn = color === 'white' ? 12 : 52;
      const dPawnHome = board.bbPieces[colorIdx][PIECES.PAWN].getBit(dPawn);
      const ePawnHome = board.bbPieces[colorIdx][PIECES.PAWN].getBit(ePawn);
      
      if (dPawnHome && ePawnHome) {
        violations.push({
          principle: 'EDGE_PAWN_EARLY',
          description: 'Moving edge pawn before central pawns',
          severity: 'low',
          penalty: -10
        });
      }
    }
  }
  
  // Bonus 1: Central pawn moves
  if (move.piece === PIECES.PAWN) {
    const toFile = move.to[1];
    const toRank = move.to[0];
    if ((toFile === 3 || toFile === 4) && (toRank === 3 || toRank === 4)) {
      bonuses.push({
        principle: 'CENTRAL_PAWN',
        description: 'Central pawn to good square',
        bonus: 10
      });
    }
  }
  
  // Bonus 2: Knight to good square
  if (move.piece === PIECES.KNIGHT) {
    const [toRow, toCol] = move.to;
    if (toCol >= 2 && toCol <= 5 && toRow >= 2 && toRow <= 5) {
      bonuses.push({
        principle: 'KNIGHT_DEVELOPMENT',
        description: 'Knight to central square',
        bonus: 8
      });
    }
    const classicSquares = color === 'white' 
      ? [[5, 2], [5, 5]]
      : [[2, 2], [2, 5]];
    if (classicSquares.some(([r, c]) => r === toRow && c === toCol)) {
      bonuses.push({
        principle: 'CLASSIC_KNIGHT_SQUARE',
        description: 'Knight to classic development square',
        bonus: 5
      });
    }
  }
  
  // Bonus 3: Bishop on long diagonal
  if (move.piece === PIECES.BISHOP) {
    const [toRow, toCol] = move.to;
    if ((toRow + toCol === 7) || (toRow === toCol)) {
      bonuses.push({
        principle: 'BISHOP_LONG_DIAGONAL',
        description: 'Bishop on long diagonal',
        bonus: 8
      });
    }
  }
  
  // Bonus 4: Castling
  if (move.piece === PIECES.KING) {
    const fileDiff = Math.abs(move.to[1] - move.from[1]);
    if (fileDiff === 2) {
      bonuses.push({
        principle: 'CASTLING',
        description: 'Castling for king safety',
        bonus: 25
      });
    }
  }
  
  return {
    violations,
    bonuses,
    isOpening: true,
    totalPenalty: violations.reduce((sum, v) => sum + v.penalty, 0),
    totalBonus: bonuses.reduce((sum, b) => sum + b.bonus, 0)
  };
}

export { GAME_STAGE };

export default {
  detectGameStage,
  getStageWeights,
  checkOpeningPrinciples,
  calculateMaterialPhase,
  GAME_STAGE
};