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
    assert.ok(diff.rawChanges);
    assert.ok(diff.rawSummary);
    assert.equal(diff.rawSummary.added > 0, true);
    assert.equal(diff.rawSummary.removed > 0, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('raw diff captures full file bytes for docx', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'enterprise-dms-diff-raw-'));
  try {
    const oldPath = join(dir, 'old.docx');
    const newPath = join(dir, 'new.docx');
    await writeFile(oldPath, 'PK\x03\x04old-zip-content');
    await writeFile(newPath, 'PK\x03\x04new-zip-content');
    const diff = compareVersions(
      { id: 'v1', fileName: 'old.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', storagePath: oldPath },
      { id: 'v2', fileName: 'new.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', storagePath: newPath },
    );
    assert.equal(diff.kind, 'docx-xml');
    assert.equal(diff.rawKind, 'docx-raw');
    assert.ok(diff.rawChanges.length > 0);
    assert.equal(diff.rawSummary.added > 0, true);
    assert.equal(diff.rawSummary.removed > 0, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
