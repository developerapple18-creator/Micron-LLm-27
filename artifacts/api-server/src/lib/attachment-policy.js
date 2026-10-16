import { HttpError } from './security.js';
// Owner-approved decimal storage limits. Analysis eligibility is separate.
// No development-only count/case quota. JSON body and rate guards remain.
export const maxMessageAttachments = Number.MAX_SAFE_INTEGER;
export const maxCaseAttachments = Number.MAX_SAFE_INTEGER;
export const maxCaseBytes = Number.MAX_SAFE_INTEGER;
// Files API upload capacity; PDF input is partitioned into <=50 MB units.
export const maxFileBytes = 512_000_000;
// OpenAI: each file strictly below 50 MB; aggregate at most 50 MB.
export const maxPdfAnalysisBytes = 49_999_999;
export const maxPdfAnalysisAttachments = maxMessageAttachments;
/** Provider raw-file aggregate, not Base64 bytes or inferred model tokens. */
export function pdfCombinedLimit() {
  return 50_000_000;
}
export function pdfSelectionIssue(files) {
  if (new Set(files.map((f) => f.id)).size !== files.length)
    return 'تكرر اختيار المرفق نفسه؛ اختر ملفات مختلفة دون تكرار.';
  const unsupported = files.filter((f) => !documentType(f.filename, f.contentType));
  if (unsupported.length)
    return `التحليل يدعم PDF وDOC وDOCX وTXT؛ نوع غير مدعوم: ${unsupported.map((f) => f.filename).join('، ')}. لن يُستبعد بصمت.`;
  if (files.some((f) => !Number.isSafeInteger(f.size) || f.size < 1 || f.size > maxFileBytes))
    return 'المرفقات محفوظة، لكن الحجم يتجاوز سعة رفع Files API البالغة 512 م.ب أو الملف فارغ.';
  if (files.some((f) => f.contentType !== 'application/pdf' && f.size > maxPdfAnalysisBytes))
    return 'ملف Word أو TXT يتجاوز حد مدخل الملف الأصلي لدى OpenAI (أقل من 50 م.ب). بقي الأصل محفوظًا؛ أرفق نسخة PDF قابلة للتقسيم، دون اختصار الأدلة.';
  return null;
}
export function documentType(filename, contentType) {
  const types = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
  };
  return types[filename.toLowerCase().split('.').at(-1)] === contentType;
}
export function validateMessageAttachments(ids) {
  if (ids.length > maxMessageAttachments)
    throw new HttpError(
      400,
      'الحد الأقصى 10 مرفقات في الرسالة الواحدة. يمكنك رفع ملفات إضافية في رسائل لاحقة.',
    );
}
/** Caller holds the owned case lock. Pending/removing rows still reserve capacity. */
export async function assertAttachmentCapacity(client, caseId, owner, size) {
  const { rows } = await client.query(
    "SELECT count(*)::integer AS count,coalesce(sum(size),0)::text AS bytes FROM case_attachments WHERE case_id=$1 AND owner_id=$2 AND status NOT IN ('removed','rejected')",
    [caseId, owner],
  );
  if (Number(rows[0].count) >= maxCaseAttachments)
    throw new HttpError(
      409,
      'وصلت القضية إلى حد 100 مرفق، ويشمل الرفعات المحجوزة. أزل الرفعات غير المرسلة أو غير المكتملة لتحرير السعة.',
    );
  if (Number(rows[0].bytes) + size > maxCaseBytes)
    throw new HttpError(
      413,
      'يتجاوز مجموع مرفقات القضية حد 500 م.ب، ويشمل الرفعات المحجوزة. أزل الرفعات غير المرسلة أو غير المكتملة لتحرير السعة.',
    );
}
