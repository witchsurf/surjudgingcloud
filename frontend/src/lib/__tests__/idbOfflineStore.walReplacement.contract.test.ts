import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('offline WAL persistence contract', () => {
  it('replaces the durable WAL so acknowledged mutations are removed', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/idbOfflineStore.ts'),
      'utf8',
    );
    const walPutAll = source.slice(
      source.indexOf('export async function walPutAll'),
      source.indexOf('export async function walRemove'),
    );

    expect(walPutAll).toContain('await tx.store.clear();');
  });
});
