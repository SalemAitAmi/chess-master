import { useState } from "react";
import { DIFFICULTY } from "../players/BotPlayer";

const DIFFICULTY_OPTIONS = [
  {
    level: DIFFICULTY.ROOKIE,
    name: 'Rookie',
    description: 'Just learning the ropes',
    elo: '~600',
    color: 'bg-green-600 hover:bg-green-700',
    selectedColor: 'bg-green-500 ring-2 ring-green-300'
  },
  {
    level: DIFFICULTY.CASUAL,
    name: 'Casual',
    description: 'Knows the basics well',
    elo: '~1200',
    color: 'bg-yellow-600 hover:bg-yellow-700',
    selectedColor: 'bg-yellow-500 ring-2 ring-yellow-300'
  },
  {
    level: DIFFICULTY.STRATEGIC,
    name: 'Strategic',
    description: 'Thinks ahead strategically',
    elo: '~1800',
    color: 'bg-orange-600 hover:bg-orange-700',
    selectedColor: 'bg-orange-500 ring-2 ring-orange-300'
  },
  {
    level: DIFFICULTY.MASTER,
    name: 'Master',
    description: 'A formidable opponent',
    elo: '~2400',
    color: 'bg-red-600 hover:bg-red-700',
    selectedColor: 'bg-red-500 ring-2 ring-red-300'
  }
];

const MainMenu = ({ onGameStart, playerColor, setPlayerColor, difficulty, setDifficulty }) => {
  const [selectedMode, setSelectedMode] = useState(null);

  const handleGameStart = () => {
    if (selectedMode) {
      onGameStart(selectedMode);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 font-sans">
      <h1 className="text-6xl font-extrabold mb-8 text-gray-100 drop-shadow-md">
        Chess Master
      </h1>
      
      {!selectedMode ? (
        <div className="flex flex-col gap-6 w-80">
          <button
            onClick={() => setSelectedMode('local')}
            className="px-8 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 
              transition-all duration-200 shadow-lg hover:shadow-xl text-xl font-semibold
              transform hover:scale-105"
          >
            Local Play
          </button>
          
          <button
            onClick={() => setSelectedMode('vs-computer')}
            className="px-8 py-4 bg-green-600 text-white rounded-lg hover:bg-green-700 
              transition-all duration-200 shadow-lg hover:shadow-xl text-xl font-semibold
              transform hover:scale-105"
          >
            vs Computer
          </button>
          
          <button
            disabled
            className="px-8 py-4 bg-gray-600 text-gray-400 rounded-lg cursor-not-allowed
              text-xl font-semibold opacity-50"
          >
            Online Play (Coming Soon)
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-6 w-full max-w-2xl items-center px-4">
          <h2 className="text-3xl font-bold text-gray-100">
            {selectedMode === 'local' ? 'Local Play' : 'Play vs Computer'}
          </h2>
          
          {selectedMode === 'vs-computer' && (
            <>
              {/* Color Selection */}
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

              {/* Difficulty Selection */}
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
          
          <div className="flex gap-4 mt-4">
            <button
              onClick={handleGameStart}
              className="px-8 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 
                transition-all duration-200 shadow-lg hover:shadow-xl text-lg font-semibold"
            >
              Start Game
            </button>
            
            <button
              onClick={() => setSelectedMode(null)}
              className="px-8 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 
                transition-all duration-200 shadow-lg hover:shadow-xl text-lg font-semibold"
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
