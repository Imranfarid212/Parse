/**
 * Mirrors packages/contracts/src into supabase/functions/_shared/contracts.
 *
 * The two runtimes disagree about one thing: relative import specifiers. The
 * Expo app (TypeScript + Metro) writes `from './products'`; Deno requires the
 * extension and fails to resolve anything without it. So the mirror rewrites
 * relative specifiers to add `.ts` on the way across.
 *
 * Before this existed, contracts had to be a set of files that never imported
 * each other — the rule was written down as "keep this file dependency-free" and
 * held only as long as nobody split a contract in two. B8 split the product
 * catalogue out of the quota rule and broke it: the app typechecked, the mirror
 * looked right, and every edge function would have failed to boot on deploy.
 * Rewriting here means the constraint is enforced by the tool rather than
 * remembered by the author.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'packages', 'contracts', 'src');
const target = path.join(root, 'supabase', 'functions', '_shared', 'contracts');

/**
 * Adds `.ts` to extensionless relative specifiers in import/export statements.
 *
 * Only `./` and `../` are touched: bare specifiers (`zod`) are a different
 * problem — Deno cannot resolve those at all, which is why the runtime-parsed
 * contracts are the ones without them — and anything already carrying an
 * extension is left alone so re-running is a no-op.
 */
function rewriteRelativeImports(code) {
  return code.replace(
    /((?:^|\n)\s*(?:import|export)[\s\S]*?from\s*)(['"])(\.\.?\/[^'"]+)\2/g,
    (match, prefix, quote, specifier) =>
      /\.[cm]?[jt]sx?$/.test(specifier) ? match : `${prefix}${quote}${specifier}.ts${quote}`,
  );
}

function sync() {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(source, target, { recursive: true });

  let rewritten = 0;
  for (const entry of fs.readdirSync(target, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    const file = path.join(entry.parentPath ?? entry.path, entry.name);
    const original = fs.readFileSync(file, 'utf8');
    const updated = rewriteRelativeImports(original);
    if (updated !== original) {
      fs.writeFileSync(file, updated);
      rewritten += 1;
    }
  }

  console.log(
    `[contracts:sync] packages/contracts/src -> supabase/functions/_shared/contracts` +
      (rewritten > 0 ? ` (${rewritten} file(s) had relative imports rewritten for Deno)` : ''),
  );
}

// Exported so the drift checks compare like with like: the mirror is no longer
// byte-identical to the source, and a checker that did not apply the same
// transform would report drift on every run. Guarded so importing the transform
// does not trigger a sync as a side effect.
module.exports = { rewriteRelativeImports, sync };

if (require.main === module) sync();
