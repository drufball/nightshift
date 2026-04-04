import type { Database } from '~/db/index';
import { resolveCwd } from './teams';

export async function getDb(): Promise<Database> {
  const { getDbPath, openDb } = await import('~/db/index');
  return openDb(getDbPath(await resolveCwd()));
}
