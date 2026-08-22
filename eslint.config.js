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
]);
