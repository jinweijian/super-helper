export class CaseTurnQueue {
  private readonly queues = new Map<string, Promise<void>>();

  async run<T>(caseId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(caseId) ?? Promise.resolve();
    const current = previous.then(task, task);
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(caseId, tail);

    try {
      return await current;
    } finally {
      if (this.queues.get(caseId) === tail) {
        this.queues.delete(caseId);
      }
    }
  }
}
