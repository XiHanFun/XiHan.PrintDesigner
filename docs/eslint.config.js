import antfu from '@antfu/eslint-config'

export default antfu(
  {
    typescript: true,
    vue: true,
    stylistic: {
      indent: 2,
      quotes: 'single',
      semi: false,
    },
    ignores: [
      '.vitepress/cache/**',
      '.vitepress/dist/**',
      'pnpm-lock.yaml',
    ],
  },
  {
    rules: {
      // 模板即数据：示例里也不执行任何字符串代码
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['**/*.mjs', '**/*.config.*', '.vitepress/config.ts'],
    rules: {
      'no-console': 'off',
      'node/prefer-global/process': 'off',
    },
  },
)
