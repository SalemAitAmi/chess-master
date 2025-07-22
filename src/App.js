import React, { useEffect } from "react";
import { useGameState } from "./hooks/useGameState";
import { createGameHandlers } from "./handlers/gameHandlers";
import { createBot } from "./bots";
import { isInCheck } from "./utils/chessLogic";
import ChessBoard from "./components/ChessBoard";
import PromotionModal from "./components/PromotionModal";
import GameOverModal from "./components/GameOverModal";
import MainMenu from "./components/MainMenu";
import BotSelection from "./components/BotSelection";

const ChessApp = () => {
  const gameState = useGameState();
  const {
    board,
    selected,
    turn,
    gameOver,
    winner,
    lastMove,
    promotion,
    gameMode,
    currentBot,
    isThinking,
    setGameMode,
    setCurrentBot,
  } = gameState;

  const { handleClick, handlePromotion, handleSurrender, handleRestart, handleBackToMenu } =
    createGameHandlers(gameState);

  // Show main menu if no game mode is selected
  if (!gameMode) {
    return (
      <MainMenu 
        onGameModeSelect={(mode) => {
          if (mode === 'bot') {
            setGameMode('bot-selection');
          } else {
            setGameMode(mode);
          }
        }} 
      />
    );
  }

  // Show bot selection if in bot selection mode
  if (gameMode === 'bot-selection') {
    return (
      <BotSelection 
        onBotSelect={(bot) => {
          setCurrentBot(createBot(bot.id));
          setGameMode('bot');
        }}
        onBack={() => setGameMode(null)}
      />
    );
  }

  // Get opponent name for display
  const getOpponentName = () => {
    if (gameMode === 'bot') {
      return currentBot ? currentBot.name : 'Bot';
    }
    return turn === 'white' ? 'Black' : 'White';
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 relative font-sans">
      <div className="absolute top-4 left-4">
        <button
          onClick={handleBackToMenu}
          className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 
            transition-all duration-200 shadow-md hover:shadow-lg text-sm font-semibold"
        >
          ← Back to Menu
        </button>
      </div>

      <h1 className="text-5xl font-extrabold mb-6 text-gray-100 drop-shadow-md">
        Chess Master
      </h1>

      {gameMode === 'bot' && currentBot && (
        <div className="mb-2 text-lg text-gray-300">
          Playing against: <span className="font-semibold text-blue-400">{currentBot.name}</span>
        </div>
      )}

      <div className="mb-6 text-2xl font-semibold text-gray-300 flex items-center gap-2">
        {gameOver ? (
          <span className="text-gray-400 italic">Game Over</span>
        ) : (
          <>
            <span
              className={`w-4 h-4 rounded-full ${
                turn === "white" ? "bg-white" : "bg-gray-800"
              } border border-gray-400`}
            ></span>
            <span>
              {gameMode === 'bot' && turn === currentBot.color && isThinking ? (
                <span className="text-yellow-400 animate-pulse">
                  {currentBot.name} is thinking...
                </span>
              ) : (
                `${turn === "white" ? "White" : getOpponentName()}'s turn`
              )}
            </span>
            {isInCheck(board, turn) && (
              <span className="text-red-400 font-bold animate-pulse">
                {" "}
                (Check!)
              </span>
            )}
          </>
        )}
      </div>

      <ChessBoard
        board={board}
        selected={selected}
        lastMove={lastMove}
        onSquareClick={handleClick}
      />

      <PromotionModal promotion={promotion} onPromotion={handlePromotion} />

      <GameOverModal
        gameOver={gameOver}
        winner={winner}
        onRestart={handleRestart}
      />

      <div className="mt-6 flex gap-4">
        {!gameOver && !promotion && (
          <button
            onClick={handleSurrender}
            className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 
              transition-all duration-200 shadow-md hover:shadow-lg text-lg font-semibold"
          >
            Surrender
          </button>
        )}
      </div>
    </div>
  );
};

export default ChessApp;