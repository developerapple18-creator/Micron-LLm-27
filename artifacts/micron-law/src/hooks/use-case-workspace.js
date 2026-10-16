import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetCaseConversationQueryKey,
  getListCasesQueryKey,
  useCompleteAttachment,
  useCreateCase,
  usePrepareAttachment,
  useSendCaseMessage,
  useRemoveUnsentAttachment,
} from '@workspace/api-client-react';
import {
  clearCreateRequestId,
  getCreateRequestId,
  loadDrafts,
  loadOutgoing,
  newRequestId,
  readCreateRecord,
  saveDrafts,
  saveOutgoing,
  setCreatedCaseId,
} from '@/lib/case-drafts';
import { errorStatus, errorText, useCsrfRequest } from '@/lib/session';
import { readSavedUpdates, saveUpdateReceipt } from '@/lib/composer-action';
export const MAX_CONTENT = 20000;
export const MAX_ATTACHMENTS = 10;
export const NEW_KEY = 'new';
export const listKey = (userId) => [...getListCasesQueryKey(), userId];
export const convKey = (caseId, userId) => [...getGetCaseConversationQueryKey(caseId), userId];
export const UNCONFIRMED = 'تعذّر تأكيد الحفظ — أعد المحاولة';
/** True when the server may have committed the request but we never saw the answer. */
function isAmbiguous(err) {
  const status = errorStatus(err);
  return status === undefined || status >= 500 || status === 408 || status === 429;
}
function requestError(err, fallback) {
  const status = errorStatus(err);
  if (isAmbiguous(err)) return UNCONFIRMED;
  if (status === 401) return 'انتهت الجلسة. سجّل الدخول مجددًا.';
  if (status === 403) return 'لا تملك صلاحية تنفيذ هذا الإجراء.';
  return errorText(err, fallback);
}
function matchContentType(file, policy) {
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  const fmt = policy.formats.find((f) => f.extension.replace(/^\./, '').toLowerCase() === ext);
  if (!fmt || fmt.contentTypes.length === 0) return null;
  const declared = file.type.toLowerCase();
  if (declared && declared !== 'application/octet-stream')
    return fmt.contentTypes.includes(declared) ? declared : null;
  return fmt.contentTypes[0];
}
function putFile(url, file, contentType, csrf, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    if (url.startsWith('/')) xhr.setRequestHeader('x-csrf-token', csrf);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0)
        onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`status ${xhr.status}`));
    xhr.onerror = () => reject(new Error('network'));
    xhr.onabort = () => reject(new Error('abort'));
    xhr.ontimeout = () => reject(new Error('timeout'));
    xhr.send(file);
  });
}
export function useCaseWorkspace({ userId, viewCaseId, onCreated }) {
  const qc = useQueryClient();
  const request = useCsrfRequest();
  const csrfRef = useRef(request.headers['x-csrf-token']);
  csrfRef.current = request.headers['x-csrf-token'];
  const createCase = useCreateCase({ request });
  const sendMessage = useSendCaseMessage({ request });
  const prepare = usePrepareAttachment({ request });
  const complete = useCompleteAttachment({ request });
  const removeAttachmentMutation = useRemoveUnsentAttachment({ request });
  const removeRef = useRef(removeAttachmentMutation.mutateAsync);
  removeRef.current = removeAttachmentMutation.mutateAsync;
  const [removals, setRemovals] = useState({});
  const removalsRef = useRef(removals);
  removalsRef.current = removals;
  const [removedIds, setRemovedIds] = useState(() => new Set());
  const createRef = useRef(createCase.mutateAsync);
  createRef.current = createCase.mutateAsync;
  const sendRef = useRef(sendMessage.mutateAsync);
  sendRef.current = sendMessage.mutateAsync;
  const sendingIds = useRef(new Set());
  const prepareRef = useRef(prepare.mutateAsync);
  prepareRef.current = prepare.mutateAsync;
  const completeRef = useRef(complete.mutateAsync);
  completeRef.current = complete.mutateAsync;
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;
  const viewRef = useRef(viewCaseId);
  viewRef.current = viewCaseId;
  const [drafts, setDrafts] = useState(() => loadDrafts(userId));
  const [draftLinks, setDraftLinks] = useState(() => {
    try {
      const stored = JSON.parse(
        sessionStorage.getItem(`micron:clarification-drafts:${userId}`) ?? '{}',
      );
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
      const valid = {};
      for (const [key, value] of Object.entries(stored)) {
        const link = value;
        if (
          link &&
          typeof link.operationId === 'string' &&
          Array.isArray(link.questionIds) &&
          link.questionIds.every((id) => typeof id === 'string')
        )
          valid[key] = link;
      }
      return valid;
    } catch {
      return {};
    }
  });
  const setDraftLink = (key, link) =>
    setDraftLinks((old) => {
      const next = { ...old, [key]: link };
      try {
        sessionStorage.setItem(`micron:clarification-drafts:${userId}`, JSON.stringify(next));
      } catch {
        /* In-memory state remains. */
      }
      return next;
    });
  const [uploads, setUploads] = useState([]);
  const [savedUpdates, setSavedUpdates] = useState(() => readSavedUpdates(userId));
  const recordSavedUpdate = useCallback(
    (s, caseId) => {
      if (s.startAnalysis !== false || s.reportQuestion) return;
      saveUpdateReceipt(userId, caseId, s.requestId);
      setSavedUpdates((old) => ({ ...old, [caseId]: s.requestId }));
    },
    [userId],
  );
  // Outgoing queue survives reloads; anything restored is unconfirmed until retried or reconciled.
  const [sends, setSends] = useState(() => {
    const created = readCreateRecord(userId)?.caseId ?? null;
    return loadOutgoing(userId)
      .filter((s) => s && typeof s.requestId === 'string')
      .map((s) => ({ ...s, caseId: s.caseId ?? created, status: 'error', error: UNCONFIRMED }));
  });
  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;
  const sendsRef = useRef(sends);
  sendsRef.current = sends;
  useEffect(() => {
    saveDrafts(userId, drafts);
  }, [userId, drafts]);
  useEffect(() => {
    saveOutgoing(userId, sends);
  }, [userId, sends]);
  const setDraft = useCallback((key, value) => {
    setDrafts((d) => (d[key] === value ? d : { ...d, [key]: value }));
  }, []);
  const invalidate = useCallback(
    (caseId) => {
      void qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
      void qc.invalidateQueries({ queryKey: getGetCaseConversationQueryKey(caseId) });
      void qc.invalidateQueries({ queryKey: ['case-analysis-operations', userId, caseId] });
      void qc.invalidateQueries({ queryKey: ['case-analysis-capability', userId, caseId] });
    },
    [qc, userId],
  );
  // Lazy creation: one in-flight promise, persistent idempotency key across reloads/retries.
  const creating = useRef(null);
  const ensureCase = useCallback(
    async (forCaseId) => {
      if (forCaseId) return forCaseId;
      if (creating.current) return creating.current;
      const p = (async () => {
        const requestId = getCreateRequestId(userId);
        const resumed = readCreateRecord(userId)?.caseId;
        const info = resumed ? { id: resumed } : await createRef.current({ data: { requestId } });
        setCreatedCaseId(userId, requestId, info.id);
        if ('title' in info)
          qc.setQueryData(listKey(userId), (old) =>
            old ? (old.some((c) => c.id === info.id) ? old : [info, ...old]) : old,
          );
        void qc.invalidateQueries({ queryKey: getListCasesQueryKey() });
        setDrafts((d) => {
          const pending = d[NEW_KEY];
          if (!pending) return d;
          const { [NEW_KEY]: _moved, ...rest } = d;
          return { ...rest, [info.id]: rest[info.id] ? `${rest[info.id]}\n${pending}` : pending };
        });
        setUploads((u) => u.map((x) => (x.caseId === null ? { ...x, caseId: info.id } : x)));
        const migrated = sendsRef.current.map((x) =>
          x.caseId === null ? { ...x, caseId: info.id } : x,
        );
        sendsRef.current = migrated;
        saveOutgoing(userId, migrated); // persist migration synchronously before dropping the creation record
        setSends((s) => s.map((x) => (x.caseId === null ? { ...x, caseId: info.id } : x)));
        const stored = loadDrafts(userId);
        if (stored[NEW_KEY]) {
          const { [NEW_KEY]: movedText, ...others } = stored;
          saveDrafts(userId, {
            ...others,
            [info.id]: others[info.id] ? `${others[info.id]}\n${movedText}` : movedText,
          });
        }
        onCreatedRef.current(info.id, viewRef.current === null);
        clearCreateRequestId(userId);
        return info.id;
      })();
      creating.current = p;
      try {
        return await p;
      } finally {
        creating.current = null;
      }
    },
    [qc, userId],
  );
  // ---------- Uploads ----------
  const patchUpload = useCallback((localId, p) => {
    setUploads((u) => u.map((x) => (x.localId === localId ? { ...x, ...p } : x)));
  }, []);
  const runUpload = useCallback(
    async (item) => {
      const patch = (p) => patchUpload(item.localId, p);
      const fail = (failedAt, error, retryable = true) =>
        patch({ stage: 'error', failedAt, error, retryable });
      const checking = (failedAt, error) =>
        patch({ stage: 'checking', failedAt, error, retryable: true });
      const uploadStarted = performance.now();
      let caseId = item.caseId;
      let attachment = item.attachment;
      patch({ stage: item.failedAt === 'complete' ? 'finalizing' : 'preparing', error: undefined });
      if (!caseId) {
        try {
          caseId = await ensureCase(null);
          patch({ caseId });
        } catch (e) {
          fail(
            'create',
            isAmbiguous(e)
              ? 'تعذّر تأكيد إنشاء القضية — أعد المحاولة'
              : requestError(e, 'تعذّر إنشاء القضية. لم يُرفع الملف.'),
          );
          return;
        }
      }
      if (!(item.failedAt === 'complete' && attachment)) {
        let uploadUrl;
        try {
          const prep = await prepareRef.current({
            caseId,
            data: {
              requestId: item.requestId,
              filename: item.filename,
              contentType: item.contentType,
              size: item.size,
            },
          });
          attachment = prep.attachment;
          uploadUrl = prep.uploadUrl;
          patch({ attachment });
        } catch (e) {
          (isAmbiguous(e) ? checking : fail)(
            'prepare',
            requestError(e, 'تعذّر تجهيز رفع الملف. لم يُحفظ.'),
          );
          return;
        }
        if (attachment.status === 'ready') {
          patch({ stage: 'ready', progress: 100, attachment });
          invalidate(caseId);
          return;
        }
        if (attachment.status === 'rejected') {
          fail('prepare', 'رفض الخادم هذا الملف. لم يُحفظ.', false);
          return;
        }
        if (uploadUrl) {
          patch({ stage: 'uploading', progress: 0 });
          try {
            await putFile(uploadUrl, item.file, item.contentType, csrfRef.current, (progress) =>
              patch({ progress }),
            );
          } catch {
            // Lost PUT acknowledgement is not proof the bytes were lost.
            // Finalization is idempotent; this never repeats a PUT.
            try {
              const confirmed = await completeRef.current({ caseId, attachmentId: attachment.id });
              if (confirmed.status === 'ready') {
                patch({ stage: 'ready', progress: 100, attachment: confirmed });
                invalidate(caseId);
                return;
              }
              if (confirmed.status === 'rejected')
                fail('complete', 'رفض الخادم الملف بعد التحقق؛ لم يُحفظ.', false);
              else checking('complete', 'بانتظار تأكيد التخزين؛ تحقق مجددًا دون تكرار الرفع.');
            } catch (e) {
              checking(
                'complete',
                'تعذّر تأكيد وصول الملف إلى التخزين؛ تحقق من الاتصال ثم حدّث التأكيد دون إعادة الرفع.',
              );
            }
            invalidate(caseId);
            return;
          }
        }
      }
      patch({ stage: 'finalizing', progress: 100 });
      try {
        const fin = await completeRef.current({ caseId, attachmentId: attachment.id });
        if (fin.status === 'ready') {
          console.info('[micron-performance]', {
            stage: 'upload_completion',
            durationMs: Math.round(performance.now() - uploadStarted),
            scope: 'this_attempt_prepare_put_finalize',
          });
          patch({ stage: 'ready', attachment: fin });
          invalidate(caseId);
        } else if (fin.status === 'rejected')
          fail('complete', 'لم يجتز الملف تحقق الخادم. لم يُحفظ.', false);
        else checking('complete', 'بانتظار تأكيد التخزين — حدّث التأكيد دون إعادة رفع الملف.');
      } catch (e) {
        (isAmbiguous(e) ? checking : fail)(
          'complete',
          isAmbiguous(e)
            ? 'بانتظار تأكيد حفظ الملف؛ تحقق من الاتصال ثم حدّث التأكيد.'
            : requestError(e, 'تعذّر التحقق من الملف على الخادم. لم يُحفظ.'),
        );
      }
    },
    [ensureCase, invalidate, patchUpload],
  );
  const addFiles = useCallback(
    (forCaseId, files, policy) => {
      const saved = forCaseId
        ? (qc.getQueryData(convKey(forCaseId, userId))?.attachments ?? [])
        : [];
      const reservedIds = new Set(
        saved
          .filter((a) => a.messageId === null && !['removed', 'rejected'].includes(a.status))
          .map((a) => a.id),
      );
      const locals = uploadsRef.current.filter(
        (u) => u.caseId === forCaseId && u.stage !== 'error',
      );
      for (const u of locals) if (u.attachment) reservedIds.add(u.attachment.id);
      let slots = Math.max(
        0,
        MAX_ATTACHMENTS - reservedIds.size - locals.filter((u) => !u.attachment).length,
      );
      const items = files.map((file) => {
        const base = {
          localId: newRequestId(),
          caseId: forCaseId,
          file,
          filename: file.name,
          size: file.size,
          requestId: newRequestId(),
          progress: 0,
        };
        const type = matchContentType(file, policy);
        let error;
        if (slots <= 0) error = 'الحد 10 مرفقات للرسالة؛ أرسلها أولًا ثم أضف ملفات في رسالة لاحقة.';
        else if (file.size <= 0) error = 'الملف فارغ.';
        else if (!type) error = 'نوع الملف غير مدعوم.';
        else if (file.size > policy.maxFileBytes) error = 'حجم الملف يتجاوز الحد المسموح.';
        else if (file.name.length > 240) error = 'اسم الملف طويل جدًا.';
        if (!error) slots--;
        return error
          ? { ...base, contentType: type ?? '', stage: 'error', error, retryable: false }
          : { ...base, contentType: type, stage: 'preparing', retryable: true };
      });
      setUploads((u) => [...u, ...items]);
      for (const it of items) if (it.stage !== 'error') void runUpload(it);
    },
    [runUpload, qc, userId],
  );
  const retryUpload = useCallback(
    (localId) => {
      const it = uploadsRef.current.find((x) => x.localId === localId);
      if (it && ['error', 'checking'].includes(it.stage) && it.retryable) void runUpload(it);
    },
    [runUpload],
  );
  const removeUpload = useCallback(
    async (localId) => {
      // Only dismiss failed local rows; completed originals require the API.
      const item = uploadsRef.current.find((u) => u.localId === localId);
      if (item?.stage === 'error' && item.caseId && item.attachment) {
        try {
          await removeRef.current({ caseId: item.caseId, attachmentId: item.attachment.id });
          invalidate(item.caseId);
        } catch (e) {
          patchUpload(localId, {
            error: requestError(e, 'تعذّر تأكيد إزالة الرفع وتحرير سعته. أعد الإزالة.'),
          });
          return;
        }
      }
      setUploads((u) => u.filter((x) => x.localId !== localId || x.stage !== 'error'));
    },
    [invalidate, patchUpload],
  );
  const removeAttachment = useCallback(
    async (caseId, attachment) => {
      if (
        removalsRef.current[attachment.id]?.busy ||
        sendsRef.current.some((s) => s.attachments.some((a) => a.id === attachment.id))
      )
        return;
      const next = { ...removalsRef.current, [attachment.id]: { caseId, busy: true } };
      removalsRef.current = next;
      setRemovals(next);
      try {
        await removeRef.current({ caseId, attachmentId: attachment.id });
        await qc.cancelQueries({ queryKey: getGetCaseConversationQueryKey(caseId) });
        setRemovedIds((old) => new Set([...old, attachment.id]));
        setUploads((all) => all.filter((u) => u.attachment?.id !== attachment.id));
        qc.setQueryData(convKey(caseId, userId), (old) =>
          old
            ? { ...old, attachments: old.attachments.filter((a) => a.id !== attachment.id) }
            : old,
        );
        setRemovals((old) => {
          const { [attachment.id]: _gone, ...rest } = old;
          return rest;
        });
        invalidate(caseId);
      } catch (error) {
        setRemovals((old) => ({
          ...old,
          [attachment.id]: {
            caseId,
            busy: false,
            error: isAmbiguous(error)
              ? 'تعذّر تأكيد الإزالة — أعد المحاولة'
              : requestError(error, 'تعذّرت إزالة المرفق.'),
          },
        }));
        // Recover durable deletion intent or a concurrent committed message.
        invalidate(caseId);
      }
    },
    [invalidate, qc, userId],
  );
  // ---------- Messages ----------
  const runSend = useCallback(
    async (s) => {
      if (sendingIds.current.has(s.requestId)) return;
      sendingIds.current.add(s.requestId);
      try {
        setSends((all) =>
          all.map((x) =>
            x.requestId === s.requestId ? { ...x, status: 'sending', error: undefined } : x,
          ),
        );
        let caseId;
        try {
          caseId = await ensureCase(s.caseId);
        } catch (e) {
          setSends((all) =>
            all.map((x) =>
              x.requestId === s.requestId
                ? {
                    ...x,
                    status: 'error',
                    error: requestError(e, 'تعذّر إنشاء القضية. لم تُرسل الرسالة.'),
                  }
                : x,
            ),
          );
          return;
        }
        try {
          const ids = s.attachments.map((a) => a.id);
          const msg = await sendRef.current({
            caseId,
            data: {
              requestId: s.requestId,
              content: s.content,
              attachmentIds: ids,
              clarification: s.clarification,
              startAnalysis: s.startAnalysis,
              newAnalysis: s.newAnalysis,
              reportQuestion: s.reportQuestion,
            },
          });
          recordSavedUpdate(s, caseId);
          const idSet = new Set(ids);
          qc.setQueryData(convKey(caseId, userId), (old) =>
            old
              ? {
                  ...old,
                  messages: old.messages.some((m) => m.id === msg.id)
                    ? old.messages
                    : [...old.messages, msg].sort((a, b) => a.sequence - b.sequence),
                  attachments: old.attachments.map((a) =>
                    idSet.has(a.id) ? { ...a, messageId: msg.id } : a,
                  ),
                }
              : old,
          );
          setSends((all) => all.filter((x) => x.requestId !== s.requestId));
          setUploads((u) => u.filter((x) => !(x.attachment && idSet.has(x.attachment.id))));
          invalidate(caseId);
        } catch (e) {
          setSends((all) =>
            all.map((x) =>
              x.requestId === s.requestId
                ? { ...x, status: 'error', error: requestError(e, 'تعذّر حفظ الرسالة.') }
                : x,
            ),
          );
          invalidate(caseId);
        }
      } finally {
        sendingIds.current.delete(s.requestId);
      }
    },
    [ensureCase, invalidate, qc, userId, recordSavedUpdate],
  );
  const send = useCallback(
    (forCaseId, content, attachments, clarification, intent) => {
      if (Object.values(removalsRef.current).some((r) => r.caseId === forCaseId && r.busy))
        return false;
      // Lazy creation migrates the outgoing row from "new" to its saved case id.
      // A stale second tap must not treat that migration as permission for a new case.
      if (!forCaseId && (creating.current || sendsRef.current.some((x) => x.status === 'sending')))
        return false;
      const key = forCaseId ?? NEW_KEY;
      if (sendsRef.current.some((x) => (x.caseId ?? NEW_KEY) === key && x.status === 'sending'))
        return false;
      const trimmed = content.trim();
      if (
        (!trimmed && attachments.length === 0) ||
        content.length > MAX_CONTENT ||
        attachments.length > MAX_ATTACHMENTS
      )
        return false;
      const s = {
        requestId: newRequestId(),
        caseId: forCaseId,
        content: clarification ? content : trimmed,
        attachments,
        clarification,
        startAnalysis: intent?.startAnalysis ?? true,
        newAnalysis: intent?.newAnalysis,
        reportQuestion: intent?.reportQuestion,
        status: 'sending',
        createdAt: new Date().toISOString(),
      };
      sendsRef.current = [...sendsRef.current, s];
      saveOutgoing(userId, sendsRef.current); // persisted before the composer is cleared
      setSends((all) => [...all, s]);
      setDrafts((d) => ({ ...d, [key]: '' }));
      setDraftLinks((old) => {
        const next = { ...old };
        delete next[key];
        try {
          sessionStorage.setItem(`micron:clarification-drafts:${userId}`, JSON.stringify(next));
        } catch {
          /* Queue already persists the binding. */
        }
        return next;
      });
      void runSend(s);
      return true;
    },
    [runSend, userId],
  );
  /** Drop queued sends the server already stored (matched by requestId). */
  const reconcile = useCallback(
    (requestIds) => {
      if (!sendsRef.current.some((s) => requestIds.has(s.requestId))) return;
      const keptIds = new Set(
        sendsRef.current
          .filter((s) => requestIds.has(s.requestId))
          .flatMap((s) => s.attachments.map((a) => a.id)),
      );
      for (const s of sendsRef.current)
        if (s.caseId && requestIds.has(s.requestId)) recordSavedUpdate(s, s.caseId);
      setSends((all) => all.filter((s) => !requestIds.has(s.requestId)));
      setUploads((u) => u.filter((x) => !(x.attachment && keptIds.has(x.attachment.id))));
    },
    [recordSavedUpdate],
  );
  const retrySend = useCallback(
    (requestId) => {
      const s = sendsRef.current.find((x) => x.requestId === requestId);
      if (!s || s.status !== 'error') return;
      if (sendsRef.current.some((x) => x.caseId === s.caseId && x.status === 'sending')) return;
      void runSend(s); // same requestId: server deduplicates if the first attempt landed
    },
    [runSend],
  );
  const resubmit = useCallback(
    (message) => {
      const s = {
        requestId: message.requestId,
        caseId: message.caseId,
        content: message.content,
        attachments: message.attachments,
        clarification: message.clarification,
        startAnalysis: true,
        status: 'sending',
        createdAt: message.createdAt,
      };
      void runSend(s);
    },
    [runSend],
  );
  return {
    drafts,
    setDraft,
    draftLinks,
    setDraftLink,
    uploads,
    sends,
    savedUpdates,
    addFiles,
    retryUpload,
    removeUpload,
    removeAttachment,
    removals,
    removedIds,
    send,
    retrySend,
    reconcile,
    resubmit,
  };
}
