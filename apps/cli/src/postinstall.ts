// Postinstall splash — shown once after `npm install -g anchor-acr`.
// This is a standalone entrypoint (no imports from the CLI) so it
// works reliably in npm's postinstall lifecycle.

const NO_COLOR =
  process.env.NO_COLOR !== undefined ||
  process.env.TERM === 'dumb' ||
  (typeof process.stdout.isTTY === 'boolean' && !process.stdout.isTTY);

const purple = (s: string) => (NO_COLOR ? s : `\x1b[35m${s}\x1b[0m`);
const lavender = (s: string) => (NO_COLOR ? s : `\x1b[95m${s}\x1b[0m`);
const dim = (s: string) => (NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`);

const WORDMARK = `░█████╗░███╗░░██╗░█████╗░██╗░░██╗░█████╗░██████╗
██╔══██╗████╗░██║██╔══██╗██║░░██║██╔══██╗██╔══██╗
███████║██╔██╗██║██║░░╚═╝███████║██║░░██║██████╔╝
██╔══██║██║╚████║██║░░██╗██╔══██║██║░░██║██╔══██╗
██║░░██║██║░╚███║╚█████╔╝██║░░██║╚█████╔╝██║░░██║
╚═╝░░╚═╝╚═╝░░╚══╝░╚════╝░╚═╝░░╚═╝░╚════╝░╚═╝░░╚═╝`;

console.log('');
console.log(purple(WORDMARK));
console.log('');
console.log(lavender('  Context, citations, and memory for agents'));
console.log(dim('  Ground your agents in real context'));
console.log('');
console.log(dim('  Get started: acr init'));
console.log('');
