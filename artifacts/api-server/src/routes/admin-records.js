import { Router } from 'express';
import { pool } from '@workspace/db';
import {
  GetAdminLawyersQueryParams,
  GetAdminLawyersResponse,
  GetAdminLawyerAcceptancesQueryParams,
  GetAdminLawyerAcceptancesResponse,
  GetAdminAuditEventsQueryParams,
  GetAdminAuditEventsResponse,
  GetAdminHistoricalDocumentParams,
  GetAdminHistoricalDocumentResponse,
} from '@workspace/api-zod';
import { HttpError, requireAdmin } from '../lib/security.js';
import { present as documentView } from './legal.js';
const router = Router();
router.get('/admin/lawyers', requireAdmin, async (req, res) => {
  const parsed = GetAdminLawyersQueryParams.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'معايير عرض الحسابات غير صحيحة.');
  const { offset, limit } = parsed.data;
  const { rows } = await pool.query(
    "SELECT id,name,username,created_at FROM accounts WHERE role='lawyer' ORDER BY created_at DESC,id LIMIT $1 OFFSET $2",
    [limit, offset],
  );
  const count = await pool.query("SELECT count(*)::int AS total FROM accounts WHERE role='lawyer'");
  res.json(
    GetAdminLawyersResponse.parse({
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        username: r.username,
        createdAt: r.created_at.toISOString(),
      })),
      total: count.rows[0].total,
      offset,
      limit,
    }),
  );
});
router.get('/admin/acceptances', requireAdmin, async (req, res) => {
  const parsed = GetAdminLawyerAcceptancesQueryParams.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'معايير عرض الإقرارات غير صحيحة.');
  const { lawyerId, offset, limit } = parsed.data;
  const lawyer = await pool.query("SELECT 1 FROM accounts WHERE id=$1 AND role='lawyer'", [
    lawyerId,
  ]);
  if (!lawyer.rows.length) throw new HttpError(404, 'حساب المحامي غير موجود.');
  // Read recorded evidence, not the user's current phone or latest document.
  const { rows } = await pool.query(
    'SELECT * FROM legal_acceptances WHERE user_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',
    [lawyerId, limit, offset],
  );
  const count = await pool.query(
    'SELECT count(*)::int AS total FROM legal_acceptances WHERE user_id=$1',
    [lawyerId],
  );
  res.json(
    GetAdminLawyerAcceptancesResponse.parse({
      items: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        mobile: r.mobile,
        documentId: r.document_id,
        documentTitle: r.document_title,
        documentVersion: r.document_version,
        contentHash: r.content_hash,
        action: r.action,
        auditId: r.audit_id,
        ip: r.ip,
        userAgent: r.user_agent,
        createdAt: r.created_at.toISOString(),
      })),
      total: count.rows[0].total,
      offset,
      limit,
    }),
  );
});
router.get('/admin/audit-events', requireAdmin, async (req, res) => {
  const parsed = GetAdminAuditEventsQueryParams.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'معايير عرض سجل التدقيق غير صحيحة.');
  const { offset, limit } = parsed.data;
  const { rows } = await pool.query(
    `SELECT e.id,e.actor_id,e.action,e.ip,e.user_agent,e.created_at,
      a.id AS account_id,a.name,a.username,a.role
     FROM audit_events e LEFT JOIN accounts a ON a.id=e.actor_id
     ORDER BY e.created_at DESC,e.id LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  const count = await pool.query('SELECT count(*)::int AS total FROM audit_events');
  res.json(
    GetAdminAuditEventsResponse.parse({
      items: rows.map((r) => ({
        id: r.id,
        actorId: r.actor_id,
        action: r.action,
        ip: r.ip,
        userAgent: r.user_agent,
        createdAt: r.created_at.toISOString(),
        actor: r.account_id
          ? { id: r.account_id, name: r.name, username: r.username, role: r.role }
          : null,
      })),
      total: count.rows[0].total,
      offset,
      limit,
    }),
  );
});
router.get('/admin/documents/:id', requireAdmin, async (req, res) => {
  const parsed = GetAdminHistoricalDocumentParams.safeParse(req.params);
  if (!parsed.success) throw new HttpError(404, 'الوثيقة غير موجودة.');
  const { rows } = await pool.query('SELECT * FROM legal_documents WHERE id=$1', [parsed.data.id]);
  if (!rows.length) throw new HttpError(404, 'الوثيقة غير موجودة.');
  res.json(GetAdminHistoricalDocumentResponse.parse(documentView(rows[0])));
});
export default router;
