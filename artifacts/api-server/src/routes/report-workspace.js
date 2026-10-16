import { Router } from 'express';
import { lawyerIdentity, resourceId } from '../lib/case-access.js';
import { throttle, HttpError } from '../lib/security.js';
import { listVersions, selectedVersion, saveVersion } from '../lib/report-versions.js';
import {
  listInteractions,
  prepareInteraction,
  rejectInteraction,
  beginInteraction,
} from '../lib/report-interactions.js';
import { exportDocx, exportPdf } from '../lib/report-export.js';
import { createFolder, listFolders, renameFolder, updateCase } from '../lib/case-organization.js';
const router = Router();
const path = '/cases/:caseId/reports/:operationId';
router.use(['/case-folders', path, '/report-exports'], (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
router.get('/case-folders', async (req, res) =>
  res.json(await listFolders(await lawyerIdentity(req))),
);
router.post('/case-folders', async (req, res) => {
  const owner = await lawyerIdentity(req);
  await throttle(`folder-write:${owner}`, 60);
  res.json(await createFolder(owner, req.body));
});
router.patch('/case-folders/:folderId', async (req, res) => {
  const owner = await lawyerIdentity(req);
  await throttle(`folder-write:${owner}`, 60);
  res.json(await renameFolder(owner, resourceId(req.params.folderId), req.body));
});
router.patch('/cases/:caseId', async (req, res) => {
  const owner = await lawyerIdentity(req);
  await throttle(`case-organize:${owner}`, 120);
  res.json(await updateCase(owner, resourceId(req.params.caseId), req.body));
});
router.get(`${path}/versions`, async (req, res) =>
  res.json(
    await listVersions(
      await lawyerIdentity(req),
      resourceId(req.params.caseId),
      resourceId(req.params.operationId),
    ),
  ),
);
router.post(`${path}/versions`, async (req, res) => {
  const owner = await lawyerIdentity(req);
  await throttle(`report-save:${owner}`, 60);
  res.json(
    await saveVersion(
      owner,
      resourceId(req.params.caseId),
      resourceId(req.params.operationId),
      req.body,
    ),
  );
});
router.get('/report-exports', async (req, res) => {
  const owner = await lawyerIdentity(req);
  await throttle(`report-export:${owner}`, 30);
  if (req.query.format !== 'docx' && req.query.format !== 'pdf')
    throw new HttpError(400, 'اختر Word أو PDF.');
  const v = await selectedVersion(
    owner,
    resourceId(req.query.caseId),
    resourceId(req.query.operationId),
    resourceId(req.query.versionId),
  );
  const format = req.query.format;
  const body = format === 'docx' ? await exportDocx(v) : await exportPdf(v);
  const filename = `${v.report.title.replace(/[^\p{L}\p{N} -]/gu, '').slice(0, 80)} - ${v.number}.${format}`;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader(
    'Content-Type',
    format === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="report-v${v.number}.${format}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.send(body);
});
router.get(`${path}/interactions`, async (req, res) =>
  res.json(
    await listInteractions(
      await lawyerIdentity(req),
      resourceId(req.params.caseId),
      resourceId(req.params.operationId),
    ),
  ),
);
router.post(`${path}/interactions`, async (req, res) => {
  const owner = await lawyerIdentity(req);
  await throttle(`paragraph-prepare:${owner}`, 60);
  res.json(
    await prepareInteraction(
      owner,
      resourceId(req.params.caseId),
      resourceId(req.params.operationId),
      req.body,
    ),
  );
});
router.post(`${path}/interactions/:interactionId/reject`, async (req, res) =>
  res.json(
    await rejectInteraction(
      await lawyerIdentity(req),
      resourceId(req.params.caseId),
      resourceId(req.params.operationId),
      resourceId(req.params.interactionId),
    ),
  ),
);
router.post(`${path}/interactions/:interactionId/execute`, async (req, res) => {
  const owner = await lawyerIdentity(req);
  const { interaction, completion } = await beginInteraction(
    owner,
    resourceId(req.params.caseId),
    resourceId(req.params.operationId),
    resourceId(req.params.interactionId),
  );
  void completion.catch(() => req.log.error('Paragraph execution storage interrupted'));
  res.status(202).json(interaction);
});
export default router;
