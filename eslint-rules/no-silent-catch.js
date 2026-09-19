/**
 * Flags a `catch` that neither reports nor rethrows.
 *
 * This codebase lost two incidents to exactly that shape. A failure was caught,
 * a `__DEV__` console line was written, and in a release build the error simply
 * stopped existing — the user saw the app return to the sign-in screen and we
 * had nothing at all. Instrumenting the call sites we knew about fixes today's
 * blind spots; this is what stops tomorrow's being added.
 *
 * Swallowing is sometimes right. `reportIntegrityFailure` deliberately discards
 * its own failures because the caller is already handling one, and saying so is
 * the point: the rule does not ban silence, it bans UNEXAMINED silence. An
 * explicit
 *
 *     // monitoring-ignore: the caller is already handling a failure
 *
 * satisfies it, and turns a swallow into something a reviewer sees.
 *
 * Scope is `catch` clauses only. Promise `.catch(() => {})` handlers are
 * deliberately not covered: they are used throughout as fire-and-forget guards
 * where flagging every one would produce noise rather than signal, and the
 * unhandled-rejection tracker in monitoring/ already reports the ones that
 * matter.
 */
'use strict';

const REPORTERS = /\b(logSafeError|trackAnonymousBreadcrumb|trackAnonymousEvent)\s*\(/;
const ANNOTATION = /monitoring-ignore:\s*\S/;

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a catch block to report, rethrow, or declare why it stays silent.',
    },
    schema: [],
    messages: {
      silent:
        'This catch neither reports nor rethrows, so the failure disappears in a release build. ' +
        'Call logSafeError(error, "source"), rethrow, or justify it with "// monitoring-ignore: <reason>".',
    },
  },

  create(context) {
    const source = context.sourceCode ?? context.getSourceCode();

    return {
      CatchClause(node) {
        // getText returns the raw slice, so comments inside the block are
        // included and the annotation is found without walking them separately.
        const text = source.getText(node);

        if (REPORTERS.test(text)) return;
        if (ANNOTATION.test(text)) return;

        // A rethrow keeps the error alive for something upstream to report.
        let rethrows = false;
        const walk = (n) => {
          if (!n || typeof n.type !== 'string' || rethrows) return;
          if (n.type === 'ThrowStatement') {
            rethrows = true;
            return;
          }
          for (const key of Object.keys(n)) {
            if (key === 'parent') continue;
            const value = n[key];
            if (Array.isArray(value)) value.forEach(walk);
            else if (value && typeof value.type === 'string') walk(value);
          }
        };
        walk(node.body);
        if (rethrows) return;

        context.report({ node: node.param ?? node, messageId: 'silent' });
      },
    };
  },
};
