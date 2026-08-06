/**
 * Finding the Deno binary.
 *
 * The B7 file-format tests run under Deno because the libraries that read an
 * xlsx and a PDF back are only reachable there, but Deno is not an npm
 * dependency and installs to different places on different machines. One
 * resolver so the two wrappers cannot disagree about where it is.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');

function resolveDeno(tag = '[deno]') {
  const candidates = [
    process.env.DENO_BIN,
    `${os.homedir()}/.deno/bin/deno`,
    '/opt/homebrew/bin/deno',
    '/usr/local/bin/deno',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const which = spawnSync('which', ['deno'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  throw new Error(`${tag} deno was not found. Install it: curl -fsSL https://deno.land/install.sh | sh -s -- -y`);
}

module.exports = { resolveDeno };
