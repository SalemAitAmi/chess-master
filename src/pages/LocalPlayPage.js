import { useState } from "react";
import ChessBoard from "../components/ChessBoard";
import PromotionModal from "../components/PromotionModal";
import GameOverModal from "../components/GameOverModal";
import { isInCheck } from "../utils/chessLogic";
import { useLocalPlayHandlers } from "../handlers/useLocalPlayHandlers";

const LocalPlayPage = ({ gameState, onBackToMenu }) => {
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
  const handlers = useLocalPlayHandlers(gameState, setSelectedWithMoves);

  const { handleSquareClick, handlePromotion, handleUndo, handleSurrender, handleRestart } = handlers;

  const shouldFlipBoard = turn === "black";

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 relative font-sans">
      <div className="absolute top-4 left-4">
        <button
          onClick={onBackToMenu}
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
          Local Two Player
        </div>
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
        <p className="mt-2 text-gray-300 text-sm">
          Board view: {shouldFlipBoard ? "Black's perspective" : "White's perspective"}
        </p>
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
        onRestart={handleRestart}
      />

      <div className="mt-6 flex gap-4">
        {!gameOver && !promotion && (
          <>
            <button
              onClick={handleUndo}
              disabled={!boardObj.canUndo()}
              className={`px-6 py-3 ${boardObj.canUndo() ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-600 cursor-not-allowed'} 
                text-white rounded-lg transition-all duration-200 shadow-md hover:shadow-lg text-lg font-semibold`}
            >
              Undo Move
            </button>
            
            <button
              onClick={handleSurrender}
              className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg 
                transition-all duration-200 shadow-md hover:shadow-lg text-lg font-semibold"
            >
              Surrender
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default LocalPlayPage;