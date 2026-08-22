const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

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
    // 'warn' while the migration is in progress: each remaining hit is a file
    // still pinned to light. Flip to 'error' once the count reaches zero and
    // the deprecated exports in theme/tokens.ts are deleted.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/theme/**'],
    rules: {
      'no-restricted-syntax': [
        'warn',
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
]);
