import { useState } from 'react';
import { useEngine } from '../hooks/useEngine';
import { DIFFICULTY_NAMES } from '../constants/gameConstants';
import { listProfiles } from '../config/catalog';

const FALLBACK_PROFILES = [{ name: 'baseline', label: 'Baseline' }];
const ROUND_OPTIONS = [1, 3, 5, 10, 20].map(n => ({ value: n, label: String(n) }));
const DIFFICULTY_OPTIONS = Object.entries(DIFFICULTY_NAMES).map(([value, label]) => ({ value, label }));
const COLOR_OPTIONS = [{ value: 'white', label: 'White' }, { value: 'black', label: 'Black' }];
const SELECT_CLASS = 'w-full mt-1 p-2 bg-gray-600 text-white rounded text-sm';
const MODE_TONES = {
  green: 'bg-green-600 hover:bg-green-700',
  blue: 'bg-blue-600 hover:bg-blue-700',
  purple: 'bg-purple-600 hover:bg-purple-700',
  amber: 'bg-amber-600 hover:bg-amber-700',
};
const toInt = (v) => parseInt(v, 10);

// ═══════════════════════════════════════════════════════════════════════════
// Building blocks
// ═══════════════════════════════════════════════════════════════════════════

/** Large mode-launch button; grey and inert while the engine is offline. */
const ModeButton = ({ tone, disabled = false, onClick, children }) => (
  <button onClick={onClick} disabled={disabled}
    className={`w-full py-4 text-xl font-bold rounded-lg transition-all duration-200 shadow-lg
      ${disabled ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : `${MODE_TONES[tone]} text-white hover:shadow-xl`}`}>
    {children}
  </button>
);

/** Card grouping a mode button with its options. */
const ModeCard = ({ children }) => <div className="bg-gray-700 rounded-lg p-4 space-y-4">{children}</div>;

/** Label + select; `parse` converts the DOM string back to the state's type. */
const Field = ({ label, value, onChange, options, parse = (v) => v, labelClass = 'text-gray-300 text-sm' }) => (
  <div>
    <label className={`${labelClass} block`}>{label}</label>
    <select value={value} onChange={e => onChange(parse(e.target.value))} className={SELECT_CLASS}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

/** One Colosseum contestant: its search depth and its config profile. */
const ContestantCard = ({ name, accent, depth, onDepth, profile, onProfile, profileOptions }) => (
  <div className="bg-gray-800 rounded p-2 space-y-2">
    <div className={`${accent} text-xs font-bold`}>{name}</div>
    <Field label="Depth" labelClass="text-gray-400 text-xs" value={depth} onChange={onDepth} parse={toInt} options={DIFFICULTY_OPTIONS} />
    <Field label="Config profile" labelClass="text-gray-400 text-xs" value={profile} onChange={onProfile} options={profileOptions} />
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// Menu
// ═══════════════════════════════════════════════════════════════════════════

const MainMenu = ({ onGameStart }) => {
  // ── Engine ──
  // Default-session engine: used here only for connection status and for the
  // profile list it advertises in its `uci` option block.
  const engine = useEngine();

  // ── State ──
  const [playerColor, setPlayerColor] = useState('white');
  const [difficulty, setDifficulty] = useState(2);
  // Colosseum: each contestant is an independent engine instance with its own
  // config set (profile) and its own transposition table.
  const [botA, setBotA] = useState(3);
  const [botB, setBotB] = useState(3);
  const [profileA, setProfileA] = useState('baseline');
  const [profileB, setProfileB] = useState('baseline');
  const [maxRounds, setMaxRounds] = useState(5);

  // ── Derived ──
  const catalogProfiles = engine.connected ? listProfiles() : [];
  const profiles = catalogProfiles.length > 0 ? catalogProfiles : FALLBACK_PROFILES;
  const profileOptions = profiles.map(p => ({ value: p.name, label: p.label }));
  const offline = !engine.connected;

  // ── Render ──
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 to-gray-900 py-10">
      <h1 className="text-6xl font-bold text-white mb-8 drop-shadow-lg">♔ Chess Master ♚</h1>

      {/* Engine status */}
      <div className="mb-8 flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${engine.connected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className={`text-sm ${engine.connected ? 'text-green-400' : 'text-red-400'}`}>
          {engine.connected ? 'Engine Connected' : 'Engine Disconnected'}
        </span>
        {offline && (
          <button onClick={engine.reconnect} className="ml-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded">Reconnect</button>
        )}
      </div>
      {engine.error && <div className="mb-4 p-3 bg-red-900 text-red-200 rounded-lg max-w-md text-center">{engine.error}</div>}

      <div className="space-y-4 w-96">
        {/* Local Play */}
        <ModeButton tone="green" disabled={offline} onClick={() => onGameStart('local')}>👥 Local Play</ModeButton>

        {/* VS Computer */}
        <ModeCard>
          <ModeButton tone="blue" disabled={offline} onClick={() => onGameStart('vs-computer', { playerColor, difficulty })}>
            🤖 VS Computer
          </ModeButton>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Play as" value={playerColor} onChange={setPlayerColor} options={COLOR_OPTIONS} />
            <Field label="Difficulty" value={difficulty} onChange={setDifficulty} parse={toInt} options={DIFFICULTY_OPTIONS} />
          </div>
        </ModeCard>

        {/* Colosseum */}
        <ModeCard>
          <ModeButton tone="purple" disabled={offline}
            onClick={() => onGameStart('colosseum', { botA, botB, profileA, profileB, maxRounds })}>
            ⚔️ Colosseum
          </ModeButton>
          <div className="grid grid-cols-2 gap-3">
            <ContestantCard name="Engine A" accent="text-cyan-300" depth={botA} onDepth={setBotA}
              profile={profileA} onProfile={setProfileA} profileOptions={profileOptions} />
            <ContestantCard name="Engine B" accent="text-pink-300" depth={botB} onDepth={setBotB}
              profile={profileB} onProfile={setProfileB} profileOptions={profileOptions} />
          </div>
          <Field label="Rounds (colours swap each round)" labelClass="text-gray-300 text-xs"
            value={maxRounds} onChange={setMaxRounds} parse={toInt} options={ROUND_OPTIONS} />
          <p className="text-gray-500 text-xs">
            Each contestant runs as its own engine instance on its own connection,
            with a private transposition table — neither can read the other's search.
          </p>
        </ModeCard>

        {/* Sandbox — replay debugger. Needs no engine: it reads log files. */}
        <ModeCard>
          <ModeButton tone="amber" onClick={() => onGameStart('sandbox')}>🧪 Sandbox</ModeButton>
          <p className="text-gray-400 text-xs">
            Replay a logged session like a debugger: step over turns, step into a decision and walk it
            backwards through root policy, iterations and sampled traces. Click pieces and candidate
            squares on the board to drive the views. Reads <span className="font-mono">engine/logs/&lt;session&gt;</span> directly
            (or an <span className="font-mono">analysis/replay</span> export) — no engine connection required.
          </p>
        </ModeCard>
      </div>

      <p className="mt-8 text-gray-500 text-sm">Engine required for play · Sandbox replays logs offline</p>
    </div>
  );
};

export default MainMenu;