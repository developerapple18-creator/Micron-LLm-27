import { Readable } from 'node:stream';
import { HttpError } from '../src/lib/security.js';
export { maxFileBytes } from '../src/lib/attachment-policy.js';
export const formats = [
  { extension: '.pdf', contentTypes: ['application/pdf'] },
  {
    extension: '.docx',
    contentTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  },
  { extension: '.txt', contentTypes: ['text/plain'] },
];
export function validateFile(name, type, size) {
  if (
    !size ||
    !formats.some((f) => name.toLowerCase().endsWith(f.extension) && f.contentTypes.includes(type))
  )
    throw new HttpError(400, 'Synthetic fixture rejected file');
}
const objects = new Map();
let generation = 0;
export function putObject(path, bytes, type) {
  objects.set(path, { bytes, type, generation: String(++generation) });
}
export function storageStats() {
  return [...objects.values()].map((o) => ({ bytes: o.bytes.length, type: o.type }));
}
export function storageFile(path, pinned) {
  const get = () => {
    const o = objects.get(path);
    if (!o || (pinned && o.generation !== String(pinned)))
      throw Object.assign(new Error('missing'), { code: 404 });
    return o;
  };
  return {
    path,
    getMetadata: async () => {
      const o = get();
      return [{ size: String(o.bytes.length), contentType: o.type, generation: o.generation }];
    },
    copy: async (target, options) => {
      if (objects.has(target.path) && options?.preconditionOpts?.ifGenerationMatch === 0)
        throw Object.assign(new Error('exists'), { code: 412 });
      const o = get();
      objects.set(target.path, { ...o, generation: String(++generation) });
      return [target];
    },
    delete: async () => {
      objects.delete(path);
    },
    createReadStream: () => Readable.from(get().bytes),
  };
}
export function privatePath(owner, caseId, id, staging) {
  return `/synthetic/${owner}/${caseId}/${staging ? 'pending' : 'originals'}/${id}`;
}
export const objectStorageClient = {
  bucket: (bucket) => ({
    file: (path, options) => storageFile(`/${bucket}/${path}`, options?.generation),
  }),
};
export async function uploadUrl(path) {
  return { uploadUrl: `/__storage${path}`, expiresAt: new Date(Date.now() + 900000).toISOString() };
}
