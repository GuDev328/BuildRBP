import type { AxiosInstance } from "axios";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AbortManager } from "../../src/core/AbortManager";
import { setupResponseInterceptors } from "../../src/core/interceptors/responseInterceptors";
import type { ApiClientConfig, ApiError } from "../../src/types";
import { logger } from "../../src/utils/logger";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSetup(configOverrides: Partial<ApiClientConfig> = {}) {
  const instance: AxiosInstance = axios.create();
  const abortManager = new AbortManager();
  const config: ApiClientConfig = {
    baseURL: "http://localhost",
    logging: false,
    ...configOverrides,
  };
  setupResponseInterceptors(instance, config, abortManager);
  return { instance, abortManager };
}

function successAdapter(data: unknown, status = 200) {
  return async (config: any) => ({
    data,
    status,
    statusText: "OK",
    headers: {},
    config,
  });
}

function errorAdapter(status: number, data: unknown = {}) {
  return async (config: any) => {
    throw new axios.AxiosError(
      `Request failed with status code ${status}`,
      String(status),
      config,
      undefined,
      { data, status, statusText: "Error", headers: {}, config } as any,
    );
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("responseInterceptors", () => {
  beforeEach(() => {
    logger.enabled = false;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Envelope Normalization ─────────────────────────────────────────────────

  describe("envelope normalization", () => {
    it("unwrap envelope {data, message, status}", async () => {
      const { instance } = makeSetup();
      instance.defaults.adapter = successAdapter({
        data: { id: 1 },
        message: "Success",
        status: 200,
        success: true,
      });
      const res = await instance.get("/users");
      expect(res.data).toEqual({
        data: { id: 1 },
        message: "Success",
        status: 200,
      });
    });

    it("fallback khi response là array (không phải envelope)", async () => {
      const { instance } = makeSetup();
      instance.defaults.adapter = successAdapter([1, 2, 3]);
      const res = await instance.get("/items");
      expect(res.data).toEqual({ data: [1, 2, 3], message: "OK", status: 200 });
    });

    it("fallback khi response là string", async () => {
      const { instance } = makeSetup();
      instance.defaults.adapter = successAdapter("plain text");
      const res = await instance.get("/text");
      expect(res.data).toEqual({
        data: "plain text",
        message: "OK",
        status: 200,
      });
    });

    it("fallback khi response là null", async () => {
      const { instance } = makeSetup();
      instance.defaults.adapter = successAdapter(null, 204);
      const res = await instance.get("/empty");
      expect(res.data).toEqual({ data: null, message: "OK", status: 204 });
    });

    it("lấy status từ envelope khi có", async () => {
      const { instance } = makeSetup();
      instance.defaults.adapter = successAdapter({
        data: {},
        message: "Created",
        status: 201,
      });
      const res = await instance.get("/test");
      expect(res.data.status).toBe(201);
    });

    it("fallback status HTTP khi envelope không có status field", async () => {
      const { instance } = makeSetup();
      instance.defaults.adapter = successAdapter(
        { data: {}, message: "OK" },
        200,
      );
      const res = await instance.get("/test");
      // undefined ?? 200 = 200
      expect(res.data.status).toBe(200);
    });
  });

  // ── Transform Keys ─────────────────────────────────────────────────────────

  describe("transformKeys response", () => {
    it("transform envelope.data snake_case → camelCase", async () => {
      const { instance } = makeSetup({ transformKeys: true });
      instance.defaults.adapter = successAdapter({
        data: { user_name: "alice", user_id: 42 },
        message: "OK",
      });
      const res = await instance.get("/users");
      expect(res.data.data).toEqual({ userName: "alice", userId: 42 });
    });

    it("không transform khi transformKeys=false", async () => {
      const { instance } = makeSetup({ transformKeys: false });
      instance.defaults.adapter = successAdapter({
        data: { user_name: "alice" },
        message: "OK",
      });
      const res = await instance.get("/users");
      expect(res.data.data).toEqual({ user_name: "alice" });
    });
  });

  // ── Logging ────────────────────────────────────────────────────────────────

  describe("logging", () => {
    it("gọi logger.response khi logging=true", async () => {
      logger.enabled = true;
      const spy = vi.spyOn(logger, "response");
      const { instance } = makeSetup({ logging: true });
      instance.defaults.adapter = successAdapter({ data: {}, message: "OK" });
      await instance.get("/test");
      expect(spy).toHaveBeenCalledOnce();
    });

    it("không gọi logger.response khi logging=false", async () => {
      const spy = vi.spyOn(logger, "response");
      const { instance } = makeSetup({ logging: false });
      instance.defaults.adapter = successAdapter({});
      await instance.get("/test");
      expect(spy).not.toHaveBeenCalled();
    });

    it("gọi logger.error khi request thất bại và logging=true", async () => {
      logger.enabled = true;
      const spy = vi.spyOn(logger, "error");
      const { instance } = makeSetup({ logging: true });
      instance.defaults.adapter = errorAdapter(500);
      await expect(instance.get("/test")).rejects.toBeDefined();
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ── Error Handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("reject với ApiError shape — 404", async () => {
      const { instance } = makeSetup();
      instance.defaults.adapter = errorAdapter(404, {
        message: "Not Found",
        code: "RESOURCE_NOT_FOUND",
      });
      const error = await instance.get("/missing").catch((e: ApiError) => e);
      expect(error.status).toBe(404);
      expect(error.message).toBe("Not Found");
      expect(error.code).toBe("RESOURCE_NOT_FOUND");
    });

    it("reject với ApiError — 500 với server message", async () => {
      const { instance } = makeSetup();
      instance.defaults.adapter = errorAdapter(500, {
        message: "Internal Server Error",
      });
      const error = await instance.get("/test").catch((e: ApiError) => e);
      expect(error.status).toBe(500);
      expect(error.message).toBe("Internal Server Error");
    });

    it("abort error có code ABORTED và status 0", async () => {
      const { instance } = makeSetup();
      instance.defaults.adapter = async (config: any) => {
        throw new axios.AxiosError("canceled", "ERR_CANCELED", config);
      };
      const error = await instance.get("/test").catch((e: ApiError) => e);
      expect(error.code).toBe("ABORTED");
      expect(error.status).toBe(0);
    });

    it("AxiosError với name=AbortError nhưng KHÔNG có cause → KHÔNG được xử lý là ABORTED (xử lý như lỗi thường)", async () => {
      // Behavior mới: abort detection dùng ERR_CANCELED code hoặc error.cause DOMException
      // Monkey-patch name='AbortError' không còn match nữa (đã là dead code)
      // → error bị xử lý như lỗi network thông thường
      const { instance } = makeSetup();
      instance.defaults.adapter = async (config: any) => {
        const err = Object.assign(
          new axios.AxiosError("aborted", "ERR_NETWORK", config),
          { name: "AbortError" },
        );
        throw err;
      };
      const error = await instance.get("/test").catch((e: ApiError) => e);
      // Không phải ABORTED vì không có ERR_CANCELED code và không có DOMException cause
      expect(error.code).not.toBe("ABORTED");
      // Vẫn được wrap thành ApiError
      expect(error.status).toBeDefined();
    });

    it("non-AxiosError được wrap thành ApiError", async () => {
      const { instance } = makeSetup();
      instance.defaults.adapter = async () => {
        throw new TypeError("Unexpected error");
      };
      const error = await instance.get("/test").catch((e: ApiError) => e);
      expect(error.message).toBe("Unexpected error");
      expect(error.status).toBe(0);
    });

    it("originalError được preserve", async () => {
      const { instance } = makeSetup();
      instance.defaults.adapter = errorAdapter(400, { message: "Bad Request" });
      const error = await instance.get("/test").catch((e: ApiError) => e);
      expect(error.originalError).toBeDefined();
    });

    it("details chứa server response data", async () => {
      const serverData = {
        message: "Validation failed",
        errors: ["field required"],
      };
      const { instance } = makeSetup();
      instance.defaults.adapter = errorAdapter(422, serverData);
      const error = await instance.get("/test").catch((e: ApiError) => e);
      expect(error.details).toMatchObject(serverData);
    });
  });

  // ── 401 Token Refresh ──────────────────────────────────────────────────────

  describe("401 Token Refresh", () => {
    it("tự động refresh và retry khi gặp 401", async () => {
      let callCount = 0;
      const refreshFn = vi.fn(async () => "new-token-xyz");

      const { instance } = makeSetup({
        tokenRefresh: { refreshFn, getAccessToken: () => "old-token" },
      });

      instance.defaults.adapter = async (config: any) => {
        callCount++;
        if (callCount === 1) {
          const response = {
            data: {},
            status: 401,
            statusText: "Unauthorized",
            headers: {},
            config,
          };
          throw new axios.AxiosError(
            "Unauthorized",
            "401",
            config,
            undefined,
            response as any,
          );
        }
        return {
          data: { message: "OK", data: null, status: 200 },
          status: 200,
          statusText: "OK",
          headers: {},
          config,
        };
      };

      const res = await instance.get("/protected");
      expect(refreshFn).toHaveBeenCalledOnce();
      expect(callCount).toBe(2);
      expect(res.data.message).toBe("OK");
    });

    it("gọi onRefreshFailed khi refreshFn throw", async () => {
      const onRefreshFailed = vi.fn();
      const refreshFn = vi.fn(async () => {
        throw new Error("Refresh failed");
      });

      const { instance } = makeSetup({
        tokenRefresh: {
          refreshFn,
          getAccessToken: () => "token",
          onRefreshFailed,
        },
      });

      instance.defaults.adapter = async (config: any) => {
        const response = {
          data: {},
          status: 401,
          statusText: "Unauthorized",
          headers: {},
          config,
        };
        throw new axios.AxiosError(
          "Unauthorized",
          "401",
          config,
          undefined,
          response as any,
        );
      };

      await expect(instance.get("/protected")).rejects.toMatchObject({
        code: "TOKEN_REFRESH_FAILED",
      });
      expect(onRefreshFailed).toHaveBeenCalledOnce();
    });

    it("gọi onRefreshFailed khi retry sau refresh vẫn 401", async () => {
      const onRefreshFailed = vi.fn();
      const refreshFn = vi.fn(async () => "new-token");

      const { instance } = makeSetup({
        tokenRefresh: {
          refreshFn,
          getAccessToken: () => "old-token",
          onRefreshFailed,
        },
      });

      instance.defaults.adapter = async (config: any) => {
        const response = {
          data: {},
          status: 401,
          statusText: "Unauthorized",
          headers: {},
          config,
        };
        throw new axios.AxiosError(
          "Unauthorized",
          "401",
          config,
          undefined,
          response as any,
        );
      };

      await expect(instance.get("/protected")).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(onRefreshFailed).toHaveBeenCalledOnce();
    });

    it("không refresh khi tokenRefresh không được cấu hình", async () => {
      const { instance } = makeSetup();
      instance.defaults.adapter = errorAdapter(401);
      const error = await instance.get("/protected").catch((e: ApiError) => e);
      expect(error.status).toBe(401);
    });

    it("queue nhiều requests khi đang refresh — refreshFn chỉ gọi 1 lần", async () => {
      let callCount = 0;
      const refreshFn = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 20));
        return "new-token";
      });

      const { instance } = makeSetup({
        tokenRefresh: { refreshFn, getAccessToken: () => "old-token" },
      });

      instance.defaults.adapter = async (config: any) => {
        callCount++;
        if (callCount <= 2) {
          const response = {
            data: {},
            status: 401,
            statusText: "Unauthorized",
            headers: {},
            config,
          };
          throw new axios.AxiosError(
            "Unauthorized",
            "401",
            config,
            undefined,
            response as any,
          );
        }
        return {
          data: { message: "OK", data: null, status: 200 },
          status: 200,
          statusText: "OK",
          headers: {},
          config,
        };
      };

      await Promise.all([instance.get("/a"), instance.get("/b")]);
      expect(refreshFn).toHaveBeenCalledOnce();
    });

    // Bug #2 fix: onRefreshFailed chỉ gọi 1 lần dù nhiều queued requests đều fail
    it("onRefreshFailed chỉ gọi ĐÚNG 1 LẦN dù có nhiều queued requests fail sau refresh", async () => {
      const onRefreshFailed = vi.fn();
      // refreshFn thành công nhưng retry request vẫn trả về 401 (token mới bị reject)
      const refreshFn = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 20));
        return "new-token-still-invalid";
      });

      const { instance } = makeSetup({
        tokenRefresh: {
          refreshFn,
          getAccessToken: () => "old-token",
          onRefreshFailed,
        },
      });

      // Adapter luôn trả về 401 — ngay cả sau khi refresh
      instance.defaults.adapter = async (config: any) => {
        const response = {
          data: {},
          status: 401,
          statusText: "Unauthorized",
          headers: {},
          config,
        };
        throw new axios.AxiosError(
          "Unauthorized",
          "401",
          config,
          undefined,
          response as any,
        );
      };

      // Gửi nhiều requests đồng thời → tất cả vào queue → tất cả fail sau refresh
      const results = await Promise.allSettled([
        instance.get("/a"),
        instance.get("/b"),
        instance.get("/c"),
      ]);

      // Tất cả đều reject
      expect(results.every((r) => r.status === "rejected")).toBe(true);
      // onRefreshFailed CHỈ được gọi 1 lần (không phải 3 lần)
      expect(onRefreshFailed).toHaveBeenCalledOnce();
    });
  });

  // ── Abort detection (Bug #1 fix) ───────────────────────────────────────────

  describe("abort detection", () => {
    it("ERR_CANCELED → code ABORTED, status 0", async () => {
      const { instance } = makeSetup();
      instance.defaults.adapter = async (config: any) => {
        throw new axios.AxiosError("canceled", "ERR_CANCELED", config);
      };
      const error = await instance.get("/test").catch((e: ApiError) => e);
      expect(error.code).toBe("ABORTED");
      expect(error.status).toBe(0);
    });

    it("ERR_CANCELED → onError hooks KHÔNG được gọi", async () => {
      const onErrorHook = vi.fn();
      const { instance } = makeSetup({
        hooks: { onError: [onErrorHook] },
      } as any);
      instance.defaults.adapter = async (config: any) => {
        throw new axios.AxiosError("canceled", "ERR_CANCELED", config);
      };
      await instance.get("/test").catch(() => {});
      expect(onErrorHook).not.toHaveBeenCalled();
    });

    it("error.cause là DOMException AbortError → code ABORTED", async () => {
      const { instance } = makeSetup();
      instance.defaults.adapter = async (config: any) => {
        const cause = new DOMException("Request was aborted", "AbortError");
        const err = new axios.AxiosError(
          "Request aborted",
          "ERR_NETWORK",
          config,
        );
        // Attach cause — đây là cơ chế thực của AbortController signal propagation
        Object.defineProperty(err, "cause", { value: cause });
        throw err;
      };
      const error = await instance.get("/test").catch((e: ApiError) => e);
      expect(error.code).toBe("ABORTED");
    });
  });
});
