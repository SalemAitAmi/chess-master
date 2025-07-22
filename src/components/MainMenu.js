import React from "react";

const MainMenu = ({ onGameModeSelect }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 font-sans">
      <h1 className="text-6xl font-extrabold mb-8 text-gray-100 drop-shadow-md">
        Chess Master
      </h1>
      
      <div className="flex flex-col gap-6 w-80">
        <button
          onClick={() => onGameModeSelect('local')}
          className="px-8 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 
            transition-all duration-200 shadow-lg hover:shadow-xl text-xl font-semibold
            transform hover:scale-105"
        >
          Local Play
        </button>
        
        <button
          onClick={() => onGameModeSelect('bot')}
          className="px-8 py-4 bg-green-600 text-white rounded-lg hover:bg-green-700 
            transition-all duration-200 shadow-lg hover:shadow-xl text-xl font-semibold
            transform hover:scale-105"
        >
          Play vs Bot
        </button>
        
        <button
          disabled
          className="px-8 py-4 bg-gray-600 text-gray-400 rounded-lg cursor-not-allowed
            text-xl font-semibold opacity-50"
        >
          Online Play (Coming Soon)
        </button>
      </div>
    </div>
  );
};

export default MainMenu;