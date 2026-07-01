import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../apps/api/lib/store.mjs';
import { authorize, getEffectiveRole } from '../apps/api/lib/auth.mjs';

async function createTempStore() {
  const dir = await mkdtemp(join(tmpdir(), 'enterprise-dms-'));
  const store = await new Store(dir).init();
  return { store, dir };
}

test('inherits department role when project role is missing', async () => {
  const { store, dir } = await createTempStore();
  try {
    const doc = {
      id: 'doc-scope',
      departmentId: 'dept-eng',
      projectId: null,
      ownerUserId: 'u-alice',
      classification: 'internal',
    };
    const effective = getEffectiveRole(store, 'u-ben', doc);
    assert.equal(effective.role, 'editor');
    const decision = authorize(store, store.findUser('u-ben'), doc, 'edit', { accessTime: '10:00' });
    assert.equal(decision.allowed, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('project role overrides department role', async () => {
  const { store, dir } = await createTempStore();
  try {
    const doc = store.findDocument('doc-apollo-release');
    const effective = getEffectiveRole(store, 'u-ben', doc);
    assert.equal(effective.role, 'viewer');
    const decision = authorize(store, store.findUser('u-ben'), doc, 'edit', { accessTime: '10:00' });
    assert.equal(decision.allowed, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('archived projects are read-only', async () => {
  const { store, dir } = await createTempStore();
  try {
    const doc = store.findDocument('doc-orion-signoff');
    const decision = authorize(store, store.findUser('u-dan'), doc, 'edit', { accessTime: '10:00' });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /read-only/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
