/**
 * Save a JSON-serialisable value as a file. A temporary object URL is created
 * and revoked immediately after the synthetic click; the browser keeps the
 * blob alive for the download itself.
 */
export function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}