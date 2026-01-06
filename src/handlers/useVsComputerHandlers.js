import { useEffect, useRef, useCallback } from "react";
import { getPieceAt } from "../utils/chessUtils";
import { getValidMoves, simulateMove, isInCheck, hasValidMoves } from "../utils/chessLogic";
import { PIECES } from "../constants/gameConstants";
import { rowColToIndex, indexToRowCol } from "../utils/bitboard";
import { HumanPlayer } from '../players/Player';
import { BotPlayer } from '../players/BotPlayer';

export const useVsComputerHandlers = (
  gameState, 
  setSelectedWithMoves, 
  isThinking, 
  setIsThinking,
  playerColor,
  difficulty
) => {
  const {
    boardObj,
    setBoard,
    selected,
    setSelected,
    turn,
    gameOver,
    setGameOver,
    setWinner,
    setLastMove,
    promotion,
    setPromotion,
    resetGame,
  } = gameState;

  const prevSelectedRef = useRef();
  const initialBotMoveDone = useRef(false);
  const mountedRef = useRef(true);
  const gamePlayersRef = useRef({ white: null, black: null, initialized: false });
  const isBotMovingRef = useRef(false);
  const actionBufferRef = useRef(null);

  // Handle selected piece moves calculation
  useEffect(() => {
    if (prevSelectedRef.current === selected) {
      return;
    }
    prevSelectedRef.current = selected;
    
    if (selected) {
      const [row, col] = selected;
      const piece = getPieceAt(boardObj, row, col);
      
      if (piece) {
        const moves = getValidMoves(row, col, boardObj);
        const currentColor = boardObj.gameState.active_color;
        const validMoves = moves.filter(([toRow, toCol]) => {
          const result = simulateMove(row, col, toRow, toCol, boardObj);
          return !isInCheck(result.board, currentColor);
        });
        
        setSelectedWithMoves({
          row,
          col,
          moves: validMoves
        });
      }
    } else {
      setSelectedWithMoves(null);
    }
  }, [selected, boardObj, setSelectedWithMoves]);

  const initializePlayers = useCallback(() => {
    if (playerColor === "white") {
      gamePlayersRef.current.white = new HumanPlayer("white", boardObj);
      gamePlayersRef.current.black = new BotPlayer("black", boardObj, difficulty);
    } else {
      gamePlayersRef.current.white = new BotPlayer("white", boardObj, difficulty);
      gamePlayersRef.current.black = new HumanPlayer("black", boardObj);
    }
    gamePlayersRef.current.initialized = true;
    isBotMovingRef.current = false;
  }, [boardObj, playerColor, difficulty]);

  const resetPlayers = useCallback(() => {
    gamePlayersRef.current = { white: null, black: null, initialized: false };
    isBotMovingRef.current = false;
    actionBufferRef.current = null;
  }, []);

  const cleanup = useCallback(() => {
    mountedRef.current = false;
    resetPlayers();
  }, [resetPlayers]);

  // Initialize players
  useEffect(() => {
    mountedRef.current = true;
    initializePlayers();
    initialBotMoveDone.current = false;
    return () => {
      mountedRef.current = false;
      resetPlayers();
    };
  }, [initializePlayers, resetPlayers]);

  const executeBotMove = useCallback((fromRow, fromCol, toRow, toCol, currentBoard) => {
    if (!mountedRef.current) return;
    
    const piece = getPieceAt(currentBoard, fromRow, fromCol);
    if (!piece) return;

    const currentColor = currentBoard.gameState.active_color;
    const result = simulateMove(fromRow, fromCol, toRow, toCol, currentBoard);

    if (result.needsPromotion) {
      const fromIndex = rowColToIndex(fromRow, fromCol);
      const toIndex = rowColToIndex(toRow, toCol);
      
      const newBoard = currentBoard.clone();
      newBoard.makeMove(fromIndex, toIndex, PIECES.QUEEN);
      
      setBoard(newBoard);
      setLastMove({ from: [fromRow, fromCol], to: [toRow, toCol] });
      setSelected(null);

      const nextTurnColor = newBoard.gameState.active_color;
      const opponentInCheck = isInCheck(newBoard, nextTurnColor);
      const opponentHasMoves = hasValidMoves(nextTurnColor, newBoard);

      if (!opponentHasMoves) {
        setGameOver(true);
        if (opponentInCheck) {
          setWinner(currentColor);
        } else {
          setWinner("draw");
        }
      }
    } else {
      const fromIndex = rowColToIndex(fromRow, fromCol);
      const toIndex = rowColToIndex(toRow, toCol);
      
      const newBoard = currentBoard.clone();
      newBoard.makeMove(fromIndex, toIndex);
      
      setBoard(newBoard);
      setLastMove({ from: [fromRow, fromCol], to: [toRow, toCol] });
      setSelected(null);

      const nextTurnColor = newBoard.gameState.active_color;
      const opponentInCheck = isInCheck(newBoard, nextTurnColor);
      const opponentHasMoves = hasValidMoves(nextTurnColor, newBoard);

      if (!opponentHasMoves) {
        setGameOver(true);
        if (opponentInCheck) {
          setWinner(currentColor);
        } else {
          setWinner("draw");
        }
      }
    }
  }, [setBoard, setLastMove, setSelected, setGameOver, setWinner]);

  const processBotMove = useCallback(async (currentBoard) => {
    if (isBotMovingRef.current || !mountedRef.current) {
      return;
    }
    
    const currentColor = currentBoard.gameState.active_color;
    const computerPlayer = currentColor === "white" 
      ? gamePlayersRef.current.white 
      : gamePlayersRef.current.black;

    if (!computerPlayer || !(computerPlayer instanceof BotPlayer)) {
      return;
    }
    
    if (currentColor === playerColor) {
      return;
    }
    
    isBotMovingRef.current = true;
    setIsThinking(true);
    
    try {
      computerPlayer.updateBoard(currentBoard);
      const move = await computerPlayer.makeMove();
      
      if (move && mountedRef.current) {
        executeBotMove(move.from[0], move.from[1], move.to[0], move.to[1], currentBoard);
      }
    } catch (err) {
      console.error('Bot move error:', err);
    } finally {
      isBotMovingRef.current = false;
      setIsThinking(false);
      
      // Process any buffered actions
      if (actionBufferRef.current && mountedRef.current) {
        const action = actionBufferRef.current;
        actionBufferRef.current = null;
        action();
      }
    }
  }, [playerColor, setIsThinking, executeBotMove]);

  // Make initial bot move if bot plays first
  useEffect(() => {
    if (!gamePlayersRef.current.initialized || gameOver || !mountedRef.current) {
      return;
    }
    
    if (playerColor === "black" && turn === "white" && !initialBotMoveDone.current) {
      initialBotMoveDone.current = true;
      const timer = setTimeout(() => {
        if (mountedRef.current) {
          processBotMove(boardObj);
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [gamePlayersRef.current.initialized, gameOver, playerColor, turn, boardObj, processBotMove]);

  const handlePromotion = useCallback((pieceType) => {
    if (!promotion) return;

    const { fromRow, fromCol, toRow, toCol, board: promotionBoard } = promotion;
    const fromIndex = rowColToIndex(fromRow, fromCol);
    const toIndex = rowColToIndex(toRow, toCol);
    
    const pieceMap = {
      'q': PIECES.QUEEN,
      'r': PIECES.ROOK,
      'b': PIECES.BISHOP,
      'n': PIECES.KNIGHT
    };
    
    const newBoard = promotionBoard.clone();
    newBoard.makeMove(fromIndex, toIndex, pieceMap[pieceType]);

    setBoard(newBoard);
    setSelected(null);
    setPromotion(null);

    const nextTurnColor = newBoard.gameState.active_color;
    const opponentInCheck = isInCheck(newBoard, nextTurnColor);
    const opponentHasMoves = hasValidMoves(nextTurnColor, newBoard);

    if (!opponentHasMoves) {
      setGameOver(true);
      if (opponentInCheck) {
        setWinner(nextTurnColor === "white" ? "black" : "white");
      } else {
        setWinner("draw");
      }
    } else {
      const isPlayerTurn = nextTurnColor === playerColor;
      if (!isPlayerTurn) {
        setTimeout(() => {
          if (mountedRef.current) {
            processBotMove(newBoard);
          }
        }, 500);
      }
    }
  }, [promotion, playerColor, setBoard, setSelected, setPromotion, setGameOver, setWinner, processBotMove]);

  const makeMove = useCallback((fromRow, fromCol, toRow, toCol) => {
    const piece = getPieceAt(boardObj, fromRow, fromCol);
    if (!piece) return;

    const currentColor = boardObj.gameState.active_color;
    const result = simulateMove(fromRow, fromCol, toRow, toCol, boardObj);

    if (result.needsPromotion) {
      setPromotion({
        board: result.board,
        fromRow,
        fromCol,
        toRow,
        toCol,
        color: piece.color === "white" ? "w" : "b"
      });
    } else {
      const fromIndex = rowColToIndex(fromRow, fromCol);
      const toIndex = rowColToIndex(toRow, toCol);
      
      const newBoard = boardObj.clone();
      newBoard.makeMove(fromIndex, toIndex);
      
      setBoard(newBoard);
      setLastMove({ from: [fromRow, fromCol], to: [toRow, toCol] });
      setSelected(null);

      const nextTurnColor = newBoard.gameState.active_color;
      const opponentInCheck = isInCheck(newBoard, nextTurnColor);
      const opponentHasMoves = hasValidMoves(nextTurnColor, newBoard);

      if (!opponentHasMoves) {
        setGameOver(true);
        if (opponentInCheck) {
          setWinner(currentColor);
        } else {
          setWinner("draw");
        }
      } else {
        const isPlayerTurn = nextTurnColor === playerColor;
        if (!isPlayerTurn) {
          setTimeout(() => {
            if (mountedRef.current) {
              processBotMove(newBoard);
            }
          }, 500);
        }
      }
    }
  }, [boardObj, playerColor, setBoard, setLastMove, setSelected, setPromotion, setGameOver, setWinner, processBotMove]);

  const handleSquareClick = useCallback((row, col) => {
    if (gameOver || promotion || isBotMovingRef.current) return;
    
    const piece = getPieceAt(boardObj, row, col);
    const currentColor = boardObj.gameState.active_color;

    if (currentColor !== playerColor) return;

    if (selected) {
      const [selectedRow, selectedCol] = selected;
      const selectedPiece = getPieceAt(boardObj, selectedRow, selectedCol);
      
      if (selectedPiece && selectedPiece.color === currentColor) {
        const moves = getValidMoves(selectedRow, selectedCol, boardObj, true);
        const validMove = moves.find(([r, c]) => r === row && c === col);
        
        if (validMove) {
          const result = simulateMove(selectedRow, selectedCol, row, col, boardObj);
          
          if (!isInCheck(result.board, currentColor)) {
            makeMove(selectedRow, selectedCol, row, col);
            return;
          }
        }
      }
      
      if (piece && piece.color === currentColor) {
        setSelected([row, col]);
      } else {
        setSelected(null);
      }
    } else {
      if (piece && piece.color === currentColor) {
        setSelected([row, col]);
      }
    }
  }, [gameOver, promotion, boardObj, playerColor, selected, setSelected, makeMove]);

  const handleUndo = useCallback(() => {
    if (isBotMovingRef.current) {
      // Buffer the action
      actionBufferRef.current = () => handleUndo();
      return;
    }
    
    if (boardObj.canUndo()) {
      boardObj.undoMove();
      setBoard(boardObj.clone());
      setSelected(null);
      
      const lastMove = boardObj.getLastMove();
      if (lastMove) {
        const fromRowCol = indexToRowCol(lastMove.from);
        const toRowCol = indexToRowCol(lastMove.to);
        setLastMove({ from: fromRowCol, to: toRowCol });
      } else {
        setLastMove(null);
      }
    }
  }, [boardObj, setBoard, setSelected, setLastMove]);

  const handleSurrender = useCallback(() => {
    if (isBotMovingRef.current) {
      actionBufferRef.current = () => handleSurrender();
      return;
    }
    
    const gameWinner = turn === "white" ? "black" : "white";
    setWinner(gameWinner);
    setGameOver(true);
  }, [turn, setWinner, setGameOver]);

  const handleRestart = useCallback(() => {
    initialBotMoveDone.current = false;
    resetGame();
    initializePlayers();
  }, [resetGame, initializePlayers]);

  return {
    handleSquareClick,
    handlePromotion,
    handleUndo,
    handleSurrender,
    handleRestart,
    cleanup,
  };
};