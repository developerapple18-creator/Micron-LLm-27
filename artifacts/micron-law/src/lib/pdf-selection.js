/** Storage success is independent of analysis eligibility. Never slice a selection. */
export function pdfSelectionIssue(files, policy) {
  const count = policy?.maxPdfAnalysisAttachments ?? Number.MAX_SAFE_INTEGER;
  const individual = 512_000_000;
  if (files.length > count)
    return `المرفقات محفوظة، لكن الرسالة تستوعب حتى ${count} مرفقات؛ أزل الزائد أو أرسله في رسالة أخرى. لن يُستبعد أي ملف بصمت.`;
  if (new Set(files.map((f) => f.id)).size !== files.length)
    return 'تكرر اختيار المرفق نفسه؛ اختر ملفات مختلفة.';
  const types = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
  };
  const unsupported = files.filter(
    (f) => types[f.filename.toLowerCase().split('.').at(-1)] !== f.contentType,
  );
  if (unsupported.length)
    return `نوع غير مدعوم للتحليل: ${unsupported.map((f) => f.filename).join('، ')}. المدعوم PDF وDOC وDOCX وTXT؛ لن نتجاهل ملفًا بصمت.`;
  if (files.some((f) => !Number.isSafeInteger(f.size) || f.size < 1 || f.size > individual))
    return 'ملف فارغ أو يتجاوز سعة رفع Files API البالغة 512 م.ب؛ الأصل المحفوظ لا يتغير.';
  if (files.some((f) => f.contentType !== 'application/pdf' && f.size >= 50_000_000))
    return 'ملف Word أو TXT يتجاوز حد مدخل الملف لدى OpenAI (أقل من 50 م.ب). أرفق نسخة PDF قابلة للتقسيم دون اختصار الأدلة.';
  return null;
}
