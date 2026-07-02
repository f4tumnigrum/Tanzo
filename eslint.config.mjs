import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,

      '@typescript-eslint/explicit-function-return-type': 'off',

      'react-refresh/only-export-components': 'warn',
      'react-hooks/set-state-in-effect': 'warn'
    }
  },
  {
    files: [
      'src/renderer/src/components/ui/**/*.{ts,tsx}',
      'src/renderer/src/components/layout/page-header.tsx',
      'src/renderer/src/components/theme/theme-provider.tsx',
      'src/renderer/src/features/chat/ui/tool/renderers/**/*.{ts,tsx}',
      'src/renderer/src/features/settings/ui/shared/settings-primitives.tsx'
    ],
    rules: {
      'react-refresh/only-export-components': 'off'
    }
  },
  {
    // Architecture invariant: only src/renderer/src/platform/* may touch
    // window.electron. Every other layer must go through a platform client so
    // it inherits the shared IPC error decoding. Warn (not error) for now:
    // the pet feature still calls the bridge directly and needs a dedicated
    // platform/electron/pet-client.ts migration before this can be an error.
    files: ['src/renderer/src/**/*.{ts,tsx}'],
    ignores: ['src/renderer/src/platform/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector: "MemberExpression[object.name='window'][property.name='electron']",
          message:
            'Access window.electron only from src/renderer/src/platform/*. Route this call through a platform client so it inherits IPC error decoding.'
        },
        {
          selector: "OptionalMemberExpression[object.name='window'][property.name='electron']",
          message:
            'Access window.electron only from src/renderer/src/platform/*. Route this call through a platform client so it inherits IPC error decoding.'
        }
      ]
    }
  },
  eslintConfigPrettier
)
