import { useEffect, useRef, useCallback } from "react";
import { isInCheck, hasValidMoves } from "../utils/chessLogic";
import { PIECES } from "../constants/gameConstants";
import { rowColToIndex } from "../utils/bitboard";
import { BotPlayer } from '../players/BotPlayer';

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
    console.log('[Colosseum] White bot difficulty:', whiteDifficulty);
    console.log('[Colosseum] Black bot difficulty:', blackDifficulty);
    
    colosseumBotsRef.current.white = new BotPlayer('white', boardObj, whiteDifficulty);
    colosseumBotsRef.current.black = new BotPlayer('black', boardObj, blackDifficulty);
    isInitializedRef.current = true;
    
    console.log('[Colosseum] Bots initialized');
  }, [boardObj, config, currentRound]);

  const executeMove = useCallback(async () => {
    console.log('[Colosseum] executeMove called');

    if (gameOver || stopRequestedRef.current || isProcessingMoveRef.current) {
      console.log('[Colosseum] executeMove blocked by conditions');
      return;
    }

    if (!colosseumBotsRef.current.white || !colosseumBotsRef.current.black) {
      console.log('[Colosseum] Bots not initialized!');
      return;
    }

    const currentColor = boardObj.gameState.active_color;
    const currentBot = currentColor === 'white' 
      ? colosseumBotsRef.current.white 
      : colosseumBotsRef.current.black;
    
    console.log('[Colosseum] Current turn:', currentColor);
    
    if (!currentBot) {
      console.log('[Colosseum] No bot for current color!');
      return;
    }

    isProcessingMoveRef.current = true;

    try {
      currentBot.updateBoard(boardObj);
      
      console.log('[Colosseum] Requesting move from bot...');
      const move = await currentBot.makeMove();
      console.log('[Colosseum] Bot returned move:', move);
      
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
        
        const nextColor = newBoard.gameState.active_color;
        const opponentInCheck = isInCheck(newBoard, nextColor);
        const opponentHasMoves = hasValidMoves(nextColor, newBoard);
        
        if (!opponentHasMoves) {
          console.log('[Colosseum] Game over detected');
          setGameOver(true);
          if (opponentInCheck) {
            setWinner(currentColor);
          } else {
            setWinner("draw");
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
  }, [boardObj, gameOver, setBoard, setLastMove, setGameOver, setWinner]);

  // Initialize bots when config changes or round changes
  useEffect(() => {
    if (config && isRunning) {
      initializeBots();
    }
    
    return () => {
      // Cleanup on unmount
      if (moveTimeoutRef.current) {
        clearTimeout(moveTimeoutRef.current);
        moveTimeoutRef.current = null;
      }
    };
  }, [config, currentRound, isRunning, initializeBots]);

  // Execute moves continuously while game is running
  useEffect(() => {
    if (!isRunning || gameOver || !isInitializedRef.current) {
      return;
    }

    // Schedule move execution
    const scheduleMove = () => {
      if (!isProcessingMoveRef.current && !gameOver && isRunning) {
        moveTimeoutRef.current = setTimeout(async () => {
          await executeMove();
          // Schedule next move after current one completes
          if (isRunning && !gameOver) {
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
    
    if (isProcessingMoveRef.current) {
      onStopCallbackRef.current = callback;
    } else {
      if (moveTimeoutRef.current) {
        clearTimeout(moveTimeoutRef.current);
        moveTimeoutRef.current = null;
      }
      if (callback) callback();
    }
  }, [setIsRunning]);

  const cleanup = useCallback(() => {
    console.log('[Colosseum] Final cleanup');
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