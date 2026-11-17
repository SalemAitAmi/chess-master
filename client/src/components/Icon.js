/**
 * Stroke icons on a 24×24 grid with ROUND caps and joins, so they match the
 * rounded controls around them (solid glyph fonts read as square blocks).
 * Geometry follows the Feather/Lucide conventions. Filled shapes (the skip
 * triangles, the "current frame" dot) keep the round join from the stroke.
 */
const DOT = <circle cx="12" cy="20" r="1.7" fill="currentColor" stroke="none" />;

const SHAPES = {
  first: (<><polygon points="18 19 9 12 18 5 18 19" fill="currentColor" /><line x1="5" y1="5" x2="5" y2="19" /></>),
  last: (<><polygon points="6 5 15 12 6 19 6 5" fill="currentColor" /><line x1="19" y1="5" x2="19" y2="19" /></>),
  back: <polyline points="15 18 9 12 15 6" />,
  // Debugger "step over": an arc jumping over the current point.
  'step-over': (<><path d="M4 15a8 8 0 0 1 14-5.3" /><polyline points="19 4 19 10 13 10" />{DOT}</>),
  'step-into': (<><line x1="12" y1="3" x2="12" y2="14" /><polyline points="7.5 9.5 12 14 16.5 9.5" />{DOT}</>),
  'step-out': (<><line x1="12" y1="14" x2="12" y2="3" /><polyline points="7.5 7.5 12 3 16.5 7.5" />{DOT}</>),
  flip: (<>
    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </>),
  eye: (<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  close: (<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>),
  folder: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  file: (<><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" /></>),
  upload: (<>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
  </>),
  'arrow-left': (<><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>),
};

const Icon = ({ name, size = 16, strokeWidth = 2.25, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
    className={`flex-shrink-0 ${className}`} aria-hidden="true">
    {SHAPES[name] ?? null}
  </svg>
);

export default Icon;