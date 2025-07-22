import React from "react";

const BotSelection = ({ onBotSelect, onBack }) => {
  const bots = [
    {
      id: 'rookie',
      name: 'Rookie Riley',
      description: 'Just learning the ropes',
      difficulty: 'Beginner',
      elo: '~600',
      color: 'bg-green-600 hover:bg-green-700'
    },
    {
      id: 'casual',
      name: 'Casual Casey',
      description: 'Knows the basics well',
      difficulty: 'Intermediate',
      elo: '~1200',
      color: 'bg-yellow-600 hover:bg-yellow-700'
    },
    {
      id: 'strategic',
      name: 'Strategic Sam',
      description: 'Thinks ahead strategically',
      difficulty: 'Advanced',
      elo: '~1800',
      color: 'bg-orange-600 hover:bg-orange-700'
    },
    {
      id: 'master',
      name: 'Master Magnus',
      description: 'A formidable opponent',
      difficulty: 'Expert',
      elo: '~2400',
      color: 'bg-red-600 hover:bg-red-700'
    }
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 font-sans">
      <h1 className="text-5xl font-extrabold mb-2 text-gray-100 drop-shadow-md">
        Choose Your Opponent
      </h1>
      <p className="text-gray-300 mb-8 text-lg">Select a bot to play against</p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl px-4">
        {bots.map((bot) => (
          <div
            key={bot.id}
            onClick={() => onBotSelect(bot)}
            className="bg-gray-800 rounded-lg p-6 cursor-pointer hover:bg-gray-700 
              transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105
              border border-gray-700 hover:border-gray-600"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-2xl font-bold text-gray-100">{bot.name}</h3>
              <span className={`px-3 py-1 rounded-full text-sm font-semibold text-white ${bot.color}`}>
                {bot.difficulty}
              </span>
            </div>
            <p className="text-gray-300 mb-3">{bot.description}</p>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Estimated ELO:</span>
              <span className="text-gray-200 font-semibold">{bot.elo}</span>
            </div>
          </div>
        ))}
      </div>
      
      <button
        onClick={onBack}
        className="mt-8 px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 
          transition-all duration-200 shadow-md hover:shadow-lg text-lg font-semibold"
      >
        Back to Menu
      </button>
    </div>
  );
};

export default BotSelection;