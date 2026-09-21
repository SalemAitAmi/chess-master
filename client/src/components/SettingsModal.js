import { useState, useEffect, useMemo } from 'react';
import {
  ENGINE_OPTIONS, OPTION_GROUPS, DEFAULT_SETTINGS, SETTING_TO_UCI,
} from '../constants/engineOptions';

export { SETTING_TO_UCI };
export const STORAGE_KEY = 'chess-master-settings';
export { DEFAULT_SETTINGS };

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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
  catch (e) { console.warn('[settings] save failed:', e); }
}

/** Only the keys that differ from default — the "config set" under test. */
export function settingsDelta(settings) {
  const out = {};
  for (const [k, v] of Object.entries(settings)) {
    if (DEFAULT_SETTINGS[k] !== v) out[k] = v;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
const SettingsModal = ({ isOpen, onClose, onSave, disabled, profiles = [], engineOptions = null }) => {
  // ── Hooks ──
  const [settings, setSettings] = useState(loadSettings);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(() => ({ engine: true }));

  // ── Derived ──
  // The engine is authoritative about what exists and about bounds; this list
  // keeps only options the engine actually advertised, clamped to ITS limits.
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return ENGINE_OPTIONS.filter(o => {
      if (!o.local && engineOptions && engineOptions.size > 0 && !engineOptions.has(o.uci)) return false;
      if (q === '') return true;
      return `${o.label} ${o.id} ${o.uci ?? ''}`.toLowerCase().includes(q);
    }).map(o => {
      const adv = !o.local && engineOptions ? engineOptions.get(o.uci) : null;
      if (!adv || o.type !== 'spin') return o;
      return {
        ...o,
        min: adv.min !== null && adv.min !== undefined ? adv.min : o.min,
        max: adv.max !== null && adv.max !== undefined ? adv.max : o.max,
      };
    });
  }, [filter, engineOptions]);

  const groups = useMemo(() => OPTION_GROUPS
    .map(g => ({ ...g, items: visible.filter(o => o.group === g.id) }))
    .filter(g => g.items.length > 0), [visible]);

  const delta = useMemo(() => settingsDelta(settings), [settings]);

  // ── Callbacks ──
  const handleChange = (key, value) => setSettings(prev => ({ ...prev, [key]: value }));

  const handleSave = () => {
    saveSettings(settings);
    if (onSave) onSave(settings);
    onClose();
  };

  const handleReset = () => setSettings({ ...DEFAULT_SETTINGS });

  const handleExport = () => {
    // Exported shape is exactly what tools/run_experiments.mjs consumes as an
    // experiment arm, so a UI-tuned config set can be swept without retyping.
    const blob = new Blob([JSON.stringify({ settings, delta }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chess-master-config.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const incoming = parsed.settings ?? parsed;
        setSettings({ ...DEFAULT_SETTINGS, ...incoming });
      } catch (err) {
        console.warn('[settings] import failed:', err);
      }
    };
    reader.readAsText(file);
  };

  // ── Effects ──
  useEffect(() => { if (isOpen) setSettings(loadSettings()); }, [isOpen]);

  // ── Render ──
  if (!isOpen) return null;

  const renderControl = (o) => {
    const v = settings[o.id];
    if (o.type === 'check') {
      return (
        <button
          onClick={() => handleChange(o.id, !v)}
          disabled={disabled}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            v ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {v ? 'ON' : 'OFF'}
        </button>
      );
    }
    if (o.type === 'combo') {
      const list = profiles.length > 0 ? profiles : [{ name: 'baseline', label: 'Baseline' }];
      return (
        <select
          value={v}
          onChange={e => handleChange(o.id, e.target.value)}
          disabled={disabled}
          className="bg-gray-600 text-white rounded text-xs p-1"
        >
          {list.map(p => <option key={p.name} value={p.name}>{p.label}</option>)}
        </select>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <input
          type="range" min={o.min} max={o.max} step={o.step}
          value={v}
          onChange={e => handleChange(o.id, parseInt(e.target.value, 10))}
          disabled={disabled}
          className="w-28 accent-blue-500"
        />
        <input
          type="number" min={o.min} max={o.max} step={o.step}
          value={v}
          onChange={e => handleChange(o.id, parseInt(e.target.value, 10) || 0)}
          disabled={disabled}
          className="w-20 bg-gray-600 text-white rounded text-xs p-1"
        />
        {o.unit && <span className="text-gray-500 text-xs">{o.unit}</span>}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 overflow-y-auto">
      <div className="mx-auto my-12 bg-gray-800 rounded-xl p-6 shadow-2xl border border-gray-600
            w-[40rem] max-w-[95vw] max-h-[85vh] overflow-y-auto animate-fade-in">
        {/* ── HEADER ── */}
        <div className="flex justify-between items-center mb-4 border-b border-gray-600 pb-3">
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

        {/* ── TOOLBAR ── */}
        <div className="flex items-center gap-2 mb-4">
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter options…"
            className="flex-1 bg-gray-700 text-white rounded p-2 text-sm"
          />
          <button onClick={handleExport}
            className="px-3 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded text-xs">
            Export
          </button>
          <label className="px-3 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded text-xs cursor-pointer">
            Import
            <input type="file" accept="application/json" onChange={handleImport} className="hidden" />
          </label>
        </div>

        <div className="mb-3 text-xs text-gray-400">
          {Object.keys(delta).length === 0
            ? 'Control set (all engine defaults).'
            : `${Object.keys(delta).length} option(s) differ from default: ${Object.keys(delta).join(', ')}`}
        </div>

        {/* ── GROUPS ── */}
        {groups.map(g => (
          <div key={g.id} className="mb-3 border border-gray-700 rounded">
            <button
              onClick={() => setOpen(prev => ({ ...prev, [g.id]: !prev[g.id] }))}
              className="w-full flex justify-between items-center px-3 py-2 bg-gray-700 text-left"
            >
              <span className="text-sm font-bold text-gray-200">{g.label}</span>
              <span className="text-gray-400 text-xs">
                {g.items.length} · {open[g.id] || filter !== '' ? '▾' : '▸'}
              </span>
            </button>
            {(open[g.id] || filter !== '') && (
              <div className="p-3 space-y-3">
                {g.items.map(o => (
                  <div key={o.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-gray-300 text-sm">
                        {o.label}
                        {DEFAULT_SETTINGS[o.id] !== settings[o.id] && (
                          <span className="ml-2 text-amber-400 text-xs">modified</span>
                        )}
                      </div>
                      {o.uci && <div className="text-gray-600 text-xs font-mono">{o.uci}</div>}
                      {o.help && <div className="text-gray-500 text-xs mt-1">{o.help}</div>}
                    </div>
                    <div className="flex-shrink-0">{renderControl(o)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* ── BUTTONS ── */}
        <div className="mt-6 pt-4 border-t border-gray-600 flex gap-3">
          <button onClick={handleReset} disabled={disabled}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors
              ${disabled ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                         : 'bg-gray-600 hover:bg-gray-500 text-white'}`}>
            Reset Defaults
          </button>
          <button onClick={handleSave} disabled={disabled}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors
              ${disabled ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                         : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;