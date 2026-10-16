import { Router } from 'express';
import { pipeline } from 'node:stream/promises';
import { pool } from '@workspace/db';
import { PrepareAttachmentBody } from '@workspace/api-zod';
import { HttpError, throttle } from '../lib/security.js';
import {
  attachmentView,
  lawyerIdentity,
  ownedCase,
  resourceId,
  validated,
} from '../lib/case-access.js';
import { formats, maxFileBytes, storageFile, uploadUrl } from '../lib/private-files.js';
import { removeUnsentAttachment } from '../lib/attachment-removal.js';
import {
  maxMessageAttachments,
  maxCaseAttachments,
  maxCaseBytes,
  maxPdfAnalysisBytes,
  maxPdfAnalysisAttachments,
  pdfCombinedLimit,
} from '../lib/attachment-policy.js';
import { prepareStoredAttachment } from '../lib/attachment-preparation.js';
const router = Router();
router.get('/attachments/policy', async (req, res) => {
  await lawyerIdentity(req);
  res.json({
    maxFileBytes,
    maxMessageAttachments,
    maxCaseAttachments,
    maxCaseBytes,
    maxPdfAnalysisBytes,
    maxPdfAnalysisCombinedBytes: pdfCombinedLimit(),
    maxPdfAnalysisAttachments,
    formats,
  });
});
router.post('/cases/:caseId/attachments', async (req, res) => {
  const owner = await lawyerIdentity(req);
  const caseId = resourceId(req.params.caseId);
  const input = validated(PrepareAttachmentBody, req.body);
  await throttle(`attachment-prepare:${owner}`, 60);
  const attachment = await prepareStoredAttachment(owner, caseId, input);
  if (attachment.status === 'ready') {
    res.json({ attachment: attachmentView(attachment), uploadUrl: null, expiresAt: null });
    return;
  }
  res.json({
    attachment: attachmentView(attachment),
    ...(await uploadUrl(attachment.staging_path)),
  });
});
router.delete('/cases/:caseId/attachments/:attachmentId', async (req, res) => {
  const owner = await lawyerIdentity(req);
  await removeUnsentAttachment(
    resourceId(req.params.caseId),
    resourceId(req.params.attachmentId),
    owner,
  );
  res.json({ message: 'تمت إزالة المرفق من القضية والتخزين.' });
});
router.post('/cases/:caseId/attachments/:attachmentId/complete', async (req, res) => {
  const completionStart = performance.now();
  const owner = await lawyerIdentity(req);
  const caseId = resourceId(req.params.caseId);
  const id = resourceId(req.params.attachmentId);
  const client = await pool.connect();
  let stagingToDelete;
  try {
    await client.query('BEGIN');
    await ownedCase(caseId, owner, client, true);
    const result = await client.query(
      'SELECT * FROM case_attachments WHERE id=$1 AND case_id=$2 AND owner_id=$3 FOR UPDATE',
      [id, caseId, owner],
    );
    const row = result.rows[0];
    if (!row) throw new HttpError(404, 'المرفق غير موجود.');
    if (row.status === 'ready') {
      await client.query('COMMIT');
      res.json(attachmentView(row));
      return;
    }
    if (row.status !== 'pending') throw new HttpError(409, 'لم يكتمل رفع المرفق. أعد الرفع.');
    const staging = storageFile(row.staging_path);
    let metadata;
    try {
      [metadata] = await staging.getMetadata();
    } catch {
      throw new HttpError(409, 'لم يصل الملف إلى التخزين. أعد الرفع أو حاول التحقق مجددًا.');
    }
    const actualSize = Number(metadata.size);
    if (
      !Number.isSafeInteger(actualSize) ||
      actualSize < 1 ||
      actualSize > maxFileBytes ||
      actualSize !== Number(row.size) ||
      metadata.contentType !== row.content_type
    ) {
      // Confirm deletion before releasing capacity; if deletion fails the pending
      // reservation remains available for explicit retry/removal, never silently freed.
      await staging.delete({ ignoreNotFound: true, ifGenerationMatch: metadata.generation });
      await client.query("UPDATE case_attachments SET status='rejected' WHERE id=$1", [id]);
      await client.query('COMMIT');
      throw new HttpError(
        400,
        'رُفض المرفق: الحجم أو النوع الفعلي لا يطابق بيانات الرفع. أعد رفع الملف الصحيح.',
      );
    }
    // Never expose the signed-URL staging object: it can still be overwritten
    // while its URL is valid. Copy the verified generation to a create-only key.
    const original = storageFile(row.storage_path);
    try {
      await storageFile(row.staging_path, metadata.generation).copy(original, {
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    } catch (error) {
      // A previous finalize may have copied bytes and then lost its DB commit.
      if (error.code !== 412)
        throw new HttpError(503, 'تعذّر تثبيت الملف في التخزين. لم يُحفظ المرفق؛ حاول مجددًا.');
    }
    const [finalMetadata] = await original.getMetadata();
    if (
      Number(finalMetadata.size) !== Number(row.size) ||
      finalMetadata.contentType !== row.content_type
    ) {
      throw new HttpError(503, 'تعذّر التحقق من الملف المحفوظ. لم يكتمل حفظ المرفق.');
    }
    const updated = await client.query(
      "UPDATE case_attachments SET status='ready',generation=$2,ready_at=clock_timestamp() WHERE id=$1 RETURNING *",
      [id, finalMetadata.generation],
    );
    await client.query(
      "UPDATE cases SET updated_at=clock_timestamp(),title=CASE WHEN title='قضية جديدة' THEN $3 ELSE title END WHERE id=$1 AND owner_id=$2",
      [caseId, owner, `مرفق: ${row.filename}`.slice(0, 80)],
    );
    await client.query('COMMIT');
    stagingToDelete = row.staging_path;
    res.json(attachmentView(updated.rows[0]));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    req.log.info(
      { stage: 'upload_finalization', durationMs: performance.now() - completionStart },
      'Attachment duration',
    );
    client.release();
    if (stagingToDelete)
      void storageFile(stagingToDelete)
        .delete({ ignoreNotFound: true })
        .catch(() => undefined);
  }
});
router.get('/cases/:caseId/attachments/:attachmentId/download', async (req, res) => {
  const owner = await lawyerIdentity(req);
  const caseId = resourceId(req.params.caseId);
  const id = resourceId(req.params.attachmentId);
  await ownedCase(caseId, owner);
  const { rows } = await pool.query(
    "SELECT * FROM case_attachments WHERE id=$1 AND case_id=$2 AND owner_id=$3 AND status='ready'",
    [id, caseId, owner],
  );
  const row = rows[0];
  if (!row?.generation) throw new HttpError(404, 'الملف غير موجود أو لم يكتمل رفعه.');
  const file = storageFile(row.storage_path, row.generation);
  try {
    await file.getMetadata();
    const filename = encodeURIComponent(row.filename).replace(
      /['()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(row.size),
      'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${filename}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    await pipeline(file.createReadStream(), res);
  } catch {
    if (res.headersSent) res.destroy();
    else throw new HttpError(503, 'تعذّر استرجاع الملف الأصلي. حاول مجددًا.');
  }
});
export default router;
