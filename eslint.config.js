import js from '@eslint/js';
import globals from 'globals';
import jsdoc from 'eslint-plugin-jsdoc';

/**
 * JSDoc rules, applied to the library and the editor alike.
 *
 * The point of these is not tidiness, it is drift: a `@param` naming an argument that was
 * renamed two refactors ago is worse than no comment, because it is believed. `check-param-names`
 * and `check-types` are what make the documentation answerable to the code.
 */
const jsdocRules = {
  'jsdoc/check-alignment': 'error',
  'jsdoc/check-param-names': 'error',
  'jsdoc/check-property-names': 'error',
  'jsdoc/check-tag-names': 'error',
  'jsdoc/check-types': 'error',
  'jsdoc/empty-tags': 'error',
  // TypeScript's lib types are not globals the plugin knows about, but they are exactly
  // what the declarations in src/index.d.ts are written in, so they belong in both.
  'jsdoc/no-undefined-types': ['error', {
    definedTypes: [
      'ReadonlyArray', 'Readonly', 'Record', 'Partial', 'Required', 'Pick', 'Omit',
      'Iterable', 'Iterator', 'Awaited', 'NonNullable', 'Parameters', 'ReturnType',
    ],
  }],
  'jsdoc/require-param': 'error',
  'jsdoc/require-param-description': 'error',
  'jsdoc/require-param-name': 'error',
  'jsdoc/require-param-type': 'error',
  'jsdoc/require-property-description': 'error',
  'jsdoc/require-property-type': 'error',
  'jsdoc/require-returns': 'error',
  'jsdoc/require-returns-check': 'error',
  'jsdoc/require-returns-description': 'error',
  'jsdoc/require-returns-type': 'error',
  'jsdoc/require-throws': 'error',
  'jsdoc/require-yields': 'error',
  'jsdoc/tag-lines': ['error', 'never', { startLines: 1 }],
  'jsdoc/valid-types': 'error',
  // Everything a caller can reach has to say what it is for. Private helpers are exempt:
  // a one-line function whose name already says it does not need a paragraph.
  'jsdoc/require-jsdoc': ['error', {
    publicOnly: true,
    require: {
      ClassDeclaration: true,
      FunctionDeclaration: true,
      MethodDefinition: true,
    },
  }],
};

const shared = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-var': 'error',
  'prefer-const': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'object-shorthand': ['error', 'properties'],
};

export default [
  { ignores: ['dist/**', 'node_modules/**', '**/*.d.ts'] },

  js.configs.recommended,

  {
    // The library is meant to run unchanged in a browser and in Node, so it is linted
    // against neither environment's globals — only the ones both actually provide. A
    // `process` or a `window` creeping into src/ should fail here, not at a user's import.
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        console: 'readonly',
      },
    },
    plugins: { jsdoc },
    settings: { jsdoc: { mode: 'typescript' } },
    rules: { ...shared, ...jsdocRules, 'no-console': 'error' },
  },

  {
    files: ['web/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.browser,
    },
    plugins: { jsdoc },
    settings: { jsdoc: { mode: 'typescript' } },
    rules: { ...shared, ...jsdocRules, 'no-console': ['error', { allow: ['error', 'warn'] }] },
  },

  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: shared,
  },

  {
    // Build and maintenance scripts are Node-only and exist to print things.
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: { ...shared, 'no-console': 'off' },
  },

  {
    files: ['*.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: shared,
  },
];
