import { createStore } from '../lib/store.mjs';

const store = await createStore();
const retentionDays = Number(store.getSettings().retentionDays || process.env.RETENTION_DAYS || 365);
const removed = await store.cleanupRetention(retentionDays);
console.log(JSON.stringify({ removed, retentionDays }, null, 2));
