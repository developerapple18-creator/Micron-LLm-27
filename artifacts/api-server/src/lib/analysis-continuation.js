import { pool } from '@workspace/db';
import { HttpError } from './security.js';
export async function validateClarificationLink(
  client,
  owner,
  caseId,
  link,
  allowPreparedChild = false,
) {
  const { rows } = await client.query(
    'SELECT * FROM case_analysis_operations WHERE id=$1 AND case_id=$2 AND owner_id=$3',
    [link.operationId, caseId, owner],
  );
  const parent = rows[0];
  if (!parent || parent.status !== 'completed' || parent.result?.kind !== 'clarification')
    throw new HttpError(409, 'الاستيضاح غير متاح في هذه القضية.');
  const valid = parent.result.clarification.questions.map((q) => q.id);
  // Empty IDs explicitly mean context-only text, not an answer to every question.
  if (
    new Set(link.questionIds).size !== link.questionIds.length ||
    link.questionIds.some((id) => !valid.includes(id))
  )
    throw new HttpError(400, 'مرجع السؤال لا يتبع هذا الاستيضاح.');
  const child = await client.query(
    "SELECT id,status FROM case_analysis_operations WHERE parent_operation_id=$1 AND failure_code IS DISTINCT FROM 'context_changed'",
    [parent.id],
  );
  if (child.rowCount && !(allowPreparedChild && child.rows[0].status === 'pending'))
    throw new HttpError(409, 'بدأت متابعة هذا الاستيضاح بالفعل؛ حدّث الحالة.');
  return parent;
}
/** Called inside the locked case transaction. Text is preserved, never classified or parsed. */
export async function continuationSnapshot(client, owner, caseId, messageId, parentId) {
  const saved = await client.query(
    'SELECT * FROM case_messages WHERE id=$1 AND owner_id=$2 AND case_id=$3',
    [messageId, owner, caseId],
  );
  const message = saved.rows[0];
  if (!message?.content?.trim()) throw new HttpError(409, 'احفظ الرسالة قبل متابعة التحليل.');
  const linked = await client.query(
    "SELECT clarification FROM case_messages WHERE owner_id=$1 AND case_id=$2 AND clarification->>'operationId'=$3 ORDER BY sequence DESC LIMIT 1",
    [owner, caseId, parentId],
  );
  if (!linked.rowCount)
    throw new HttpError(409, 'احفظ رسالة في سياق الاستيضاح قبل متابعة التحليل.');
  const parent = await validateClarificationLink(
    client,
    owner,
    caseId,
    linked.rows[0].clarification,
  );
  const round = (parent.input_snapshot?.round ?? 0) + 1;
  // The case lock defines the explicit preparation cutoff, not the selected answer's age.
  const messages = await client.query(
    'SELECT id,content,clarification FROM case_messages WHERE case_id=$1 AND owner_id=$2 ORDER BY sequence',
    [caseId, owner],
  );
  const previous = parent.input_snapshot;
  return {
    ...(previous?.pdf
      ? {
          processingVersion: 1,
          pdf: previous.pdf,
          pdfs: previous.pdfs,
          pdfEvidence: previous.pdfEvidence,
        }
      : {}),
    round,
    messages: messages.rows.map((m) => ({
      id: m.id,
      content: m.content,
      ...(m.clarification ? { clarification: m.clarification } : {}),
    })),
    clarifications: [
      ...(previous?.clarifications ?? []),
      { operationId: parent.id, clarification: parent.result.clarification },
    ],
  };
}
/** Revalidate every persisted source against the authorized case before dispatch. */
export async function verifiedAnswerSnapshot(owner, caseId, operationId) {
  const { rows } = await pool.query(
    'SELECT input_snapshot FROM case_analysis_operations WHERE id=$1 AND owner_id=$2 AND case_id=$3',
    [operationId, owner, caseId],
  );
  const snapshot = rows[0]?.input_snapshot;
  if (
    !snapshot ||
    !Number.isSafeInteger(snapshot.round) ||
    snapshot.round < 0 ||
    !Array.isArray(snapshot.messages) ||
    !Array.isArray(snapshot.clarifications)
  )
    throw new HttpError(409, 'تعذر التحقق من سياق التحليل.');
  const messages = await pool.query(
    'SELECT id,content,clarification FROM case_messages WHERE case_id=$1 AND owner_id=$2 AND id=ANY($3::uuid[])',
    [caseId, owner, snapshot.messages.map((m) => m.id)],
  );
  if (
    !snapshot.messages.length ||
    messages.rows.length !== snapshot.messages.length ||
    snapshot.messages.some(
      (m) =>
        !messages.rows.some(
          (saved) =>
            saved.id === m.id &&
            saved.content === m.content &&
            JSON.stringify(saved.clarification ?? undefined) === JSON.stringify(m.clarification),
        ),
    )
  )
    throw new HttpError(409, 'تعذر التحقق من سياق الرسائل المحفوظة.');
  for (const c of snapshot.clarifications) {
    const op = await pool.query(
      "SELECT result FROM case_analysis_operations WHERE id=$1 AND owner_id=$2 AND case_id=$3 AND status='completed'",
      [c.operationId, owner, caseId],
    );
    if (
      op.rows[0]?.result?.kind !== 'clarification' ||
      JSON.stringify(op.rows[0].result.clarification) !== JSON.stringify(c.clarification)
    )
      throw new HttpError(409, 'تعذر التحقق من الاستيضاح السابق.');
  }
  return snapshot;
}
