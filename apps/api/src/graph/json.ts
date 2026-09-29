import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { format } from 'prettier';

// Committed JSON written by the graph job, formatted the way npm run lint checks it. Written under
// a temporary name and renamed, so an interrupted run never leaves half a file.
export async function writeJson(path: string, value: unknown): Promise<void> {
  const text = await format(JSON.stringify(value), { parser: 'json', printWidth: 100 });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.part`, text);
  await rename(`${path}.part`, path);
}
