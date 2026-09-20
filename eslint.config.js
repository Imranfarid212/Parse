const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const noSilentCatch = require('./eslint-rules/no-silent-catch');

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: ['ios/**', 'dist/**', 'web-build/**', '.expo/**'],
  },
  {
    settings: {
      'import/resolver': {
        typescript: {},
        node: {
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
        },
      },
    },
    rules: {
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // Dark mode guard. `colors`/`elevation` from theme/tokens are the LIGHT
    // values — a module-level StyleSheet built from them is frozen at import
    // and will never follow the theme toggle. Use `makeStyles` from
    // theme/appearance instead, which rebuilds per theme.
    //
    // The migration is complete and theme/tokens no longer exports `colors`
    // or `elevation`, so this is an error: it catches a new file reaching for
    // a frozen palette before it can ship pinned to light.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/theme/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='StyleSheet'][callee.property.name='create'] MemberExpression[object.name=/^(colors|elevation)$/]",
          message:
            'Theme-frozen colour in a module-level StyleSheet. Wrap the stylesheet in makeStyles() from @/theme/appearance so it follows the dark mode toggle.',
        },
        {
          selector:
            "ImportDeclaration[source.value='@/theme/tokens'] ImportSpecifier[imported.name=/^(colors|elevation)$/]",
          message:
            'colors/elevation from @/theme/tokens are the light values only. Use useColors()/makeStyles() from @/theme/appearance.',
        },
      ],
    },
  },
  {
    // See eslint-rules/no-silent-catch.js. Two incidents were unreportable
    // because a failure was caught and written to a __DEV__ console line that
    // does not exist in a release build.
    files: ['src/**/*.{ts,tsx}'],
    plugins: { monitoring: { rules: { 'no-silent-catch': noSilentCatch } } },
    // An error, with the pre-existing 48 recorded in eslint-suppressions.json
    // rather than annotated in bulk: a warning among dozens of warnings is not
    // a guard, and blanket-annotating catches nobody has examined would launder
    // "unexamined" into "justified", which is the opposite of the point. New
    // violations fail; the backlog is visible and shrinks as files are touched.
    rules: { 'monitoring/no-silent-catch': 'error' },
  },
]);
