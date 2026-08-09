/**
 * The kit: JS sources shipped verbatim beside the server bundle, loaded into a
 * chrome context by ensure_privileged_kit and exposed as MCP resources so the
 * agent can read the same source the server injects.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KIT_URI_SCHEME = 'kit://';

// The schema contract for read_kit_file: static so the tool schema stays valid
// on a broken install; parity with the kit directory is pinned by tests.
export const KIT_FILE_NAMES = [
  'capture.js',
  'child.js',
  'hook.js',
  'hookscript.js',
  'introspect.js',
  'loader.js',
  'tap.js',
];

const KIT_MIME_TYPE = 'text/javascript';

// Copied verbatim into the moz package (files entry), never built by tsup, so
// it sits next to the bundle; the cwd candidate covers running from source.
export function resolveKitDir(): string | null {
  const bundleDir = dirname(fileURLToPath(import.meta.url));
  for (const dir of [resolve(bundleDir, '../kit'), resolve(process.cwd(), 'kit')]) {
    if (existsSync(dir)) {
      return dir;
    }
  }
  return null;
}

export function listKitFiles(): string[] {
  const dir = resolveKitDir();
  if (!dir) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .sort();
}

// Membership in the listing is also what keeps a uri from reaching outside the
// kit directory.
export function readKitFile(name: string): string {
  const dir = resolveKitDir();
  if (!dir || !listKitFiles().includes(name)) {
    throw new Error(`Unknown kit resource: ${name}`);
  }
  return readFileSync(resolve(dir, name), 'utf-8');
}

// Read server-side so the sources travel to Firefox over BiDi: the browser may
// be on another machine, where a path would mean nothing.
export function readKitFiles(): Array<{ name: string; source: string }> {
  return listKitFiles().map((name) => ({ name, source: readKitFile(name) }));
}

export function listKitResources(): Array<{
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}> {
  return listKitFiles().map((name) => {
    // Each kit file opens with a one-line statement of what it is
    const firstLine = (readKitFile(name).split('\n', 1)[0] ?? '').replace(/^\/\/\s*/, '').trim();
    return {
      uri: KIT_URI_SCHEME + name,
      name,
      description: firstLine || name,
      mimeType: KIT_MIME_TYPE,
    };
  });
}

export function readKitResource(uri: string): { uri: string; mimeType: string; text: string } {
  if (!uri.startsWith(KIT_URI_SCHEME)) {
    throw new Error(`Unknown resource uri: ${uri}`);
  }
  return {
    uri,
    mimeType: KIT_MIME_TYPE,
    text: readKitFile(uri.slice(KIT_URI_SCHEME.length)),
  };
}
