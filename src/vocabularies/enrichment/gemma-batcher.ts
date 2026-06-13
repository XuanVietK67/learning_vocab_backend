/**
 * In-process request coalescer for Gemma calls. Words waiting to be enriched are
 * collected into buckets (keyed by the caller — e.g. `${language}:${t}`) and
 * flushed together as ONE batched model call when a bucket reaches `maxBatch`
 * or `lingerMs` elapses, whichever comes first. This turns N concurrent
 * single-word jobs into N/maxBatch model calls without changing the
 * one-job-per-word queue model: each `submit` resolves with that word's own
 * slice of the batch result.
 *
 * Framework-agnostic (no NestJS/DI) — the processor instantiates one per call
 * type and supplies the flush function. Designed for a single worker process
 * running the BullMQ worker at concurrency >= maxBatch, so the shared,
 * module-local buckets see several jobs at once.
 *
 * Failure model:
 *   - The flush throwing (network/429/timeout, or an unparseable whole batch)
 *     rejects EVERY participant, so each job retries independently.
 *   - A per-item `{ ok: false }` result rejects only that word; its siblings in
 *     the same batch still resolve.
 */

export type BatchItemResult<O> =
  | { ok: true; value: O }
  | { ok: false; error: Error };

/** Runs one batched model call for `inputs`, returning one result per input in
 * the same order. Throw to fail the whole batch; return an `{ ok: false }` item
 * to fail just that input. */
export type BatchFlush<I, O> = (inputs: I[]) => Promise<BatchItemResult<O>[]>;

export interface GemmaBatcherOptions {
  maxBatch: number;
  lingerMs: number;
}

interface Pending<I, O> {
  input: I;
  resolve: (value: O) => void;
  reject: (error: Error) => void;
}

interface Bucket<I, O> {
  items: Pending<I, O>[];
  timer: ReturnType<typeof setTimeout> | null;
}

export class GemmaBatcher<I, O> {
  private readonly buckets = new Map<string, Bucket<I, O>>();

  constructor(
    private readonly flush: BatchFlush<I, O>,
    private readonly opts: GemmaBatcherOptions,
  ) {}

  /** Add `input` to the bucket for `key` and resolve with its batch slice. */
  submit(key: string, input: I): Promise<O> {
    return new Promise<O>((resolve, reject) => {
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = { items: [], timer: null };
        this.buckets.set(key, bucket);
      }
      bucket.items.push({ input, resolve, reject });

      if (bucket.items.length >= this.opts.maxBatch) {
        this.flushKey(key);
      } else if (!bucket.timer) {
        bucket.timer = setTimeout(() => this.flushKey(key), this.opts.lingerMs);
      }
    });
  }

  private flushKey(key: string): void {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.items.length === 0) return;
    // Detach the batch so any submit arriving during the await starts fresh.
    this.buckets.delete(key);
    if (bucket.timer) clearTimeout(bucket.timer);
    void this.runFlush(bucket.items);
  }

  private async runFlush(items: Pending<I, O>[]): Promise<void> {
    const inputs = items.map((it) => it.input);
    try {
      const results = await this.flush(inputs);
      items.forEach((it, i) => {
        const r = results[i];
        if (r && r.ok) {
          it.resolve(r.value);
        } else {
          it.reject(
            r && !r.ok
              ? r.error
              : new Error('batch returned no result for item'),
          );
        }
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      for (const it of items) it.reject(error);
    }
  }
}
