/**
 * Failure reporting. Every caught failure on the client goes through here so
 * a hang or silent no-op becomes a visible, stack-tagged console entry. The
 * call stack is always dumped: either the error's own, or one captured here.
 */
export function reportFailure(context, cause) {
  const err = cause instanceof Error ? cause : new Error(String(cause));
  const stack = err.stack ? err.stack : new Error('captured at report site').stack;
  console.error(`[FAIL] ${context}: ${err.message}\n${stack}`);
  return err;
}

/** Throw + report when `condition` holds. Use for invariants that must not pass silently. */
export function failIf(condition, context, message) {
  if (condition) throw reportFailure(context, new Error(message));
}