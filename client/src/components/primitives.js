/**
 * Shared UI primitives. Every page and the Sandbox draw their chrome from
 * here, so a panel, button or banner looks the same everywhere and a restyle
 * happens in one place.
 *
 *   Panel    titled card — size 'sm' (Sandbox density) or 'md' (game pages)
 *   KV       key/value grid — keys NEVER truncate; values yield the space
 *   Section  small-caps sub-heading inside a panel
 *   Button   action button: tone × size
 *   Chip     small pill for secondary, out-of-the-way commands
 *   Banner   transient status line (thinking, errors, round results)
 */

// ═══════════════════════════════════════════════════════════════════════════
// Panel
// ═══════════════════════════════════════════════════════════════════════════

const PANEL_SIZES = {
  sm: { box: 'p-3', head: 'pb-1 mb-2', title: 'text-sm' },
  md: { box: 'p-4', head: 'pb-2 mb-3', title: 'text-lg' },
};

/**
 * `fill` turns the panel into a flex column whose body can take `flex-1`
 * children — the parent decides the height (e.g. `className="xl:flex-1"`).
 */
export const Panel = ({
  title, sub = null, right = null, size = 'sm', fill = false,
  className = '', bodyClassName = '', children,
}) => {
  const s = PANEL_SIZES[size];
  return (
    <section className={`bg-gray-800 rounded-lg shadow-lg ${s.box} ${fill ? 'flex flex-col min-h-0' : ''} ${className}`}>
      {/* Header: title + optional subtitle, right-aligned actions */}
      <header className={`flex-none flex items-baseline justify-between gap-2 border-b border-gray-600 ${s.head}`}>
        <div className="min-w-0">
          <h3 className={`${s.title} font-bold text-white truncate`}>{title}</h3>
          {sub && (
            <div className="text-[11px] text-gray-500 truncate" title={typeof sub === 'string' ? sub : undefined}>{sub}</div>
          )}
        </div>
        {right}
      </header>

      {/* Body */}
      <div className={`${fill ? 'flex-1 min-h-0 flex flex-col' : ''} ${bodyClassName}`}>{children}</div>
    </section>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// KV
// ═══════════════════════════════════════════════════════════════════════════

/**
 * items: [key, value, valueClass?]; falsy items are skipped so rows can be
 * conditional inline. cols 'auto' packs as many ≥13rem columns as fit; 1
 * forces a single column (narrow panels with long values).
 *
 * The key is `whitespace-nowrap flex-shrink-0`, so a long value truncates
 * (full text in its tooltip) instead of cutting the label off.
 */
export const KV = ({ items, cols = 'auto' }) => (
  <div className={`grid gap-x-4 gap-y-0.5 text-xs ${cols === 1 ? 'grid-cols-1' : 'grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]'}`}>
    {items.filter(Boolean).map(([key, value, cls]) => (
      <div key={key} className="flex items-baseline justify-between gap-3 border-b border-gray-700/60 py-0.5 min-w-0">
        <span className="text-gray-400 whitespace-nowrap flex-shrink-0">{key}</span>
        <span className={`font-mono text-right truncate min-w-0 ${cls ?? 'text-gray-100'}`}
          title={typeof value === 'string' || typeof value === 'number' ? String(value) : undefined}>
          {value}
        </span>
      </div>
    ))}
  </div>
);

export const Section = ({ title, children }) => (
  <div className="mt-2">
    <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">{title}</div>
    {children}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// Buttons
// ═══════════════════════════════════════════════════════════════════════════

const BUTTON_TONES = {
  primary: 'bg-blue-600 hover:bg-blue-700 text-white',
  success: 'bg-green-600 hover:bg-green-700 text-white',
  danger: 'bg-red-600 hover:bg-red-700 text-white',
  warning: 'bg-yellow-600 hover:bg-yellow-700 text-white',
  caution: 'bg-yellow-700 hover:bg-yellow-600 text-white',
  neutral: 'bg-gray-600 hover:bg-gray-700 text-white',
};

const BUTTON_SIZES = {
  sm: 'px-3 py-1 text-sm rounded',
  md: 'px-4 py-2 text-sm rounded-lg',
  lg: 'px-6 py-3 text-lg rounded-lg',
};

const BUTTON_DISABLED = 'bg-gray-600 text-gray-400 cursor-not-allowed';

export const Button = ({ tone = 'neutral', size = 'md', disabled = false, className = '', children, ...rest }) => (
  <button type="button" disabled={disabled}
    className={`${BUTTON_SIZES[size]} font-semibold shadow-md transition-all duration-200 ${disabled ? BUTTON_DISABLED : BUTTON_TONES[tone]} ${className}`}
    {...rest}>
    {children}
  </button>
);

/** Small pill for secondary actions that should stay out of the way. */
export const Chip = ({ icon = null, onClick, title, children }) => (
  <button type="button" onClick={onClick} title={title}
    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap
      bg-amber-500/10 text-amber-200 border border-amber-400/40 hover:bg-amber-500/20 hover:text-amber-100 transition-colors">
    {icon}{children}
  </button>
);

// ═══════════════════════════════════════════════════════════════════════════
// Banner
// ═══════════════════════════════════════════════════════════════════════════

const BANNER_TONES = {
  info: 'bg-gray-700 text-gray-300',
  error: 'bg-red-900 text-red-200',
};

export const Banner = ({ tone = 'info', pulse = false, children }) => (
  <div className={`px-4 py-2 rounded-lg flex items-center gap-3 ${BANNER_TONES[tone]} ${pulse ? 'animate-pulse' : ''}`}>
    {children}
  </div>
);