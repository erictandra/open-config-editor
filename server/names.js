// "geraikita/claude-sonnet-5" -> "Claude Sonnet 5"
// "gemini/gemini-2.5-flash-lite" -> "Gemini 2.5 Flash Lite"
export function prettyName(id) {
  const last = String(id).split('/').pop();
  return last
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export const PREFIX = '9router/';

export function withPrefix(id) {
  return PREFIX + id;
}

export function stripPrefix(ref) {
  return typeof ref === 'string' && ref.startsWith(PREFIX) ? ref.slice(PREFIX.length) : null;
}
