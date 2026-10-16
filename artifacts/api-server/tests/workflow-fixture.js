// Actual production routes/SQL with TEMP tables and fail-closed fake transports.
import express from 'express';
import { randomUUID } from 'node:crypto';
import { pool, publicFingerprints } from './workflow-fixture-db.js';
import { putObject, storageStats } from './workflow-fixture-storage.js';
import { owner } from './workflow-fixture-security.js';
import cases from '../src/routes/cases.js';
import attachments from '../src/routes/attachments.js';
import analysis from '../src/routes/analysis.js';
import reports from '../src/routes/report-workspace.js';
import management from '../src/routes/lawyer-management.js';
const app = express(),
  csrf = 'synthetic-workflow-csrf';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? 'http://localhost');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-csrf-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});
let mode = 'report',
  files = 0,
  analysisPosts = 0,
  discussionPosts = 0,
  nativeReads = 0;
let discussionFiles = 0;
const bodies = new Map();
const output = (id, result) =>
  Response.json({
    id,
    status: 'completed',
    model: 'gpt-6.1-sol',
    usage: { input_tokens: 250, output_tokens: 700 },
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
  });
const fakeResult = (selectedMode, refs = []) =>
  selectedMode.startsWith('clarification')
    ? {
        kind: 'clarification',
        report: null,
        blocked: null,
        clarification: {
          context: 'استيضاح اصطناعي لا يمثل قضية حقيقية.',
          questions: [
            {
              id: 'side',
              question: 'من تمثل؟',
              options: ['المدعي', 'المدعى عليه'],
              allow_unknown: true,
              allow_not_applicable: false,
            },
            ...(selectedMode === 'clarification-many'
              ? [
                  {
                    id: 'payment',
                    question: 'هل يوجد اتفاق دفعات؟',
                    options: ['نعم', 'لا'],
                    allow_unknown: true,
                    allow_not_applicable: true,
                  },
                  {
                    id: 'delivery',
                    question: 'ما حالة التسليم؟',
                    options: ['تم التسليم', 'لم يتم التسليم'],
                    allow_unknown: false,
                    allow_not_applicable: false,
                  },
                ]
              : []),
          ],
        },
      }
    : {
        kind: 'report',
        clarification: null,
        blocked: null,
        report: {
          title: 'تقرير اصطناعي لا يمثل قضية حقيقية',
          sections: [
            'summary',
            'facts',
            'characterization',
            'evidence',
            'position',
            'legal_basis',
            'risks',
            'conclusions',
          ].map((section_id) => ({
            section_id,
            blocks: [
              {
                text: 'محاكاة: أصل تقرير الخبير غير متاح. لم تُقرأ كل صفحات ملف الفواتير.',
                basis: refs.length ? 'documented' : 'analysis',
                source_refs: refs,
              },
            ],
          })),
          alerts: [],
          change_summary: null,
        },
      };
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  if (u.hostname !== 'api.openai.com') throw new Error('Unmocked external request forbidden');
  const path = u.pathname.replace('/v1/', ''),
    method = init.method ?? 'GET';
  if (path === 'files' && method === 'POST') {
    const file = init.body.get('file');
    return Response.json({ id: `file_synthetic_${++files}`, bytes: file.size });
  }
  if (path.startsWith('files/') && method === 'DELETE') return Response.json({ deleted: true });
  if (path === 'responses/input_tokens') {
    nativeReads++;
    return Response.json({ input_tokens: 250 });
  }
  if (path === 'responses' && method === 'POST') {
    const body = JSON.parse(String(init.body));
    if (body.text?.format?.name === 'focused_paragraph_interaction') {
      discussionPosts++;
      if (
        body.input.some(
          (p) => Array.isArray(p.content) && p.content.some((x) => x.type === 'input_file'),
        )
      )
        discussionFiles++;
      const ctx = JSON.parse(body.input.at(-1).content);
      if (
        ctx.sectionId === '__report__'
          ? !ctx.savedReportContext.source_registry
          : !Array.isArray(ctx.savedReportContext.sections)
      )
        throw new Error('Report context missing');
      return output(`resp_discuss_${discussionPosts}`, {
        answer:
          'إجابة محاكاة: لا، التقرير المحفوظ يذكر عدم توفر أصل تقرير الخبير. أرفق تقرير الخبير النهائي وجداول التسوية، ثم اطلب تحليلًا جديدًا. لم تُقرأ جميع صفحات الفواتير.',
        proposedText:
          ctx.kind === 'revise' ? 'نص تعديل اصطناعي مقترح لا يمثل رأيًا قانونيًا.' : null,
        sourceRefs: [],
      });
    }
    const id = `resp_analysis_${++analysisPosts}`;
    bodies.set(id, { body, mode });
    if (!body.background) return output(id, fakeResult(mode));
    return Response.json({ id, status: 'queued' });
  }
  if (path.startsWith('responses/') && method === 'GET') {
    const id = path.split('/')[1],
      item = bodies.get(id);
    if (!item) return Response.json({}, { status: 404 });
    // Test-only hold to inspect active UI without racing the synthetic provider.
    if (mode === 'hold') return Response.json({ id, status: 'queued' });
    const parts = item.body.input.at(-1).content;
    const ctx = JSON.parse(parts.find((x) => x.type === 'input_text').text);
    const refs = ctx.source_registry.filter((s) => s.basis === 'documented').map((s) => s.id);
    const result = fakeResult(item.mode, refs);
    return output(id, result);
  }
  throw new Error(`Unmocked endpoint forbidden: ${method} ${path}`);
};
app.use((req, _res, next) => {
  req.log = { info() {}, warn() {}, error() {} };
  next();
});
app.use((req, res, next) => {
  if (req.method !== 'PUT' || !req.path.startsWith('/__storage/')) return next();
  const chunks = [];
  req.on('data', (x) => chunks.push(x));
  req.on('end', () => {
    putObject(
      decodeURIComponent(req.path.slice('/__storage'.length)),
      Buffer.concat(chunks),
      req.headers['content-type'] ?? '',
    );
    setTimeout(() => res.status(200).end(), 1500); // Visible NORMAL progress.
  });
});
app.use(express.json({ limit: '160kb' }));
app.get('/api/auth/session', (_req, res) =>
  res.json({
    csrfToken: csrf,
    developmentOtp: false,
    user: { id: owner, name: 'Synthetic Workflow Lawyer', mobile: '+15550000000', role: 'lawyer' },
  }),
);
app.post('/__fixture/mode', (req, res) => {
  mode = req.body.mode;
  res.json({ mode });
});
app.get('/__fixture/stats', async (_req, res) =>
  res.json({
    files,
    analysisPosts,
    discussionPosts,
    discussionFiles,
    nativeReads,
    storage: storageStats(),
    public: await publicFingerprints(),
    operations: (
      await pool.query(
        'SELECT id,case_id,status,parent_operation_id,input_snapshot,md5(result::text) AS result_hash FROM case_analysis_operations ORDER BY created_at',
      )
    ).rows,
    messages: (
      await pool.query(
        'SELECT id,request_id,case_id,clarification FROM case_messages ORDER BY sequence',
      )
    ).rows,
    questions: (
      await pool.query(
        'SELECT id,request_id,operation_id,version_id,status FROM report_interactions',
      )
    ).rows,
    originals: (await pool.query('SELECT id,generation,status FROM case_attachments ORDER BY id'))
      .rows,
    versions: (await pool.query('SELECT id,version_number FROM report_versions')).rows,
    clients: (await pool.query('SELECT id,owner_id,name FROM lawyer_clients')).rows,
    caseRecords: (await pool.query('SELECT id,owner_id,client_id,archived_at FROM cases')).rows,
    fees: (await pool.query('SELECT * FROM case_fee_agreements')).rows,
    receipts: (await pool.query('SELECT * FROM case_fee_receipts')).rows,
  }),
);
app.use('/api', cases, attachments, analysis, reports, management);
app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
const caseId = randomUUID();
await pool.query(
  "INSERT INTO cases(id,owner_id,request_id,title,task_type) VALUES($1,$2,$3,$4,'analysis')",
  [caseId, owner, randomUUID(), 'Synthetic workflow case'],
);
app.get('/__fixture/info', (_req, res) => res.json({ caseId, owner }));
app.listen(19486, '0.0.0.0', () =>
  process.stdout.write('Synthetic workflow fixture ready on 19486\n'),
);
