import { pool } from '@workspace/db';
import { ownedCase } from './case-access.js';
import { HttpError } from './security.js';
import { storageFile } from './private-files.js';
async function deleteStoredBytes(row) {
  // The canonical original is immutable; never delete an unexpected generation.
  if (row.generation)
    await storageFile(row.storage_path).delete({
      ignoreNotFound: true,
      ifGenerationMatch: row.generation,
    });
  else {
    // Finalization may have copied an original before losing its DB commit.
    const original = storageFile(row.storage_path);
    try {
      const [metadata] = await original.getMetadata();
      if (Number(metadata.size) !== Number(row.size) || metadata.contentType !== row.content_type)
        throw new Error('Unexpected original');
      await original.delete({ ignoreNotFound: true, ifGenerationMatch: metadata.generation });
    } catch (e) {
      if (e.code !== 404) throw e;
    }
  }
  await storageFile(row.staging_path).delete({ ignoreNotFound: true });
}
export async function removeUnsentAttachment(caseId, id, owner, deleteBytes = deleteStoredBytes) {
  const client = await pool.connect();
  let row;
  try {
    await client.query('BEGIN');
    // Same lock/order as sending and completing: only one can commit first.
    await ownedCase(caseId, owner, client, true);
    const result = await client.query(
      'SELECT * FROM case_attachments WHERE id=$1 AND case_id=$2 AND owner_id=$3 FOR UPDATE',
      [id, caseId, owner],
    );
    row = result.rows[0];
    if (!row) throw new HttpError(404, 'المرفق غير موجود.');
    if (row.message_id) throw new HttpError(409, 'لا يمكن إزالة مرفق سبق حفظه مع رسالة.');
    if (row.status === 'removed') {
      await client.query('COMMIT');
      return;
    }
    if (!['pending', 'rejected', 'ready', 'removing'].includes(row.status))
      throw new HttpError(409, 'لا يمكن إزالة هذا المرفق.');
    if (row.status === 'ready' && !row.generation)
      throw new HttpError(503, 'تعذّر التحقق من أصل المرفق؛ لم تتم إزالته.');
    // Durable intent blocks sends/downloads/finalization while external storage
    // is deleted. A storage/DB failure leaves a retryable, non-sendable record.
    await client.query("UPDATE case_attachments SET status='removing' WHERE id=$1", [id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  try {
    await deleteBytes(row);
  } catch {
    throw new HttpError(
      503,
      'لم تكتمل إزالة المرفق من التخزين. أعد محاولة الإزالة؛ لن يُرسل مع الرسالة.',
    );
  }
  // Keep an inactive tombstone using existing columns for idempotent removal
  // and to prevent prepare/complete replays resurrecting the deleted original.
  await pool.query(
    "UPDATE case_attachments SET status='removed' WHERE id=$1 AND case_id=$2 AND owner_id=$3 AND status='removing' AND message_id IS NULL",
    [id, caseId, owner],
  );
}
