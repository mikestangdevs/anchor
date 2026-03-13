// ─── Branding Utility ─────────────────────────────────────────
// Shared terminal branding for the Anchor / ACR CLI.
// One source of truth for the wordmark, colors, and splash logic.

// ─── Color support ───────────────────────────────────────────

function supportsColor(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.TERM === 'dumb') return false;
  if (process.env.FORCE_COLOR !== undefined) return true;
  if (typeof process.stdout.isTTY === 'boolean') return process.stdout.isTTY;
  return false;
}

const useColor = supportsColor();

const purple = (s: string) => (useColor ? `\x1b[35m${s}\x1b[0m` : s);
const lavender = (s: string) => (useColor ? `\x1b[95m${s}\x1b[0m` : s);
const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s);

// ─── Wordmark ────────────────────────────────────────────────

const WORDMARK = `░█████╗░███╗░░██╗░█████╗░██╗░░██╗░█████╗░██████╗
██╔══██╗████╗░██║██╔══██╗██║░░██║██╔══██╗██╔══██╗
███████║██╔██╗██║██║░░╚═╝███████║██║░░██║██████╔╝
██╔══██║██║╚████║██║░░██╗██╔══██║██║░░██║██╔══██╗
██║░░██║██║░╚███║╚█████╔╝██║░░██║╚█████╔╝██║░░██║
╚═╝░░╚═╝╚═╝░░╚══╝░╚════╝░╚═╝░░╚═╝░╚════╝░╚═╝░░╚═╝`;

const SUBTITLE = 'Context, citations, and memory for agents';
const SECONDARY = 'Ground your agents in real context';

// ─── Public API ──────────────────────────────────────────────

/**
 * Print the full branded splash — wordmark + subtitle + tagline.
 * Intended for one-time use on `acr init`.
 */
export function printSplash(): void {
  console.log('');
  console.log(purple(WORDMARK));
  console.log('');
  console.log(lavender(`  ${SUBTITLE}`));
  console.log(dim(`  ${SECONDARY}`));
  console.log('');
}

/**
 * Return the compact branded header string for use in help text.
 * Two lines: product identity + subtitle.
 */
export function getCompactHeader(): string {
  const line1 = useColor ? `\x1b[35mACR\x1b[0m — \x1b[1mAnchor\x1b[0m` : 'ACR — Anchor';
  const line2 = useColor ? `\x1b[95m${SUBTITLE}\x1b[0m` : SUBTITLE;
  return `\n${line1}\n${line2}\n`;
}
