/** 'white' → 'White'. Nullish / empty input → ''. */
export const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');