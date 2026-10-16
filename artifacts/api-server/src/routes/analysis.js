import { Router } from 'express';
import {
  CreateCaseAnalysisOperationBody,
  ListCaseAnalysisOperationsResponse,
  GetCaseAnalysisOperationResponse,
  CreateCaseAnalysisOperationResponse,
  GetCaseAnalysisCapabilityResponse,
  ExecuteCaseAnalysisOperationResponse,
} from '@workspace/api-zod';
import { lawyerIdentity, resourceId, validated } from '../lib/case-access.js';
import { createAnalysis, getAnalysis, listAnalysis } from '../lib/analysis-lifecycle.js';
import { throttle } from '../lib/security.js';
import { analysisCapability, beginExecution } from '../lib/analysis-execution.js';
const router = Router();
router.get('/cases/:caseId/analysis-capability', async (req, res) => {
  res.json(
    GetCaseAnalysisCapabilityResponse.parse(
      await analysisCapability(await lawyerIdentity(req), resourceId(req.params.caseId)),
    ),
  );
});
router.post('/cases/:caseId/analysis-operations/:operationId/execute', async (req, res) => {
  const owner = await lawyerIdentity(req),
    caseId = resourceId(req.params.caseId),
    id = resourceId(req.params.operationId);
  await throttle(`analysis-execute:${owner}`, 20);
  const { operation, completion } = await beginExecution(owner, caseId, id);
  void completion.catch(() => req.log.error({ operationId: id }, 'Analysis execution interrupted'));
  res.status(202).json(ExecuteCaseAnalysisOperationResponse.parse(operation));
});
router.get('/cases/:caseId/analysis-operations', async (req, res) => {
  const owner = await lawyerIdentity(req),
    caseId = resourceId(req.params.caseId);
  res.json(ListCaseAnalysisOperationsResponse.parse(await listAnalysis(owner, caseId)));
});
router.get('/cases/:caseId/analysis-operations/:operationId', async (req, res) => {
  const owner = await lawyerIdentity(req),
    caseId = resourceId(req.params.caseId),
    id = resourceId(req.params.operationId);
  res.json(GetCaseAnalysisOperationResponse.parse(await getAnalysis(owner, caseId, id)));
});
router.post('/cases/:caseId/analysis-operations', async (req, res) => {
  const owner = await lawyerIdentity(req),
    caseId = resourceId(req.params.caseId);
  const input = validated(CreateCaseAnalysisOperationBody, req.body);
  await throttle(`analysis-create:${owner}`, 100);
  res.json(
    CreateCaseAnalysisOperationResponse.parse(
      await createAnalysis(
        owner,
        caseId,
        input.messageId,
        input.parentOperationId,
        input.attachmentId,
        undefined,
        input.attachmentIds,
      ),
    ),
  );
});
export default router;
