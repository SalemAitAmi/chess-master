import { useState } from "react";
import { useEngine } from "../hooks/useEngine";
import { DIFFICULTY_NAMES, DEFAULT_ENGINE_PROFILES } from "../constants/gameConstants";

const MainMenu = ({ onGameStart }) => {
  // The default-session engine: used here only for connection status and for
  // the profile list the engine advertises in its `uci` option block.
  const engine = useEngine();
  const profiles = engine.profiles && engine.profiles.length > 0
    ? engine.profiles
    : DEFAULT_ENGINE_PROFILES;

  const [playerColor, setPlayerColor] = useState('white');
  const [difficulty, setDifficulty] = useState(2);

  // Colosseum config: each contestant is an independent engine instance with
  // its own config set (profile) and its own transposition table.
  const [botA, setBotA] = useState(3);
  const [botB, setBotB] = useState(3);
  const [profileA, setProfileA] = useState('baseline');
  const [profileB, setProfileB] = useState('baseline');
  const [maxRounds, setMaxRounds] = useState(5);

  const handleVsComputer = () => {
    onGameStart('vs-computer', { playerColor, difficulty });
  };

  const handleColosseum = () => {
    onGameStart('colosseum', { botA, botB, profileA, profileB, maxRounds });
  };

  const selectClass = "w-full mt-1 p-2 bg-gray-600 text-white rounded text-sm";

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 py-10">
      <h1 className="text-6xl font-bold text-white mb-8 drop-shadow-lg">
        ♔ Chess Master ♚
      </h1>

      {/* Engine Status */}
      <div className="mb-8 flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${engine.connected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className={`text-sm ${engine.connected ? 'text-green-400' : 'text-red-400'}`}>
          {engine.connected ? 'Engine Connected' : 'Engine Disconnected'}
        </span>
        {!engine.connected && (
          <button
            onClick={engine.reconnect}
            className="ml-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded"
          >
            Reconnect
          </button>
        )}
      </div>

      {engine.error && (
        <div className="mb-4 p-3 bg-red-900 text-red-200 rounded-lg max-w-md text-center">
          {engine.error}
        </div>
      )}

      <div className="space-y-4 w-96">
        {/* Local Play */}
        <button
          onClick={() => onGameStart('local')}
          disabled={!engine.connected}
          className={`w-full py-4 text-xl font-bold rounded-lg transition-all duration-200 shadow-lg
            ${engine.connected
              ? 'bg-green-600 hover:bg-green-700 text-white hover:shadow-xl'
              : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`}
        >
          👥 Local Play
        </button>

        {/* VS Computer */}
        <div className="bg-gray-700 rounded-lg p-4">
          <button
            onClick={handleVsComputer}
            disabled={!engine.connected}
            className={`w-full py-4 text-xl font-bold rounded-lg transition-all duration-200 shadow-lg mb-4
              ${engine.connected
                ? 'bg-blue-600 hover:bg-blue-700 text-white hover:shadow-xl'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`}
          >
            🤖 VS Computer
          </button>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-gray-300 text-sm">Play as</label>
              <select
                value={playerColor}
                onChange={(e) => setPlayerColor(e.target.value)}
                className={selectClass}
              >
                <option value="white">White</option>
                <option value="black">Black</option>
              </select>
            </div>
            <div>
              <label className="text-gray-300 text-sm">Difficulty</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(parseInt(e.target.value, 10))}
                className={selectClass}
              >
                {Object.entries(DIFFICULTY_NAMES).map(([val, name]) => (
                  <option key={val} value={val}>{name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Colosseum */}
        <div className="bg-gray-700 rounded-lg p-4">
          <button
            onClick={handleColosseum}
            disabled={!engine.connected}
            className={`w-full py-4 text-xl font-bold rounded-lg transition-all duration-200 shadow-lg mb-4
              ${engine.connected
                ? 'bg-purple-600 hover:bg-purple-700 text-white hover:shadow-xl'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`}
          >
            ⚔️ Colosseum
          </button>

          <div className="grid grid-cols-2 gap-3">
            {/* Engine A */}
            <div className="bg-gray-800 rounded p-2">
              <div className="text-cyan-300 text-xs font-bold mb-1">Engine A</div>
              <label className="text-gray-400 text-xs">Depth</label>
              <select
                value={botA}
                onChange={(e) => setBotA(parseInt(e.target.value, 10))}
                className={selectClass}
              >
                {Object.entries(DIFFICULTY_NAMES).map(([val, name]) => (
                  <option key={val} value={val}>{name}</option>
                ))}
              </select>
              <label className="text-gray-400 text-xs mt-2 block">Config profile</label>
              <select
                value={profileA}
                onChange={(e) => setProfileA(e.target.value)}
                className={selectClass}
              >
                {profiles.map(p => (
                  <option key={p.name} value={p.name}>{p.label}</option>
                ))}
              </select>
            </div>

            {/* Engine B */}
            <div className="bg-gray-800 rounded p-2">
              <div className="text-pink-300 text-xs font-bold mb-1">Engine B</div>
              <label className="text-gray-400 text-xs">Depth</label>
              <select
                value={botB}
                onChange={(e) => setBotB(parseInt(e.target.value, 10))}
                className={selectClass}
              >
                {Object.entries(DIFFICULTY_NAMES).map(([val, name]) => (
                  <option key={val} value={val}>{name}</option>
                ))}
              </select>
              <label className="text-gray-400 text-xs mt-2 block">Config profile</label>
              <select
                value={profileB}
                onChange={(e) => setProfileB(e.target.value)}
                className={selectClass}
              >
                {profiles.map(p => (
                  <option key={p.name} value={p.name}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3">
            <label className="text-gray-300 text-xs">Rounds (colours swap each round)</label>
            <select
              value={maxRounds}
              onChange={(e) => setMaxRounds(parseInt(e.target.value, 10))}
              className={selectClass}
            >
              {[1, 3, 5, 10, 20].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>

          <p className="mt-3 text-gray-500 text-xs">
            Each contestant runs as its own engine instance on its own connection,
            with a private transposition table — neither can read the other's search.
          </p>
        </div>
      </div>

      <p className="mt-8 text-gray-500 text-sm">
        Engine required for all game modes
      </p>
    </div>
  );
};

export default MainMenu;