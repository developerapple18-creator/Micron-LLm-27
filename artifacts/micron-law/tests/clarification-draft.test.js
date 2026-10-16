import assert from 'node:assert/strict';
import {
  clarificationDraftKey,
  readClarificationDraft,
  saveClarificationDraft,
  clarificationSubmission,
  pendingClarificationOperation,
  emptyClarificationDraft,
} from '../src/lib/clarification-draft.js';
const store = new Map();
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
  },
});
const questions = [
  {
    id: 'a',
    question: 'من تمثل؟',
    options: ['المدعي', 'المدعى عليه'],
    allow_unknown: true,
    allow_not_applicable: false,
  },
  {
    id: 'b',
    question: 'هل اتفقتم؟',
    options: ['نعم', 'لا'],
    allow_unknown: true,
    allow_not_applicable: true,
  },
  { id: 'c', question: 'متى؟', options: [], allow_unknown: false, allow_not_applicable: false },
];
let n = 0;
function check(actual, expected) {
  assert.deepEqual(actual, expected);
  n++;
}
const key = clarificationDraftKey('owner', 'case', 'parent');
const op = (id, parentOperationId, kind, status = 'completed', failureCode = null) => ({
  id,
  parentOperationId,
  result: { kind },
  status,
  failureCode,
});
const parent = op('parent', null, 'clarification');
check(pendingClarificationOperation([parent])?.id, 'parent');
check(pendingClarificationOperation([parent, op('child', 'parent', 'report')]), undefined);
check(
  pendingClarificationOperation([
    parent,
    op('retryable', 'parent', '', 'failed', 'context_changed'),
  ])?.id,
  'parent',
);
check(pendingClarificationOperation([parent, op('new-root', null, 'report')]), undefined);
check(
  pendingClarificationOperation([parent, op('new-root', null, 'clarification')])?.id,
  'new-root',
);
check(pendingClarificationOperation([parent, op('new-root', null, '', 'running')]), undefined);
check(
  pendingClarificationOperation([parent, op('failed-root', null, '', 'failed', 'case_busy')])?.id,
  'parent',
);
const draft = {
  current: 'b',
  answers: {
    a: { kind: 'option', value: 'المدعى عليه' },
    b: { kind: 'not_applicable', value: 'لا ينطبق' },
    c: { kind: 'custom', value: '  15 أكتوبر 2026\nتفصيل محفوظ  ' },
  },
};
check(readClarificationDraft(key), emptyClarificationDraft());
check(saveClarificationDraft(key, draft), true);
check(readClarificationDraft(key), draft);
for (const args of [
  ['other', 'case', 'parent'],
  ['owner', 'other', 'parent'],
  ['owner', 'case', 'other'],
]) {
  check(
    readClarificationDraft(clarificationDraftKey(args[0], args[1], args[2])),
    emptyClarificationDraft(),
  );
}
let submitted = clarificationSubmission(questions, draft, 'نص حر إضافي لم يحدد سؤالًا');
check(submitted.questionIds, ['a', 'b', 'c']);
check(submitted.content.includes(draft.answers.c.value), true);
check(submitted.content.split('السؤال:').length - 1, 3);
check(submitted.emptyCustom, false);
check(clarificationSubmission(questions, emptyClarificationDraft(), 'سياق فقط').questionIds, []);
check(
  clarificationSubmission(questions, emptyClarificationDraft(), 'سياق فقط').content.endsWith(
    'سياق فقط',
  ),
  true,
);
draft.answers.a = { kind: 'unknown', value: 'لا أعلم' };
check(clarificationSubmission(questions, draft, '').questionIds, ['a', 'b', 'c']);
draft.answers.c = { kind: 'custom', value: '  ' };
submitted = clarificationSubmission(questions, draft, '');
check(submitted.questionIds, ['a', 'b']);
check(submitted.emptyCustom, true);
draft.answers.a = { kind: 'not_applicable', value: 'لا ينطبق' };
draft.answers.b = { kind: 'option', value: 'قيمة غير متاحة' };
draft.answers.foreign = { kind: 'custom', value: 'لا يربط بسؤال آخر' };
check(clarificationSubmission(questions, draft, '').questionIds, []);
delete draft.answers.a;
delete draft.answers.b;
delete draft.answers.c;
check(clarificationSubmission(questions, draft, 'نص حر').questionIds, []);
store.set(key, '{"current":42,"answers":[]}');
check(readClarificationDraft(key), emptyClarificationDraft());
store.set(key, 'invalid');
check(readClarificationDraft(key), emptyClarificationDraft());
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  get() {
    throw Error('blocked');
  },
});
check(readClarificationDraft(key), emptyClarificationDraft());
check(saveClarificationDraft(key, draft), false);
console.log(`PASS: ${n} clarification draft assertions`);
