import js from '@eslint/js';
import globals from 'globals';
import jsdoc from 'eslint-plugin-jsdoc';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

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
  { ignores: ['dist/**', 'coverage/**', '**/node_modules/**', '**/*.d.ts'] },

  js.configs.recommended,

  // SonarSource's own rules, which is what SonarCloud runs against this JavaScript. Having
  // them here means a cognitive-complexity or nested-ternary finding fails `npm run lint`
  // on a laptop, rather than surfacing as a quality gate on a pull request with no local
  // way to reproduce it.
  {
    files: ['packages/*/src/**/*.js', 'apps/*/src/**/*.js', 'apps/docs/*.mjs', '**/test/**/*.js'],
    ...sonarjs.configs.recommended,
  },

  // A third of SonarCloud's findings need type information — a sort with no comparator, a
  // template that will interpolate `[object Object]` — and are simply invisible without it.
  // Those are the ones that cost the most to diagnose from a dashboard, so the parser gets
  // a program here. Tests are left out: they are not what Sonar analyses, and typing them
  // doubles the lint for nothing.
  {
    files: ['packages/*/src/**/*.js', 'apps/*/src/**/*.js', 'apps/docs/*.mjs'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.lint.json', tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // Sonar reports this as "will use Object's default stringification format".
      '@typescript-eslint/no-base-to-string': 'error',
    },
  },

  {
    // These tests assert through `close`/`closeAll`, which wrap `assert.ok` with a floating
    // point tolerance. The rule only recognises assertion calls written directly in the test
    // body, so it reads every one of them as assertion-free. Inlining the comparisons to
    // satisfy it would mean repeating the tolerance at every call site, which is the thing
    // the helpers exist to avoid.
    files: ['**/test/**/*.js'],
    rules: { 'sonarjs/assertions-in-tests': 'off' },
  },

  {
    // The library is meant to run unchanged in a browser and in Node, so it is linted
    // against neither environment's globals — only the ones both actually provide. A
    // `process` or a `window` creeping into the package should fail here, not at a user's
    // import.
    files: ['packages/forma-dsl/src/**/*.js'],
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
    files: ['apps/editor/src/**/*.js'],
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
    files: ['packages/forma-dsl/test/**/*.js', 'apps/editor/test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: shared,
  },

  {
    // Build and maintenance scripts, in any workspace: Node-only, and they exist to print
    // things.
    files: ['packages/forma-dsl/scripts/**/*.{js,mjs}', 'apps/docs/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: { ...shared, 'no-console': 'off' },
  },

  {
    files: ['**/*.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: shared,
  },
];
