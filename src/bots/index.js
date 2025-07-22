import { RookieBot } from "./RookieBot";
import { CasualBot } from "./CasualBot";
import { StrategicBot } from "./StrategicBot";
import { MasterBot } from "./MasterBot";

export const createBot = (botId) => {
  switch (botId) {
    case 'rookie':
      return new RookieBot();
    case 'casual':
      return new CasualBot();
    case 'strategic':
      return new StrategicBot();
    case 'master':
      return new MasterBot();
    default:
      return new RookieBot();
  }
};

export { RookieBot, CasualBot, StrategicBot, MasterBot };