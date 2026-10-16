import { pool } from '@workspace/db';
import { messageView, ownedCase } from './case-access.js';
import { validateClarificationLink } from './analysis-continuation.js';
import { HttpError } from './security.js';
import { validateMessageAttachments } from './attachment-policy.js';
/** Saving a statement never creates or executes an analysis operation. */
export async function saveCaseMessage(owner, id, input) {
  const content = input.clarification ? input.content : input.content.trim(),
    ids = input.attachmentIds;
  if ((!content.trim() && !ids.length) || new Set(ids).size !== ids.length)
    throw new HttpError(400, 'اكتب رسالة أو أرفق ملفًا دون تكرار المرفقات.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ownedCase(id, owner, client, true);
    const existing = await client.query(
      'SELECT * FROM case_messages WHERE case_id=$1 AND request_id=$2 AND owner_id=$3',
      [id, input.requestId, owner],
    );
    if (existing.rows.length) {
      const { rows: attached } = await client.query(
        'SELECT * FROM case_attachments WHERE message_id=$1 AND case_id=$2 AND owner_id=$3 ORDER BY created_at,id',
        [existing.rows[0].id, id, owner],
      );
      if (
        existing.rows[0].content !== content ||
        JSON.stringify(existing.rows[0].clarification ?? null) !==
          JSON.stringify(input.clarification ?? null) ||
        JSON.stringify(attached.map((a) => a.id).sort()) !== JSON.stringify([...ids].sort())
      )
        throw new HttpError(409, 'معرّف الإرسال مستخدم لرسالة مختلفة. لم تُحفظ رسالة مكررة.');
      await client.query('COMMIT');
      return messageView(existing.rows[0], attached);
    }
    // Existing historical messages remain readable and idempotently replayable.
    validateMessageAttachments(ids);
    const { rows: attached } = await client.query(
      "SELECT * FROM case_attachments WHERE id=ANY($1::uuid[]) AND case_id=$2 AND owner_id=$3 AND status='ready' AND message_id IS NULL FOR UPDATE",
      [ids, id, owner],
    );
    if (attached.length !== ids.length)
      throw new HttpError(400, 'أحد المرفقات غير مكتمل أو لا يتبع هذه القضية أو سبق إرساله.');
    if (input.clarification) {
      if (!content || ids.length) throw new HttpError(400, 'إجابة الاستيضاح نصية فقط.');
      await validateClarificationLink(client, owner, id, input.clarification, true);
    }
    const saved = await client.query(
      'INSERT INTO case_messages(case_id,owner_id,request_id,content,clarification) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING *',
      [
        id,
        owner,
        input.requestId,
        content,
        input.clarification ? JSON.stringify(input.clarification) : null,
      ],
    );
    const message = saved.rows[0];
    await client.query(
      'UPDATE case_attachments SET message_id=$1 WHERE id=ANY($2::uuid[]) AND owner_id=$3 AND case_id=$4',
      [message.id, ids, owner, id],
    );
    const title = content
      ? content.replace(/\s+/g, ' ').slice(0, 80)
      : attached[0].filename.slice(0, 80);
    await client.query(
      `UPDATE cases SET updated_at=clock_timestamp(),
      title=CASE WHEN title='قضية جديدة' AND (SELECT count(*) FROM case_messages WHERE case_id=$1)=1 THEN $2 ELSE title END WHERE id=$1 AND owner_id=$3`,
      [id, title, owner],
    );
    await client.query('COMMIT');
    return messageView(
      message,
      attached.map((a) => ({ ...a, message_id: message.id })),
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
