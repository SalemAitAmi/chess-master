import { useState, useCallback } from "react";
import MainMenu from "./components/MainMenu";
import LocalPlayPage from "./pages/LocalPlayPage";
import VsComputerPage from "./pages/VsComputerPage";
import ColosseumPage from "./pages/ColosseumPage";
import SandboxPage from "./pages/SandboxPage";
import SettingsModal from "./components/SettingsModal";
import { useEngine } from "./hooks/useEngine";

/** e0 is opened here and lives for the page; it syncs its own config on connect and on commit. */
const App = () => {
  const engine = useEngine();
  const [gameMode, setGameMode] = useState(null);
  const [gameConfig, setGameConfig] = useState({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const start = useCallback((mode, config) => { setGameConfig(config || {}); setGameMode(mode); }, []);
  const back = useCallback(() => { setGameMode(null); setGameConfig({}); }, []);
  const close = useCallback(() => setSettingsOpen(false), []);
  let page;
  if (gameMode === 'local') page = <LocalPlayPage onBackToMenu={back} />;
  else if (gameMode === 'vs-computer') page = <VsComputerPage playerColor={gameConfig.playerColor || 'white'} difficulty={gameConfig.difficulty || 2} onBackToMenu={back} />;
  else if (gameMode === 'colosseum') page = <ColosseumPage config={gameConfig} onBackToMenu={back} />;
  else if (gameMode === 'sandbox') page = <SandboxPage onBackToMenu={back} />;
  else page = <MainMenu onGameStart={start} />;
  // The Sandbox replays logs: nothing it does depends on the live config, so
  // the settings stay editable there.
  const settingsLocked = gameMode !== null && gameMode !== 'sandbox';
  return (
    <>
      <button onClick={() => setSettingsOpen(true)} title="Engine Settings"
        className="fixed top-4 right-4 z-40 w-10 h-10 bg-gray-700 hover:bg-gray-600 rounded-full flex items-center justify-center text-gray-300 hover:text-white shadow-lg">
        <i className="fas fa-cog text-lg" />
      </button>
      <SettingsModal isOpen={settingsOpen} onClose={close} disabled={settingsLocked}
        engineReady={engine.connected} validateFen={engine.connected ? engine.validateFen : null} />
      {page}
    </>
  );
};
export default App;