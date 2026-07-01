import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions } from '../apps/api/lib/diff.mjs';

test('produces a line diff for text versions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'enterprise-dms-diff-'));
  try {
    const oldPath = join(dir, 'old.txt');
    const newPath = join(dir, 'new.txt');
    await writeFile(oldPath, 'alpha\nbeta\n');
    await writeFile(newPath, 'alpha\ngamma\n');
    const diff = compareVersions(
      { id: 'v1', fileName: 'old.txt', mimeType: 'text/plain', storagePath: oldPath },
      { id: 'v2', fileName: 'new.txt', mimeType: 'text/plain', storagePath: newPath },
    );
    assert.equal(diff.summary.added > 0, true);
    assert.equal(diff.summary.removed > 0, true);
    assert.equal(diff.kind, 'text');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
