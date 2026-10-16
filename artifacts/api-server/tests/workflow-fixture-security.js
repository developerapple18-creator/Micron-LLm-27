export class HttpError extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const owner = '00000000-0000-4000-8000-000000000111';
export const otherOwner = '00000000-0000-4000-8000-000000000222';
export async function currentUser(req) {
  const scope = req?.headers?.['x-fixture-account'];
  if (scope === 'anonymous') return null;
  return {
    id: scope === 'other' ? otherOwner : owner,
    role: scope === 'admin' ? 'admin' : 'lawyer',
    name: 'Synthetic Workflow Lawyer',
  };
}
export async function throttle() {}
