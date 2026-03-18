import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    // Global ignores — always applied regardless of files pattern
    ignores: [
      'dist/**',
      'dist-node/**',
      'src-tauri/**',
      'node_modules/**',
      'agent/dist/**',
      'agent/node_modules/**',
      'shared/dist/**',
    ],
  },
  {
    // Only lint plain JS/JSX — TypeScript files are checked by tsc
    files: ['**/*.{js,jsx,mjs,cjs}'],
    ...js.configs.recommended,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
];
