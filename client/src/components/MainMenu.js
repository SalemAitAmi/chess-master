import { useState } from "react";

const DIFFICULTY_OPTIONS = [
  { level: 1, name: 'Rookie', id: 'rookie', description: 'Just learning the ropes', elo: '~600', color: 'bg-green-600 hover:bg-green-700', selectedColor: 'bg-green-500 ring-2 ring-green-300' },
  { level: 2, name: 'Casual', id: 'casual', description: 'Knows the basics well', elo: '~1200', color: 'bg-yellow-600 hover:bg-yellow-700', selectedColor: 'bg-yellow-500 ring-2 ring-yellow-300' },
  { level: 3, name: 'Strategic', id: 'strategic', description: 'Thinks ahead strategically', elo: '~1800', color: 'bg-orange-600 hover:bg-orange-700', selectedColor: 'bg-orange-500 ring-2 ring-orange-300' },
  { level: 4, name: 'Master', id: 'master', description: 'A formidable opponent', elo: '~2400', color: 'bg-red-600 hover:bg-red-700', selectedColor: 'bg-red-500 ring-2 ring-red-300' }
];

const ROUND_OPTIONS = [1, 3, 5, 10, 20];

const MainMenu = ({
  onGameStart,
  playerColor,
  setPlayerColor,
  difficulty,
  setDifficulty,
  onColosseumStart,
  engineConnected,
  engineError,
  onReconnect  // NEW: reconnect callback
}) => {
  const [selectedMode, setSelectedMode] = useState(null);
  const [whiteBot, setWhiteBot] = useState(2);
  const [blackBot, setBlackBot] = useState(2);
  const [maxRounds, setMaxRounds] = useState(1);

  const handleGameStart = () => {
    if (selectedMode === 'colosseum') {
      if (onColosseumStart) {
        onColosseumStart({ whiteBot, blackBot, maxRounds });
      }
    } else if (selectedMode) {
      onGameStart(selectedMode);
    }
  };

  const requiresEngine = selectedMode === 'vs-computer' || selectedMode === 'colosseum';

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 font-sans">
      <h1 className="text-6xl font-extrabold mb-8 text-gray-100 drop-shadow-md">
        Chess Master
      </h1>

      {/* Engine status */}
      <div className={`mb-6 px-4 py-3 rounded-lg ${engineConnected ? 'bg-green-600/20 border border-green-500' : 'bg-red-600/20 border border-red-500'}`}>
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${engineConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
          <span className={engineConnected ? 'text-green-400' : 'text-red-400'}>
            {engineConnected ? 'Engine Server Connected' : 'Engine Server Disconnected'}
          </span>
          {!engineConnected && onReconnect && (
            <button
              onClick={onReconnect}
              className="ml-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
            >
              Reconnect
            </button>
          )}
        </div>
        {engineError && (
          <p className="text-red-400 text-sm mt-2">{engineError}</p>
        )}
        {!engineConnected && (
          <p className="text-gray-400 text-xs mt-2">
            Start the engine server: <code className="bg-gray-700 px-2 py-1 rounded">cd chess-engine && npm start</code>
          </p>
        )}
      </div>

      {!selectedMode ? (
        <div className="flex flex-col gap-6 w-80">
          <button
            onClick={() => setSelectedMode('local')}
            className="px-8 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all duration-200 shadow-lg hover:shadow-xl text-xl font-semibold transform hover:scale-105"
          >
            Local Play
          </button>

          <button
            onClick={() => setSelectedMode('vs-computer')}
            disabled={!engineConnected}
            className={`px-8 py-4 ${engineConnected ? 'bg-green-600 hover:bg-green-700 transform hover:scale-105' : 'bg-gray-600 cursor-not-allowed opacity-50'} text-white rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl text-xl font-semibold`}
          >
            vs Computer
            {!engineConnected && <span className="block text-sm opacity-75">(Engine required)</span>}
          </button>

          <button
            onClick={() => setSelectedMode('colosseum')}
            disabled={!engineConnected}
            className={`px-8 py-4 ${engineConnected ? 'bg-purple-600 hover:bg-purple-700 transform hover:scale-105' : 'bg-gray-600 cursor-not-allowed opacity-50'} text-white rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl text-xl font-semibold`}
          >
            <div className="flex items-center justify-center gap-2">
              <span>⚔️</span>
              <span>Colosseum</span>
              <span>⚔️</span>
            </div>
            <div className="text-sm opacity-80 mt-1">Bot vs Bot</div>
            {!engineConnected && <span className="block text-sm opacity-75">(Engine required)</span>}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-6 w-full max-w-2xl items-center px-4">
          <h2 className="text-3xl font-bold text-gray-100">
            {selectedMode === 'local' ? 'Local Play' :
             selectedMode === 'colosseum' ? '⚔️ Colosseum ⚔️' :
             'Play vs Computer'}
          </h2>

          {selectedMode === 'vs-computer' && (
            <>
              <div className="w-full">
                <h3 className="text-xl font-semibold text-gray-300 mb-4 text-center">
                  Choose Your Color
                </h3>
                <div className="flex gap-4 justify-center">
                  <button
                    onClick={() => setPlayerColor("white")}
                    className={`px-6 py-3 rounded-lg font-semibold transition-all duration-200
                      ${playerColor === "white"
                        ? "bg-yellow-500 text-gray-900 shadow-lg scale-105"
                        : "bg-gray-600 text-gray-300 hover:bg-gray-500"}`}
                  >
                    Play as White
                  </button>
                  <button
                    onClick={() => setPlayerColor("black")}
                    className={`px-6 py-3 rounded-lg font-semibold transition-all duration-200
                      ${playerColor === "black"
                        ? "bg-gray-800 text-gray-100 shadow-lg scale-105 ring-2 ring-gray-400"
                        : "bg-gray-600 text-gray-300 hover:bg-gray-500"}`}
                  >
                    Play as Black
                  </button>
                </div>
              </div>

              <div className="w-full">
                <h3 className="text-xl font-semibold text-gray-300 mb-4 text-center">
                  Select Difficulty
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  {DIFFICULTY_OPTIONS.map((option) => (
                    <button
                      key={option.level}
                      onClick={() => setDifficulty(option.level)}
                      className={`p-4 rounded-lg font-semibold transition-all duration-200 text-left
                        ${difficulty === option.level
                          ? `${option.selectedColor} scale-105`
                          : `${option.color} text-white`}`}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-lg">{option.name}</span>
                        <span className="text-sm opacity-80">{option.elo}</span>
                      </div>
                      <p className="text-sm opacity-90">{option.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {selectedMode === 'colosseum' && (
            <>
              <p className="text-gray-400 text-center max-w-md">
                Watch two engines battle it out!
              </p>

              <div className="w-full">
                <h3 className="text-xl font-semibold text-gray-300 mb-4 text-center">
                  ⬜ White Bot
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {DIFFICULTY_OPTIONS.map((option) => (
                    <button
                      key={`white-${option.level}`}
                      onClick={() => setWhiteBot(option.level)}
                      className={`p-3 rounded-lg font-semibold transition-all duration-200 text-left
                        ${whiteBot === option.level
                          ? `${option.selectedColor} scale-105`
                          : `${option.color} text-white`}`}
                    >
                      <div className="flex justify-between items-center">
                        <span>{option.name}</span>
                        <span className="text-xs opacity-80">{option.elo}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="w-full">
                <h3 className="text-xl font-semibold text-gray-300 mb-4 text-center">
                  ⬛ Black Bot
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {DIFFICULTY_OPTIONS.map((option) => (
                    <button
                      key={`black-${option.level}`}
                      onClick={() => setBlackBot(option.level)}
                      className={`p-3 rounded-lg font-semibold transition-all duration-200 text-left
                        ${blackBot === option.level
                          ? `${option.selectedColor} scale-105`
                          : `${option.color} text-white`}`}
                    >
                      <div className="flex justify-between items-center">
                        <span>{option.name}</span>
                        <span className="text-xs opacity-80">{option.elo}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="w-full">
                <h3 className="text-xl font-semibold text-gray-300 mb-4 text-center">
                  Number of Rounds
                </h3>
                <div className="flex gap-3 justify-center flex-wrap">
                  {ROUND_OPTIONS.map((rounds) => (
                    <button
                      key={rounds}
                      onClick={() => setMaxRounds(rounds)}
                      className={`px-5 py-2 rounded-lg font-semibold transition-all duration-200
                        ${maxRounds === rounds
                          ? "bg-purple-500 text-white shadow-lg scale-105"
                          : "bg-gray-600 text-gray-300 hover:bg-gray-500"}`}
                    >
                      {rounds}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex gap-4 mt-4">
            <button
              onClick={handleGameStart}
              disabled={requiresEngine && !engineConnected}
              className={`px-8 py-3 ${requiresEngine && !engineConnected ? 'bg-gray-600 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'} text-white rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl text-lg font-semibold`}
            >
              {selectedMode === 'colosseum' ? 'Start Battle' : 'Start Game'}
            </button>

            <button
              onClick={() => setSelectedMode(null)}
              className="px-8 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-all duration-200 shadow-lg hover:shadow-xl text-lg font-semibold"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MainMenu;