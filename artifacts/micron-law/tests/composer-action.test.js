import assert from 'node:assert/strict';
import {
  readComposerIntent,
  saveComposerIntent,
  readSavedUpdates,
  saveUpdateReceipt,
  UPDATED_ANALYSIS_REQUEST,
} from '../src/lib/composer-action.js';
const store = new Map();
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  },
});
const caseA = '00000000-0000-4000-8000-000000000001';
const caseB = '00000000-0000-4000-8000-000000000002';
const request = '00000000-0000-4000-8000-000000000003';
assert.equal(readComposerIntent('A', caseA), 'question');
saveComposerIntent('A', caseA, 'analysis');
assert.equal(readComposerIntent('A', caseA), 'analysis');
assert.equal(readComposerIntent('B', caseA), 'question');
assert.equal(readComposerIntent('A', caseB), 'question');
saveComposerIntent('A', caseB, 'update');
assert.equal(readComposerIntent('A', caseA), 'analysis');
assert.equal(readComposerIntent('A', caseB), 'update');
saveComposerIntent('A', caseA, 'continue');
assert.equal(readComposerIntent('A', caseA), 'continue');
saveComposerIntent('A', caseA, 'question');
assert.equal(readComposerIntent('A', caseA), 'question');
store.set(`micron:composer-action:A:${caseA}`, 'execute-now');
assert.equal(readComposerIntent('A', caseA), 'question');
saveUpdateReceipt('A', caseA, request);
assert.equal(readSavedUpdates('A')[caseA], request);
assert.deepEqual(readSavedUpdates('B'), {});
saveUpdateReceipt('A', caseB, request);
assert.equal(readSavedUpdates('A')[caseA], request);
assert.equal(readSavedUpdates('A')[caseB], request);
store.set('micron:saved-updates:A', '{"not-a-case":"not-a-request"}');
assert.deepEqual(readSavedUpdates('A'), {});
store.set('micron:saved-updates:A', '{bad json');
assert.deepEqual(readSavedUpdates('A'), {});
assert(UPDATED_ANALYSIS_REQUEST.trim().length > 0 && UPDATED_ANALYSIS_REQUEST.length < 4000);
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  get() {
    throw new Error('Storage unavailable');
  },
});
assert.equal(readComposerIntent('A', caseA), 'question');
assert.deepEqual(readSavedUpdates('A'), {});
assert.doesNotThrow(() => saveComposerIntent('A', caseA, 'analysis'));
assert.doesNotThrow(() => saveUpdateReceipt('A', caseA, request));
console.log(
  'PASS: 20 focused assertions — defaults, draft action recovery, user/case isolation, save receipt recovery, invalid/blocked storage.',
);
