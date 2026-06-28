import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OnboardingReviewQuery, OnboardingService } from '../../onboarding/index.js';
import { readJson, sendJson, startEventStream, writeEvent } from '../http-utils.js';

export async function handleOnboardingRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  service: Pick<OnboardingService,
    | 'getState'
    | 'saveDraft'
    | 'validateDraft'
    | 'getReviewState'
    | 'submitReview'
    | 'startRun'
    | 'getRun'
    | 'retryRun'
    | 'subscribe'
  >,
): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, service: 'super-helper' });
    return true;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/onboarding') {
      sendJson(res, 200, service.getState());
      return true;
    }

    if (req.method === 'PUT' && url.pathname === '/api/onboarding/draft') {
      const state = await service.saveDraft(await readJson(req) as never);
      sendJson(res, 200, state);
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/onboarding/validate') {
      sendJson(res, 200, await service.validateDraft());
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/onboarding/review') {
      sendJson(res, 200, { review: service.getReviewState(reviewQueryFromUrl(url)) });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/onboarding/review') {
      sendJson(res, 200, await service.submitReview(await readJson(req) as never));
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/onboarding/runs') {
      sendJson(res, 200, { run: await service.startRun() });
      return true;
    }

    const runMatch = url.pathname.match(/^\/api\/onboarding\/runs\/([^/]+)$/);
    if (runMatch && req.method === 'GET') {
      const run = service.getRun(runMatch[1]!);
      if (!run) {
        sendJson(res, 404, { error: 'run not found' });
        return true;
      }
      sendJson(res, 200, { run });
      return true;
    }

    const retryMatch = url.pathname.match(/^\/api\/onboarding\/runs\/([^/]+)\/retry$/);
    if (retryMatch && req.method === 'POST') {
      sendJson(res, 200, { run: await service.retryRun(retryMatch[1]!) });
      return true;
    }

    const eventsMatch = url.pathname.match(/^\/api\/onboarding\/runs\/([^/]+)\/events$/);
    if (eventsMatch && req.method === 'GET') {
      const runId = eventsMatch[1]!;
      const run = service.getRun(runId);
      if (!run) {
        sendJson(res, 404, { error: 'run not found' });
        return true;
      }
      startEventStream(res);
      writeEvent(res, 'run.snapshot', { run });
      const unsubscribe = service.subscribe(runId, (event) => {
        writeEvent(res, event.type, event);
      });
      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 15_000);
      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
      return true;
    }
  } catch (error) {
    sendOnboardingError(res, error);
    return true;
  }

  return false;
}

function reviewQueryFromUrl(url: URL): OnboardingReviewQuery {
  const query: OnboardingReviewQuery = {};
  const offset = parseIntegerQuery(url.searchParams.get('offset'));
  const limit = parseIntegerQuery(url.searchParams.get('limit'));
  const severity = url.searchParams.get('severity');
  const search = url.searchParams.get('search')?.trim();
  if (offset !== undefined) query.offset = offset;
  if (limit !== undefined) query.limit = limit;
  if (severity === 'all' || severity === 'warn' || severity === 'error') {
    query.severity = severity;
  }
  if (search) query.search = search;
  return query;
}

function parseIntegerQuery(value: string | null): number | undefined {
  if (value === null || value.trim() === '') {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sendOnboardingError(res: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (/already active/i.test(message) || /not retryable/i.test(message)) {
    sendJson(res, 409, { error: message });
    return;
  }
  if (/not found/i.test(message)) {
    sendJson(res, 404, { error: message });
    return;
  }
  if (/draft|invalid|input|json/i.test(message)) {
    sendJson(res, 400, { error: message });
    return;
  }
  sendJson(res, 500, { error: 'onboarding request failed' });
}
