import { useEffect, useRef, useCallback } from "react";
import { isInCheck, hasValidMoves } from "../utils/chessLogic";
import { PIECES } from "../constants/gameConstants";
import { rowColToIndex, colorToIndex } from "../utils/bitboard";
import { BotPlayer, abortSearch } from '../players/BotPlayer';

export const useColosseumHandlers = (
  gameState,
  config,
  currentRound,
  setCurrentRound,
  colosseumResults,
  setColosseumResults,
  isRunning,
  setIsRunning
) => {
  const {
    boardObj,
    setBoard,
    setLastMove,
    gameOver,
    setGameOver,
    setWinner,
  } = gameState;

  const colosseumBotsRef = useRef({ white: null, black: null });
  const moveTimeoutRef = useRef(null);
  const isProcessingMoveRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const onStopCallbackRef = useRef(null);
  const isInitializedRef = useRef(false);

  const initializeBots = useCallback(() => {
    const swapped = currentRound % 2 === 1;
    const whiteDifficulty = swapped ? config.blackBot : config.whiteBot;
    const blackDifficulty = swapped ? config.whiteBot : config.blackBot;
    
    console.log('[Colosseum] Initializing bots for round', currentRound + 1);
    
    colosseumBotsRef.current.white = new BotPlayer('white', boardObj, whiteDifficulty);
    colosseumBotsRef.current.black = new BotPlayer('black', boardObj, blackDifficulty);
    isInitializedRef.current = true;
  }, [boardObj, config, currentRound]);

  // Check for draw conditions
  const checkForDraw = useCallback((board) => {
    // 50-move rule
    if (board.gameState.half_move_clock >= 100) {
      return { isDraw: true, reason: '50-move rule' };
    }
    
    // Threefold repetition
    const currentZobrist = board.gameState.zobrist_key;
    let count = 1;
    for (let i = 0; i < board.history.states.length; i++) {
      if (board.history.states[i].zobrist_key === currentZobrist) {
        count++;
        if (count >= 3) {
          return { isDraw: true, reason: 'Threefold repetition' };
        }
      }
    }
    
    // Insufficient material
    const whiteIdx = colorToIndex('white');
    const blackIdx = colorToIndex('black');
    
    const hasPawns = board.bbPieces[whiteIdx][PIECES.PAWN].popCount() > 0 ||
                    board.bbPieces[blackIdx][PIECES.PAWN].popCount() > 0;
    const hasQueens = board.bbPieces[whiteIdx][PIECES.QUEEN].popCount() > 0 ||
                     board.bbPieces[blackIdx][PIECES.QUEEN].popCount() > 0;
    const hasRooks = board.bbPieces[whiteIdx][PIECES.ROOK].popCount() > 0 ||
                    board.bbPieces[blackIdx][PIECES.ROOK].popCount() > 0;
    
    if (!hasPawns && !hasQueens && !hasRooks) {
      const whiteMinors = board.bbPieces[whiteIdx][PIECES.BISHOP].popCount() + 
                         board.bbPieces[whiteIdx][PIECES.KNIGHT].popCount();
      const blackMinors = board.bbPieces[blackIdx][PIECES.BISHOP].popCount() + 
                         board.bbPieces[blackIdx][PIECES.KNIGHT].popCount();
      
      if (whiteMinors <= 1 && blackMinors <= 1) {
        return { isDraw: true, reason: 'Insufficient material' };
      }
    }
    
    return { isDraw: false, reason: null };
  }, []);

  const executeMove = useCallback(async () => {
    if (gameOver || stopRequestedRef.current || isProcessingMoveRef.current) {
      return;
    }

    if (!colosseumBotsRef.current.white || !colosseumBotsRef.current.black) {
      return;
    }

    // Check for draw before making a move
    const drawCheck = checkForDraw(boardObj);
    if (drawCheck.isDraw) {
      console.log('[Colosseum] Draw detected:', drawCheck.reason);
      setGameOver(true);
      setWinner('draw');
      return;
    }

    const currentColor = boardObj.gameState.active_color;
    const currentBot = currentColor === 'white' 
      ? colosseumBotsRef.current.white 
      : colosseumBotsRef.current.black;
    
    if (!currentBot) return;

    isProcessingMoveRef.current = true;

    try {
      currentBot.updateBoard(boardObj);
      
      const move = await currentBot.makeMove();
      
      if (move && !stopRequestedRef.current) {
        const fromIndex = rowColToIndex(move.from[0], move.from[1]);
        const toIndex = rowColToIndex(move.to[0], move.to[1]);
        
        const newBoard = boardObj.clone();
        const piece = newBoard.pieceList[fromIndex];
        
        const isPromotion = piece === PIECES.PAWN && 
          ((currentColor === 'white' && move.to[0] === 0) || 
           (currentColor === 'black' && move.to[0] === 7));
        
        if (isPromotion) {
          newBoard.makeMove(fromIndex, toIndex, PIECES.QUEEN);
        } else {
          newBoard.makeMove(fromIndex, toIndex);
        }
        
        setBoard(newBoard);
        setLastMove({ from: move.from, to: move.to });
        
        // Check for draw after move
        const postMoveDrawCheck = checkForDraw(newBoard);
        if (postMoveDrawCheck.isDraw) {
          console.log('[Colosseum] Draw after move:', postMoveDrawCheck.reason);
          setGameOver(true);
          setWinner('draw');
          return;
        }
        
        const nextColor = newBoard.gameState.active_color;
        const opponentInCheck = isInCheck(newBoard, nextColor);
        const opponentHasMoves = hasValidMoves(nextColor, newBoard);
        
        if (!opponentHasMoves) {
          setGameOver(true);
          if (opponentInCheck) {
            setWinner(currentColor);
          } else {
            setWinner('draw');
          }
        }
      }
    } catch (err) {
      console.error('[Colosseum] Bot move error:', err);
    } finally {
      isProcessingMoveRef.current = false;
      
      if (stopRequestedRef.current && onStopCallbackRef.current) {
        onStopCallbackRef.current();
        onStopCallbackRef.current = null;
        stopRequestedRef.current = false;
      }
    }
  }, [boardObj, gameOver, setBoard, setLastMove, setGameOver, setWinner, checkForDraw]);

  useEffect(() => {
    if (config && isRunning) {
      initializeBots();
    }
    
    return () => {
      if (moveTimeoutRef.current) {
        clearTimeout(moveTimeoutRef.current);
        moveTimeoutRef.current = null;
      }
    };
  }, [config, currentRound, isRunning, initializeBots]);

  useEffect(() => {
    if (!isRunning || gameOver || !isInitializedRef.current) {
      return;
    }

    const scheduleMove = () => {
      if (!isProcessingMoveRef.current && !gameOver && isRunning && !stopRequestedRef.current) {
        moveTimeoutRef.current = setTimeout(async () => {
          await executeMove();
          if (isRunning && !gameOver && !stopRequestedRef.current) {
            scheduleMove();
          }
        }, 100);
      }
    };

    scheduleMove();

    return () => {
      if (moveTimeoutRef.current) {
        clearTimeout(moveTimeoutRef.current);
        moveTimeoutRef.current = null;
      }
    };
  }, [boardObj, isRunning, gameOver, executeMove]);

  const stopMatch = useCallback((callback) => {
    console.log('[Colosseum] stopMatch called');
    stopRequestedRef.current = true;
    setIsRunning(false);
    
    // Abort any ongoing search
    abortSearch();
    
    if (moveTimeoutRef.current) {
      clearTimeout(moveTimeoutRef.current);
      moveTimeoutRef.current = null;
    }
    
    if (isProcessingMoveRef.current) {
      onStopCallbackRef.current = callback;
      // Give the search a moment to abort
      setTimeout(() => {
        if (onStopCallbackRef.current) {
          onStopCallbackRef.current();
          onStopCallbackRef.current = null;
        }
        isProcessingMoveRef.current = false;
      }, 500);
    } else {
      if (callback) callback();
    }
  }, [setIsRunning]);

  const cleanup = useCallback(() => {
    console.log('[Colosseum] Final cleanup');
    stopRequestedRef.current = true;
    abortSearch();
    
    if (moveTimeoutRef.current) {
      clearTimeout(moveTimeoutRef.current);
      moveTimeoutRef.current = null;
    }
    colosseumBotsRef.current = { white: null, black: null };
    isProcessingMoveRef.current = false;
    stopRequestedRef.current = false;
    onStopCallbackRef.current = null;
    isInitializedRef.current = false;
  }, []);

  return {
    stopMatch,
    cleanup,
  };
};