/**
 * Debugger toolbar: stepping, level, breadcrumbs, lens, view toggles.
 * Controls are grouped into rounded "pill" segments; icons are the rounded
 * stroke set from components/Icon.
 */
import Icon from '../../components/Icon';
import { LEVELS, LENSES } from '../nav';
import { COMPONENTS, COMPONENT_LABEL } from '../model';
import { plyLabel } from '../format';

const TONES = {
  default: 'text-gray-200 hover:bg-gray-700 hover:text-white',
  go: 'bg-emerald-600 text-white hover:bg-emerald-500 shadow',
  dive: 'bg-amber-600 text-white hover:bg-amber-500 shadow',
  active: 'bg-blue-600 text-white shadow',
  lens: 'bg-purple-600 text-white shadow',
};

// ═══════════════════════════════════════════════════════════════════════════
// Building blocks
// ═══════════════════════════════════════════════════════════════════════════

/** Round button: icon-only (circle) or icon + label (pill). */
const CtrlButton = ({ icon = null, label = null, title, onClick, disabled = false, tone = 'default' }) => (
  <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={label ?? title}
    className={`inline-flex items-center justify-center gap-1.5 h-8 ${label ? 'px-3' : 'w-8'} rounded-full text-xs font-semibold transition-colors
      ${disabled ? 'text-gray-600 cursor-not-allowed' : TONES[tone]}`}>
    {icon && <Icon name={icon} size={15} />}
    {label}
  </button>
);

/** Segmented pill container. */
const Group = ({ label, children }) => (
  <div role="group" aria-label={label} className="flex items-center gap-0.5 rounded-full bg-gray-900/70 p-1 ring-1 ring-gray-700/60">
    {children}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// Toolbar
// ═══════════════════════════════════════════════════════════════════════════

const DebuggerControls = ({ nav, dispatch, view }) => {
  // ── Derived ──
  const { turn, frame, game } = view;
  const turnCount = game ? game.turns.length : 0;
  const canStepInto = nav.level === 0 ? turn !== null
                    : nav.level === 1 ? frame !== null && frame.samples.length > 0
                    : false;
  const crumbs = [
    game && `game-${game.index}`,
    turn && `${plyLabel(turn.t)} ${turn.best ?? '?'} (${turn.eng}, turn ${nav.turn + 1}/${turnCount})`,
    nav.level >= 1 && frame && frame.title,
    nav.level === 2 && frame && `sample ${nav.sample + 1}/${frame.samples.length}`,
  ].filter(Boolean).join(' › ');
  const send = (type, extra = {}) => () => dispatch({ type, ...extra });

  // ── Render ──
  return (
    <div className="bg-gray-800 rounded-xl px-3 py-2 shadow-lg flex flex-wrap items-center gap-2">
      {/* Stepping */}
      <Group label="Step">
        <CtrlButton icon="first" title="First (Home)" onClick={send('first')} />
        <CtrlButton icon="back" title="Step back (←)" onClick={send('step-back')} />
        <CtrlButton icon="step-over" label="Step over" tone="go" onClick={send('step-over')}
          title="Step over (→): next turn / next frame (reverse chronology) / next older sample" />
        <CtrlButton icon="last" title="Last (End)" onClick={send('last')} />
      </Group>

      {/* Depth */}
      <Group label="Descend">
        <CtrlButton icon="step-into" label="Into" tone="dive" disabled={!canStepInto} onClick={send('step-into')}
          title={nav.level === 1 && !canStepInto ? 'No sampled traces in this window' : 'Step into (↓): descend to the latest element of the next level'} />
        <CtrlButton icon="step-out" label="Out" disabled={nav.level === 0} onClick={send('step-out')} title="Step out (↑)" />
      </Group>

      {/* Level indicator */}
      <Group label="Level">
        {LEVELS.map((level, i) => (
          <span key={level}
            className={`inline-flex items-center h-6 px-2.5 rounded-full text-[11px] font-semibold
              ${i === nav.level ? 'bg-blue-600 text-white' : i < nav.level ? 'text-blue-300' : 'text-gray-500'}`}>
            {level}
          </span>
        ))}
      </Group>

      {/* Breadcrumbs */}
      <div className="flex-1 min-w-[12rem] text-xs text-gray-300 font-mono truncate" title={crumbs}>{crumbs}</div>

      {/* Lens */}
      <Group label="Lens">
        {LENSES.map(l => (
          <CtrlButton key={l.id} label={l.label} title={l.help} tone={nav.lens === l.id ? 'lens' : 'default'}
            onClick={send('set-lens', { lens: l.id })} />
        ))}
        <select value={nav.heuristic} onChange={e => dispatch({ type: 'set-heuristic', heuristic: e.target.value })}
          title="Evaluation term for the Heuristic lens"
          className="h-8 rounded-full bg-gray-800 text-gray-200 text-xs px-2 border-0 focus:outline-none focus:ring-1 focus:ring-purple-500">
          {COMPONENTS.map(c => <option key={c} value={c}>{COMPONENT_LABEL[c]}</option>)}
        </select>
      </Group>

      {/* View toggles */}
      <Group label="View">
        <CtrlButton icon="eye" label="After" tone={nav.after ? 'active' : 'default'} onClick={send('toggle-after')}
          title="Show the position AFTER the focused move (a)" />
        <CtrlButton icon="flip" label="Flip" tone={nav.flip ? 'active' : 'default'} onClick={send('toggle-flip')} title="Flip board (f)" />
        {(nav.selected || nav.pick) && <CtrlButton icon="close" title="Clear selection (Esc)" onClick={send('clear-selection')} />}
      </Group>
    </div>
  );
};

export default DebuggerControls;