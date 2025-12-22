import { useState } from "react";
import { Board } from "../utils/boardStructure";

export const useGameState = () => {
  const [boardObj, setBoardObj] = useState(() => new Board());
  const [selected, setSelected] = useState(null);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [promotion, setPromotion] = useState(null);
  const [gameMode, setGameMode] = useState(null);

  // Compatibility getter
  const turn = boardObj.gameState.active_color;

  const setBoard = (newBoard) => {
    if (newBoard instanceof Board) {
      setBoardObj(newBoard);
    } else {
      console.error("setBoard requires a Board instance");
    }
  };

  const resetGame = () => {
    setBoardObj(new Board());
    setSelected(null);
    setGameOver(false);
    setWinner(null);
    setLastMove(null);
    setPromotion(null);
  };

  const resetToMenu = () => {
    resetGame();
    setGameMode(null);
  };

  const canUndo = () => boardObj.canUndo();

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
    resetGame,
    resetToMenu,
    canUndo,
  };
};