import { useState, useEffect } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// Module constants
// ═══════════════════════════════════════════════════════════════════════════
export const STORAGE_KEY = 'chess-master-settings';

export const DEFAULT_SETTINGS = {
  maxSearchTime: 30000,
  useOpeningBook: true,
  drawContemptMax: 50,
  threads: 1,
};

/** Setting key → UCI option name. Consumed by App to push settings. */
export const SETTING_TO_UCI = {
  maxSearchTime: 'MoveTime',
  useOpeningBook: 'OwnBook',
  drawContemptMax: 'Contempt',
  threads: 'Threads',
};

const MAX_THREADS_UI = 8;

// ═══════════════════════════════════════════════════════════════════════════
// Persistence
// ═══════════════════════════════════════════════════════════════════════════
export function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : { ...DEFAULT_SETTINGS };
  } catch (e) {
    console.warn('[settings] load failed, using defaults:', e);
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('[settings] save failed:', e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
const SettingsModal = ({ isOpen, onClose, onSave, disabled }) => {
  // ── Hooks ──
  const [settings, setSettings] = useState(loadSettings);

  // ── Callbacks ──
  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    saveSettings(settings);
    if (onSave) onSave(settings);
    onClose();
  };

  const handleReset = () => {
    setSettings({ ...DEFAULT_SETTINGS });
  };

  // ── Effects ──
  useEffect(() => {
    if (isOpen) setSettings(loadSettings());
  }, [isOpen]);

  // ── Render ──
  if (!isOpen) return null;

  const toggleClass = (on) =>
    `px-3 py-1 rounded text-sm font-medium transition-colors ${
      on ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300'
    } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50">
      <div className="absolute left-1/2 top-96 -translate-x-1/2
            bg-gray-800 rounded-xl p-6 shadow-2xl border border-gray-600
            w-96 max-h-[80vh] overflow-y-auto animate-fade-in">
        {/* ── HEADER ── */}
        <div className="flex justify-between items-center mb-6 border-b border-gray-600 pb-3">
          <h2 className="text-xl font-bold text-white">
            <i className="fas fa-cog mr-2" />Engine Settings
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">&times;</button>
        </div>

        {disabled && (
          <div className="mb-4 p-3 bg-yellow-900 rounded-lg text-yellow-200 text-sm text-center">
            <i className="fas fa-exclamation-triangle mr-1" />
            Settings locked during active game
          </div>
        )}

        {/* ── CONTROLS ── */}
        <div className="space-y-5">
          {/* Search Time */}
          <div>
            <label className="text-gray-300 text-sm font-medium">
              Max Search Time: {(settings.maxSearchTime / 1000).toFixed(0)}s
            </label>
            <input
              type="range" min="5000" max="120000" step="5000"
              value={settings.maxSearchTime}
              onChange={e => handleChange('maxSearchTime', parseInt(e.target.value, 10))}
              disabled={disabled}
              className="w-full mt-1 accent-blue-500"
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>5s</span><span>120s</span>
            </div>
          </div>

          {/* Threads */}
          <div>
            <label className="text-gray-300 text-sm font-medium">
              Search Threads: {settings.threads}
            </label>
            <input
              type="range" min="1" max={MAX_THREADS_UI} step="1"
              value={settings.threads}
              onChange={e => handleChange('threads', parseInt(e.target.value, 10))}
              disabled={disabled}
              className="w-full mt-1 accent-blue-500"
            />
            <div className="text-xs text-gray-500">
              Recorded by the engine; multi-threaded search is not yet active (runs single-threaded).
            </div>
          </div>

          {/* Opening Book */}
          <div className="flex justify-between items-center">
            <span className="text-gray-300 text-sm">Opening Book</span>
            <button
              onClick={() => handleChange('useOpeningBook', !settings.useOpeningBook)}
              disabled={disabled}
              className={toggleClass(settings.useOpeningBook)}
            >
              {settings.useOpeningBook ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Draw Contempt */}
          <div>
            <label className="text-gray-300 text-sm font-medium">
              Draw Contempt: {settings.drawContemptMax}cp
            </label>
            <input
              type="range" min="0" max="100" step="5"
              value={settings.drawContemptMax}
              onChange={e => handleChange('drawContemptMax', parseInt(e.target.value, 10))}
              disabled={disabled}
              className="w-full mt-1 accent-blue-500"
            />
          </div>
        </div>

        {/* ── BUTTONS ── */}
        <div className="mt-6 pt-4 border-t border-gray-600 flex gap-3">
          <button
            onClick={handleReset}
            disabled={disabled}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors
              ${disabled ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                         : 'bg-gray-600 hover:bg-gray-500 text-white'}`}
          >
            Reset Defaults
          </button>
          <button
            onClick={handleSave}
            disabled={disabled}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors
              ${disabled ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                         : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;