import {
  BatchItemResult,
  GemmaBatcher,
} from '@/vocabularies/enrichment/gemma-batcher';

const okAll = (inputs: number[]): Promise<BatchItemResult<number>[]> =>
  Promise.resolve(inputs.map((n) => ({ ok: true, value: n * 10 })));

describe('GemmaBatcher', () => {
  it('flushes immediately when a bucket reaches maxBatch', async () => {
    const flush = jest.fn(okAll);
    const batcher = new GemmaBatcher(flush, { maxBatch: 3, lingerMs: 10_000 });

    const results = await Promise.all([
      batcher.submit('k', 1),
      batcher.submit('k', 2),
      batcher.submit('k', 3),
    ]);

    expect(results).toEqual([10, 20, 30]);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('flushes a partial batch after the linger timeout', async () => {
    jest.useFakeTimers();
    try {
      const flush = jest.fn(okAll);
      const batcher = new GemmaBatcher(flush, { maxBatch: 5, lingerMs: 300 });

      const pending = batcher.submit('k', 7);
      expect(flush).not.toHaveBeenCalled();

      jest.advanceTimersByTime(300);
      await expect(pending).resolves.toBe(70);
      expect(flush).toHaveBeenCalledWith([7]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('isolates a per-item failure to that item', async () => {
    const flush = (inputs: number[]): Promise<BatchItemResult<number>[]> =>
      Promise.resolve(
        inputs.map((n) =>
          n === 2
            ? { ok: false, error: new Error('bad 2') }
            : { ok: true, value: n },
        ),
      );
    const batcher = new GemmaBatcher(flush, { maxBatch: 3, lingerMs: 1000 });

    const r1 = batcher.submit('k', 1);
    const r2 = batcher.submit('k', 2);
    const r3 = batcher.submit('k', 3);

    await expect(r1).resolves.toBe(1);
    await expect(r2).rejects.toThrow('bad 2');
    await expect(r3).resolves.toBe(3);
  });

  it('rejects every participant when the flush throws', async () => {
    const flush = (): Promise<BatchItemResult<number>[]> =>
      Promise.reject(new Error('network down'));
    const batcher = new GemmaBatcher(flush, { maxBatch: 2, lingerMs: 1000 });

    const r1 = batcher.submit('k', 1);
    const r2 = batcher.submit('k', 2);

    await expect(r1).rejects.toThrow('network down');
    await expect(r2).rejects.toThrow('network down');
  });

  it('keeps separate buckets per key', async () => {
    const flush = jest.fn(
      (inputs: string[]): Promise<BatchItemResult<string>[]> =>
        Promise.resolve(
          inputs.map((s) => ({ ok: true, value: s.toUpperCase() })),
        ),
    );
    const batcher = new GemmaBatcher(flush, { maxBatch: 2, lingerMs: 1000 });

    await Promise.all([batcher.submit('en', 'a'), batcher.submit('en', 'b')]);
    await Promise.all([batcher.submit('vi', 'c'), batcher.submit('vi', 'd')]);

    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenCalledWith(['a', 'b']);
    expect(flush).toHaveBeenCalledWith(['c', 'd']);
  });
});
