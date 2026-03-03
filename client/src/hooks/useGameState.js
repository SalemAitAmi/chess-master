import { useState, useCallback } from "react";
import { Board } from "../utils/boardStructure";

export const useGameState = () => {
  const [boardObj, setBoardObj] = useState(() => new Board());
  const [selected, setSelected] = useState(null);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [promotion, setPromotion] = useState(null);
  const [gameMode, setGameMode] = useState(null);
  const [moveHistory, setMoveHistory] = useState([]);

  const turn = boardObj.gameState.active_color;

  const setBoard = useCallback((newBoard) => {
    if (newBoard instanceof Board) {
      setBoardObj(newBoard);
    } else {
      console.error("setBoard requires a Board instance");
    }
  }, []);

  const addMove = useCallback((moveStr) => {
    setMoveHistory(prev => [...prev, moveStr]);
  }, []);

  const resetGame = useCallback(() => {
    setBoardObj(new Board());
    setSelected(null);
    setGameOver(false);
    setWinner(null);
    setLastMove(null);
    setPromotion(null);
    setMoveHistory([]);
  }, []);

  const resetToMenu = useCallback(() => {
    resetGame();
    setGameMode(null);
  }, [resetGame]);

  const canUndo = useCallback(() => boardObj.canUndo(), [boardObj]);

  const getFen = useCallback(() => {
    return boardObj.toFen ? boardObj.toFen() : null;
  }, [boardObj]);

  return {
    boardObj,
    setBoard,
    selected,
    setSelected,
    turn,
    gameOver,
    setGameOver,
    winner,
    setWinner,
    lastMove,
    setLastMove,
    promotion,
    setPromotion,
    gameMode,
    setGameMode,
    moveHistory,
    addMove,
    resetGame,
    resetToMenu,
    canUndo,
    getFen,
  };
};