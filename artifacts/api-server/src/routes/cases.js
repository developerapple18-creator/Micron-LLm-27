import { Router } from 'express';
import { pool } from '@workspace/db';
import { CreateCaseBody, SendCaseMessageBody } from '@workspace/api-zod';
import { validateMessageAttachments } from '../lib/attachment-policy.js';
import { throttle } from '../lib/security.js';
import {
  attachmentView,
  caseView,
  lawyerIdentity,
  messageView,
  ownedCase,
  resourceId,
  validated,
} from '../lib/case-access.js';
import { submitCaseMessage } from '../lib/analysis-submission.js';
const router = Router();
router.get('/cases', async (req, res) => {
  const owner = await lawyerIdentity(req);
  const { rows } = await pool.query(
    `SELECT c.*,o.folder_id,COALESCE(o.pinned,false) AS pinned,l.name AS client_name FROM cases c LEFT JOIN case_organization o
    ON o.case_id=c.id AND o.owner_id=c.owner_id LEFT JOIN lawyer_clients l ON l.id=c.client_id AND l.owner_id=c.owner_id
    WHERE c.owner_id=$1 ORDER BY c.updated_at DESC,c.id`,
    [owner],
  );
  res.json(rows.map(caseView));
});
router.post('/cases', async (req, res) => {
  const owner = await lawyerIdentity(req);
  const input = validated(CreateCaseBody, req.body);
  await throttle(`case-create:${owner}`, 60);
  const { rows } = await pool.query(
    `INSERT INTO cases(owner_id,request_id) VALUES($1,$2)
     ON CONFLICT(owner_id,request_id) DO UPDATE SET request_id=excluded.request_id RETURNING *`,
    [owner, input.requestId],
  );
  res.json(caseView(rows[0]));
});
router.get('/cases/:caseId', async (req, res) => {
  const owner = await lawyerIdentity(req);
  const id = resourceId(req.params.caseId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const caseRow = await ownedCase(id, owner, client);
    const { rows: clients } = await client.query(
      'SELECT name FROM lawyer_clients WHERE id=$1 AND owner_id=$2',
      [caseRow.client_id, owner],
    );
    const { rows: organization } = await client.query(
      'SELECT folder_id,pinned FROM case_organization WHERE case_id=$1 AND owner_id=$2',
      [id, owner],
    );
    const { rows: messages } = await client.query(
      'SELECT * FROM case_messages WHERE case_id=$1 AND owner_id=$2 ORDER BY sequence',
      [id, owner],
    );
    const { rows: attachments } = await client.query(
      "SELECT * FROM case_attachments WHERE case_id=$1 AND owner_id=$2 AND status<>'removed' ORDER BY created_at,id",
      [id, owner],
    );
    const { rows: questions } = await client.query(
      `SELECT id,request_id,operation_id,version_id,
      CASE WHEN status='running' AND started_at<now()-interval '4 minutes' THEN 'failed' ELSE status END AS status,instruction,answer
      FROM report_interactions WHERE case_id=$1 AND owner_id=$2 AND section_id='__report__' AND kind='discuss'
      ORDER BY created_at,id`,
      [id, owner],
    );
    await client.query('COMMIT');
    res.json({
      caseInfo: caseView({
        ...caseRow,
        client_name: clients[0]?.name,
        folder_id: organization[0]?.folder_id,
        pinned: organization[0]?.pinned,
      }),
      messages: messages.map((m) => messageView(m, attachments)),
      attachments: attachments.map(attachmentView),
      reportQuestions: questions.map((q) => ({
        id: q.id,
        requestId: q.request_id,
        operationId: q.operation_id,
        versionId: q.version_id,
        status: q.status,
        instruction: q.instruction,
        answer: q.answer,
      })),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});
router.post('/cases/:caseId/messages', async (req, res) => {
  const owner = await lawyerIdentity(req);
  const id = resourceId(req.params.caseId);
  if (Array.isArray(req.body?.attachmentIds)) validateMessageAttachments(req.body.attachmentIds);
  const input = validated(SendCaseMessageBody, req.body);
  await throttle(`message-send:${owner}`, 150);
  const { message, completion } = await submitCaseMessage(owner, id, input);
  void completion.catch(() => req.log.error('Submitted analysis execution interrupted'));
  res.json(message);
});
export default router;
