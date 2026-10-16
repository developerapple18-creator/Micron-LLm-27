import { Router } from 'express';
import { pool } from '@workspace/db';
import { SaveDocumentDraftBody, PublishDocumentParams } from '@workspace/api-zod';
import { HttpError, hashText, requireAdmin, requestEvidence } from '../lib/security.js';
const router = Router();
const titles = { terms: 'الشروط والأحكام', usage: 'سياسة الاستخدام', privacy: 'سياسة الخصوصية' };
export function present(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    content: row.content,
    version: row.version,
    published: row.published,
    testing: row.testing,
    createdAt: row.created_at.toISOString(),
  };
}
router.get('/legal/documents', async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT DISTINCT ON(kind) * FROM legal_documents WHERE published=true ORDER BY kind,version DESC',
  );
  res.json(rows.map(present));
});
router.get('/admin/documents', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM legal_documents ORDER BY kind,version DESC');
  res.json(rows.map(present));
});
router.post('/admin/documents', requireAdmin, async (req, res) => {
  const data = SaveDocumentDraftBody.parse(req.body);
  if (!data.content.trim()) throw new HttpError(400, 'أدخل محتوى الوثيقة.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(190011)');
    const existing = await client.query(
      'SELECT id FROM legal_documents WHERE kind=$1 AND published=false',
      [data.kind],
    );
    let result;
    if (existing.rowCount) {
      result = await client.query(
        'UPDATE legal_documents SET content=$1,testing=$2,content_hash=$3 WHERE id=$4 AND published=false RETURNING *',
        [data.content, data.testing, hashText(data.content), existing.rows[0].id],
      );
    } else {
      result = await client.query(
        `INSERT INTO legal_documents(kind,title,content,version,testing,content_hash)
         SELECT $1,$2,$3,COALESCE(MAX(version),0)+1,$4,$5 FROM legal_documents WHERE kind=$1 RETURNING *`,
        [data.kind, titles[data.kind], data.content, data.testing, hashText(data.content)],
      );
    }
    const { ip, userAgent } = requestEvidence(req);
    await client.query(
      'INSERT INTO audit_events(actor_id,action,ip,user_agent) VALUES($1,$2,$3,$4)',
      [req.session.userId, `document_draft_saved:${result.rows[0].id}`, ip, userAgent],
    );
    await client.query('COMMIT');
    res.json(present(result.rows[0]));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});
router.post('/admin/documents/:id/publish', requireAdmin, async (req, res) => {
  const { id } = PublishDocumentParams.parse(req.params);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'معرّف الوثيقة غير صحيح.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(190011)');
    const result = await client.query(
      'UPDATE legal_documents SET published=true,published_at=now() WHERE id=$1 AND published=false RETURNING *',
      [id],
    );
    if (!result.rowCount) throw new HttpError(409, 'الوثيقة منشورة بالفعل أو غير موجودة.');
    const { ip, userAgent } = requestEvidence(req);
    await client.query(
      'INSERT INTO audit_events(actor_id,action,ip,user_agent) VALUES($1,$2,$3,$4)',
      [req.session.userId, `document_published:${id}`, ip, userAgent],
    );
    await client.query('COMMIT');
    res.json(present(result.rows[0]));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});
export default router;
