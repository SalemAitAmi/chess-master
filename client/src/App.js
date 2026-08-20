import { useState, useEffect, useCallback } from "react";
import MainMenu from "./components/MainMenu";
import LocalPlayPage from "./pages/LocalPlayPage";
import VsComputerPage from "./pages/VsComputerPage";
import ColosseumPage from "./pages/ColosseumPage";
import SettingsModal, { SETTING_TO_UCI, loadSettings } from "./components/SettingsModal";
import { useEngine } from "./hooks/useEngine";
import { reportFailure } from "./utils/failure";

// ═══════════════════════════════════════════════════════════════════════════
// Module helpers
// ═══════════════════════════════════════════════════════════════════════════
function pushSettings(engine, settings) {
  for (const [key, uciName] of Object.entries(SETTING_TO_UCI)) {
    if (settings[key] === undefined) continue;
    try {
      engine.setOption(uciName, String(settings[key]));
    } catch (err) {
      reportFailure(`App.pushSettings(${uciName})`, err);
      return false;
    }
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
const App = () => {
  // ── Hooks ──
  const engine = useEngine();
  const [gameMode, setGameMode] = useState(null);
  const [gameConfig, setGameConfig] = useState({});
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Derived ──
  const gameActive = gameMode !== null;

  // ── Callbacks ──
  const handleGameStart = useCallback((mode, config) => {
    setGameConfig(config || {});
    setGameMode(mode);
  }, []);

  const handleBackToMenu = useCallback(() => {
    setGameMode(null);
    setGameConfig({});
  }, []);

  const handleSettingsSave = useCallback((settings) => {
    if (!engine.connected) {
      reportFailure('App.handleSettingsSave', new Error('engine not connected; settings saved locally only'));
      return;
    }
    pushSettings(engine, settings);
  }, [engine]);

  // ── Effects ──
  // Push persisted settings once the engine is up, so a reload does not
  // silently revert to engine defaults.
  useEffect(() => {
    if (!engine.connected) return;
    pushSettings(engine, loadSettings());
  }, [engine.connected]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render: chrome ──
  const settingsButton = (
    <button
      onClick={() => setSettingsOpen(true)}
      className="fixed top-4 right-4 z-40 w-10 h-10 bg-gray-700 hover:bg-gray-600
        rounded-full flex items-center justify-center text-gray-300 hover:text-white
        transition-all duration-200 shadow-lg"
      title="Engine Settings"
    >
      <i className="fas fa-cog text-lg" />
    </button>
  );

  const settingsModal = (
    <SettingsModal
      isOpen={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      onSave={handleSettingsSave}
      disabled={gameActive}
    />
  );

  // ── Render: page ──
  let page;
  switch (gameMode) {
    case 'local':
      page = <LocalPlayPage onBackToMenu={handleBackToMenu} />;
      break;
    case 'vs-computer':
      page = (
        <VsComputerPage
          playerColor={gameConfig.playerColor || 'white'}
          difficulty={gameConfig.difficulty || 2}
          onBackToMenu={handleBackToMenu}
        />
      );
      break;
    case 'colosseum':
      page = <ColosseumPage config={gameConfig} onBackToMenu={handleBackToMenu} />;
      break;
    default:
      page = <MainMenu onGameStart={handleGameStart} />;
  }

  return (
    <>
      {settingsButton}
      {settingsModal}
      {page}
    </>
  );
};

export default App;