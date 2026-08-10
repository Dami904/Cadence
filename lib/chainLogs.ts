import type { Address } from "viem";

// Base Sepolia RPC providers cap how many blocks a single eth_getLogs call may span.
// Splitting into fixed-size chunks keeps every request safely under that cap regardless
// of how wide the overall range is, instead of gambling on one huge request.
const CHUNK_BLOCKS = 10_000n;
const CONCURRENCY = 5;

// Deliberately loose: viem's PublicClient#getLogs has a heavily overloaded generic
// signature keyed to the exact event ABI passed in, which fights a shared helper like
// this one. Callers already cast the returned logs to their own known shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LogsClient = { getLogs: (args: any) => Promise<any[]> };

export async function getLogsChunked<T>(
  client: LogsClient,
  params: {
    address: Address | Address[];
    event?: unknown;
    events?: readonly unknown[];
    args?: Record<string, unknown>;
    fromBlock: bigint;
    toBlock: bigint;
  },
): Promise<T[]> {
  const { address, event, events, args, fromBlock, toBlock } = params;
  if (fromBlock > toBlock) return [];

  const ranges: [bigint, bigint][] = [];
  for (let start = fromBlock; start <= toBlock; start += CHUNK_BLOCKS) {
    const end = start + CHUNK_BLOCKS - 1n > toBlock ? toBlock : start + CHUNK_BLOCKS - 1n;
    ranges.push([start, end]);
  }

  const results: T[] = [];
  for (let i = 0; i < ranges.length; i += CONCURRENCY) {
    const batch = ranges.slice(i, i + CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    const batchLogs = await Promise.all(
      batch.map(([start, end]) => client.getLogs({ address, event, events, args, fromBlock: start, toBlock: end })),
    );
    for (const chunkLogs of batchLogs) results.push(...(chunkLogs as T[]));
  }
  return results;
}
