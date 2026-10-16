import { readFile } from 'node:fs/promises';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import puppeteer from 'puppeteer-core';
import { HttpError } from './security.js';
export const sectionTitles = {
  summary: 'الملخص',
  facts: 'الوقائع',
  characterization: 'التكييف القانوني',
  evidence: 'الأدلة وعبء الإثبات',
  position: 'مركز الموكل',
  legal_basis: 'الأساس النظامي',
  risks: 'المخاطر',
  conclusions: 'النتائج والتوصيات',
};
const basisTitles = {
  documented: 'مستند مرفق — دون توثيق صفحات',
  lawyer_statement: 'إفادة المحامي',
  analysis: 'استنتاج تحليلي',
  conditional: 'مشروط',
  unverified: 'غير متحقق',
  legal_source: 'مرجع نظامي كما ورد في التقرير',
};
export function paragraphNotes(b) {
  const changed = b.origin === 'manual' || b.origin === 'ai_accepted';
  return [
    changed
      ? b.origin === 'manual'
        ? 'تعديل يدوي للمحامي — الادعاءات المعدلة غير متحققة'
        : 'مقترح آلي قبله المحامي — الادعاءات المعدلة غير متحققة'
      : 'من التقرير الأصلي',
    `التصنيف: ${basisTitles[b.basis] ?? b.basis}`,
    ...(b.source_refs.length ? [`إحالات كما وردت في التقرير: ${b.source_refs.join('، ')}`] : []),
    ...(changed && b.original_source_refs?.length
      ? [
          `إحالات النص الأصلي للسياق فقط، وليست تحققًا للنص المعدل: ${b.original_source_refs.join('، ')}`,
        ]
      : []),
    ...(b.proposed_source_refs?.length
      ? [`إحالات مقترحة غير متحققة: ${b.proposed_source_refs.join('، ')}`]
      : []),
  ];
}
/** One canonical sequence for DOCX/PDF: no duplicate headings or invented citations. */
export function exportLines(v) {
  const lines = [
    { text: v.report.title, heading: 1 },
    { text: v.number === 0 ? 'التقرير الأصلي' : `النسخة المحفوظة ${v.number}`, note: true },
  ];
  if (v.report.change_summary) lines.push({ text: v.report.change_summary });
  for (const a of v.report.alerts)
    lines.push({
      text: `تنبيه: ${a.message}${a.attachment_id ? ` — المرفق: ${a.attachment_id}` : ''}`,
      note: true,
    });
  for (const s of v.report.sections) {
    if (!s.blocks.some((b) => b.text.trim())) continue;
    lines.push({ text: sectionTitles[s.section_id] ?? s.section_id, heading: 2 });
    for (const b of s.blocks) {
      if (!b.text.trim()) continue;
      lines.push({ text: b.text });
      lines.push(...paragraphNotes(b).map((text) => ({ text, note: true })));
    }
  }
  return lines;
}
export async function exportDocx(v) {
  const children = exportLines(v).map(
    (line) =>
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        heading:
          line.heading === 1
            ? HeadingLevel.HEADING_1
            : line.heading === 2
              ? HeadingLevel.HEADING_2
              : undefined,
        spacing: { after: line.note ? 100 : 180 },
        keepNext: !!line.heading,
        children: line.text.split(/\r?\n/).map(
          (text, i) =>
            new TextRun({
              text,
              break: i ? 1 : undefined,
              rightToLeft: true,
              font: 'Arial',
              size: line.heading === 1 ? 32 : line.heading === 2 ? 28 : line.note ? 20 : 24,
            }),
        ),
      }),
  );
  return Packer.toBuffer(
    new Document({
      creator: 'Micron Law',
      title: v.report.title,
      sections: [
        {
          properties: {
            page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } },
          },
          children,
        },
      ],
    }),
  );
}
const escape = (s) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
let active = 0;
export async function exportPdf(v) {
  if (active >= 2) throw new HttpError(429, 'يجري تجهيز ملفات أخرى. أعد محاولة التصدير بعد قليل.');
  active++;
  let browser;
  try {
    const font = await readFile('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
    browser = await puppeteer.launch({
      executablePath: '/repl/tools/bin/chromium',
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      void (/^(data:|about:)/.test(req.url()) ? req.continue() : req.abort());
    });
    const lines = exportLines(v)
      .map(
        (l) =>
          `<${l.heading ? `h${l.heading}` : 'p'}${l.note ? ' class="note"' : ''} dir="rtl">${escape(l.text)}</${l.heading ? `h${l.heading}` : 'p'}>`,
      )
      .join('\n');
    await page.setContent(
      `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
      @font-face{font-family:ReportArabic;src:url(data:font/ttf;base64,${font.toString('base64')})}
      @page{size:A4;margin:20mm}body{font-family:ReportArabic,sans-serif;direction:rtl;text-align:right;font-size:12pt;line-height:1.9}
      h1{font-size:19pt}h2{font-size:15pt;break-after:avoid}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 10pt}
      .note{font-size:9pt;color:#444}h1,h2{margin:14pt 0 8pt}</style></head><body>${lines}</body></html>`,
      { waitUntil: 'load', timeout: 20000 },
    );
    await page.evaluate('document.fonts.ready.then(() => true)');
    return Buffer.from(
      await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        timeout: 30000,
      }),
    );
  } finally {
    try {
      await browser?.close();
    } finally {
      active--;
    }
  }
}
