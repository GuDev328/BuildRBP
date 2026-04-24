/**
 * AbortManager — Quản lý AbortController cho từng request
 *
 * Features:
 * - Register controller theo key
 * - Auto-cancel duplicate request cùng key
 * - Abort theo key hoặc abort tất cả
 */
export class AbortManager {
  private controllers = new Map<string, AbortController>();

  /**
   * Đăng ký một key mới.
   * Nếu key đã tồn tại (duplicate request) → tự động hủy request cũ.
   * @returns AbortSignal để gắn vào axios config
   */
  register(key: string): AbortSignal {
    // Hủy request cũ nếu đang pending
    if (this.controllers.has(key)) {
      this.controllers.get(key)!.abort(
        new DOMException(`Duplicate request aborted: ${key}`, 'AbortError')
      );
    }
    const controller = new AbortController();
    this.controllers.set(key, controller);
    return controller.signal;
  }

  /**
   * Hủy request theo key cụ thể
   */
  abort(key: string, reason?: string): void {
    const controller = this.controllers.get(key);
    if (controller) {
      controller.abort(
        new DOMException(reason ?? `Request aborted: ${key}`, 'AbortError')
      );
      this.controllers.delete(key);
    }
  }

  /**
   * Hủy tất cả pending requests (dùng khi logout, unmount page)
   */
  abortAll(reason?: string): void {
    // Snapshot trước khi iterate để tránh mutate Map đang duyệt (undefined behavior)
    const entries = [...this.controllers];
    this.controllers.clear();
    for (const [, controller] of entries) {
      controller.abort(
        new DOMException(reason ?? 'All requests aborted', 'AbortError')
      );
    }
  }

  /**
   * Dọn dẹp sau khi request hoàn thành (resolve hoặc reject)
   */
  clear(key: string): void {
    this.controllers.delete(key);
  }

  /**
   * Số lượng request đang pending
   */
  get pendingCount(): number {
    return this.controllers.size;
  }

  /**
   * Danh sách các key đang pending
   */
  get pendingKeys(): string[] {
    return [...this.controllers.keys()];
  }
}
