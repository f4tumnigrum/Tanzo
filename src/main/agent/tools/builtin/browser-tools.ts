import { tool, zodSchema } from 'ai'
import type { TanzoTools, ToolError } from '@shared/agent-message'
import type { ToolDeps } from '../types'
import { toolResultToModelOutput } from '../model-output'
import { isAllowedEmbeddedBrowserUrl } from '../../../embedded-browser'
import { browserOpenInputSchema } from '../tool-schemas'

export const browserOpenTool = (deps: ToolDeps) =>
  tool<
    TanzoTools['browserOpen']['input'],
    TanzoTools['browserOpen']['output'],
    Record<string, unknown>
  >({
    description:
      'Open the built-in browser and load an absolute http(s) URL, showing the browser panel if it ' +
      'is hidden. Use this first to bring up a page; then use the chrome-devtools browser tools to ' +
      'snapshot, read, click, type, and navigate. Only open URLs that serve the user’s stated task.',
    inputSchema: zodSchema(browserOpenInputSchema),
    metadata: {
      tanzo: { kind: 'exec' as const, component: 'BrowserCard', fingerprintFields: ['url'] }
    },
    toModelOutput: toolResultToModelOutput,
    async execute({ url }): Promise<TanzoTools['browserOpen']['output'] | ToolError> {
      if (!isAllowedEmbeddedBrowserUrl(url)) {
        return { error: true, message: `Refusing to open disallowed URL: ${url}` }
      }
      const opened = deps.browser.requestOpen(url)
      if (!opened) {
        return {
          error: true,
          message: 'Could not open the built-in browser (no app window is available).'
        }
      }
      return { url, opened }
    }
  })
