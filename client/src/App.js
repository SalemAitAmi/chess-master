import { useState } from "react";
import MainMenu from "./components/MainMenu";
import LocalPlayPage from "./pages/LocalPlayPage";
import VsComputerPage from "./pages/VsComputerPage";
import ColosseumPage from "./pages/ColosseumPage";

const App = () => {
  const [gameMode, setGameMode] = useState(null);
  const [gameConfig, setGameConfig] = useState({});

  const handleGameStart = (mode, config = {}) => {
    setGameConfig(config);
    setGameMode(mode);
  };

  const handleBackToMenu = () => {
    setGameMode(null);
    setGameConfig({});
  };

  if (!gameMode) {
    return <MainMenu onGameStart={handleGameStart} />;
  }

  switch (gameMode) {
    case 'local':
      return <LocalPlayPage onBackToMenu={handleBackToMenu} />;
    
    case 'vs-computer':
      return (
        <VsComputerPage
          playerColor={gameConfig.playerColor || 'white'}
          difficulty={gameConfig.difficulty || 2}
          onBackToMenu={handleBackToMenu}
        />
      );
    
    case 'colosseum':
      return (
        <ColosseumPage
          config={gameConfig}
          onBackToMenu={handleBackToMenu}
        />
      );
    
    default:
      return <MainMenu onGameStart={handleGameStart} />;
  }
};

export default App;