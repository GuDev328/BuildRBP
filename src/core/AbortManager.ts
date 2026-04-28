export class AbortManager {
  private controllers = new Map<string, AbortController>();

  register(key: string): AbortSignal {
    if (this.controllers.has(key)) {
      this.controllers.get(key)!.abort(
        new DOMException(`Duplicate request aborted: ${key}`, 'AbortError')
      );
    }
    const controller = new AbortController();
    this.controllers.set(key, controller);
    return controller.signal;
  }

  abort(key: string, reason?: string): void {
    const controller = this.controllers.get(key);
    if (controller) {
      controller.abort(
        new DOMException(reason ?? `Request aborted: ${key}`, 'AbortError')
      );
      this.controllers.delete(key);
    }
  }

  abortAll(reason?: string): void {
    const entries = [...this.controllers];
    this.controllers.clear();
    for (const [, controller] of entries) {
      controller.abort(
        new DOMException(reason ?? 'All requests aborted', 'AbortError')
      );
    }
  }

  clear(key: string): void {
    this.controllers.delete(key);
  }

  get pendingCount(): number {
    return this.controllers.size;
  }

  get pendingKeys(): string[] {
    return [...this.controllers.keys()];
  }
}
