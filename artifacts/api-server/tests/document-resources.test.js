import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { DocumentResources, pdfWorkingSetBytes } from '../src/lib/document-resources.js';
import { processDocuments, initialProcessingState } from '../src/lib/document-processing.js';
import { beginDocumentExecution } from '../src/lib/document-execution.js';
import { pdfSources } from '../src/lib/analysis-pdf.js';
import { fixtures } from './document-processing.test.js';
import { cases, messages, operations, documents } from './document-resource-db.js';
function barrier() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function operation(s) {
  const id = randomUUID(),
    owner = randomUUID(),
    caseId = randomUUID(),
    messageId = randomUUID();
  s.messages[0].id = messageId;
  cases.set(caseId, owner);
  s.messages.forEach((m) => messages.set(m.id, { owner, caseId }));
  s.pdfs.forEach((d) => {
    d.messageId = messageId;
    Object.assign(documents.get(d.id).row, {
      owner_id: owner,
      case_id: caseId,
      message_id: messageId,
    });
  });
  operations.set(id, {
    id,
    owner_id: owner,
    case_id: caseId,
    message_id: s.messages[0].id,
    input_snapshot: structuredClone(s),
    source_registry: pdfSources(s),
    status: 'pending',
    result: null,
    failure_code: null,
    run_token: null,
    lease_expires_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    started_at: null,
    finished_at: null,
  });
  return { id, owner, caseId, s };
}
export async function run() {
  globalThis.fetch = async () => {
    throw new Error('External requests forbidden');
  };
  let passed = 0;
  async function test(name, fn) {
    await fn();
    passed++;
    process.stdout.write(`PASS ${name}\n`);
  }
  const mb = 1024 * 1024;
  await test('atomic pre-byte envelopes for concurrent 200 MB originals; no count quota', async () => {
    const resources = new DocumentResources(() => ({ available: 900 * mb, heapFree: 900 * mb }));
    const release = await resources.acquire(pdfWorkingSetBytes(200 * mb, true));
    const waiting = barrier();
    let admitted = false;
    const next = resources
      .acquire(600 * mb, undefined, async () => {
        waiting.resolve();
      })
      .then((r) => {
        admitted = true;
        return r;
      });
    await waiting.promise;
    await Promise.resolve();
    assert.equal(admitted, false);
    release();
    const releaseNext = await next;
    releaseNext();
    releaseNext();
    const small = await Promise.all(Array.from({ length: 20 }, () => resources.acquire(1024)));
    small.forEach((r) => r());
  });
  await test('abort and waiting-checkpoint failures do not strand reservations; FIFO', async () => {
    const resources = new DocumentResources(() => ({ available: 100, heapFree: 100 }));
    const release = await resources.acquire(90);
    const c = new AbortController(),
      order = [];
    const aborted = resources.acquire(100, c.signal).then(
      (r) => {
        r();
        throw new Error('Unexpected admission');
      },
      (e) => assert.equal(e.name, 'AbortError'),
    );
    const b = resources.acquire(80).then((r) => {
      order.push(1);
      return r;
    });
    const d = resources.acquire(10).then((r) => {
      order.push(2);
      return r;
    });
    await assert.rejects(
      resources.acquire(100, undefined, async () => {
        throw new Error('fence');
      }),
      /fence/,
    );
    await Promise.resolve();
    c.abort();
    await aborted;
    release();
    const [rb, rd] = await Promise.all([b, d]);
    assert.deepEqual(order, [1, 2]);
    rb();
    rd();
    (await resources.acquire(100))();
  });
  await test('live memory and heap rechecked after release; invalid and impossible sizes fail closed', async () => {
    let available = 100,
      heapFree = 100;
    const resources = new DocumentResources(() => ({ available, heapFree }));
    const release = await resources.acquire(100);
    const waiting = resources.acquire(80);
    await Promise.resolve();
    heapFree = 50;
    release();
    await assert.rejects(waiting, (e) => e.status === 503);
    heapFree = 100;
    available = 40;
    await assert.rejects(resources.acquire(80), (e) => e.status === 503);
    for (const n of [0, -1, NaN, Infinity, 0.5]) await assert.rejects(resources.acquire(n));
    available = 100;
    (await resources.acquire(100))();
  });
  // Actual byte processing plus lifecycle: distinct cases/accounts; all SQL is memory-only.
  const bytes = Buffer.concat([
    Buffer.from('%PDF-1.7\n%'),
    Buffer.alloc(20 * mb, 88),
    Buffer.from('\n%%EOF'),
  ]);
  const headroom = () => ({ available: bytes.length * 5, heapFree: bytes.length * 5 });
  const previous = operation(fixtures.snapshot());
  Object.assign(operations.get(previous.id), {
    status: 'completed',
    result: { title: 'prior report — unchanged' },
  });
  const before = structuredClone(operations.get(previous.id));
  await test('concurrent large cases wait visibly; duplicate execution cannot generate twice; old report retained', async () => {
    const resources = new DocumentResources(headroom);
    const a = operation(fixtures.snapshot(2, bytes)),
      b = operation(fixtures.snapshot(2, bytes));
    const gate = barrier(),
      entered = barrier();
    const pa = fixtures.provider(),
      pb = fixtures.provider();
    let readsB = 0;
    const first = await beginDocumentExecution(a.owner, a.caseId, a.id, a.s, {
      resources,
      pollMs: 1,
      reader: fixtures.reader,
      transport: async (path, init) => {
        if (path === 'files') {
          entered.resolve();
          await gate.promise;
        }
        return pa.transport(path, init);
      },
    });
    await entered.promise;
    const second = await beginDocumentExecution(b.owner, b.caseId, b.id, b.s, {
      resources,
      pollMs: 1,
      reader: async (row) => {
        readsB++;
        return fixtures.reader(row);
      },
      transport: pb.transport,
    });
    // Wait without wall-clock sleeps for the durable waiting checkpoint.
    const deadline = Date.now() + 5000;
    while (operations.get(b.id).input_snapshot.documentProcessing?.stage !== 'waiting_resources') {
      assert(Date.now() < deadline, 'Waiting checkpoint was not reached');
      await new Promise((r) => setImmediate(r));
    }
    assert.equal(readsB, 0);
    assert.equal(pb.bodies.length, 0);
    assert.match(operations.get(b.id).input_snapshot.documentProcessing.message, /بانتظار/);
    const duplicate = await beginDocumentExecution(b.owner, b.caseId, b.id, b.s, {
      resources,
      transport: pb.transport,
    });
    gate.resolve();
    await Promise.all([first.completion, second.completion, duplicate.completion]);
    for (const o of [a, b]) {
      assert.equal(operations.get(o.id).status, 'completed');
      assert.equal(operations.get(o.id).input_snapshot.documentProcessing.units.length, 2);
    }
    assert.equal(pa.bodies.length, 1);
    assert.equal(pb.bodies.length, 1);
    assert.equal(readsB, 2);
    assert.deepEqual(operations.get(previous.id), before);
  });
  await test('failed upload releases its envelope to a queued case without generation replay', async () => {
    const resources = new DocumentResources(headroom),
      gate = barrier(),
      entered = barrier();
    const a = operation(fixtures.snapshot(1, bytes)),
      b = operation(fixtures.snapshot(1, bytes));
    const pa = fixtures.provider(),
      pb = fixtures.provider();
    const first = await beginDocumentExecution(a.owner, a.caseId, a.id, a.s, {
      resources,
      reader: fixtures.reader,
      transport: async (path, init) => {
        if (path === 'files') {
          entered.resolve();
          await gate.promise;
          throw new Error('upload failed');
        }
        return pa.transport(path, init);
      },
    });
    await entered.promise;
    const second = await beginDocumentExecution(b.owner, b.caseId, b.id, b.s, {
      resources,
      reader: fixtures.reader,
      transport: pb.transport,
      pollMs: 1,
    });
    gate.resolve();
    await Promise.all([first.completion, second.completion]);
    assert.equal(operations.get(a.id).status, 'failed');
    assert.equal(pa.bodies.length, 0);
    assert.equal(operations.get(b.id).status, 'completed');
    assert.equal(pb.bodies.length, 1);
    (await resources.acquire(pdfWorkingSetBytes(bytes.length, true)))();
  });
  await test('lost generation POST is never repeated by repeated begin; old reports unchanged', async () => {
    const resources = new DocumentResources(headroom);
    const o = operation(fixtures.snapshot(1, bytes)),
      p = fixtures.provider('lost-post');
    const started = await beginDocumentExecution(o.owner, o.caseId, o.id, o.s, {
      resources,
      transport: p.transport,
      reader: fixtures.reader,
    });
    await started.completion;
    const again = await beginDocumentExecution(o.owner, o.caseId, o.id, o.s, {
      resources,
      transport: p.transport,
      reader: fixtures.reader,
    });
    await again.completion;
    assert.equal(operations.get(o.id).status, 'failed');
    assert.equal(p.bodies.length, 1);
    assert.equal(operations.get(o.id).input_snapshot.pdfEvidence.status, 'submission_uncertain');
    assert.deepEqual(operations.get(previous.id), before);
  });
  await test('lease token lost during wait prevents byte reads, provider requests and report writes', async () => {
    const resources = new DocumentResources(headroom),
      release = await resources.acquire(bytes.length * 3);
    const o = operation(fixtures.snapshot(1, bytes)),
      p = fixtures.provider();
    let reads = 0;
    const started = await beginDocumentExecution(o.owner, o.caseId, o.id, o.s, {
      resources,
      transport: p.transport,
      reader: async (row) => {
        reads++;
        return fixtures.reader(row);
      },
    });
    operations.get(o.id).run_token = 'different-executor';
    release();
    await started.completion;
    assert.equal(reads, 0);
    assert.equal(p.calls.length, 0);
    assert.equal(operations.get(o.id).result, null);
    (await resources.acquire(bytes.length * 3))();
  });
  await test('identity mismatch is caught before downloading bytes and reservation is released', async () => {
    const resources = new DocumentResources(headroom),
      o = operation(fixtures.snapshot(1, bytes));
    documents.get(o.s.pdf.id).row.size = String(bytes.length + 1);
    let reads = 0;
    await assert.rejects(
      processDocuments(
        o.owner,
        o.caseId,
        o.s,
        initialProcessingState(),
        async () => {},
        {},
        {
          resources,
          transport: fixtures.provider().transport,
          reader: async (row) => {
            reads++;
            return fixtures.reader(row);
          },
        },
      ),
    );
    assert.equal(reads, 0);
    (await resources.acquire(bytes.length * 3))();
  });
  await test('read and held-checkpoint failures release memory; aborted wait never reads or POSTs', async () => {
    const resources = new DocumentResources(headroom),
      o = operation(fixtures.snapshot(1, bytes));
    const p = fixtures.provider();
    await assert.rejects(
      processDocuments(
        o.owner,
        o.caseId,
        o.s,
        initialProcessingState(),
        async () => {},
        {},
        {
          resources,
          transport: p.transport,
          reader: async () => {
            throw new Error('read failed');
          },
        },
      ),
      /read failed/,
    );
    (await resources.acquire(bytes.length * 3))();
    await assert.rejects(
      processDocuments(
        o.owner,
        o.caseId,
        o.s,
        initialProcessingState(),
        async () => {
          throw new Error('checkpoint failed');
        },
        {},
        { resources, transport: p.transport, reader: fixtures.reader },
      ),
      /checkpoint failed/,
    );
    const release = await resources.acquire(bytes.length * 3),
      signal = new AbortController(),
      entered = barrier();
    let reads = 0;
    const waiting = processDocuments(
      o.owner,
      o.caseId,
      o.s,
      initialProcessingState(),
      async (st) => {
        if (st.stage === 'waiting_resources') entered.resolve();
      },
      {},
      {
        resources,
        signal: signal.signal,
        transport: p.transport,
        reader: async (row) => {
          reads++;
          return fixtures.reader(row);
        },
      },
    );
    const rejected = assert.rejects(waiting, (e) => e.name === 'AbortError');
    await entered.promise;
    signal.abort();
    await rejected;
    assert.equal(reads, 0);
    assert.equal(p.calls.length, 0);
    release();
    (await resources.acquire(bytes.length * 3))();
  });
  await test('token-driven PDF reloading and splitting also acquire/release reservations', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.addPage();
    const o = operation(fixtures.snapshot(1, Buffer.from(await pdf.save()))),
      p = fixtures.provider('complete', true);
    let acquisitions = 0;
    class Tracked extends DocumentResources {
      async acquire(...args) {
        acquisitions++;
        return super.acquire(...args);
      }
    }
    const resources = new Tracked(() => ({ available: mb, heapFree: mb }));
    const state = initialProcessingState();
    await processDocuments(
      o.owner,
      o.caseId,
      o.s,
      state,
      async () => {},
      {},
      { resources, reader: fixtures.reader, transport: p.transport, pollMs: 1 },
    );
    assert.equal(acquisitions, 2);
    assert.equal(state.units.length, 2);
    assert.equal(p.bodies.length, 1);
    (await resources.acquire(mb))();
  });
  process.stdout.write(
    `TOTAL ${passed} resource groups; mocked SQL/storage/provider only, zero external requests.\n`,
  );
}
