import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    typescript: true,
    stylistic: {
      indent: 2,
      quotes: 'single',
      semi: false,
    },
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'pnpm-lock.yaml',
    ],
  },
  {
    rules: {
      // 库分发禁止 console（保留 warn/error）
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // 模板即数据：不执行任何字符串代码
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['**/*.mjs', '**/*.config.*'],
    rules: {
      'no-console': 'off',
      'node/prefer-global/process': 'off',
    },
  },
  {
    // catalog 按类别分组，不按字母序
    files: ['pnpm-workspace.yaml'],
    rules: {
      'yaml/sort-keys': 'off',
      'pnpm/yaml-no-unused-catalog-item': 'off',
    },
  },
  {
    // 框架无关：各包源码不得 import 任何前端框架
    files: ['packages/*/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            'vue',
            '@vue/*',
            'react',
            'react-dom',
            'react/*',
            'react-dom/*',
            'preact',
            'preact/*',
            'svelte',
            'svelte/*',
            'solid-js',
            'solid-js/*',
            'lit',
            'lit/*',
            'lit-html',
            'lit-element',
            '@lit/*',
            '@lit-labs/*',
            '@angular/*',
          ],
          message: '各包必须框架无关：不得 import 任何前端框架，对外以原生 Web Components 交付。',
        }],
      }],
    },
  },
)
