export function fileTypeLabel(filename) {
  const ext = filename
    ?.replace(/[\u2066-\u2069\u200e\u200f]/g, '')
    .split('.')
    .pop()
    ?.toUpperCase();
  return ext && ['PDF', 'DOC', 'DOCX', 'TXT', 'JPG', 'JPEG', 'PNG'].includes(ext) ? ext : 'مستند';
}
export function attachmentDescription(a) {
  const type = fileTypeLabel(a.filename);
  if (type === 'PDF' && a.contentType === 'application/pdf')
    return 'محفوظ ومؤهل مبدئيًا للمعالجة؛ لا يثبت حفظه اكتمال قراءة جميع صفحاته.';
  if (['DOC', 'DOCX', 'TXT'].includes(type) && a.size < 50_000_000)
    return type === 'TXT'
      ? 'محفوظ؛ النص مدعوم للتحليل.'
      : 'محفوظ؛ نص Word مدعوم للتحليل. الصور والأختام المضمّنة ليست مضمونة القراءة؛ أرفق PDF عند الحاجة.';
  return 'محفوظ؛ يلزم التحقق من أهلية هذا النوع أو الحجم قبل التحليل.';
}
