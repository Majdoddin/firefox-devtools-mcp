/**
 * Chrome context management tools for MCP
 * Requires MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1
 */

import { successResponse, errorResponse } from '../utils/response-helpers.js';
import type { McpToolResponse } from '../types/common.js';

export const listChromeContextsTool = {
  name: 'list_chrome_contexts',
  description:
    'List chrome (privileged) browsing contexts. Requires MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 env var. Use restart_firefox with env parameter to enable.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export const selectChromeContextTool = {
  name: 'select_chrome_context',
  description:
    'Select a chrome browsing context by ID and set Marionette context to chrome. Requires MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 env var.',
  inputSchema: {
    type: 'object',
    properties: {
      contextId: {
        type: 'string',
        description: 'Chrome browsing context ID from list_chrome_contexts',
      },
    },
    required: ['contextId'],
  },
};

export const evaluateChromeScriptTool = {
  name: 'evaluate_chrome_script',
  description:
    'Evaluate JavaScript in the current chrome context. Requires MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 env var. Returns the result of the expression.',
  inputSchema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'JavaScript expression to evaluate in the chrome context',
      },
    },
    required: ['expression'],
  },
};

function formatContextList(contexts: any[]): string {
  if (contexts.length === 0) {
    return '🔧 No chrome contexts found';
  }

  const lines: string[] = [`🔧 ${contexts.length} chrome contexts`];
  for (const ctx of contexts) {
    const id = ctx.context;
    const url = ctx.url || '(no url)';
    const children = ctx.children ? ` [${ctx.children.length} children]` : '';
    lines.push(`  ${id}: ${url}${children}`);
  }
  return lines.join('\n');
}

export async function handleListChromeContexts(_args: unknown): Promise<McpToolResponse> {
  try {
    const { getFirefox } = await import('../index.js');
    const firefox = await getFirefox();

    const result = await firefox.sendBiDiCommand('browsingContext.getTree', {
      'moz:scope': 'chrome',
    });

    const contexts = result.contexts || [];

    return successResponse(formatContextList(contexts));
  } catch (error) {
    if (error instanceof Error && error.message.includes('UnsupportedOperationError')) {
      return errorResponse(
        new Error(
          'Chrome context access not enabled. Set MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 environment variable and restart Firefox.'
        )
      );
    }
    return errorResponse(error as Error);
  }
}

export async function handleSelectChromeContext(args: unknown): Promise<McpToolResponse> {
  try {
    const { contextId } = args as { contextId: string };

    if (!contextId || typeof contextId !== 'string') {
      throw new Error('contextId parameter is required and must be a string');
    }

    const { getFirefox } = await import('../index.js');
    const firefox = await getFirefox();

    const driver = firefox.getDriver();
    await driver.switchTo().window(contextId);

    try {
      await driver.setContext('chrome');
    } catch (contextError) {
      return errorResponse(
        new Error(
          `Switched to context ${contextId} but failed to set Marionette chrome context. Your Firefox build may not support chrome context or MOZ_REMOTE_ALLOW_SYSTEM_ACCESS is not set.`
        )
      );
    }

    return successResponse(
      `✅ Switched to chrome context: ${contextId} (Marionette context set to chrome)`
    );
  } catch (error) {
    return errorResponse(error as Error);
  }
}

export async function handleEvaluateChromeScript(args: unknown): Promise<McpToolResponse> {
  try {
    const { expression } = args as { expression: string };

    if (!expression || typeof expression !== 'string') {
      throw new Error('expression parameter is required and must be a string');
    }

    const { getFirefox } = await import('../index.js');
    const firefox = await getFirefox();

    const driver = firefox.getDriver();

    // Self-contained context switch: switch to chrome, execute, restore content.
    // Follows the same pattern as core.ts applyPreferences().
    const treeResult = await firefox.sendBiDiCommand('browsingContext.getTree', {
      'moz:scope': 'chrome',
    });
    const contexts = treeResult.contexts || [];
    if (contexts.length === 0) {
      return errorResponse(
        new Error(
          'No chrome contexts available. Ensure MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 is set.'
        )
      );
    }

    const chromeContextId = contexts[0].context;
    const originalContextId = await driver.getWindowHandle();

    try {
      await driver.switchTo().window(chromeContextId);
      await (driver as any).setContext('chrome');

      const result = await driver.executeScript(`return (${expression});`);
      const resultText =
        typeof result === 'string'
          ? result
          : result === null
            ? 'null'
            : result === undefined
              ? 'undefined'
              : JSON.stringify(result, null, 2);

      return successResponse(`🔧 Result:\n${resultText}`);
    } catch (executeError) {
      return errorResponse(
        new Error(
          `Script execution failed: ${executeError instanceof Error ? executeError.message : String(executeError)}`
        )
      );
    } finally {
      // Always restore content context so subsequent tools work normally
      try {
        await (driver as any).setContext('content');
        await driver.switchTo().window(originalContextId);
      } catch {
        // Ignore errors restoring context
      }
    }
  } catch (error) {
    return errorResponse(error as Error);
  }
}
