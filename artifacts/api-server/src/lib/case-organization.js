import { pool } from '@workspace/db';
import { z } from 'zod';
import { ownedCase, caseView, validated } from './case-access.js';
import { HttpError } from './security.js';
export const folderInput = z
  .object({ requestId: z.string().uuid(), name: z.string().trim().min(1).max(100) })
  .strict();
export const renameInput = z
  .object({ name: z.string().trim().min(1).max(100).optional(), pinned: z.boolean().optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.pinned !== undefined);
export const caseInput = z
  .object({
    title: z.string().trim().min(1).max(180).optional(),
    folderId: z.string().uuid().nullable().optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    clientId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export const folderView = (r) => ({
  id: r.id,
  name: r.name,
  pinned: r.pinned ?? false,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
export async function listFolders(owner) {
  const { rows } = await pool.query(
    'SELECT * FROM case_folders WHERE owner_id=$1 ORDER BY name,id',
    [owner],
  );
  return rows.map(folderView);
}
export async function createFolder(owner, raw) {
  const i = validated(folderInput, raw);
  const { rows } = await pool.query(
    `INSERT INTO case_folders(owner_id,request_id,name) VALUES($1,$2,$3)
    ON CONFLICT(owner_id,request_id) DO UPDATE SET request_id=excluded.request_id RETURNING *`,
    [owner, i.requestId, i.name],
  );
  if (rows[0].name !== i.name) throw new HttpError(409, 'معرّف الإنشاء مستخدم لمجلد مختلف.');
  return folderView(rows[0]);
}
export async function renameFolder(owner, id, raw) {
  const { name, pinned } = validated(renameInput, raw);
  const { rows } = await pool.query(
    'UPDATE case_folders SET name=COALESCE($3,name),pinned=COALESCE($4,pinned),updated_at=now() WHERE owner_id=$1 AND id=$2 RETURNING *',
    [owner, id, name ?? null, pinned ?? null],
  );
  if (!rows[0]) throw new HttpError(404, 'المجلد غير موجود.');
  return folderView(rows[0]);
}
export async function updateCase(owner, id, raw) {
  const i = validated(caseInput, raw),
    c = await pool.connect();
  try {
    await c.query('BEGIN');
    await ownedCase(id, owner, c, true);
    if (i.clientId) {
      const client = await c.query('SELECT id FROM lawyer_clients WHERE id=$1 AND owner_id=$2', [
        i.clientId,
        owner,
      ]);
      if (!client.rowCount) throw new HttpError(404, 'الموكل غير موجود.');
    }
    if (i.folderId) {
      const f = await c.query('SELECT id FROM case_folders WHERE id=$1 AND owner_id=$2', [
        i.folderId,
        owner,
      ]);
      if (!f.rows[0]) throw new HttpError(404, 'المجلد غير موجود.');
    }
    if (i.folderId !== undefined)
      await c.query(
        `INSERT INTO case_organization(case_id,owner_id,folder_id) VALUES($1,$2,$3)
        ON CONFLICT(case_id) DO UPDATE SET folder_id=excluded.folder_id WHERE case_organization.owner_id=$2`,
        [id, owner, i.folderId],
      );
    if (i.pinned !== undefined)
      await c.query(
        `INSERT INTO case_organization(case_id,owner_id,pinned) VALUES($1,$2,$3)
        ON CONFLICT(case_id) DO UPDATE SET pinned=excluded.pinned WHERE case_organization.owner_id=$2`,
        [id, owner, i.pinned],
      );
    await c.query(
      'UPDATE cases SET title=COALESCE($3,title),updated_at=now() WHERE id=$1 AND owner_id=$2',
      [id, owner, i.title ?? null],
    );
    if (i.archived !== undefined)
      await c.query(
        `UPDATE cases SET archived_at=CASE WHEN $3 THEN COALESCE(archived_at,now()) ELSE NULL END WHERE id=$1 AND owner_id=$2`,
        [id, owner, i.archived],
      );
    if (i.clientId !== undefined)
      await c.query('UPDATE cases SET client_id=$3 WHERE id=$1 AND owner_id=$2', [
        id,
        owner,
        i.clientId,
      ]);
    const { rows } = await c.query(
      `SELECT c.*,o.folder_id,COALESCE(o.pinned,false) AS pinned,l.name AS client_name FROM cases c
      LEFT JOIN case_organization o ON o.case_id=c.id AND o.owner_id=c.owner_id
      LEFT JOIN lawyer_clients l ON l.id=c.client_id AND l.owner_id=c.owner_id WHERE c.id=$1 AND c.owner_id=$2`,
      [id, owner],
    );
    await c.query('COMMIT');
    return caseView(rows[0]);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
