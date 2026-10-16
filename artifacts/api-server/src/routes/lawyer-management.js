import { Router } from 'express';
import { lawyerIdentity, resourceId } from '../lib/case-access.js';
import {
  listClients,
  getClient,
  createClient,
  editClient,
  pinClient,
} from '../lib/lawyer-clients.js';
import { getFees, saveAgreement, createReceipt, editReceipt } from '../lib/case-fees.js';
import { throttle } from '../lib/security.js';
const router = Router();
router.get('/clients', async (req, res) => res.json(await listClients(await lawyerIdentity(req))));
router.get('/clients/:clientId', async (req, res) =>
  res.json(await getClient(await lawyerIdentity(req), resourceId(req.params.clientId))),
);
router.post('/clients', async (req, res) => {
  const owner = await lawyerIdentity(req);
  await throttle(`client-write:${owner}`, 100);
  res.json(await createClient(owner, req.body));
});
router.patch('/clients/:clientId', async (req, res) => {
  const owner = await lawyerIdentity(req);
  await throttle(`client-write:${owner}`, 100);
  res.json(await editClient(owner, resourceId(req.params.clientId), req.body));
});
router.patch('/clients/:clientId/pin', async (req, res) => {
  const owner = await lawyerIdentity(req);
  await throttle(`client-write:${owner}`, 100);
  res.json(await pinClient(owner, resourceId(req.params.clientId), req.body));
});
router.get('/cases/:caseId/fees', async (req, res) =>
  res.json(await getFees(await lawyerIdentity(req), resourceId(req.params.caseId))),
);
router.put('/cases/:caseId/fees', async (req, res) => {
  const owner = await lawyerIdentity(req);
  await throttle(`fee-write:${owner}`, 150);
  res.json(await saveAgreement(owner, resourceId(req.params.caseId), req.body));
});
router.post('/cases/:caseId/fee-receipts', async (req, res) => {
  const owner = await lawyerIdentity(req);
  await throttle(`fee-write:${owner}`, 150);
  res.json(await createReceipt(owner, resourceId(req.params.caseId), req.body));
});
router.patch('/cases/:caseId/fee-receipts/:receiptId', async (req, res) => {
  const owner = await lawyerIdentity(req);
  await throttle(`fee-write:${owner}`, 150);
  res.json(
    await editReceipt(
      owner,
      resourceId(req.params.caseId),
      resourceId(req.params.receiptId),
      req.body,
    ),
  );
});
export default router;
