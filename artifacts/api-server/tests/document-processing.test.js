import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { PDFDocument, PDFName } from 'pdf-lib';
import { Document, Packer, Paragraph } from 'docx';
import { documents } from './document-test-db.js';
import { processDocuments, initialProcessingState } from '../src/lib/document-processing.js';
import { analysisContractErrors, sectionOrder } from '../src/lib/analysis-contract.js';
import { captureProviderError, ProviderFailure } from '../src/lib/analysis-provider.js';
import { wordVisualFixture } from './word-visual-fixture.js';
import { loadPdf } from '../src/lib/analysis-pdf.js';
import { pool } from './document-test-db.js';
const owner = randomUUID(),
  caseId = randomUUID(),
  messageId = randomUUID();
function add(bytes, filename = 'synthetic.pdf', contentType = 'application/pdf') {
  const id = randomUUID();
  documents.set(id, {
    bytes,
    row: {
      id,
      owner_id: owner,
      case_id: caseId,
      message_id: messageId,
      filename,
      content_type: contentType,
      status: 'ready',
      generation: '100',
      size: String(bytes.length),
      storage_path: 'fixture-only',
    },
  });
  return {
    id,
    messageId,
    filename,
    contentType,
    generation: '100',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
function snapshot(count = 1, buffer) {
  const pdfs = Array.from({ length: count }, (_, i) =>
    add(buffer ?? Buffer.from(`%PDF-1.7\n%synthetic-${i}\n%%EOF`), `synthetic-${i}.pdf`),
  );
  return {
    processingVersion: 1,
    round: 0,
    messages: [{ id: messageId, content: 'قضية اختبار اصطناعية دون بيانات حقيقية.' }],
    clarifications: [],
    pdf: pdfs[0],
    pdfs,
  };
}
function provider(mode = 'complete', tokenOverflow = false) {
  const files = new Map();
  const calls = [],
    bodies = [];
  let sequence = 0,
    polls = 0,
    lastBody;
  const transport = async (path, init) => {
    calls.push({ path, method: init.method ?? 'GET' });
    if (path === 'files') {
      const form = init.body,
        file = form.get('file');
      assert.equal(form.get('purpose'), 'user_data');
      assert.equal(form.get('expires_after[seconds]'), '86400');
      const id = `file_fixture${++sequence}`;
      files.set(id, {
        name: file.name,
        size: file.size,
        bytes: Buffer.from(await file.arrayBuffer()),
      });
      return Response.json({ id, bytes: file.size });
    }
    if (path.startsWith('files/')) return Response.json({ deleted: true });
    if (path === 'responses/input_tokens') {
      const b = JSON.parse(String(init.body));
      const units = b.input.at(-1).content.filter((p) => p.type === 'input_file');
      const oversized =
        tokenOverflow && units.some((u) => files.get(u.file_id)?.name.includes('-0-0.'));
      if (oversized && mode === 'count-rejected')
        return Response.json(
          { error: { code: 'context_length_exceeded', type: 'invalid_request_error' } },
          { status: 400 },
        );
      const n = oversized ? 923_000 : 100 + units.length * 100;
      return Response.json({ input_tokens: n });
    }
    if (path === 'responses') {
      lastBody = JSON.parse(String(init.body));
      bodies.push(lastBody);
      assert.equal(lastBody.store, false);
      assert.equal(lastBody.background, true);
      assert.equal(lastBody.model, 'gpt-6.1-sol');
      const fileParts = lastBody.input.at(-1).content.filter((p) => p.type === 'input_file');
      assert(fileParts.every((p) => p.file_id && !p.file_data));
      if (mode === '500')
        return Response.json(
          {
            error: {
              code: 'server_error',
              type: 'server_error',
              message: 'CONFIDENTIAL_MUST_NEVER_BE_RETAINED',
            },
          },
          { status: 500, headers: { 'x-request-id': 'req_fixture500' } },
        );
      if (mode === 'timeout') throw new DOMException('fixture deadline', 'TimeoutError');
      if (mode === 'lost-post') throw new TypeError('simulated lost response');
      return Response.json({ id: `resp_fixture${bodies.length}`, status: 'queued' });
    }
    if (path.startsWith('responses/')) {
      polls++;
      if (mode === '404') return Response.json({ error: { code: 'unknown' } }, { status: 404 });
      if (mode === 'reconnect' && polls === 1) throw new TypeError('temporary network loss');
      if (mode === 'delayed' && polls < 4)
        return Response.json({ id: path.split('/')[1], status: 'in_progress' });
      if (mode === 'incomplete')
        return Response.json({
          id: path.split('/')[1],
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          usage: { input_tokens: 55, output_tokens: 12000 },
          output: [],
        });
      const context = JSON.parse(lastBody.input.at(-1).content[0].text);
      const text =
        lastBody.text.format.name === 'document_evidence_record'
          ? {
              complete: true,
              units: context.document_units.map((u) => u.id),
              text: 'سجل أدلة اصطناعي مفصل يشمل جميع الوحدات، وليس نتيجة قراءة فعلية.',
            }
          : {
              kind: 'report',
              clarification: null,
              blocked: null,
              report: {
                title: 'تقرير اصطناعي',
                sections: sectionOrder.map((section_id) => ({
                  section_id,
                  blocks: [
                    {
                      text: 'نتيجة اختبار بروتوكول فقط.',
                      basis: 'documented',
                      source_refs: context.source_registry
                        .filter((s) => s.basis === 'documented')
                        .map((s) => s.id),
                    },
                  ],
                })),
                alerts: [],
                change_summary: null,
              },
            };
      return Response.json({
        id: path.split('/')[1],
        status: 'completed',
        model: 'gpt-6.1-sol',
        usage: { input_tokens: 200, output_tokens: 700 },
        output: [
          { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(text) }] },
        ],
      });
    }
    throw new Error('Unmocked HTTP forbidden');
  };
  return { transport, calls, bodies, files };
}
const reader = async (row) => documents.get(row.id).bytes;
export const fixtures = { snapshot, provider, reader, owner, caseId };
export async function run() {
  // Any accidental use of the real transport or object storage fails closed.
  globalThis.fetch = async () => {
    throw new Error('External requests forbidden in fixtures');
  };
  let passed = 0;
  async function happy(name, s, mode = 'complete', overflow = false) {
    const p = provider(mode, overflow),
      state = initialProcessingState(),
      telemetry = {};
    const checkpoints = [];
    const r = await processDocuments(
      owner,
      caseId,
      s,
      state,
      async (st) => {
        checkpoints.push(structuredClone(st));
      },
      telemetry,
      { transport: p.transport, reader, pollMs: 1 },
    );
    assert.equal(r.result && r.result.kind, 'report');
    assert.deepEqual(
      analysisContractErrors(
        r.result,
        [...s.messages.map((m) => m.id), ...s.pdfs.map((d) => d.id)],
        s.pdfs.map((d) => d.id),
      ),
      [],
    );
    assert.equal(new Set(state.units.map((u) => u.sourceId)).size, s.pdfs.length);
    assert(checkpoints.some((c) => c.stage === 'validation'));
    assert(
      p.bodies.every((b) =>
        b.text.format.name !== 'document_evidence_record'
          ? b.max_output_tokens === 12000
          : b.max_output_tokens === 128000,
      ),
    );
    passed++;
    process.stdout.write(`PASS ${name}\n`);
    return { p, state };
  }
  await happy('single PDF native references', snapshot());
  const metadataOnly = snapshot(3);
  for (const d of metadataOnly.pdfs) delete d.sha256;
  await happy('metadata-only preparation hashes after claim', metadataOnly);
  assert(metadataOnly.pdfs.every((d) => /^[a-f0-9]{64}$/.test(d.sha256)));
  await happy('three PDFs', snapshot(3));
  const ten = await happy('ten PDFs no base64', snapshot(10));
  assert.equal(ten.p.bodies.length, 1);
  const mixed = snapshot(2);
  mixed.pdfs.push(
    add(
      Buffer.from(
        await Packer.toBuffer(
          new Document({ sections: [{ children: [new Paragraph('ملف Word اصطناعي.')] }] }),
        ),
      ),
      'synthetic.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ),
  );
  await happy('PDF and genuine DOCX', mixed);
  const visual = await wordVisualFixture();
  const visualSnapshot = snapshot();
  const wordIdentity = add(
    visual.bytes,
    'arabic-table-image-stamp.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  visualSnapshot.pdfs.push(wordIdentity);
  const original = Buffer.from(visual.bytes);
  const metadataBefore = JSON.stringify(documents.get(wordIdentity.id).row);
  const visualRun = await happy(
    'Arabic DOCX tables/body/header/footer images and synthetic stamp (transport only)',
    visualSnapshot,
  );
  const uploadedWord = [...visualRun.p.files.values()].find((f) => f.name.endsWith('.docx'));
  assert(
    uploadedWord.bytes.equals(original),
    'native upload retains the entire DOCX, including embedded media',
  );
  assert(documents.get(wordIdentity.id).bytes.equals(original), 'fixture original is unchanged');
  assert.equal(JSON.stringify(documents.get(wordIdentity.id).row), metadataBefore);
  assert.equal(wordIdentity.sha256, createHash('sha256').update(original).digest('hex'));
  const visualContext = JSON.parse(visualRun.p.bodies[0].input.at(-1).content[0].text);
  const registeredWord = visualContext.attachment_registry.find((d) => d.id === wordIdentity.id);
  assert.equal(registeredWord.coverage, 'native_text_only_embedded_images_not_read');
  assert.equal(registeredWord.generation, wordIdentity.generation);
  assert(
    visualContext.source_registry.some(
      (s) =>
        s.id === wordIdentity.id &&
        s.attachmentId === wordIdentity.id &&
        s.messageId === wordIdentity.messageId &&
        s.sha256 === wordIdentity.sha256,
    ),
  );
  assert(
    visualContext.document_units.some(
      (u) =>
        u.sourceId === wordIdentity.id &&
        u.sha256 === wordIdentity.sha256 &&
        u.firstPage === undefined,
    ),
  );
  let unauthorizedReads = 0;
  const deniedReader = async () => {
    unauthorizedReads++;
    return original;
  };
  await assert.rejects(loadPdf(pool, randomUUID(), caseId, wordIdentity.id, deniedReader));
  await assert.rejects(loadPdf(pool, owner, randomUUID(), wordIdentity.id, deniedReader));
  assert.equal(unauthorizedReads, 0, 'another account/case cannot read original Word bytes');
  process.stdout.write(
    'PASS Word media inventory, immutable fixture/source identity, explicit text-only coverage, ownership/case isolation; no rendering or visual understanding claimed\n',
  );
  const scanned = await PDFDocument.create();
  const image = await scanned.embedPng(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  scanned.addPage().drawImage(image, { x: 20, y: 20, width: 300, height: 500 });
  await happy(
    'image-only PDF bytes preserved natively (not OCR quality)',
    snapshot(1, Buffer.from(await scanned.save())),
  );
  scanned.addPage().drawText('Synthetic text and preceding image page');
  await happy('mixed text/image PDF protocol', snapshot(1, Buffer.from(await scanned.save())));
  await happy('long running queued + polling no repeat', snapshot(3), 'delayed');
  const reconnected = await happy('temporary GET interruption', snapshot(), 'reconnect');
  assert.equal(reconnected.p.bodies.length, 1);
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Synthetic page 1');
  pdf.addPage().drawText('Synthetic page 2');
  const divided = await happy(
    'measured context overflow splits PDF pages',
    snapshot(1, Buffer.from(await pdf.save())),
    'complete',
    true,
  );
  assert.equal(divided.state.units.length, 2);
  assert.deepEqual(
    divided.state.units.map((u) => [u.firstPage, u.lastPage]),
    [
      [1, 1],
      [2, 2],
    ],
  );
  await happy(
    'provider context rejection partitions without inventing count',
    snapshot(1, Buffer.from(await pdf.save())),
    'count-rejected',
    true,
  );
  const large = await PDFDocument.create();
  for (let i = 0; i < 3; i++) {
    const page = large.addPage();
    // Valid PDF comments in page content streams, not external/confidential bytes.
    const stream = large.context.stream(Buffer.from('%' + 'X'.repeat(20_000_000) + '\n'));
    page.node.set(PDFName.of('Contents'), large.context.register(stream));
  }
  const largeBytes = Buffer.from(await large.save({ useObjectStreams: false }));
  assert(largeBytes.length > 50_000_000);
  const staged = await happy('60 MB individual PDF + staged evidence', snapshot(1, largeBytes));
  assert.equal(staged.state.batches.length, 2);
  assert.equal(staged.p.bodies.length, 3);
  assert(staged.state.units.every((u) => u.size < 50_000_000));
  assert.deepEqual(
    staged.state.units.map((u) => [u.firstPage, u.lastPage]),
    [
      [1, 2],
      [3, 3],
    ],
  );
  for (const [mode, expected] of [
    ['500', 'provider_error'],
    ['incomplete', 'incomplete_response'],
    ['timeout', 'timeout'],
    ['lost-post', 'provider_error'],
    ['404', 'interrupted'],
  ]) {
    const p = provider(mode),
      telemetry = {},
      state = initialProcessingState();
    await assert.rejects(
      processDocuments(owner, caseId, snapshot(3), state, async () => {}, telemetry, {
        transport: p.transport,
        reader,
        pollMs: 1,
      }),
      (e) => e instanceof ProviderFailure && e.code === expected,
    );
    assert.equal(p.bodies.length, 1);
    assert(!JSON.stringify(telemetry).includes('CONFIDENTIAL'));
    if (mode === '500') {
      assert.equal(telemetry.requestId, 'req_fixture500');
      assert.equal(telemetry.errorCode, 'server_error');
    }
    if (mode === 'incomplete') {
      assert.equal(telemetry.incompleteReason, 'max_output_tokens');
      assert.equal(telemetry.usage?.output_tokens, 12000);
    }
    passed++;
    process.stdout.write(`PASS ${mode} rejects without generation retry\n`);
  }
  const pending = initialProcessingState();
  pending.recoveryOnly = true;
  pending.posting = true;
  const p = provider();
  await assert.rejects(
    processDocuments(
      owner,
      caseId,
      snapshot(),
      pending,
      async () => {},
      {},
      { transport: p.transport, reader },
    ),
    (e) => e instanceof ProviderFailure && e.code === 'interrupted',
  );
  assert.equal(p.bodies.length, 0);
  passed++;
  process.stdout.write('PASS ambiguous recovery never POSTs\n');
  const t = {};
  captureProviderError(
    new Response('', {
      status: 500,
      headers: { 'x-request-id': 'bad header contains confidential text' },
    }),
    JSON.stringify({
      error: { code: 'PRIVATE', type: 'PRIVATE', message: 'PRIVATE', param: 'PRIVATE' },
    }),
    t,
  );
  assert.equal(t.errorCode, 'unknown');
  assert.equal(t.requestId, undefined);
  assert(!JSON.stringify(t).includes('PRIVATE'));
  passed++;
  process.stdout.write('PASS sanitized diagnostics allowlist\n');
  process.stdout.write(
    `TOTAL ${passed} groups; all provider/storage/DB fixture-only, zero external fetches.\n`,
  );
}
