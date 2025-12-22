import { useEffect, useState, useRef } from "react";
import { useGameState } from "./hooks/useGameState";
import { createGameHandlers } from "./handlers/gameHandlers";
import { isInCheck, getValidMoves, simulateMove } from "./utils/chessLogic";
import { getPieceAt } from "./utils/chessUtils";
import { SQUARE_NAMES } from "./constants/gameConstants";
import ChessBoard from "./components/ChessBoard";
import PromotionModal from "./components/PromotionModal";
import GameOverModal from "./components/GameOverModal";
import MainMenu from "./components/MainMenu";

const ChessApp = () => {
  const gameState = useGameState();
  const [isThinking, setIsThinking] = useState(false);
  const [playerColor, setPlayerColor] = useState("white");
  const [gamesPlayed, setGamesPlayed] = useState(0);
  
  const {
    boardObj,
    selected,
    setSelected,
    turn,
    gameOver,
    winner,
    lastMove,
    promotion,
    gameMode,
    setGameMode,
    resetGame,
    resetToMenu,
  } = gameState;

  // Add isThinking and playerColor to gameState for handlers
  const enhancedGameState = { ...gameState, setIsThinking, playerColor };

  const { handleSquareClick, handlePromotion, handleUndo, initializePlayers } = createGameHandlers(enhancedGameState);

  // Calculate valid moves when a piece is selected
  const [selectedWithMoves, setSelectedWithMoves] = useState(null);
  
  // Use a ref to track the previous selected value
  const prevSelectedRef = useRef();
  
  useEffect(() => {
    // Only recalculate if selected actually changed
    if (prevSelectedRef.current === selected) {
      return;
    }
    prevSelectedRef.current = selected;
    
    if (selected) {
      const [row, col] = selected;
      const piece = getPieceAt(boardObj, row, col);
      
      if (piece) {
        console.log(`Calculating moves for selected piece at ${SQUARE_NAMES[7-row][col]}`);
        const moves = getValidMoves(row, col, boardObj);
        
        // Filter out moves that would leave the king in check
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
  }, [selected, boardObj.gameState.active_color]);

  // Initialize players when game mode changes
  useEffect(() => {
    if (gameMode && initializePlayers) {
      initializePlayers();
    }
  }, [gameMode, playerColor, initializePlayers]);

  // Make computer move on game start if computer plays white
  useEffect(() => {
    if (gameMode === 'vs-computer' && playerColor === "black" && turn === "white" && !gameOver) {
      const handlers = createGameHandlers(enhancedGameState);
      setTimeout(() => {
        handlers.makeComputerMove?.();
      }, 1000);
    }
  }, [gameMode, playerColor, turn]);

  // Show main menu if no game mode is selected
  if (!gameMode) {
    return (
      <MainMenu 
        onGameStart={(mode) => {
          setGameMode(mode);
        }}
        playerColor={playerColor}
        setPlayerColor={setPlayerColor}
      />
    );
  }

  const handleSurrender = () => {
    // Set winner to the opponent
    const winner = turn === "white" ? "black" : "white";
    gameState.setWinner(winner);
    gameState.setGameOver(true);
  };

  const handleRestart = () => {
    // Swap colors after each game
    setGamesPlayed(prev => prev + 1);
    if (gameMode === 'vs-computer') {
      setPlayerColor(prev => prev === "white" ? "black" : "white");
    }
    resetGame();
  };

  const handleBackToMenu = () => {
    resetToMenu();
  };

  // Determine if the board should be flipped
  const shouldFlipBoard = () => {
    if (gameMode === 'local') {
      // In local play, flip board to show current player's perspective
      return turn === "black";
    } else if (gameMode === 'vs-computer') {
      // In vs computer, always show from human player's perspective
      return playerColor === "black";
    }
    return false;
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 relative font-sans">
      <div className="absolute top-4 left-4">
        <button
          onClick={handleBackToMenu}
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
          {gameMode === 'vs-computer' ? `Playing vs Computer as ${playerColor}` : 'Local Two Player'}
        </div>
        {gameMode === 'vs-computer' && gamesPlayed > 0 && (
          <div className="text-sm text-gray-400 mt-2">
            Game #{gamesPlayed + 1} - Colors swapped
          </div>
        )}
      </div>

      <div className="mb-6 px-6 py-3 bg-gray-700 rounded-lg shadow-lg">
        <p className="text-xl font-semibold text-white">
          Current Turn:{" "}
          <span className={`${turn === "white" ? "text-yellow-300" : "text-gray-800"}`}>
            {turn === "white" ? "White" : "Black"}
          </span>
          {isInCheck(boardObj, boardObj.gameState.active_color) && (
            <span className="ml-2 text-red-500 font-bold animate-pulse">Check!</span>
          )}
        </p>
        {gameMode === 'local' && (
          <p className="mt-2 text-gray-300 text-sm">
            Board view: {shouldFlipBoard() ? "Black's perspective" : "White's perspective"}
          </p>
        )}
        {gameMode === 'vs-computer' && isThinking && (
          <p className="mt-2 text-gray-300 text-sm animate-pulse">
            Computer is thinking...
          </p>
        )}
      </div>

      <ChessBoard
        boardObj={boardObj}
        selected={selectedWithMoves}
        lastMove={lastMove}
        onSquareClick={handleSquareClick}
        flipped={shouldFlipBoard()}
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
              className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 
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

export default ChessApp;