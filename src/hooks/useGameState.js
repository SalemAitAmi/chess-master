import { useState } from "react";
import { 
  initialBoard, 
  initialCastlingRights, 
  initialKingMoved, 
  initialRookMoved 
} from "../constants/gameConstants";

export const useGameState = () => {
  const [board, setBoard] = useState(initialBoard);
  const [selected, setSelected] = useState(null);
  const [turn, setTurn] = useState("white");
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [enPassantTarget, setEnPassantTarget] = useState(null);
  const [promotion, setPromotion] = useState(null);
  const [castlingRights, setCastlingRights] = useState(initialCastlingRights);
  const [kingMoved, setKingMoved] = useState(initialKingMoved);
  const [rookMoved, setRookMoved] = useState(initialRookMoved);
  const [gameMode, setGameMode] = useState(null); // 'local', 'bot', 'online'
  const [currentBot, setCurrentBot] = useState(null);
  const [isThinking, setIsThinking] = useState(false);

  const resetGame = () => {
    setBoard(initialBoard);
    setSelected(null);
    setTurn("white");
    setGameOver(false);
    setWinner(null);
    setLastMove(null);
    setEnPassantTarget(null);
    setPromotion(null);
    setCastlingRights(initialCastlingRights);
    setKingMoved(initialKingMoved);
    setRookMoved(initialRookMoved);
    setIsThinking(false);
  };

  const resetToMenu = () => {
    resetGame();
    setGameMode(null);
    setCurrentBot(null);
  };

  return {
    board,
    setBoard,
    selected,
    setSelected,
    turn,
    setTurn,
    gameOver,
    setGameOver,
    winner,
    setWinner,
    lastMove,
    setLastMove,
    enPassantTarget,
    setEnPassantTarget,
    promotion,
    setPromotion,
    castlingRights,
    setCastlingRights,
    kingMoved,
    setKingMoved,
    rookMoved,
    setRookMoved,
    gameMode,
    setGameMode,
    currentBot,
    setCurrentBot,
    isThinking,
    setIsThinking,
    resetGame,
    resetToMenu,
  };
};