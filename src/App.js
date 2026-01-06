import { useState } from "react";
import { useGameState } from "./hooks/useGameState";
import MainMenu from "./components/MainMenu";
import LocalPlayPage from "./pages/LocalPlayPage";
import VsComputerPage from "./pages/VsComputerPage";
import ColosseumPage from "./pages/ColosseumPage";
import { DIFFICULTY } from "./players/BotPlayer";

const ChessApp = () => {
  const gameState = useGameState();
  const [gameMode, setGameMode] = useState(null);
  const [playerColor, setPlayerColor] = useState("white");
  const [difficulty, setDifficulty] = useState(DIFFICULTY.CASUAL);
  const [colosseumConfig, setColosseumConfig] = useState(null);

  const handleGameStart = (mode) => {
    gameState.setGameMode(mode);
    setGameMode(mode);
  };

  const handleColosseumStart = (config) => {
    setColosseumConfig(config);
    setGameMode('colosseum');
    gameState.setGameMode('colosseum');
  };

  const handleBackToMenu = () => {
    gameState.resetToMenu();
    setGameMode(null);
    setColosseumConfig(null);
  };

  // Route to appropriate page based on game mode
  if (!gameMode) {
    return (
      <MainMenu 
        onGameStart={handleGameStart}
        playerColor={playerColor}
        setPlayerColor={setPlayerColor}
        difficulty={difficulty}
        setDifficulty={setDifficulty}
        onColosseumStart={handleColosseumStart}
      />
    );
  }

  switch (gameMode) {
    case 'local':
      return <LocalPlayPage gameState={gameState} onBackToMenu={handleBackToMenu} />;
    
    case 'vs-computer':
      return (
        <VsComputerPage 
          gameState={gameState} 
          playerColor={playerColor}
          difficulty={difficulty}
          onBackToMenu={handleBackToMenu} 
        />
      );
    
    case 'colosseum':
      return (
        <ColosseumPage 
          gameState={gameState}
          config={colosseumConfig}
          onBackToMenu={handleBackToMenu}
        />
      );
    
    default:
      return null;
  }
};

export default ChessApp;