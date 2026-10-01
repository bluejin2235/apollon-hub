export class EvalRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export type EvalContinuationResponse = {
  continued?: boolean;
  skipped: boolean;
  reason?: string;
  run_id?: string;
  passed?: number;
  total?: number;
  score_sum?: number;
  score_max?: number;
  tier?: string;
};

/** Only known run IDs may be retried. Creating a run is deliberately outside
 * this loop so a lost response can never create duplicate evaluations. */
export async function continueEvalInBrowser(options: {
  runId: string;
  request: (runId: string) => Promise<EvalContinuationResponse>;
  progress: (result: EvalContinuationResponse | null) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxMs?: number;
}): Promise<EvalContinuationResponse> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const deadline = now() + (options.maxMs ?? 6 * 60 * 60_000);
  let failures = 0;
  while (now() < deadline) {
    let result: EvalContinuationResponse;
    try {
      result = await options.request(options.runId);
      failures = 0;
    } catch (error) {
      const transient = error instanceof TypeError ||
        (error instanceof EvalRequestError && [429, 502, 503, 504].includes(error.status));
      if (!transient || ++failures > 8) throw error;
      await options.progress(null);
      await sleep(30_000);
      continue;
    }
    if (result.run_id && result.run_id !== options.runId) throw new Error('Evaluation run changed unexpectedly');
    if (!result.continued) return result;
    await options.progress(result);
    if (result.skipped) await sleep(30_000);
  }
  throw new Error('검증 진행 상황은 저장돼 있습니다. 실행 시간이 길어져 자동 재시도를 종료했습니다. 같은 실행을 이어서 검증할 수 있습니다.');
}
