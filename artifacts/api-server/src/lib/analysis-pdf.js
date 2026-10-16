import { createHash } from 'node:crypto';
import { documentMemoryCapacity, pdfWorkingSetBytes } from './document-resources.js';
import { pool } from '@workspace/db';
import { HttpError } from './security.js';
import { storageFile } from './private-files.js';
import { logger } from './logger.js';
import {
  maxFileBytes,
  maxPdfAnalysisAttachments,
  pdfSelectionIssue,
  documentType,
} from './attachment-policy.js';
import { buildAnalysisRequest } from './analysis-provider.js';
/** Working-set envelope: two raw copies plus three UTF-16 Base64/JSON copies.
 * This is host memory admission, never an estimate of PDF/model token counts. */
export function assertPdfMemoryCapacity(rawBytes, resources, native = false) {
  const required = pdfWorkingSetBytes(rawBytes, native);
  const { available, heapFree } = resources ?? documentMemoryCapacity();
  if (required > available || required > heapFree)
    throw new HttpError(
      503,
      'ذاكرة الخادم المتاحة الآن لا تكفي لتجهيز المستند دون اختصاره. الأصل محفوظ؛ لم يبدأ إرسال التحليل.',
    );
}
/** Read only a pinned immutable generation, bounded in bytes and time. */
export const readOriginalPdf = async (row) => {
  const file = storageFile(row.storage_path, row.generation);
  let stream,
    expired = false;
  let timer;
  const timeoutError = () =>
    new HttpError(503, 'انتهت مهلة استرجاع المستند الأصلي؛ لم يبدأ طلب التوليد.');
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      stream?.destroy();
      reject(timeoutError());
    }, 600_000);
  });
  try {
    return await Promise.race([
      deadline,
      (async () => {
        const [metadata] = await file.getMetadata();
        if (expired) throw timeoutError();
        if (
          String(metadata.generation) !== row.generation ||
          Number(metadata.size) !== Number(row.size) ||
          metadata.contentType !== row.content_type
        )
          throw new HttpError(409, 'تعذر مطابقة أصل PDF المحفوظ؛ لم يُرسل للتحليل.');
        stream = file.createReadStream();
        const chunks = [];
        let size = 0;
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > maxFileBytes || size > Number(row.size))
            throw new HttpError(409, 'حجم الأصل لا يطابق النسخة المختارة.');
          chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    stream?.destroy();
  }
};
export async function loadPdf(client, owner, caseId, id, reader = readOriginalPdf, expected) {
  const { rows } = await client.query(
    'SELECT * FROM case_attachments WHERE id=$1 AND owner_id=$2 AND case_id=$3',
    [id, owner, caseId],
  );
  const row = rows[0];
  if (!row || row.status !== 'ready' || !row.message_id || !row.generation)
    throw new HttpError(409, 'اختر مرفقًا أصليًا مكتملًا ومحفوظًا مع رسالة في هذه القضية.');
  if (!documentType(row.filename, row.content_type) || Number(row.size) > maxFileBytes)
    throw new HttpError(409, 'المرفق محفوظ، لكن نوعه غير مدعوم لمعالجة المستندات.');
  if (
    expected &&
    (row.id !== expected.id ||
      row.message_id !== expected.messageId ||
      row.filename !== expected.filename ||
      String(row.generation) !== expected.generation ||
      Number(row.size) !== expected.size ||
      row.content_type !== (expected.contentType ?? 'application/pdf'))
  )
    throw new HttpError(409, 'تغيّرت هوية المستند الأصلي؛ لم تُحمّل بايتات خارج الحجز المعتمد.');
  const start = performance.now();
  const bytes = await reader(row);
  // Structural admission only; no extraction, OCR, page counting or legal interpretation.
  if (
    bytes.length !== Number(row.size) ||
    bytes.length < 1 ||
    bytes.length > maxFileBytes ||
    (row.content_type === 'application/pdf' &&
      (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) ||
        !bytes.subarray(-1024).includes(Buffer.from('%%EOF')))) ||
    (row.filename.toLowerCase().endsWith('.docx') &&
      !bytes.subarray(0, 2).equals(Buffer.from('PK'))) ||
    (row.filename.toLowerCase().endsWith('.doc') &&
      !bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')))
  )
    throw new HttpError(
      409,
      'البايتات الفعلية لا تطابق المستند المقبول؛ بقي الأصل محفوظًا دون إرسال.',
    );
  const identity = {
    id: row.id,
    messageId: row.message_id,
    filename: row.filename,
    generation: String(row.generation),
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    contentType: row.content_type,
  };
  return { identity, bytes, storageRetrievalMs: performance.now() - start };
}
export function selectedPdfs(snapshot) {
  const docs = snapshot.pdfs ?? (snapshot.pdf ? [snapshot.pdf] : []);
  if (
    !docs.length ||
    docs.length > maxPdfAnalysisAttachments ||
    new Set(docs.map((d) => d.id)).size !== docs.length
  )
    throw new HttpError(409, 'اختر مستندات محفوظة؛ لا يُسمح بتكرار معرّف المرفق.');
  const issue = pdfSelectionIssue(
    docs.map((d) => ({ ...d, contentType: d.contentType ?? 'application/pdf' })),
  );
  if (issue) throw new HttpError(409, issue);
  if (snapshot.pdf && JSON.stringify(snapshot.pdf) !== JSON.stringify(docs[0]))
    throw new HttpError(409, 'هوية مجموعة المستندات لا تطابق العملية المحفوظة.');
  return docs;
}
export async function pdfSnapshot(client, owner, caseId, attachmentId, reader) {
  const preparationStart = performance.now();
  const ids = typeof attachmentId === 'string' ? [attachmentId] : attachmentId;
  if (!ids.length || ids.length > maxPdfAnalysisAttachments || new Set(ids).size !== ids.length)
    throw new HttpError(409, 'اختر مستندات محفوظة؛ لا يُسمح بتكرار معرّف المرفق.');
  // Inspect ALL selected metadata before retrieving any bytes. Never slice or deduplicate.
  const metadata = await client.query(
    'SELECT * FROM case_attachments WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND case_id=$3',
    [ids, owner, caseId],
  );
  if (
    metadata.rows.length !== ids.length ||
    metadata.rows.some((r) => r.status !== 'ready' || !r.message_id || !r.generation)
  )
    throw new HttpError(
      409,
      'تعذر اعتماد جميع المرفقات: يجب أن تكون PDF أصلية مكتملة ومحفوظة في حسابك وهذه القضية. لم يبدأ التحليل.',
    );
  const issue = pdfSelectionIssue(
    metadata.rows.map((r) => ({ ...r, size: Number(r.size), contentType: r.content_type })),
  );
  if (issue) throw new HttpError(409, issue);
  const documents = [];
  // Preparation pins owned immutable generations without downloading documents
  // while holding the case lock or the browser's submission request open.
  for (const id of ids) {
    const r = metadata.rows.find((r) => r.id === id);
    documents.push(
      reader
        ? (await loadPdf(client, owner, caseId, id, reader)).identity
        : {
            id: r.id,
            messageId: r.message_id,
            filename: r.filename,
            contentType: r.content_type,
            generation: r.generation,
            size: Number(r.size),
          },
    );
  }
  const identity = documents[0];
  selectedPdfs({ pdf: identity, pdfs: documents });
  const { rows } = await client.query(
    'SELECT id,content,clarification FROM case_messages WHERE owner_id=$1 AND case_id=$2 ORDER BY sequence',
    [owner, caseId],
  );
  if (documents.some((d) => !rows.some((m) => m.id === d.messageId)))
    throw new HttpError(409, 'مرجع رسالة المرفق غير صالح.');
  logger.info(
    {
      stage: 'attachment_validation_retrieval',
      durationMs: performance.now() - preparationStart,
      documentCount: documents.length,
      rawBytes: documents.reduce((sum, d) => sum + d.size, 0),
    },
    'Attachment duration',
  );
  return {
    processingVersion: 1,
    round: 0,
    messages: rows.map((m) => ({
      id: m.id,
      content: m.content,
      ...(m.clarification ? { clarification: m.clarification } : {}),
    })),
    clarifications: [],
    pdf: identity,
    pdfs: documents,
    pdfEvidence: {
      originalStored: true,
      eligible: true,
      identity,
      documents,
      method: 'native_file_ids',
      providerCopy: 'temporary_files_api',
      pageProvenance: 'unavailable',
      pageCoverage: 'not_verified',
      status: 'prepared_not_submitted',
      submitted: false,
    },
  };
}
export function pdfSources(snapshot) {
  return [
    ...snapshot.messages.map((m) => ({ id: m.id, messageId: m.id, basis: 'lawyer_statement' })),
    ...selectedPdfs(snapshot).map((pdf) => ({
      id: pdf.id,
      messageId: pdf.messageId,
      basis: 'documented',
      attachmentId: pdf.id,
      filename: pdf.filename,
      generation: pdf.generation,
      sha256: pdf.sha256,
    })),
  ];
}
export async function verifiedPdf(owner, caseId, snapshot, reader) {
  const started = performance.now();
  assertPdfMemoryCapacity(selectedPdfs(snapshot).reduce((sum, d) => sum + d.size, 0));
  const loaded = [];
  for (const identity of selectedPdfs(snapshot)) {
    const doc = await loadPdf(pool, owner, caseId, identity.id, reader);
    if (
      Object.keys(doc.identity).some((key) =>
        key === 'sha256' && !identity.sha256 ? false : doc.identity[key] !== identity[key],
      )
    )
      throw new HttpError(
        409,
        'تغيّر أحد أصول PDF المختارة؛ لم يُرسل أي مستند. يلزم إعداد عملية جديدة.',
      );
    loaded.push(doc);
  }
  const saved = await pool.query(
    'SELECT id,content FROM case_messages WHERE owner_id=$1 AND case_id=$2 ORDER BY sequence',
    [owner, caseId],
  );
  if (
    JSON.stringify(saved.rows.map((m) => ({ id: m.id, content: m.content }))) !==
    JSON.stringify(snapshot.messages.map((m) => ({ id: m.id, content: m.content })))
  )
    throw new HttpError(409, 'حُفظت رسائل جديدة بعد تهيئة PDF؛ أعد التهيئة بالسياق المحدّث.');
  return { bytes: loaded.map((d) => d.bytes), storageRetrievalMs: performance.now() - started };
}
export function buildPdfRequest(snapshot, bytes) {
  const start = performance.now();
  const documents = selectedPdfs(snapshot),
    files = Buffer.isBuffer(bytes) ? [bytes] : bytes;
  assertPdfMemoryCapacity(documents.reduce((sum, d) => sum + d.size, 0));
  if (
    files.length !== documents.length ||
    documents.some(
      (d, i) =>
        files[i].length !== d.size ||
        createHash('sha256').update(files[i]).digest('hex') !== d.sha256,
    )
  )
    throw new HttpError(409, 'لم تتطابق جميع بايتات المستندات المختارة؛ لم يبدأ أي طلب مدفوع.');
  const built = buildAnalysisRequest(snapshot.messages[0].content, snapshot.messages[0].id);
  const context = JSON.parse(built.request.input[2].content);
  context.lawyer_message = snapshot.messages.at(-1).content;
  context.previous_messages = snapshot.messages;
  context.attachment_registry = documents.map((d) => ({
    ...d,
    status: 'stored_original',
    page_provenance: 'unavailable',
    page_coverage: 'not_verified',
  }));
  context.source_registry = pdfSources(snapshot);
  // No Files API resource and no public/signed URL; bytes live only in this request.
  const request = {
    ...built.request,
    input: [
      ...built.request.input.slice(0, 2),
      {
        role: 'user',
        content: [
          { type: 'input_text', text: JSON.stringify(context) },
          ...documents.map((d, i) => ({
            type: 'input_file',
            filename: d.filename,
            file_data: `data:application/pdf;base64,${files[i].toString('base64')}`,
          })),
        ],
      },
    ],
  };
  // PDF page/image tokens are unknown until provider usage arrives. No invented reservation.
  return { request, providerFilePreparationMs: performance.now() - start };
}
