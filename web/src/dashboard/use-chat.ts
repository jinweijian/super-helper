import { ref } from 'vue';
import { apiJson, jsonRequest, type Fetcher } from '../shared/api';
import type { SessionDto } from '../shared/contracts';
import type { ChatProgressState } from './chat-progress';

interface ChatOptions {
  fetcher?: Fetcher;
  pollDelayMs?: number;
  maxPolls?: number;
  trackInvestigation?: boolean;
}

interface SendInput {
  caseId?: string;
  workspaceId?: string;
  message: string;
  persona: string;
  investigationPreference?: 'auto' | 'fast' | 'deep';
}

export function pendingUserMessageId(session: SessionDto): string | undefined {
  if (session.retryableTurn) return session.retryableTurn.userMessageId;
  if (!['diagnosing', 'queued', 'ready_for_diagnosis'].includes(session.status)) return undefined;
  return [...session.messages].reverse().find((message) => message.role === 'user' && !hasHelperReply(session, message.id))?.id;
}

function hasHelperReply(session: SessionDto, userMessageId: string): boolean {
  return session.messages.some((message) => message.role === 'helper' && message.replyToMessageId === userMessageId);
}

export function useChat(options: ChatOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const sending = ref(false);
  const error = ref('');
  const progress = ref<ChatProgressState>({ state: 'idle' });
  const acceptedCount = ref(0);
  let activeTarget: {caseId: string; userMessageId: string} | undefined;
  let abortController: AbortController | undefined;
  let generation = 0;

  async function send(input: SendInput, onSession?: (session: SessionDto) => void): Promise<SessionDto> {
    const { currentGeneration, signal } = startOperation();
    sending.value = true;
    error.value = '';
    progress.value = { state: 'running', startedAt: Date.now(), lastActivityAt: Date.now() };
    try {
      const request = jsonRequest('POST', { ...input, async: true });
      const accepted = await apiJson<{ caseId: string; userMessageId: string }>(
        fetcher,
        '/api/chat',
        { ...request, signal },
      );
      assertCurrent(signal, currentGeneration);
      acceptedCount.value += 1;
      return await pollCurrent(accepted.caseId, accepted.userMessageId, signal, currentGeneration, onSession);
    } catch (cause) {
      if (isAbortError(cause)) throw cause;
      assertCurrent(signal, currentGeneration);
      error.value = cause instanceof Error ? cause.message : '发送失败';
      throw cause;
    } finally {
      if (currentGeneration === generation) sending.value = false;
    }
  }

  async function poll(caseId: string, userMessageId: string, onSession?: (session: SessionDto) => void): Promise<SessionDto> {
    const { currentGeneration, signal } = startOperation();
    return pollCurrent(caseId, userMessageId, signal, currentGeneration, onSession);
  }

  async function pollCurrent(
    caseId: string,
    userMessageId: string,
    signal: AbortSignal,
    currentGeneration: number,
    onSession?: (session: SessionDto) => void,
  ): Promise<SessionDto> {
    activeTarget = {caseId, userMessageId};
    if (progress.value.state !== 'running') progress.value = { state: 'running', startedAt: Date.now(), lastActivityAt: Date.now() };
    const maxPolls = options.maxPolls ?? Infinity;
    let reconnectDelay = 500;
    for (let index = 0; index < maxPolls; index += 1) {
      assertCurrent(signal, currentGeneration);
      let body: { session: SessionDto };
      try {
        body = await apiJson<{ session: SessionDto }>(
          fetcher,
          `/api/session?caseId=${encodeURIComponent(caseId)}&includeKnowledgeHealth=false`,
          { signal },
        );
        assertCurrent(signal, currentGeneration);
      } catch (cause) {
        if (isAbortError(cause)) throw cause;
        assertCurrent(signal, currentGeneration);
        progress.value = { ...progress.value, state: 'reconnecting', error: '网络连接中断，正在重新连接…' };
        await delay(reconnectDelay, signal);
        assertCurrent(signal, currentGeneration);
        reconnectDelay = Math.min(reconnectDelay * 2, 5000);
        continue;
      }

      reconnectDelay = 500;
      progress.value = { ...progress.value, state: 'running', lastActivityAt: Date.now(), session: body.session };
      onSession?.(body.session);
      if (body.session.retryableTurn?.userMessageId === userMessageId) {
        const message = body.session.retryableTurn.reason === 'user_cancelled'
          ? '排查已停止，你可以点击“一键重试”继续。'
          : '这个回合因服务重启被中断，你可以点击“一键重试”继续。';
        activeTarget = undefined;
        progress.value = { ...progress.value, state: 'interrupted', session: body.session, error: message };
        throw new Error(message);
      }
      if (hasHelperReply(body.session, userMessageId)) {
        activeTarget = undefined;
        progress.value = { ...progress.value, state: 'completed', session: body.session };
        return body.session;
      }
      if (options.trackInvestigation) {
        try {
          const state = await apiJson<{progress: ChatProgressState['investigation'] | null}>(
            fetcher, `/api/chat/progress?caseId=${encodeURIComponent(caseId)}&userMessageId=${encodeURIComponent(userMessageId)}`, {signal},
          );
          assertCurrent(signal, currentGeneration);
          progress.value = {...progress.value, investigation: state.progress ?? undefined};
          if (state.progress?.lastActivityAt) progress.value.lastActivityAt = Date.parse(state.progress.lastActivityAt);
        } catch (cause) {
          assertCurrent(signal, currentGeneration);
          if (isAbortError(cause)) throw cause;
        }
      }
      await delay(options.pollDelayMs ?? 500, signal);
      assertCurrent(signal, currentGeneration);
    }
    assertCurrent(signal, currentGeneration);
    const message = '等待回复超时，请刷新会话重试';
    progress.value = { ...progress.value, state: 'interrupted', error: message };
    throw new Error(message);
  }

  async function retry(caseId: string, userMessageId: string, onSession?: (session: SessionDto) => void): Promise<SessionDto> {
    const { currentGeneration, signal } = startOperation();
    error.value = '';
    progress.value = { state: 'running', startedAt: Date.now(), lastActivityAt: Date.now() };
    const request = jsonRequest('POST', { caseId, userMessageId });
    try {
      await apiJson(fetcher, '/api/chat/retry', { ...request, signal });
      assertCurrent(signal, currentGeneration);
    } catch (cause) {
      if (isAbortError(cause)) throw cause;
      assertCurrent(signal, currentGeneration);
      const message = cause instanceof Error ? cause.message : '重试失败';
      error.value = message;
      progress.value = { ...progress.value, state: 'interrupted', error: message };
      throw cause;
    }
    return pollCurrent(caseId, userMessageId, signal, currentGeneration, onSession);
  }

  function startOperation(): { currentGeneration: number; signal: AbortSignal } {
    cancel();
    abortController = new AbortController();
    return { currentGeneration: generation, signal: abortController.signal };
  }

  function cancel(): void {
    activeTarget = undefined;
    generation += 1;
    abortController?.abort();
    abortController = undefined;
    sending.value = false;
    error.value = '';
    progress.value = { state: 'idle' };
  }

  async function stop(): Promise<void> {
    if (!activeTarget) return;
    const target = {...activeTarget};
    const currentGeneration = generation;
    try {
      await apiJson(fetcher, '/api/chat/cancel', jsonRequest('POST', target));
      if (currentGeneration !== generation) return;
      if (progress.value.investigation) progress.value.investigation.stopping = true;
    } catch (cause) {
      if (currentGeneration === generation) error.value = cause instanceof Error ? cause.message : '停止失败，请重试';
    }
  }

  function assertCurrent(signal: AbortSignal, currentGeneration: number): void {
    if (signal.aborted || currentGeneration !== generation) {
      throw new DOMException('aborted', 'AbortError');
    }
  }

  return { sending, error, progress, acceptedCount, send, poll, retry, cancel, stop };
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isAbortError(cause: unknown): boolean {
  return typeof cause === 'object'
    && cause !== null
    && 'name' in cause
    && cause.name === 'AbortError';
}
