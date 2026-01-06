import { useState, useEffect, useCallback } from "react";
import ChessBoard from "../components/ChessBoard";
import PromotionModal from "../components/PromotionModal";
import GameOverModal from "../components/GameOverModal";
import { isInCheck } from "../utils/chessLogic";
import { useColosseumHandlers } from "../handlers/useColosseumHandlers";
import { DIFFICULTY, downloadReport, downloadAllReports, getLatestReport, clearReportHistory } from "../players/BotPlayer";
import { boardToFen } from "../utils/chessUtils";

const DIFFICULTY_NAMES = {
  [DIFFICULTY.ROOKIE]: 'Rookie',
  [DIFFICULTY.CASUAL]: 'Casual',
  [DIFFICULTY.STRATEGIC]: 'Strategic',
  [DIFFICULTY.MASTER]: 'Master'
};

const ColosseumPage = ({ gameState, config, onBackToMenu }) => {
  const {
    boardObj,
    turn,
    gameOver,
    winner,
    lastMove,
    promotion,
  } = gameState;

  const [currentRound, setCurrentRound] = useState(0);
  const [colosseumResults, setColosseumResults] = useState([]);
  const [isRunning, setIsRunning] = useState(true);
  const [isPendingAction, setIsPendingAction] = useState(false);

  const handlers = useColosseumHandlers(
    gameState,
    config,
    currentRound,
    setCurrentRound,
    colosseumResults,
    setColosseumResults,
    isRunning,
    setIsRunning
  );

  const { stopMatch, cleanup } = handlers;

  useEffect(() => {
    clearReportHistory();
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // Handle game over and round progression
  useEffect(() => {
    if (!gameOver || !config) return;

    const result = {
      round: currentRound + 1,
      winner: winner,
      whiteBotDifficulty: currentRound % 2 === 0 ? config.whiteBot : config.blackBot,
      blackBotDifficulty: currentRound % 2 === 0 ? config.blackBot : config.whiteBot,
      moves: boardObj.history.moves.length,
      fen: boardToFen(boardObj)
    };
    
    setColosseumResults(prev => [...prev, result]);
    
    if (currentRound + 1 < config.maxRounds && isRunning) {
      setTimeout(() => {
        setCurrentRound(prev => prev + 1);
        gameState.resetGame();
        gameState.setGameOver(false);
        gameState.setWinner(null);
      }, 2000);
    } else {
      setIsRunning(false);
    }
  }, [gameOver, config, currentRound, winner, boardObj, isRunning, gameState]);

  const handleStopClick = useCallback(() => {
    setIsPendingAction(true);
    stopMatch(() => {
      setIsPendingAction(false);
    });
  }, [stopMatch]);

  const handleBackClick = useCallback(() => {
    setIsPendingAction(true);
    stopMatch(() => {
      setIsPendingAction(false);
      onBackToMenu();
    });
  }, [stopMatch, onBackToMenu]);

  const ColosseumSummary = () => {
    if (colosseumResults.length === 0) return null;
    
    const whiteWins = colosseumResults.filter(r => r.winner === 'white').length;
    const blackWins = colosseumResults.filter(r => r.winner === 'black').length;
    const draws = colosseumResults.filter(r => r.winner === 'draw').length;
    
    return (
      <div id="colosseum-summary" className="mt-4 p-4 bg-gray-700 rounded-lg max-w-md">
        <h3 className="text-lg font-bold text-white mb-2">Match Results</h3>
        <div className="grid grid-cols-3 gap-4 text-center mb-3">
          <div>
            <div id="colosseum-white-wins" className="text-2xl font-bold text-yellow-300">
              {whiteWins}
            </div>
            <div className="text-sm text-gray-400">White Wins</div>
          </div>
          <div>
            <div id="colosseum-draws" className="text-2xl font-bold text-gray-400">
              {draws}
            </div>
            <div className="text-sm text-gray-400">Draws</div>
          </div>
          <div>
            <div id="colosseum-black-wins" className="text-2xl font-bold text-gray-300">
              {blackWins}
            </div>
            <div className="text-sm text-gray-400">Black Wins</div>
          </div>
        </div>
        
        <span id="colosseum-current-round" className="hidden">
          {currentRound + 1}
        </span>
        <span id="colosseum-max-rounds" className="hidden">
          {config?.maxRounds || 0}
        </span>
        
        <div id="colosseum-round-history" className="text-xs text-gray-500 max-h-32 overflow-y-auto">
          {colosseumResults.map((r, i) => (
            <div key={i} id={`round-result-${i + 1}`} className="py-1 border-b border-gray-600">
              Round {r.round}: {r.winner === 'draw' ? 'Draw' : `${r.winner} wins`} ({r.moves} moves)
            </div>
          ))}
        </div>
      </div>
    );
  };

  const swapped = currentRound % 2 === 1;
  const whiteName = DIFFICULTY_NAMES[swapped ? config.blackBot : config.whiteBot];
  const blackName = DIFFICULTY_NAMES[swapped ? config.whiteBot : config.blackBot];
  const shouldFlipBoard = currentRound % 2 === 1;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 relative font-sans">
      <div className="absolute top-4 left-4">
        <button
          onClick={handleBackClick}
          disabled={isPendingAction}
          title={isPendingAction ? "Waiting for bot to finish..." : ""}
          className={`px-4 py-2 ${isPendingAction ? 'bg-gray-500 cursor-wait' : 'bg-gray-600 hover:bg-gray-700'} 
            text-white rounded-lg transition-all duration-200 shadow-md hover:shadow-lg text-sm font-semibold`}
        >
          <i className="fas fa-arrow-left mr-2"></i>
          {isPendingAction ? "Stopping..." : "Main Menu"}
        </button>
      </div>

      <div className="mb-8 text-center">
        <h1 className="text-5xl font-bold text-white mb-4 drop-shadow-lg">
          ⚔️ Colosseum ⚔️
        </h1>
        <div className="text-xl text-gray-300">
          {whiteName} (White) vs {blackName} (Black) - Round {currentRound + 1}/{config.maxRounds}
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
        <p className="mt-2 text-gray-300 text-sm animate-pulse">
          {turn === 'white' ? 'White' : 'Black'} Bot is thinking...
        </p>
      </div>

      <ChessBoard
        boardObj={boardObj}
        selected={null}
        lastMove={lastMove}
        onSquareClick={() => {}}
        flipped={shouldFlipBoard}
      />

      <PromotionModal promotion={promotion} onPromotion={() => {}} />

      <GameOverModal
        gameOver={gameOver}
        winner={winner}
        onRestart={null}
      />

      <ColosseumSummary />

      <div className="mt-6 flex gap-4">
        {isRunning && !gameOver && (
          <button
            onClick={handleStopClick}
            disabled={isPendingAction}
            title={isPendingAction ? "Waiting for bot to finish..." : ""}
            className={`px-6 py-3 ${isPendingAction ? 'bg-gray-500 cursor-wait' : 'bg-red-600 hover:bg-red-700'} 
              text-white rounded-lg transition-all duration-200 shadow-md hover:shadow-lg text-lg font-semibold`}
          >
            {isPendingAction ? "Stopping..." : "Stop Match"}
          </button>
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

export default ColosseumPage;