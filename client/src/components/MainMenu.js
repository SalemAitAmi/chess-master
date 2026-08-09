import { useState } from "react";
import { useEngine } from "../hooks/useEngine";

const DIFFICULTY_NAMES = {
  1: 'Rookie',
  2: 'Casual', 
  3: 'Strategic',
  4: 'Master'
};

const MainMenu = ({ onGameStart }) => {
  const engine = useEngine();
  
  const [playerColor, setPlayerColor] = useState('white');
  const [difficulty, setDifficulty] = useState(2);
  
  // Colosseum config
  const [whiteBot, setWhiteBot] = useState(3);
  const [blackBot, setBlackBot] = useState(3);
  const [maxRounds, setMaxRounds] = useState(5);

  const handleVsComputer = () => {
    onGameStart('vs-computer', { playerColor, difficulty });
  };

  const handleColosseum = () => {
    onGameStart('colosseum', { whiteBot, blackBot, maxRounds });
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900">
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

      <div className="space-y-4 w-80">
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
                className="w-full mt-1 p-2 bg-gray-600 text-white rounded"
              >
                <option value="white">White</option>
                <option value="black">Black</option>
              </select>
            </div>
            <div>
              <label className="text-gray-300 text-sm">Difficulty</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(parseInt(e.target.value))}
                className="w-full mt-1 p-2 bg-gray-600 text-white rounded"
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
          
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-gray-300 text-xs">White Bot</label>
              <select
                value={whiteBot}
                onChange={(e) => setWhiteBot(parseInt(e.target.value))}
                className="w-full mt-1 p-2 bg-gray-600 text-white rounded text-sm"
              >
                {Object.entries(DIFFICULTY_NAMES).map(([val, name]) => (
                  <option key={val} value={val}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-gray-300 text-xs">Black Bot</label>
              <select
                value={blackBot}
                onChange={(e) => setBlackBot(parseInt(e.target.value))}
                className="w-full mt-1 p-2 bg-gray-600 text-white rounded text-sm"
              >
                {Object.entries(DIFFICULTY_NAMES).map(([val, name]) => (
                  <option key={val} value={val}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-gray-300 text-xs">Rounds</label>
              <select
                value={maxRounds}
                onChange={(e) => setMaxRounds(parseInt(e.target.value))}
                className="w-full mt-1 p-2 bg-gray-600 text-white rounded text-sm"
              >
                {[1, 3, 5, 10, 20].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-8 text-gray-500 text-sm">
        Engine required for all game modes
      </p>
    </div>
  );
};

export default MainMenu;