#!/usr/bin/env node

/**
 * Colosseum Runner - Comprehensive Bot vs Bot Match System
 * 
 * This module provides a complete interface for running automated chess matches
 * between bot players of different difficulties.
 * 
 * Features:
 * - Run multiple rounds with automatic color swapping
 * - Collect detailed decision reports from both bots
 * - Generate comprehensive match statistics
 * - Export results in JSON format for analysis
 * 
 * Usage as CLI:
 *   node scripts/colosseum-runner.mjs --white=casual --black=master --rounds=5
 * 
 * Usage as Module:
 *   import { ColosseumRunner, DIFFICULTY } from './colosseum-runner.mjs';
 *   const runner = new ColosseumRunner();
 *   const results = await runner.runMatch({
 *     whiteBot: DIFFICULTY.CASUAL,
 *     blackBot: DIFFICULTY.MASTER,
 *     maxRounds: 5
 *   });
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Difficulty levels matching BotPlayer.js
export const DIFFICULTY = {
  ROOKIE: 1,
  CASUAL: 2,
  STRATEGIC: 3,
  MASTER: 4
};

const DIFFICULTY_NAMES = {
  [DIFFICULTY.ROOKIE]: 'Rookie',
  [DIFFICULTY.CASUAL]: 'Casual',
  [DIFFICULTY.STRATEGIC]: 'Strategic',
  [DIFFICULTY.MASTER]: 'Master'
};

const DIFFICULTY_FROM_STRING = {
  'rookie': DIFFICULTY.ROOKIE,
  'casual': DIFFICULTY.CASUAL,
  'strategic': DIFFICULTY.STRATEGIC,
  'master': DIFFICULTY.MASTER
};

/**
 * Colosseum Match Report Structure
 */
class ColosseumReport {
  constructor(config) {
    this.meta = {
      startTime: new Date().toISOString(),
      endTime: null,
      config: { ...config },
      version: '1.0.0'
    };
    this.rounds = [];
    this.allDecisions = [];
    this.summary = {
      totalRounds: config.maxRounds,
      completedRounds: 0,
      whiteWins: 0,
      blackWins: 0,
      draws: 0,
      totalMoves: 0,
      averageMovesPerGame: 0,
      longestGame: 0,
      shortestGame: Infinity,
      whiteBotConfig: config.whiteBot,
      blackBotConfig: config.blackBot
    };
  }

  addRound(roundResult) {
    this.rounds.push(roundResult);
    this.summary.completedRounds++;
    
    if (roundResult.winner === 'white') this.summary.whiteWins++;
    else if (roundResult.winner === 'black') this.summary.blackWins++;
    else this.summary.draws++;
    
    this.summary.totalMoves += roundResult.totalMoves;
    this.summary.longestGame = Math.max(this.summary.longestGame, roundResult.totalMoves);
    this.summary.shortestGame = Math.min(this.summary.shortestGame, roundResult.totalMoves);
    
    if (roundResult.decisions) {
      this.allDecisions.push(...roundResult.decisions.map(d => ({
        ...d,
        round: roundResult.round
      })));
    }
  }

  finalize() {
    this.meta.endTime = new Date().toISOString();
    if (this.summary.completedRounds > 0) {
      this.summary.averageMovesPerGame = Math.round(
        this.summary.totalMoves / this.summary.completedRounds
      );
    }
    if (this.summary.shortestGame === Infinity) {
      this.summary.shortestGame = 0;
    }
  }

  toJSON() {
    return JSON.stringify(this, null, 2);
  }

  toSummaryText() {
    let text = '';
    text += '═'.repeat(60) + '\n';
    text += 'COLOSSEUM MATCH REPORT\n';
    text += '═'.repeat(60) + '\n\n';
    
    text += `Start Time: ${this.meta.startTime}\n`;
    text += `End Time: ${this.meta.endTime}\n`;
    text += `Duration: ${this.getDuration()}\n\n`;
    
    text += '─'.repeat(40) + '\n';
    text += 'CONFIGURATION\n';
    text += '─'.repeat(40) + '\n';
    text += `White Bot: ${DIFFICULTY_NAMES[this.meta.config.whiteBot]}\n`;
    text += `Black Bot: ${DIFFICULTY_NAMES[this.meta.config.blackBot]}\n`;
    text += `Max Rounds: ${this.meta.config.maxRounds}\n\n`;
    
    text += '─'.repeat(40) + '\n';
    text += 'RESULTS\n';
    text += '─'.repeat(40) + '\n';
    text += `Completed Rounds: ${this.summary.completedRounds}\n`;
    text += `White Wins: ${this.summary.whiteWins}\n`;
    text += `Black Wins: ${this.summary.blackWins}\n`;
    text += `Draws: ${this.summary.draws}\n\n`;
    
    text += '─'.repeat(40) + '\n';
    text += 'STATISTICS\n';
    text += '─'.repeat(40) + '\n';
    text += `Total Moves: ${this.summary.totalMoves}\n`;
    text += `Average Moves/Game: ${this.summary.averageMovesPerGame}\n`;
    text += `Longest Game: ${this.summary.longestGame} moves\n`;
    text += `Shortest Game: ${this.summary.shortestGame} moves\n\n`;
    
    text += '─'.repeat(40) + '\n';
    text += 'ROUND BY ROUND\n';
    text += '─'.repeat(40) + '\n';
    for (const round of this.rounds) {
      const result = round.winner === 'draw' ? 'Draw' : `${round.winner} wins`;
      text += `Round ${round.round}: ${result} (${round.totalMoves} moves)\n`;
      text += `  White: ${DIFFICULTY_NAMES[round.whiteBotDifficulty]}\n`;
      text += `  Black: ${DIFFICULTY_NAMES[round.blackBotDifficulty]}\n`;
    }
    
    text += '\n' + '═'.repeat(60) + '\n';
    
    return text;
  }

  getDuration() {
    if (!this.meta.endTime) return 'In progress';
    const start = new Date(this.meta.startTime);
    const end = new Date(this.meta.endTime);
    const ms = end - start;
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

/**
 * Colosseum Runner Class
 * 
 * Manages the execution of bot vs bot matches
 */
export class ColosseumRunner {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.outputDir = options.outputDir || './colosseum-reports';
  }

  log(message) {
    if (this.verbose) {
      console.log(`[Colosseum] ${message}`);
    }
  }

  /**
   * Run a complete match between two bots
   * 
   * @param {Object} config - Match configuration
   * @param {number} config.whiteBot - Difficulty level for white bot
   * @param {number} config.blackBot - Difficulty level for black bot
   * @param {number} config.maxRounds - Number of rounds to play
   * @param {Function} config.onRoundComplete - Callback after each round
   * @param {Function} config.onMoveComplete - Callback after each move
   * @returns {Promise<ColosseumReport>} - Complete match report
   */
  async runMatch(config) {
    const report = new ColosseumReport(config);
    
    this.log(`Starting match: ${DIFFICULTY_NAMES[config.whiteBot]} vs ${DIFFICULTY_NAMES[config.blackBot]}`);
    this.log(`Rounds: ${config.maxRounds}`);
    
    for (let round = 1; round <= config.maxRounds; round++) {
      const swapped = round % 2 === 0;
      const whiteDifficulty = swapped ? config.blackBot : config.whiteBot;
      const blackDifficulty = swapped ? config.whiteBot : config.blackBot;
      
      this.log(`\nRound ${round}: ${DIFFICULTY_NAMES[whiteDifficulty]} (white) vs ${DIFFICULTY_NAMES[blackDifficulty]} (black)`);
      
      try {
        const roundResult = await this.runRound({
          round,
          whiteBotDifficulty: whiteDifficulty,
          blackBotDifficulty: blackDifficulty,
          onMoveComplete: config.onMoveComplete
        });
        
        report.addRound(roundResult);
        
        if (config.onRoundComplete) {
          config.onRoundComplete(roundResult, report);
        }
        
        this.log(`Round ${round} complete: ${roundResult.winner === 'draw' ? 'Draw' : `${roundResult.winner} wins`}`);
      } catch (error) {
        this.log(`Round ${round} error: ${error.message}`);
        report.addRound({
          round,
          whiteBotDifficulty: whiteDifficulty,
          blackBotDifficulty: blackDifficulty,
          winner: 'error',
          totalMoves: 0,
          error: error.message
        });
      }
    }
    
    report.finalize();
    return report;
  }

  /**
   * Run a single round
   * 
   * Note: This is a placeholder implementation. 
   * In a full implementation, this would integrate with the actual chess engine.
   */
  async runRound(config) {
    // Placeholder - simulates a game result
    // In real implementation, this would:
    // 1. Create a new Board instance
    // 2. Create BotPlayer instances for white and black
    // 3. Alternate moves until game over
    // 4. Collect all decisions made by both bots
    
    const decisions = [];
    const totalMoves = Math.floor(Math.random() * 80) + 20;
    
    // Simulate moves
    for (let i = 0; i < totalMoves; i++) {
      const color = i % 2 === 0 ? 'white' : 'black';
      decisions.push({
        moveNumber: Math.floor(i / 2) + 1,
        color,
        botDifficulty: color === 'white' ? config.whiteBotDifficulty : config.blackBotDifficulty,
        // In real implementation, this would contain the full decision report
        timestamp: new Date().toISOString()
      });
      
      if (config.onMoveComplete) {
        config.onMoveComplete({
          round: config.round,
          moveNumber: Math.floor(i / 2) + 1,
          color
        });
      }
    }
    
    // Determine winner (simulated)
    const outcomes = ['white', 'black', 'draw'];
    const winner = outcomes[Math.floor(Math.random() * 3)];
    
    return {
      round: config.round,
      whiteBotDifficulty: config.whiteBotDifficulty,
      blackBotDifficulty: config.blackBotDifficulty,
      winner,
      totalMoves,
      decisions,
      finalFen: 'placeholder'
    };
  }

  /**
   * Save report to file
   */
  saveReport(report, filename = null) {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = filename || `colosseum-${timestamp}`;
    
    // Save JSON report
    const jsonPath = path.join(this.outputDir, `${baseName}.json`);
    fs.writeFileSync(jsonPath, report.toJSON());
    this.log(`JSON report saved to: ${jsonPath}`);
    
    // Save text summary
    const txtPath = path.join(this.outputDir, `${baseName}-summary.txt`);
    fs.writeFileSync(txtPath, report.toSummaryText());
    this.log(`Text summary saved to: ${txtPath}`);
    
    return { jsonPath, txtPath };
  }
}

/**
 * Bulk Report Generator
 * 
 * Generates multiple reports for comprehensive analysis
 */
export class BulkReportGenerator {
  constructor(options = {}) {
    this.runner = new ColosseumRunner(options);
    this.verbose = options.verbose || false;
  }

  /**
   * Run all difficulty combinations
   */
  async runAllCombinations(roundsPerMatch = 3) {
    const difficulties = [DIFFICULTY.ROOKIE, DIFFICULTY.CASUAL, DIFFICULTY.STRATEGIC, DIFFICULTY.MASTER];
    const reports = [];
    
    for (const white of difficulties) {
      for (const black of difficulties) {
        if (white !== black) {  // Skip same difficulty matches
          console.log(`\nRunning: ${DIFFICULTY_NAMES[white]} vs ${DIFFICULTY_NAMES[black]}`);
          
          const report = await this.runner.runMatch({
            whiteBot: white,
            blackBot: black,
            maxRounds: roundsPerMatch
          });
          
          reports.push(report);
          this.runner.saveReport(report, 
            `${DIFFICULTY_NAMES[white].toLowerCase()}-vs-${DIFFICULTY_NAMES[black].toLowerCase()}`
          );
        }
      }
    }
    
    return reports;
  }

  /**
   * Generate aggregate statistics from multiple reports
   */
  generateAggregateStats(reports) {
    const stats = {
      totalMatches: reports.length,
      totalRounds: 0,
      totalMoves: 0,
      byDifficulty: {}
    };
    
    // Initialize difficulty stats
    for (const level of Object.values(DIFFICULTY)) {
      stats.byDifficulty[DIFFICULTY_NAMES[level]] = {
        winsAsWhite: 0,
        winsAsBlack: 0,
        losses: 0,
        draws: 0,
        totalGames: 0
      };
    }
    
    for (const report of reports) {
      stats.totalRounds += report.summary.completedRounds;
      stats.totalMoves += report.summary.totalMoves;
      
      // Update per-difficulty stats
      const whiteName = DIFFICULTY_NAMES[report.meta.config.whiteBot];
      const blackName = DIFFICULTY_NAMES[report.meta.config.blackBot];
      
      stats.byDifficulty[whiteName].winsAsWhite += report.summary.whiteWins;
      stats.byDifficulty[whiteName].losses += report.summary.blackWins;
      stats.byDifficulty[whiteName].draws += report.summary.draws;
      stats.byDifficulty[whiteName].totalGames += report.summary.completedRounds;
      
      stats.byDifficulty[blackName].winsAsBlack += report.summary.blackWins;
      stats.byDifficulty[blackName].losses += report.summary.whiteWins;
      stats.byDifficulty[blackName].draws += report.summary.draws;
      stats.byDifficulty[blackName].totalGames += report.summary.completedRounds;
    }
    
    return stats;
  }
}

// CLI Entry Point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).reduce((acc, arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    acc[key] = value || true;
    return acc;
  }, {});
  
  const config = {
    whiteBot: DIFFICULTY_FROM_STRING[args.white?.toLowerCase()] || DIFFICULTY.CASUAL,
    blackBot: DIFFICULTY_FROM_STRING[args.black?.toLowerCase()] || DIFFICULTY.STRATEGIC,
    maxRounds: parseInt(args.rounds) || 1
  };
  
  console.log('═'.repeat(60));
  console.log('COLOSSEUM RUNNER');
  console.log('═'.repeat(60));
  console.log('');
  console.log(`White Bot: ${DIFFICULTY_NAMES[config.whiteBot]}`);
  console.log(`Black Bot: ${DIFFICULTY_NAMES[config.blackBot]}`);
  console.log(`Rounds: ${config.maxRounds}`);
  console.log('');
  
  const runner = new ColosseumRunner({
    verbose: args.verbose || false,
    outputDir: args.output || './colosseum-reports'
  });
  
  runner.runMatch(config).then(report => {
    runner.saveReport(report);
    console.log('\n' + report.toSummaryText());
  }).catch(err => {
    console.error('Error running match:', err);
    process.exit(1);
  });
}

export default ColosseumRunner;
