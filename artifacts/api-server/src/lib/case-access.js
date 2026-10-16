import { pool } from '@workspace/db';
import { z } from 'zod';
import { currentUser, HttpError } from './security.js';
export async function lawyerIdentity(req) {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, 'سجّل الدخول للمتابعة.');
  if (user.role !== 'lawyer') throw new HttpError(403, 'مساحة القضايا متاحة لحسابات المحامين فقط.');
  return user.id;
}
export function resourceId(value) {
  const result = z.string().uuid().safeParse(value);
  if (!result.success) throw new HttpError(404, 'القضية أو المرفق غير موجود.');
  return result.data;
}
export async function ownedCase(id, owner, client = pool, lock = false) {
  const { rows } = await client.query(
    `SELECT * FROM cases WHERE id=$1 AND owner_id=$2${lock ? ' FOR UPDATE' : ''}`,
    [id, owner],
  );
  if (!rows.length) throw new HttpError(404, 'القضية غير موجودة.');
  return rows[0];
}
export function validated(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'تحقق من بيانات القضية أو الرسالة أو المرفق.');
  return result.data;
}
export const caseView = (row) => ({
  id: row.id,
  title: row.title,
  taskType: row.task_type,
  folderId: row.folder_id ?? null,
  pinned: row.pinned ?? false,
  archivedAt: row.archived_at?.toISOString() ?? null,
  clientId: row.client_id ?? null,
  clientName: row.client_name ?? null,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});
export const attachmentView = (row) => ({
  id: row.id,
  caseId: row.case_id,
  messageId: row.message_id,
  filename: row.filename,
  contentType: row.content_type,
  size: Number(row.size),
  status: row.status,
  createdAt: row.created_at.toISOString(),
  readyAt: row.ready_at?.toISOString() ?? null,
  downloadUrl:
    row.status === 'ready' ? `/api/cases/${row.case_id}/attachments/${row.id}/download` : null,
});
export const messageView = (row, attachments) => ({
  id: row.id,
  caseId: row.case_id,
  requestId: row.request_id,
  content: row.content,
  sequence: Number(row.sequence),
  createdAt: row.created_at.toISOString(),
  ...(row.clarification ? { clarification: row.clarification } : {}),
  attachments: attachments.filter((a) => a.message_id === row.id).map(attachmentView),
});
