import { getHeapStatistics } from 'node:v8';
import { HttpError } from './security.js';
const capacityError = () =>
  new HttpError(
    503,
    'ذاكرة الخادم المتاحة الآن لا تكفي لتجهيز المستند دون اختصاره. الأصول والتقارير السابقة محفوظة؛ لم نكرر طلب التوليد.',
  );
const interrupted = () => new DOMException('Document resource wait aborted', 'AbortError');
export function pdfWorkingSetBytes(rawBytes, native = false) {
  if (!Number.isSafeInteger(rawBytes) || rawBytes < 1) throw capacityError();
  const bytes = native ? rawBytes * 3 : rawBytes * 2 + Math.ceil(rawBytes / 3) * 4 * 2 * 3;
  if (!Number.isSafeInteger(bytes)) throw capacityError();
  return bytes;
}
export function documentMemoryCapacity() {
  const heap = getHeapStatistics();
  return {
    available: process.availableMemory(),
    heapFree: heap.heap_size_limit - heap.used_heap_size,
  };
}
/** One API process, no job-count quota. Reserve synchronously before any byte read.
 * Subtract the FULL outstanding envelopes from live headroom, even if some bytes
 * already appear in RSS/heap: conservative double-counting beats optimistic admission.
 * Envelopes are estimates, not guarantees against malformed PDF expansion or other allocators.
 */
export class DocumentResources {
  capacity;
  reserved = 0;
  queue = [];
  constructor(capacity = documentMemoryCapacity) {
    this.capacity = capacity;
  }
  fits(bytes) {
    const { available, heapFree } = this.capacity();
    return (
      Number.isFinite(available) &&
      Number.isFinite(heapFree) &&
      bytes <= available - this.reserved &&
      bytes <= heapFree - this.reserved
    );
  }
  grant(bytes) {
    this.reserved += bytes;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.reserved -= bytes;
      this.drain();
    };
  }
  drain() {
    while (this.queue.length) {
      const next = this.queue[0];
      if (!next.ready) return;
      if (!this.fits(next.bytes) && this.reserved) return;
      this.queue.shift();
      next.signal?.removeEventListener('abort', next.abort);
      if (this.fits(next.bytes)) next.resolve(this.grant(next.bytes));
      // No reservations can release more headroom. Fail explicitly rather than
      // hold a running operation forever waiting for unrelated host allocations.
      else next.reject(capacityError());
    }
  }
  async acquire(bytes, signal, onWait) {
    if (!Number.isSafeInteger(bytes) || bytes < 1) throw capacityError();
    if (signal?.aborted) throw interrupted();
    if (!this.queue.length && this.fits(bytes)) return this.grant(bytes);
    if (!this.reserved && !this.queue.length) throw capacityError();
    // Join synchronously so a smaller arrival cannot bypass a waiting large
    // original while its checkpoint is pending. No resource is held until that
    // lawyer-visible checkpoint (including its lease fence) has succeeded.
    return new Promise((resolve, reject) => {
      const waiter = {
        bytes,
        ready: false,
        signal,
        resolve,
        reject,
        abort: () => {
          const index = this.queue.indexOf(waiter);
          if (index < 0) return;
          this.queue.splice(index, 1);
          signal?.removeEventListener('abort', waiter.abort);
          reject(interrupted());
          this.drain();
        },
      };
      this.queue.push(waiter);
      signal?.addEventListener('abort', waiter.abort, { once: true });
      void (async () => {
        try {
          await onWait?.();
          if (!this.queue.includes(waiter)) return;
          waiter.ready = true;
          this.drain();
        } catch (error) {
          const index = this.queue.indexOf(waiter);
          if (index < 0) return;
          this.queue.splice(index, 1);
          signal?.removeEventListener('abort', waiter.abort);
          reject(error);
          this.drain();
        }
      })();
    });
  }
}
export const documentResources = new DocumentResources();
