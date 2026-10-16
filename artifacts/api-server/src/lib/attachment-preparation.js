import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { ownedCase } from './case-access.js';
import { HttpError } from './security.js';
import { privatePath, validateFile } from './private-files.js';
import { assertAttachmentCapacity } from './attachment-policy.js';
/** Reserve metadata under the same case lock as sending/finalization. No network. */
export async function prepareStoredAttachment(owner, caseId, input) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ownedCase(caseId, owner, client, true);
    const existing = await client.query(
      'SELECT * FROM case_attachments WHERE case_id=$1 AND owner_id=$2 AND request_id=$3 FOR UPDATE',
      [caseId, owner, input.requestId],
    );
    let row = existing.rows[0];
    if (row) {
      if (row.status === 'removing' || row.status === 'removed')
        throw new HttpError(
          409,
          'أزيل هذا المرفق أو تجري إزالته. اختر الملف مجددًا لرفع مرفق جديد.',
        );
      if (
        row.filename !== input.filename ||
        row.content_type !== input.contentType ||
        Number(row.size) !== input.size
      )
        throw new HttpError(409, 'معرّف الرفع مستخدم لمرفق مختلف.');
      // Grandfather immutable originals: a lower new-upload ceiling must not
      // invalidate a previously confirmed upload or its idempotent response.
      if (row.status !== 'ready') validateFile(input.filename, input.contentType, input.size);
      if (row.status === 'rejected') {
        await assertAttachmentCapacity(client, caseId, owner, input.size);
        row = (
          await client.query(
            "UPDATE case_attachments SET status='pending' WHERE id=$1 RETURNING *",
            [row.id],
          )
        ).rows[0];
      }
    } else {
      validateFile(input.filename, input.contentType, input.size);
      await assertAttachmentCapacity(client, caseId, owner, input.size);
      const id = randomUUID();
      row = (
        await client.query(
          `INSERT INTO case_attachments(id,case_id,owner_id,request_id,filename,content_type,size,staging_path,storage_path)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            id,
            caseId,
            owner,
            input.requestId,
            input.filename,
            input.contentType,
            input.size,
            privatePath(owner, caseId, id, true),
            privatePath(owner, caseId, id, false),
          ],
        )
      ).rows[0];
    }
    await client.query('COMMIT');
    return row;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
