import { access } from 'node:fs/promises';
import { join } from 'node:path';

export async function assertInitialized(cwd: string): Promise<void> {
  try {
    await access(join(cwd, '.nightshift'));
  } catch {
    throw new Error('Not initialized: run `nightshift init` first');
  }
}

export async function assertNotExists(
  path: string,
  message: string,
): Promise<void> {
  let exists = false;
  try {
    await access(path);
    exists = true;
  } catch {
    // ENOENT expected — file does not exist
  }
  if (exists) throw new Error(message);
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function assertValidName(name: string, label: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `Invalid ${label} name "${name}": must be lowercase alphanumeric with hyphens (e.g. my-agent)`,
    );
  }
}
