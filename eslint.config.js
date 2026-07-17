/* eslint-disable @typescript-eslint/no-require-imports -- this config file is plain CommonJS */
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const importPlugin = require('eslint-plugin-import');
const globals = require('globals');

module.exports = tseslint.config(
    {
        ignores: ['.webpack/**', 'out/**', 'src/libs/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    importPlugin.flatConfigs.recommended,
    importPlugin.flatConfigs.electron,
    importPlugin.flatConfigs.typescript,
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.es2015,
                ...globals.node,
            },
        },
        rules: {
            // typescript-eslint's recommended preset reports these as errors; kept at the
            // pre-v8 severity so existing, tolerated instances don't newly fail lint.
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': 'warn',
            '@typescript-eslint/no-non-null-assertion': 'warn',
        },
    },
);
