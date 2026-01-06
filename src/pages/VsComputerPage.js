import { useState, useEffect, useCallback } from "react";
import ChessBoard from "../components/ChessBoard";
import PromotionModal from "../components/PromotionModal";
import GameOverModal from "../components/GameOverModal";
import { isInCheck } from "../utils/chessLogic";
import { useVsComputerHandlers } from "../handlers/useVsComputerHandlers";
import { DIFFICULTY, downloadReport, downloadAllReports, getLatestReport } from "../players/BotPlayer";

const DIFFICULTY_NAMES = {
  [DIFFICULTY.ROOKIE]: 'Rookie',
  [DIFFICULTY.CASUAL]: 'Casual',
  [DIFFICULTY.STRATEGIC]: 'Strategic',
  [DIFFICULTY.MASTER]: 'Master'
};

const VsComputerPage = ({ gameState, playerColor, difficulty, onBackToMenu }) => {
  const {
    boardObj,
    selected,
    turn,
    gameOver,
    winner,
    lastMove,
    promotion,
  } = gameState;

  const [selectedWithMoves, setSelectedWithMoves] = useState(null);
  const [isThinking, setIsThinking] = useState(false);
  const [gamesPlayed, setGamesPlayed] = useState(0);
  const [currentPlayerColor, setCurrentPlayerColor] = useState(playerColor);
  
  const handlers = useVsComputerHandlers(
    gameState, 
    setSelectedWithMoves, 
    isThinking, 
    setIsThinking,
    currentPlayerColor,
    difficulty
  );

  const { 
    handleSquareClick, 
    handlePromotion, 
    handleUndo, 
    handleSurrender, 
    handleRestart,
    cleanup
  } = handlers;

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const handleRestartWithColorSwap = useCallback(() => {
    setGamesPlayed(prev => prev + 1);
    setCurrentPlayerColor(prev => prev === "white" ? "black" : "white");
    handleRestart();
  }, [handleRestart]);

  const handleBackClick = useCallback(() => {
    setGamesPlayed(0);
    setCurrentPlayerColor(playerColor);
    onBackToMenu();
  }, [onBackToMenu, playerColor]);

  const shouldFlipBoard = currentPlayerColor === "black";

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 relative font-sans">
      <div className="absolute top-4 left-4">
        <button
          onClick={handleBackClick}
          className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 
            transition-all duration-200 shadow-md hover:shadow-lg text-sm font-semibold"
        >
          <i className="fas fa-arrow-left mr-2"></i>
          Main Menu
        </button>
      </div>

      <div className="mb-8 text-center">
        <h1 className="text-5xl font-bold text-white mb-4 drop-shadow-lg">
          Chess Game
        </h1>
        <div className="text-xl text-gray-300">
          Playing vs {DIFFICULTY_NAMES[difficulty]} Bot as {currentPlayerColor}
        </div>
        {gamesPlayed > 0 && (
          <div className="text-sm text-gray-400 mt-2">
            Game #{gamesPlayed + 1} - Colors swapped
          </div>
        )}
      </div>

      <div className="mb-6 px-6 py-3 bg-gray-700 rounded-lg shadow-lg">
        <p className="text-xl font-semibold text-white">
          Current Turn:{" "}
          <span className={`${turn === "white" ? "text-yellow-300" : "text-gray-400"}`}>
            {turn === "white" ? "White" : "Black"}
          </span>
          {isInCheck(boardObj, boardObj.gameState.active_color) && (
            <span className="ml-2 text-red-500 font-bold animate-pulse">Check!</span>
          )}
        </p>
        {isThinking && (
          <p className="mt-2 text-gray-300 text-sm animate-pulse">
            {DIFFICULTY_NAMES[difficulty]} Bot is thinking...
          </p>
        )}
      </div>

      <ChessBoard
        boardObj={boardObj}
        selected={selectedWithMoves}
        lastMove={lastMove}
        onSquareClick={handleSquareClick}
        flipped={shouldFlipBoard}
      />

      <PromotionModal promotion={promotion} onPromotion={handlePromotion} />

      <GameOverModal
        gameOver={gameOver}
        winner={winner}
        onRestart={handleRestartWithColorSwap}
      />

      <div className="mt-6 flex gap-4">
        {!gameOver && !promotion && (
          <>
            <button
              onClick={handleUndo}
              disabled={!boardObj.canUndo() || isThinking}
              className={`px-6 py-3 ${boardObj.canUndo() && !isThinking ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-600 cursor-not-allowed'} 
                text-white rounded-lg transition-all duration-200 shadow-md hover:shadow-lg text-lg font-semibold`}
            >
              Undo Move
            </button>
            
            <button
              onClick={handleSurrender}
              disabled={isThinking}
              className={`px-6 py-3 ${isThinking ? 'bg-gray-600 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'} text-white rounded-lg 
                transition-all duration-200 shadow-md hover:shadow-lg text-lg font-semibold`}
            >
              Surrender
            </button>
          </>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 justify-center">
        <button
          onClick={() => downloadReport('txt')}
          disabled={!getLatestReport()}
          className={`px-4 py-2 text-sm ${getLatestReport() ? 'bg-purple-600 hover:bg-purple-700' : 'bg-gray-600 cursor-not-allowed'} 
            text-white rounded-lg transition-all duration-200 shadow-md`}
        >
          Download Last Decision (TXT)
        </button>
        <button
          onClick={() => downloadReport('json')}
          disabled={!getLatestReport()}
          className={`px-4 py-2 text-sm ${getLatestReport() ? 'bg-purple-600 hover:bg-purple-700' : 'bg-gray-600 cursor-not-allowed'} 
            text-white rounded-lg transition-all duration-200 shadow-md`}
        >
          Download Last Decision (JSON)
        </button>
        <button
          onClick={() => downloadAllReports('json')}
          disabled={!getLatestReport()}
          className={`px-4 py-2 text-sm ${getLatestReport() ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-600 cursor-not-allowed'} 
            text-white rounded-lg transition-all duration-200 shadow-md`}
        >
          Download All Decisions (JSON)
        </button>
        <button
          onClick={() => downloadAllReports('txt')}
          disabled={!getLatestReport()}
          className={`px-4 py-2 text-sm ${getLatestReport() ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-600 cursor-not-allowed'} 
            text-white rounded-lg transition-all duration-200 shadow-md`}
        >
          Download All Decisions (TXT)
        </button>
      </div>
    </div>
  );
};

export default VsComputerPage;