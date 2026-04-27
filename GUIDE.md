# 📚 Hướng Dẫn Chi Tiết Thư Viện @buildrbp/http-client

> **Custom Axios HTTP Client** — TypeScript-first, production-ready, enterprise-grade.
> Phiên bản: Chi tiết đầy đủ với ví dụ và edge cases.

---

## Mục Lục

1. [Tổng Quan Kiến Trúc](#1-tổng-quan-kiến-trúc)
2. [Factory Function: `createApiClient`](#2-factory-function-createapiclient)
3. [AbortManager - Quản Lý Hủy Request](#3-abortmanager---quản-lý-hủy-request)
4. [Request Interceptors](#4-request-interceptors)
5. [Response Interceptors](#5-response-interceptors)
6. [Token Refresh - Tự Động Làm Mới Token](#6-token-refresh---tự-động-làm-mới-token)
7. [Retry Handler - Tự Động Thử Lại](#7-retry-handler---tự-động-thử-lại)
8. [Deduplicator - Chống Request Trùng Lặp](#8-deduplicator---chống-request-trùng-lặp)
9. [Response Cache - Bộ Nhớ Đệm](#9-response-cache---bộ-nhớ-đệm)
10. [Key Transform - Chuyển Đổi Key](#10-key-transform---chuyển-đổi-key)
11. [Upload & Download](#11-upload--download)
12. [Mock Adapter](#12-mock-adapter)
13. [Fork Instance](#13-fork-instance)
14. [Error Handling](#14-error-handling)
15. [Logger](#15-logger)
16. [Các Edge Cases Quan Trọng](#16-các-edge-cases-quan-trọng)

---

## 1. Tổng Quan Kiến Trúc

### 1.1 Request Flow

```
api.get("/users")
    │
    ▼
[Cache wrap] (nếu enabled)
  ├── HIT (fresh) ────────────────────► return cached (shallow copy)
  ├── STALE + SWR ────────────────────► return stale + revalidate ngầm
  └── MISS → tiếp tục
    │
    ▼
[Deduplicator wrap]
  ├── PENDING (cùng key) ─────────────► join existing promise
  └── NEW → tiếp tục
    │
    ▼
[Request Interceptors]
  ├── Ghi timestamp _startTime
  ├── Inject x-request-id, x-trace-id
  ├── Inject Authorization: Bearer <token>
  ├── Transform request body keys (camelCase → snake_case)
  └── Register AbortController
    │
    ▼
    HTTP Request (hoặc Mock Adapter)
    │
    ▼
[Retry Interceptor] ← chạy TRƯỚC (innermost error handler)
    │
[Response Interceptor]
  ├── Success: cleanup, log, transform, unwrap envelope
  └── Error: cleanup, log, 401 → refresh token → retry
    │
    ▼
return ApiResponse<T> = { data: T, message: string, status: number }
```

### 1.2 Thứ Tự Interceptors Quan Trọng

```typescript
// Axios chạy response error handlers NGƯỢC thứ tự đăng ký:
// Đăng ký lúc 1: Response Interceptor → chạy lúc 2 (sau cùng)
// Đăng ký lúc 2: Retry Interceptor → chạy lúc 1 (trước tiên)

// Vì vậy Retry phải đăng ký SAU để chạy TRƯỚC
// Retry bắt lỗi gốc trước khi Response Interceptor biến nó thành ApiError
```

### 1.3 Cấu Trúc Files

```
src/
├── core/
│   ├── AbortManager.ts              # Quản lý AbortController
│   ├── createInstance.ts            # Factory - kết hợp tất cả features
│   └── interceptors/
│       ├── requestInterceptors.ts   # Auth, trace, transform, abort
│       └── responseInterceptors.ts # Normalize, envelope, 401/refresh
├── features/
│   ├── retryHandler.ts              # Auto retry + exponential backoff
│   ├── deduplicator.ts              # Chống duplicate GET
│   ├── cache.ts                     # In-memory cache + TTL + LRU + SWR
│   ├── uploadDownload.ts            # Upload/Download với progress
│   └── mockAdapter.ts               # Custom axios adapter cho mock
├── utils/
│   ├── buildRequestKey.ts           # Tạo JSON key từ method+url+params
│   ├── logger.ts                   # Dev logger
│   └── transformKeys.ts             # camelCase ↔ snake_case
├── types/
│   └── index.ts                    # Tất cả TypeScript interfaces
└── index.ts                        # Public API entry point
```

---

## 2. Factory Function: `createApiClient`

### 2.1 Signature

```typescript
function createApiClient(clientConfig: ApiClientConfig): ApiClient
```

### 2.2 ApiClientConfig

```typescript
interface ApiClientConfig {
  /** Base URL của API - BẮT BUỘC */
  baseURL: string;
  
  /** Timeout mặc định (ms). Default: 10_000 */
  timeout?: number;
  
  /** Headers mặc định cho mọi request */
  defaultHeaders?: Record<string, string>;
  
  /** Cấu hình retry */
  retry?: RetryOptions;
  
  /** Cấu hình cache */
  cache?: CacheOptions;
  
  /** Cấu hình token refresh */
  tokenRefresh?: TokenRefreshConfig;
  
  /** Bật deduplication. Default: true */
  deduplication?: boolean;
  
  /** Bật transform keys. Default: false */
  transformKeys?: boolean;
  
  /** Bật logging ở dev. Default: true */
  logging?: boolean;
  
  /** Danh sách mock handlers */
  mocks?: MockHandler[];
}
```

### 2.3 Ví Dụ Cơ Bản

```typescript
import { createApiClient } from "./src";

const api = createApiClient({
  baseURL: "https://api.example.com",
  timeout: 15_000,
  defaultHeaders: {
    "X-App-Version": "2.0.0",
  },
});

// Sử dụng
const { data, message, status } = await api.get<User[]>("/users");
// data: User[], message: string, status: number
```

### 2.4 Edge Cases

```typescript
// ❌ Lỗi: thiếu baseURL
const api1 = createApiClient({}); // TypeScript error: baseURL is required

// ❌ Lỗi: timeout = 0 (sẽ không bao giờ timeout)
const api2 = createApiClient({ baseURL: "...", timeout: 0 }); // BAD

// ✅ Tắt timeout hoàn toàn
const api3 = createApiClient({ baseURL: "...", timeout: Infinity }); // OK

// ✅ Headers có giá trị null/undefined được bỏ qua
const api4 = createApiClient({
  baseURL: "...",
  defaultHeaders: {
    "X-Optional": undefined, // bị ignore
    "X-Null": null,         // bị ignore
    "X-Empty": "",           // được gửi
  },
});
```

### 2.5 Returned ApiClient Interface

```typescript
interface ApiClient {
  /** Axios instance gốc - dùng khi cần access trực tiếp */
  instance: AxiosInstance;
  
  /** GET request */
  get<T>(url: string, options?: RequestOptions): Promise<ApiResponse<T>>;
  
  /** POST request */
  post<T>(url: string, data?: unknown, options?: RequestOptions): Promise<ApiResponse<T>>;
  
  /** PUT request */
  put<T>(url: string, data?: unknown, options?: RequestOptions): Promise<ApiResponse<T>>;
  
  /** PATCH request */
  patch<T>(url: string, data?: unknown, options?: RequestOptions): Promise<ApiResponse<T>>;
  
  /** DELETE request */
  delete<T>(url: string, options?: RequestOptions): Promise<ApiResponse<T>>;
  
  /** Upload file với progress */
  upload<T>(url: string, formData: FormData, options?: RequestOptions): Promise<ApiResponse<T>>;
  
  /** Download file */
  download(url: string, options?: RequestOptions): Promise<Blob>;
  
  /** Hủy request theo key */
  abort(key: string): void;
  
  /** Hủy tất cả pending requests */
  abortAll(): void;
  
  /** Xóa cache */
  clearCache(keyOrPattern?: string | RegExp): void;
  
  /** Tạo instance mới kế thừa config */
  fork(overrides?: Partial<ApiClientConfig>): ApiClient;
}
```

---

## 3. AbortManager - Quản Lý Hủy Request

### 3.1 Class Definition

```typescript
export class AbortManager {
  private controllers = new Map<string, AbortController>();
  
  register(key: string): AbortSignal;
  abort(key: string, reason?: string): void;
  abortAll(reason?: string): void;
  clear(key: string): void;
  get pendingCount(): number;
  get pendingKeys(): string[];
}
```

### 3.2 Chi Tiết Từng Method

#### `register(key: string): AbortSignal`

Đăng ký một AbortController mới cho request.

**Edge Case quan trọng - Auto-cancel duplicate:**

```typescript
// Nếu key đã tồn tại → tự động hủy request cũ
abortManager.register("user-search"); // Request A đang pending
abortManager.register("user-search"); // Request A bị hủy, trả signal mới cho B
```

**Tại sao cần auto-cancel?**
- Khi user gõ search, request cũ có thể lâu hơn request mới
- Không muốn request cũ overwrite kết quả mới
- Tránh race condition

#### `abort(key: string, reason?: string): void`

Hủy request cụ thể.

```typescript
// Hủy với lý do mặc định
abortManager.abort("user-search");
// → DOMException: "Request aborted: user-search"

// Hủy với lý do tùy chỉnh
abortManager.abort("user-search", "User cancelled the search");
// → DOMException: "User cancelled the search"
```

#### `abortAll(reason?: string): void`

Hủy tất cả pending requests.

```typescript
// Khi user logout
abortManager.abortAll("User logged out");

// Khi route change (React)
useEffect(() => {
  api.get("/dashboard").then(/* ... */);
  
  return () => {
    api.abortAll("Component unmounted");
  };
}, []);
```

**Edge Case - Snapshot before iterate:**

```typescript
// Code bên trong abortAll()
abortAll(reason?: string): void {
  // ⚠️ PHẢI snapshot trước khi iterate
  // vì abort() gọi controller.delete() → mutate Map đang iterate
  const entries = [...this.controllers]; // Snapshot
  this.controllers.clear();
  for (const [, controller] of entries) {
    controller.abort(...);
  }
}
```

#### `clear(key: string): void`

Chỉ xóa key khỏi Map mà không abort. Dùng khi request hoàn thành bình thường.

```typescript
// Sau khi response interceptor nhận được response
if (reqConfig._abortKey) {
  abortManager.clear(reqConfig._abortKey); // Xóa để không leak memory
}
```

### 3.3 Ví Dụ Sử Dụng

```typescript
// 1. Tự động register qua request interceptor
const api = createApiClient({ baseURL: "..." });

// abortKey được tạo tự động nếu không truyền
api.get("/users/1");

// 2. Truyền abortKey tùy chỉnh
api.get("/search", { 
  abortKey: "product-search",
  params: { q: "macbook" }
});

// 3. Cancel sau
api.abort("product-search");

// 4. Cancel tất cả khi unmount
useEffect(() => {
  api.get("/dashboard").then(/* ... */);
  
  return () => {
    api.abortAll("Component unmounted");
  };
}, []);
```

### 3.4 Edge Cases Quan Trọng

```typescript
// 1. Abort key không tồn tại → không làm gì cả
abortManager.abort("non-existent-key"); // Silent no-op

// 2. AbortAll khi không có request nào → không crash
abortManager.abortAll(); // OK, nothing happens

// 3. Clear key không tồn tại → không crash
abortManager.clear("non-existent-key"); // Silent no-op

// 4. Request hoàn thành trước khi abort → abort signal vẫn hoạt động
// AbortController có thể abort bất cứ lúc nào, kể cả sau khi complete

// 5. Race condition: abort trong finally của promise
// ⚠️ Request interceptor đã register với key
// ⚠️ Request bắt đầu gửi
// ⚠️ User click cancel → abort() được gọi
// ⚠️ Request interceptor cleanup chạy → clear(key) được gọi
// → Map đã bị clear nên không vấn đề gì
```

---

## 4. Request Interceptors

### 4.1 Chi Tiết Từng Bước

#### Bước 1: Timestamp & Retry Count

```typescript
// Ghi thời điểm bắt đầu request (cho logging)
requestConfig._startTime = Date.now();

// Giữ _retryCount nếu đã có (từ retry handler)
// Dùng ?? 0 để chỉ set khi undefined
requestConfig._retryCount = requestConfig._retryCount ?? 0;
```

#### Bước 2: Trace Headers

```typescript
// Mỗi instance có counter riêng để tránh shared state
let requestCounter = 0;

const requestId = `${Date.now()}-${++requestCounter}`;
requestConfig.headers['x-request-id'] = requestId;
requestConfig.headers['x-trace-id'] = requestId;
```

**Tại sao dùng cả timestamp + counter?**
- Timestamp: để debug theo thời gian
- Counter: để phân biệt các request cùng ms
- Kết hợp: `1704067200000-1`, `1704067200000-2`, etc.

**Edge Case - Per-instance counter:**

```typescript
// ❌ SAI: Global counter (bug khi dùng multi-instance)
// let requestCounter = 0; // Global!

// ✅ ĐÚNG: Per-instance trong closure
export function setupRequestInterceptors(...) {
  let requestCounter = 0; // Instance-scoped
  // ...
}
```

#### Bước 3: Authorization

```typescript
if (config.tokenRefresh) {
  const token = config.tokenRefresh.getAccessToken();
  if (token) {
    requestConfig.headers['Authorization'] = `Bearer ${token}`;
  }
  // Không có token? → không gửi header, để server xử lý
}
```

**Edge Cases:**

```typescript
// 1. Token là empty string
getAccessToken: () => localStorage.getItem("token") ?? null;
// localStorage.getItem("token") trả "" nếu không có → falsy → không gửi header ✓

// 2. Token là "null" string (user set localStorage.token = "null")
// ⚠️ Bug tiềm năng! Cần validate
getAccessToken: () => {
  const token = localStorage.getItem("token");
  return token && token !== "null" ? token : null;
};

// 3. Async token fetching
// ⚠️ getAccessToken phải sync! Token phải đã có sẵn
// Nếu cần async → dùng refreshFn cho 401 handling
```

#### Bước 4: Transform Body Keys

```typescript
if (config.transformKeys && requestConfig.data) {
  requestConfig.data = keysToSnakeCase(requestConfig.data);
}
```

**Edge Cases:**

```typescript
// 1. data là string (vd: JSON string)
keysToSnakeCase('{"firstName":"John"}'); // → '{"first_name":"John"}' ✓

// 2. data là Array
keysToSnakeCase([{firstName: "A"}, {firstName: "B"}]); // → [{first_name: "A"}, ...] ✓

// 3. data là FormData
// ⚠️ FormData KHÔNG được transform (FormData không phải plain object)
// Request interceptor check: typeof data !== 'object' sau khi stringify
```

#### Bước 5: AbortController Registration

```typescript
// Nếu caller đã pass signal thì không override
if (!requestConfig.signal) {
  const abortKey =
    (requestConfig as { abortKey?: string }).abortKey ??
    buildRequestKey(requestConfig);
  requestConfig._abortKey = abortKey;
  requestConfig.signal = abortManager.register(abortKey);
}
```

**Edge Cases:**

```typescript
// 1. Caller truyền custom signal
api.get("/users", {
  signal: myAbortController.signal, // Không override ✓
});

// 2. Caller truyền abortKey nhưng signal đã có
api.get("/users", {
  abortKey: "my-key",
  signal: customSignal, // ⚠️ Custom signal được ưu tiên, abortKey vẫn được set
});

// 3. buildRequestKey với params không serialize được
buildRequestKey({ method: "get", url: "/test", params: { fn: () => {} } });
// → paramsStr = String({}) = "[object Object]" (fallback)
```

#### Bước 6: Logging

```typescript
if (config.logging !== false) {
  logger.request({
    method: requestConfig.method ?? 'get',
    url: requestConfig.url ?? '',
    params: requestConfig.params as Record<string, unknown>,
    body: requestConfig.data,
  });
}
```

---

## 5. Response Interceptors

### 5.1 Success Handler

#### Bước 1: Cleanup AbortController

```typescript
if (reqConfig._abortKey) {
  abortManager.clear(reqConfig._abortKey);
}
```

#### Bước 2: Transform Response Keys

```typescript
const skipTransform =
  response.config.responseType !== undefined &&
  response.config.responseType !== 'json';

let responseData = response.data;
if (config.transformKeys && !skipTransform && responseData) {
  responseData = keysToCamelCase(responseData);
}
```

**Edge Cases:**

```typescript
// 1. Blob/ArrayBuffer download - KHÔNG transform
// responseType = 'blob' → skipTransform = true ✓

// 2. response.data là null
keysToCamelCase(null); // → null (handled) ✓

// 3. response.data là primitive (string, number)
keysToCamelCase("hello"); // → "hello" ✓

// 4. Nested objects
{
  user: { first_name: "John" },
  items: [
    { item_name: "A" },
    { item_name: "B" }
  ]
}
// → { user: { firstName: "John" }, items: [{ itemName: "A" }, ...] } ✓
```

#### Bước 3: Envelope Unwrap

```typescript
const skipEnvelope =
  response.config.responseType !== undefined &&
  response.config.responseType !== 'json';

const isEnvelope =
  !skipEnvelope &&
  responseData !== null &&
  typeof responseData === 'object' &&
  'data' in responseData &&
  'message' in responseData;

const normalized: ApiResponse = isEnvelope
  ? {
      data: (responseData as Record<string, unknown>).data,
      message: (responseData as Record<string, unknown>).message as string,
      status: ((responseData as Record<string, unknown>).status as number) ?? response.status,
    }
  : { data: responseData, message: 'OK', status: response.status };
```

**Edge Cases:**

```typescript
// 1. Server trả envelope
{ data: { id: 1 }, message: "Success", status: 200, success: true }
// → { data: { id: 1 }, message: "Success", status: 200 } ✓

// 2. Server trả plain object (không phải envelope)
{ id: 1, name: "John" }
// → { data: { id: 1, name: "John" }, message: "OK", status: 200 } ✓

// 3. Server trả array
[{ id: 1 }, { id: 2 }]
// → { data: [{ id: 1 }, { id: 2 }], message: "OK", status: 200 } ✓

// 4. Server trả primitive
"hello"
// → { data: "hello", message: "OK", status: 200 } ✓

// 5. Blob download
// → skipEnvelope = true → { data: blob, message: "OK", status: 200 } ✓
```

### 5.2 Error Handler

#### buildApiError Helper

```typescript
function buildApiError(error: unknown, status: number, code?: string): ApiError {
  if (axios.isAxiosError(error)) {
    const serverData = error.response?.data as Record<string, unknown> | undefined;
    return {
      message: (serverData?.message as string) ?? error.message ?? 'Unknown error',
      status: error.response?.status ?? status,
      code: code ?? (serverData?.code as string),
      details: serverData,
      originalError: error,
    };
  }
  if (error instanceof Error) {
    return { message: error.message, status, code, originalError: error };
  }
  return { message: String(error), status, code, originalError: error };
}
```

**Edge Cases:**

```typescript
// 1. Server trả { message: "Validation failed", code: "VALIDATION_ERROR" }
// → ApiError.message = "Validation failed", code = "VALIDATION_ERROR"

// 2. Server trả { msg: "Error", error: "Details" } (không có message)
// → ApiError.message = error.message (axios error message)

// 3. Non-Axios error (TypeError, RangeError, etc.)
// → ApiError.message = error.message

// 4. Non-Error thrown (string, number, object)
// → ApiError.message = String(error)

// 5. status = 0 (network error / abort)
// → ApiError.status = 0
```

---

## 6. Token Refresh - Tự Động Làm Mới Token

### 6.1 TokenRefreshConfig

```typescript
interface TokenRefreshConfig {
  /** Hàm refresh token - trả về access token mới */
  refreshFn: () => Promise<string>;
  
  /** Hàm lấy token hiện tại */
  getAccessToken: () => string | null;
  
  /** Callback khi refresh thất bại */
  onRefreshFailed?: () => void;
}
```

### 6.2 Chi Tiết Refresh Flow

```typescript
// Token Refresh State - PER INSTANCE (không phải global)
let isRefreshing = false;
let refreshQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];
```

**Refresh flow chi tiết:**

```
Request A (401)
    │
    ├── isRefreshing = false
    ├── Bắt đầu refresh()
    ├── isRefreshing = true
    │
Request B (401) ──────► isRefreshing = true
    │                        │
    ├── Xếp vào queue       │
    └── Promise pending...   │
                              │
                         refreshFn() hoàn thành
                              │
                         processQueue(newToken)
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              Request A retry      Request B retry
                    │                   │
              resolve(A)            resolve(B)
```

### 6.3 Ví Dụ Đầy Đủ

```typescript
const api = createApiClient({
  baseURL: "https://api.example.com",
  tokenRefresh: {
    // Lấy token từ localStorage
    getAccessToken: () => localStorage.getItem("access_token"),
    
    // Refresh bằng refresh token cookie
    refreshFn: async () => {
      const res = await fetch("https://api.example.com/auth/refresh", {
        method: "POST",
        credentials: "include", // Gửi refresh token cookie
      });
      
      if (!res.ok) {
        throw new Error("Refresh failed");
      }
      
      const { access_token } = await res.json();
      localStorage.setItem("access_token", access_token);
      return access_token;
    },
    
    // Refresh thất bại - logout user
    onRefreshFailed: () => {
      localStorage.removeItem("access_token");
      window.location.href = "/login?reason=session_expired";
    },
  },
});

// Giờ đây tất cả requests tự động refresh token khi 401
const { data } = await api.get("/profile");
// → Nếu 401: refresh → retry → trả về data
```

### 6.4 Edge Cases Quan Trọng

```typescript
// 1. Multi-instance - mỗi instance có refresh state riêng
const api1 = createApiClient({ baseURL: "https://api1.com", tokenRefresh: {...} });
const api2 = createApiClient({ baseURL: "https://api2.com", tokenRefresh: {...} });

// api1 refresh không ảnh hưởng api2 ✓
```

```typescript
// 2. Refresh thất bại nhưng retry một lần
// Request A: 401 → refresh → refresh fail → onRefreshFailed()
// Request B (cùng lúc): 401 → trong queue → reject với refreshError

// ⚠️ Vấn đề: Request B nhận error nhưng không gọi onRefreshFailed
// Vì onRefreshFailed chỉ được gọi một lần (ở request A)

// ✅ Đã fix: processQueue(null, error) gọi reject trước khi onRefreshFailed
```

```typescript
// 3. Request không có config (edge case)
// Nếu axios throw error trước khi có config
// → error.config = undefined
// → reqConfig?._retry sẽ undefined → proceed bình thường ✓
```

```typescript
// 4. Race condition: refresh xong nhưng request đã bị abort
// reqConfig._retry = true được set
// Refresh hoàn thành
// Retry request nhưng signal đã abort
// → Request interceptor thấy signal aborted → reject với ABORTED
// → Không crash ✓
```

```typescript
// 5. RefreshFn throw non-Error
refreshFn: async () => {
  throw "Token expired"; // String thay vì Error
}
// → catch (refreshError) → refreshError = "Token expired"
// → buildApiError("Token expired", 401, "TOKEN_REFRESH_FAILED")
// → message = "Token expired" ✓
```

```typescript
// 6. Circular refresh - request A 401 → refresh → retry → 401 lại
// reqConfig._retry = true
// Retry request → 401 → thấy _retry = true
// → onRefreshFailed() + TOKEN_REFRESH_FAILED error
// → Ngăn infinite loop ✓
```

---

## 7. Retry Handler - Tự Động Thử Lại

### 7.1 RetryOptions

```typescript
interface RetryOptions {
  /** Số lần retry tối đa. Default: 3 */
  maxRetries?: number;
  
  /** Delay ban đầu (ms). Default: 300 */
  retryDelay?: number;
  
  /** Status codes sẽ retry. Default: [429, 500, 502, 503, 504] */
  retryOn?: number[];
  
  /** Delay tối đa (ms). Default: 10_000 */
  maxDelay?: number;
}
```

### 7.2 Exponential Backoff

```typescript
// delay = min(retryDelay × 2^attempt, maxDelay)

retryDelay = 300, maxDelay = 10_000

Attempt 0 (original): 0ms
Attempt 1: min(300 × 2^0, 10000) = 300ms
Attempt 2: min(300 × 2^1, 10000) = 600ms
Attempt 3: min(300 × 2^2, 10000) = 1200ms
Attempt 4: min(300 × 2^3, 10000) = 2400ms
Attempt 5: min(300 × 2^4, 10000) = 4800ms
Attempt 6: min(300 × 2^5, 10000) = 9600ms
Attempt 7: min(300 × 2^6, 10000) = 10000ms (capped)
```

### 7.3 shouldRetry Logic

```typescript
function shouldRetry(error: unknown, options: Required<RetryOptions>): boolean {
  if (!axios.isAxiosError(error)) return false;
  
  // Không retry nếu bị abort chủ động
  if (error.code === 'ERR_CANCELED' || error.name === 'AbortError') return false;
  
  // Retry network error (không có response)
  if (!error.response) return true;
  
  // Retry nếu status nằm trong retryOn
  return options.retryOn.includes(error.response.status);
}
```

### 7.4 Ví Dụ

```typescript
// 1. Retry mặc định (3 lần, delay 300ms)
const api1 = createApiClient({
  baseURL: "...",
  retry: {}, // Dùng defaults
});

// 2. Không retry
const api2 = createApiClient({
  baseURL: "...",
  retry: { maxRetries: 0 },
});

// 3. Chỉ retry network error
const api3 = createApiClient({
  baseURL: "...",
  retry: { maxRetries: 3, retryOn: [] },
});

// 4. Retry 5 lần với delay ban đầu 500ms
const api4 = createApiClient({
  baseURL: "...",
  retry: { maxRetries: 5, retryDelay: 500 },
});

// 5. Custom retry on status
const api5 = createApiClient({
  baseURL: "...",
  retry: { retryOn: [408, 429, 500, 502, 503, 504] }, // Thêm 408 Request Timeout
});
```

### 7.5 Edge Cases

```typescript
// 1. Abort trong khi đang retry
// Retry attempt 2 đang sleep(600ms)
// User gọi abort()
// → AbortController abort
// → Retry interceptor nhận ERR_CANCELED
// → shouldRetry return false → không retry nữa ✓
```

```typescript
// 2. Request timeout → retry không nên gửi lại
// axios timeout → ECONNABORTED error
// error.code = "ECONNABORTED" (KHÔNG phải ERR_CANCELED)
// shouldRetry: error.response undefined → return true
// → Retry timeout error ✓ (có thể network đã ổn định)
```

```typescript
// 3. Signal bị consumed sau request đầu tiên
// Request 1: signal đã used → không thể reuse
// Retry cần new signal → xóa signal cũ để interceptor tạo mới
delete retryConfig.signal;
```

```typescript
// 4. Retry count không bị reset khi retry
// _retryCount = 1 sau attempt 1
// Attempt 2: config._retryCount = 1 → retryCount = 1
// config._retryCount = 2
// → Attempt 3: config._retryCount = 2
// → Không reset về 0 ✓
```

```typescript
// 5. Config không có _retryCount property ban đầu
// config._retryCount ?? 0 = 0
// retryCount = 0
// config._retryCount = 1
// → Attempt 2: config._retryCount = 1 ✓
```

---

## 8. Deduplicator - Chống Request Trùng Lặp

### 8.1 Concept

```
Request A: GET /users?page=1
Request B: GET /users?page=1  (cùng lúc)
Request C: GET /users?page=1  (cùng lúc)

Without deduplication:
→ 3 HTTP requests sent

With deduplication:
→ 1 HTTP request sent
→ A, B, C all share the same Promise
```

### 8.2 Ví Dụ

```typescript
const api = createApiClient({
  baseURL: "...",
  deduplication: true, // Default
});

// Cả 3 calls chỉ tạo 1 HTTP request
const [r1, r2, r3] = await Promise.all([
  api.get("/config"),
  api.get("/config"),
  api.get("/config"),
]);
// r1 === r2 === r3 (same data)

/**
 * Bỏ qua deduplication cho request cụ thể
 * Dùng khi muốn force refresh
 */
await api.get("/config", { skipDedup: true }); // Luôn gửi request mới
```

### 8.3 Chi Tiết Implementation

```typescript
export class Deduplicator {
  private pending = new Map<string, Promise<AxiosResponse>>();
  
  wrap(axiosInstance: AxiosInstance): void {
    const originalRequest = axiosInstance.request.bind(axiosInstance);
    
    axiosInstance.request = <T>(config): Promise<AxiosResponse<T>> => {
      const method = (config.method ?? 'get').toLowerCase();
      
      // Chỉ deduplicate GET requests
      if (method !== 'get' || config.skipDedup) {
        return originalRequest<T>(config);
      }
      
      const key = buildRequestKey(config);
      
      if (this.pending.has(key)) {
        // Return existing promise
        return this.pending.get(key);
      }
      
      // Tạo promise mới
      const promise = originalRequest<T>(config).finally(() => {
        this.pending.delete(key);
      });
      
      this.pending.set(key, promise);
      return promise;
    };
  }
}
```

### 8.4 Edge Cases

```typescript
// 1. POST request - không deduplicate
api.post("/users", { name: "John" }); // Luôn gửi request mới

// 2. Request hoàn thành → promise resolved → key bị xóa
// Request tiếp theo cùng key → gửi request mới
// → Deduplication CHỈ áp dụng cho pending requests ✓
```

```typescript
// 3. Request thất bại (error)
// .finally() vẫn chạy → xóa key
// → Request tiếp theo gửi request mới (đúng behavior)
// → Caller xử lý error riêng
```

```typescript
// 4. Race condition: rất nhanh gọi 2 lần
// Request A: pending.get(key) = undefined → tạo promise
// Request B: pending.get(key) = promise (A đã set)
// → B return A's promise ✓

// ⚠️ Không race condition vì JS single-threaded
```

```typescript
// 5. Idempotent guard
wrap(axiosInstance: AxiosInstance): void {
  if (this._wrapped) return; // Chỉ wrap một lần
  this._wrapped = true;
  // ...
}
```

---

## 9. Response Cache - Bộ Nhớ Đệm

### 9.1 CacheOptions

```typescript
interface CacheOptions {
  /** Bật cache. Default: false */
  enabled?: boolean;
  
  /** TTL (ms). Default: 60_000 */
  ttl?: number;
  
  /** Stale-while-revalidate. Default: false */
  staleWhileRevalidate?: boolean;
  
  /** Số entries tối đa. Default: 100 */
  maxSize?: number;
}
```

### 9.2 Cache Flow

```
GET /users (cache enabled)
    │
    ▼
Cache.get(key)
    │
    ├── Fresh (now < expiresAt)
    │   └── Return cached response (shallow copy)
    │
    ├── Stale + SWR
    │   ├── Return stale response (shallow copy)
    │   └── Trigger background revalidation
    │
    └── Expired (no SWR) or Miss
        └── Fetch fresh → Cache.set() → Return response
```

### 9.3 Ví Dụ

```typescript
const api = createApiClient({
  baseURL: "...",
  cache: {
    enabled: true,
    ttl: 60_000,              // 1 phút
    staleWhileRevalidate: true,
    maxSize: 100,
  },
});

// Request đầu tiên - cache miss
const { data } = await api.get("/products");
// → HTTP request → cache response

// Request tiếp theo trong 1 phút - cache hit
const { data } = await api.get("/products");
// → Return cached (no HTTP)

// Override TTL cho request cụ thể
await api.get("/app-config", { cacheTtl: 10 * 60_000 }); // 10 phút

// Bỏ qua cache
await api.get("/products", { skipCache: true }); // Luôn fetch fresh

// Xóa cache
api.clearCache();                          // Xóa tất cả
api.clearCache("/products");               // Xóa /products
api.clearCache(/\/products\/\d+/);         // Xóa /products/123, /products/456
```

### 9.4 LRU Eviction

```typescript
// Khi store.size >= maxSize và entry mới được set
if (this.store.size >= this.options.maxSize && !this.store.has(key)) {
  this.evictLRU(); // Xóa entry ít được dùng nhất
}

private evictLRU(): void {
  let lruKey: string | null = null;
  let lruTime = Infinity;
  
  for (const [key, entry] of this.store) {
    if (entry.lastAccessedAt < lruTime) {
      lruTime = entry.lastAccessedAt;
      lruKey = key;
    }
  }
  
  if (lruKey) this.store.delete(lruKey);
}
```

**LRU Update Logic:**

```typescript
get(key: string): AxiosResponse | null {
  const entry = this.store.get(key);
  if (!entry) return null;
  
  if (now < entry.expiresAt) {
    // Fresh hit - CẬP NHẬT lastAccessedAt cho LRU
    entry.lastAccessedAt = now;
    return entry.data;
  }
  
  if (this.options.staleWhileRevalidate) {
    // Stale hit - KHÔNG cập nhật lastAccessedAt
    // Entry sẽ bị evict sớm hơn nếu maxSize đạt giới hạn
    return entry.data;
  }
  
  // Expired (no SWR) - xóa
  this.store.delete(key);
  return null;
}
```

### 9.5 Edge Cases Quan Trọng

```typescript
// 1. Cache cho non-GET requests
// Cache chỉ áp dụng cho method = 'get'
// POST/PUT/PATCH/DELETE luôn bypass cache ✓

// 2. Race condition giữa get() và isStale()
// ⚠️ NGUY HIỂM: Gọi riêng biệt có thể race
const entry = cache.get(key);
const isStale = cache.isStale(key);
// Between these two calls, TTL could expire!

// ✅ FIX: Cache wrap check cùng lúc
const entry = cache.store.get(key);
const now = Date.now();
const isFresh = entry && now < entry.expiresAt;
const isStaleEntry = entry && now >= entry.expiresAt;
```

```typescript
// 3. Shallow copy để prevent mutation
// ⚠️ Entry data bị shared giữa callers
const entry = cache.store.get(key);
return { ...entry.data }; // Shallow copy

// Caller mutate response.headers
// → Không ảnh hưởng cache entry ✓

// ⚠️ response.data vẫn là shared reference
// Caller mutate response.data.userName
// → Ảnh hưởng cache entry!

// Trade-off: Deep clone quá tốn kém
// Solution: Chỉ document, user cần tự clone nếu cần
```

```typescript
// 4. Background revalidation failure
// ⚠️ SWR: revalidation fail nhưng stale data đã return
originalRequest<T>(config).then((fresh) => {
  cache.set(key, fresh);
}).catch((err) => {
  // Log để debug
  // KHÔNG throw - caller đã nhận stale response
  logger.debug(`[Cache] Background revalidation failed`, err);
});

// Next request → vẫn return stale (vì entry chưa update)
```

```typescript
// 5. clearCache với string pattern
api.clearCache("/products");
// → Regex: /,"products"/ (match JSON format: '["get","/products","",""]')

// ⚠️ Cần escape special chars
"/api/v1/users"
// → "/api/v1/users" → regex escape → "\/api\/v1\/users"
```

```typescript
// 6. Cache với different responseType
// Cache wrap check: method !== 'get' || skipCache
// → Blob/ArrayBuffer download vẫn bypass cache ✓
```

```typescript
// 7. Retry + Cache interaction
// Request fail → retry → retry success → cache.set()
// → Entry được cache với fresh data ✓
```

---

## 10. Key Transform - Chuyển Đổi Key

### 10.1 toCamelCase

```typescript
// Standard snake_case → camelCase
"first_name"     → "firstName"
"user_id"        → "userId"
"created_at"     → "createdAt"
"is_active"     → "isActive"

// SCREAMING_SNAKE_CASE → camelCase
"USER_NAME"      → "userName"
"USER_ID"        → "userId"
"HTTP_200_OK"   → "http200Ok"
"API_KEY"        → "apiKey"

// Số sau underscore
"page_1_count"  → "page1Count"
"item_2_name"    → "item2Name"
```

### 10.2 toSnakeCase

```typescript
// camelCase → snake_case
"firstName"      → "first_name"
"userId"         → "user_id"
"createdAt"      → "created_at"
"isActive"       → "is_active"

// Acronyms xử lý đúng
"XMLParser"      → "xml_parser"    // Không phải x_m_l_parser
"getHTTPResponse" → "get_http_response"
"parseHTML"       → "parse_html"
"userID"          → "user_id"       // Không phải user_i_d
"IOStream"       → "io_stream"
```

### 10.3 Deep Transform

```typescript
// Nested objects
{
  user: {
    first_name: "John",
    addresses: [
      { street_name: "123 Main" },
      { street_name: "456 Oak" }
    ]
  }
}
// →
//
// {
//   user: {
//     firstName: "John",
//     addresses: [
//       { streetName: "123 Main" },
//       { streetName: "456 Oak" }
//     ]
//   }
// }
```

### 10.4 Special Objects Preserved

```typescript
// Date objects - KHÔNG transform
keysToCamelCase({ created_at: new Date() }); // → { createdAt: Date } ✓

// RegExp - KHÔNG transform
keysToCamelCase({ pattern: /test/gi }); // → { pattern: /test/gi } ✓

// Map - transform values
const map = new Map([["user_name", "John"]]);
keysToCamelCase(map); // → Map { "userName" → "John" } ✓

// Set - transform values
const set = new Set(["user_name", "item_name"]);
keysToCamelCase(set); // → Set { "userName", "itemName" } ✓
```

### 10.5 Edge Cases

```typescript
// 1. Null/undefined
keysToCamelCase(null);     // → null
keysToCamelCase(undefined); // → undefined

// 2. Primitive values
keysToCamelCase("hello");  // → "hello"
keysToCamelCase(123);      // → 123

// 3. Empty object
keysToCamelCase({});       // → {}

// 4. Object với prototype khác
class CustomClass { }
keysToCamelCase(new CustomClass()); // → CustomClass instance (không transform)

// 5. Symbol keys
const sym = Symbol("test");
keysToCamelCase({ [sym]: "value" }); // → {} (Symbol không enumerable trong Object.entries)
```

---

## 11. Upload & Download

### 11.1 Upload

```typescript
export async function uploadFile<T>(
  axiosInstance: AxiosInstance,
  url: string,
  formData: FormData,
  options: RequestOptions = {}
): Promise<ApiResponse<T>>
```

**Ví Dụ:**

```typescript
const formData = new FormData();
formData.append("file", fileInput.files[0]);
formData.append("description", "Profile avatar");

const { data } = await api.upload<UploadResult>("/files/upload", formData, {
  abortKey: "avatar-upload",
  onUploadProgress: (percent, event) => {
    console.log(`Upload: ${percent}%`);
    console.log(`Loaded: ${event.loaded} bytes`);
    console.log(`Total: ${event.total} bytes`);
    setProgress(percent);
  },
});
```

**Edge Cases:**

```typescript
// 1. event.total undefined (server không gửi Content-Length)
onUploadProgress: (percent, event) => {
  // percent = 0 vì event.total là undefined
  // → Handle gracefully, show "Uploading..." without percentage
  const percent = event.total 
    ? Math.round((event.loaded * 100) / event.total) 
    : 0;
}

// 2. Multiple files
const formData = new FormData();
fileList.forEach((file, i) => formData.append(`file_${i}`, file));
await api.upload("/files/batch", formData);
```

### 11.2 Download

```typescript
export async function downloadFile(
  axiosInstance: AxiosInstance,
  url: string,
  options: RequestOptions = {}
): Promise<Blob>
```

**Ví Dụ:**

```typescript
// Download với progress
const blob = await api.download("/reports/sales.pdf", {
  onDownloadProgress: (percent) => {
    console.log(`Download: ${percent}%`);
  },
});

// Auto download - trigger browser save dialog
await api.download("/exports/customers.csv", {
  autoDownload: true,
  downloadFileName: "customers-export.csv",
});

// Manual handling
const blob = await api.download("/files/document.pdf");
const url = URL.createObjectURL(blob);
window.open(url);
URL.revokeObjectURL(url);
```

**File Name Priority:**

```typescript
// 1. downloadFileName option (highest)
autoDownload: true,
downloadFileName: "custom-name.pdf"

// 2. Content-Disposition header từ server
// Content-Disposition: attachment; filename="report.pdf"
const fileNameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^\n]*)/);
const fileName = fileNameMatch?.[1] ?? 'download';
```

**Edge Cases:**

```typescript
// 1. Memory leak prevention
const href = URL.createObjectURL(blob);
try {
  // ... trigger download
} finally {
  URL.revokeObjectURL(href); // Luôn cleanup
}

// 2. Server không gửi Content-Disposition
// → Fallback: "download" ✓

// 3. Content-Disposition có double quotes
// filename="report.pdf" → extract "report.pdf" → remove quotes → "report.pdf" ✓

// 4. Content-Disposition có UTF-8 encoded filename
// filename*=UTF-8''report.pdf
// ⚠️ CHƯA HỖ TRỢ - sẽ fallback sang "download"
```

---

## 12. Mock Adapter

### 12.1 MockHandler Interface

```typescript
interface MockHandler {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  url: string | RegExp;
  response: unknown | ((config: AxiosRequestConfig) => unknown);
  status?: number;
  delay?: number;
}
```

### 12.2 Ví Dụ

```typescript
const mocks: MockHandler[] = [
  // 1. Static response với delay
  {
    method: "get",
    url: "/users",
    response: [
      { id: 1, first_name: "Alice", email: "alice@example.com" },
      { id: 2, first_name: "Bob", email: "bob@example.com" },
    ],
    delay: 500,
    status: 200,
  },

  // 2. Dynamic response - nhận config
  {
    method: "post",
    url: "/users",
    response: (config) => ({
      id: Math.floor(Math.random() * 1000),
      ...JSON.parse(config.data as string),
      created_at: new Date().toISOString(),
    }),
    status: 201,
  },

  // 3. RegExp matching
  {
    method: "get",
    url: /^\/users\/\d+$/,  // /users/123, /users/456
    response: (config) => {
      const id = config.url?.split("/").pop();
      return { id: Number(id), name: `User ${id}` };
    },
    status: 200,
  },

  // 4. Error simulation
  {
    method: "get",
    url: "/admin/dashboard",
    response: { message: "Forbidden", code: "PERMISSION_DENIED" },
    status: 403,
  },

  // 5. Path matching (with trailing slash)
  {
    method: "get",
    url: "/api/users/",  // Match /api/users, /api/users/123, /api/users/123/profile
    response: [{ id: 1 }],
    status: 200,
  },
];

const api = createApiClient({
  baseURL: "https://api.example.com",
  mocks,
  transformKeys: true, // Mock responses được transform
});
```

### 12.3 URL Matching Logic

```typescript
function matchHandler(config, handler): boolean {
  const methodMatch = (config.method ?? 'get').toLowerCase() === handler.method.toLowerCase();
  if (!methodMatch) return false;

  const url = config.url ?? '';
  
  if (typeof handler.url === 'string') {
    // Exact match
    if (url === handler.url) return true;
    
    // Sub-path match CHỈ khi handler ends with '/'
    if (handler.url.endsWith('/')) {
      return url.startsWith(handler.url);
    }
    return false;
  }
  
  // RegExp match
  return handler.url.test(url);
}
```

### 12.4 Edge Cases

```typescript
// 1. URL '/user' KHÔNG match '/users'
// '/user' === '/users' → false
// '/user'.startsWith('/users') → false
// → Correct! Different resources

// 2. URL '/users' match '/users/'
// '/users'.startsWith('/users/') → false
// → Correct! '/users' là resource gốc, '/users/' là collection path

// 3. Handler '/users/' match '/users/123'
// '/users/123'.startsWith('/users/') → true
// → Correct! Sub-resources
```

```typescript
// 4. Mock response với status >= 400
// → Throw AxiosError (không phải Error)
// → axios.isAxiosError() = true
// → Retry interceptor và response interceptor hoạt động bình thường
```

```typescript
// 5. Không có handler match
// → Dùng original adapter (real HTTP request)
axiosInstance.defaults.adapter = async (config) => {
  const handler = handlers.find(h => matchHandler(config, h));
  if (!handler) {
    return originalAdapter(config); // Real HTTP
  }
  // ...
};
```

---

## 13. Fork Instance

### 13.1 Concept

Fork tạo instance mới với config kế thừa từ parent.

```typescript
// Parent instance
const api = createApiClient({
  baseURL: "https://api.example.com",
  timeout: 10_000,
  tokenRefresh: { ... },
  cache: { enabled: true },
});

// Fork với overrides
const uploadApi = api.fork({
  baseURL: "https://upload.example.com",
  timeout: 120_000, // Override timeout dài hơn
});
```

### 13.2 Shallow Clone Config

```typescript
fork(overrides: Partial<ApiClientConfig> = {}): ApiClient {
  const forkedConfig: ApiClientConfig = {
    ...clientConfig,
    ...overrides,
    // Clone nested mutable objects
    defaultHeaders: { ...clientConfig.defaultHeaders, ...overrides.defaultHeaders },
    retry: clientConfig.retry ? { ...clientConfig.retry, ...overrides.retry } : overrides.retry,
    cache: clientConfig.cache ? { ...clientConfig.cache, ...overrides.cache } : overrides.cache,
    tokenRefresh: clientConfig.tokenRefresh ? { ...clientConfig.tokenRefresh } : overrides.tokenRefresh,
    mocks: overrides.mocks ?? clientConfig.mocks,
  };
  return createApiClient(forkedConfig);
}
```

### 13.3 Ví Dụ

```typescript
// 1. Upload service - baseURL và timeout khác
const uploadApi = api.fork({
  baseURL: "https://upload.example.com",
  timeout: 120_000,
  tokenRefresh: undefined, // Upload không cần auth
});

// 2. Public API - không cần auth
const publicApi = api.fork({
  tokenRefresh: undefined,
});

// 3. Testing - dùng mocks
const testApi = api.fork({
  mocks: testMocks,
  logging: false,
  cache: { enabled: false }, // Tắt cache cho test
});

// 4. Admin API - endpoint khác
const adminApi = api.fork({
  baseURL: "https://admin.example.com",
});
```

### 13.4 Edge Cases

```typescript
// 1. Fork tạo hoàn toàn độc lập
const parent = createApiClient({ baseURL: "https://a.com", tokenRefresh: {...} });
const child = parent.fork({ baseURL: "https://b.com" });

// parent.abortAll() không ảnh hưởng child ✓
// parent.clearCache() không ảnh hưởng child ✓

// 2. Override headers
parent.fork({
  defaultHeaders: { "X-Custom": "value" }
  // → merged với parent.defaultHeaders
});
```

---

## 14. Error Handling

### 14.1 ApiError Interface

```typescript
interface ApiError {
  message: string;       // Message từ server hoặc error.message
  status: number;        // HTTP status (0 = network error/abort)
  code?: string;         // "ABORTED" | "UNAUTHORIZED" | "TOKEN_REFRESH_FAILED" | server code
  details?: unknown;      // Toàn bộ error response từ server
  originalError?: unknown; // AxiosError gốc
}
```

### 14.2 Ví Dụ Xử Lý Lỗi

```typescript
async function loadUser(id: number) {
  try {
    const { data } = await api.get<User>(`/users/${id}`);
    return data;
  } catch (err) {
    const error = err as ApiError;

    // 1. Abort - bỏ qua
    if (error.code === "ABORTED") {
      console.log("Request was cancelled");
      return null;
    }

    // 2. Token refresh thất bại - user đã logout
    if (error.code === "TOKEN_REFRESH_FAILED") {
      console.log("Session expired");
      return null;
    }

    // 3. Network error
    if (error.status === 0) {
      showToast("Không có kết nối mạng");
      return null;
    }

    // 4. HTTP errors
    switch (error.status) {
      case 400:
        showValidationErrors(error.details);
        break;
      case 401:
        showToast("Vui lòng đăng nhập lại");
        break;
      case 403:
        showToast("Bạn không có quyền truy cập");
        break;
      case 404:
        showToast("Không tìm thấy dữ liệu");
        break;
      case 422:
        showValidationErrors(error.details);
        break;
      case 429:
        showToast("Quá nhiều yêu cầu, vui lòng thử lại sau");
        break;
      case 500:
      case 502:
      case 503:
        showToast("Lỗi server, vui lòng thử lại sau");
        break;
      default:
        showToast(error.message || "Đã xảy ra lỗi");
    }

    return null;
  }
}
```

### 14.3 Error Code Reference

| Code | Meaning | When |
|------|---------|------|
| `ABORTED` | Request bị hủy | `abort()`, `abortAll()`, duplicate cancel |
| `UNAUTHORIZED` | Refresh token fail sau retry | 401 → refresh → fail |
| `TOKEN_REFRESH_FAILED` | Refresh token thất bại | 401 → refresh → throw |

### 14.4 Edge Cases

```typescript
// 1. Server trả error không có message field
// { error: "Something went wrong" }
// → message = error.message (axios default)

// 2. Non-Axios error
throw new TypeError("Invalid data");
// → axios.isAxiosError(error) = false
// → buildApiError(TypeError, 0)
// → message = "Invalid data"

// 3. Non-Error thrown
throw "Something bad";
// → message = "Something bad"

// 4. Server trả array như error
// [ "Error 1", "Error 2" ]
// → message = array.toString() = "Error 1,Error 2"
```

---

## 15. Logger

### 15.1 Auto-Enable Conditions

```typescript
const isBrowser = typeof window !== 'undefined';

const isDev: boolean = isBrowser
  ? window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  : process.env.NODE_ENV === 'development';
```

### 15.2 Log Output Examples

```bash
# Request
[HTTP] ➤ GET /users

# Success
[HTTP] ✔ 200 GET /users (142ms)

# Error
[HTTP] ✖ 401 GET /me (38ms)

# Mock
[HTTP] ⚠ [Mock] GET /users → 200

# Cache
[HTTP] ◦ [Cache] HIT: ["get","/users","",""]
[HTTP] ◦ [Cache] STALE — revalidating: ["get","/users","",""]

# Dedup
[HTTP] ◦ [Dedup] Reusing pending request: ["get","/config","",""]
```

### 15.3 Edge Cases

```typescript
// 1. NODE_ENV = "production" trên browser
// window.location.hostname = "example.com"
// → isDev = false ✓

// 2. NODE_ENV undefined trên browser
// → isDev = false (vì hostname !== localhost/127.0.0.1) ✓

// 3. Production build có source maps
// → Vẫn disabled vì isDev check hostname/NODE_ENV ✓

// 4. Disable logging per instance
const api = createApiClient({
  baseURL: "...",
  logging: false, // Tắt hoàn toàn
});
```

---

## 16. Các Edge Cases Quan Trọng

### 16.1 Request Key Building

```typescript
// buildRequestKey format: JSON.stringify([method, url, paramsStr, dataStr])

// 1. Params order không matter
GET /users?sort=name&order=asc  ===  GET /users?order=asc&sort=name
// → Keys sorted before stringify ✓

// 2. Special values in params
GET /users?filter={"type":"admin"}
// → paramsStr = '{"filter":"{\"type\":\"admin\"}"}' ✓

// 3. Params không serialize được
GET /test?fn=function(){}
// → paramsStr = String(params) = "[object Object]" (fallback)

// 4. GET request với data (edge case)
// dataStr = '' cho GET ✓
```

### 16.2 Interceptor Order

```typescript
// Request flow (top-down):
// 1. Cache wrap (outermost)
// 2. Dedup wrap
// 3. Request interceptors
// 4. HTTP

// Response flow (bottom-up):
// 1. HTTP
// 2. Retry interceptor (innermost)
// 3. Response interceptor
// 4. Cache/Dedup unwrap (outermost)

// ⚠️ Retry phải đăng ký SAU response interceptor
// để Axios chạy TRƯỚC (ngược thứ tự đăng ký)
```

### 16.3 Memory Leaks Prevention

```typescript
// 1. AbortManager - clear sau request
if (reqConfig._abortKey) {
  abortManager.clear(reqConfig._abortKey);
}

// 2. Deduplicator - clear trong finally
originalRequest(config).finally(() => {
  this.pending.delete(key);
});

// 3. Cache - LRU eviction
if (this.store.size >= this.options.maxSize) {
  this.evictLRU();
}

// 4. Download - revoke ObjectURL
try {
  anchor.click();
} finally {
  URL.revokeObjectURL(href);
}

// 5. Snapshot before iterate (abortAll)
const entries = [...this.controllers]; // Copy trước
this.controllers.clear();
for (...) { ... }
```

### 16.4 Race Conditions

```typescript
// 1. Retry + Abort
// Retry đang sleep → abort được gọi
// → shouldRetry return false (ERR_CANCELED)
// → Không retry nữa ✓

// 2. Token Refresh + Abort
// Request trong queue → abort được gọi
// → Request interceptor thấy signal aborted
// → Throw error → queue reject với ABORTED ✓

// 3. SWR + Cache miss
// Cache miss → fetch → cache.set()
// Race: request A miss → fetch A → request B same key
// B không thấy A trong pending (vì chưa set)
// → B also fetch (không deduplicate)
// → Race không nghiêm trọng, cả hai fetch cùng data
```

### 16.5 Shallow vs Deep Copy

```typescript
// Cache HIT - return shallow copy
return { ...entry.data };
// → response.headers = NEW object (safe)
// → response.data = SAME reference (potential mutation risk)

// ⚠️ Trade-off:
// Pro: Không deep clone toàn bộ data (performance)
// Con: response.data mutation có thể affect cache

// Best practice: Immutable updates
const newData = { ...cachedData, count: cachedData.count + 1 };
// → Mutate trên copy, không ảnh hưởng cache
```

### 16.6 Multi-Instance Isolation

```typescript
// Mỗi instance hoàn toàn độc lập
const api1 = createApiClient({ baseURL: "https://a.com", cache: { enabled: true } });
const api2 = createApiClient({ baseURL: "https://b.com" });

// api1.cache !== api2.cache ✓
// api1.abortAll() không ảnh hưởng api2 ✓

// Fork cũng tạo instance độc lập
const child = api1.fork({ baseURL: "https://c.com" });
// child.abortAll() không ảnh hưởng api1 ✓
```

---

## Phụ Lục A: Quick Reference

### Tạo Client

```typescript
import { createApiClient } from "./src";

const api = createApiClient({
  baseURL: "https://api.example.com",
  // ... options
});
```

### HTTP Methods

```typescript
// GET
const { data } = await api.get<T>("/endpoint", options);

// POST
const { data } = await api.post<T>("/endpoint", payload, options);

// PUT
await api.put("/endpoint", payload, options);

// PATCH
await api.patch("/endpoint", payload, options);

// DELETE
await api.delete("/endpoint", options);
```

### Options Phổ Biến

```typescript
await api.get("/users", {
  params: { page: 1, limit: 10 },
  headers: { "X-Custom": "value" },
  timeout: 5000,
  abortKey: "unique-key",
  skipCache: true,
  skipDedup: true,
  cacheTtl: 30000,
});
```

### Abort

```typescript
// Cancel specific
api.get("/search", { abortKey: "search" });
api.abort("search");

// Cancel all
api.abortAll();
```

### Cache

```typescript
// Clear all
api.clearCache();

// Clear by URL
api.clearCache("/users");

// Clear by pattern
api.clearCache(/\/users\/\d+/);
```

---

## Phụ Lục B: Migration Guide

### Từ Axios sang @buildrbp/http-client

```typescript
// BEFORE - Axios
const response = await axios.get("/users");
const { data } = response.data; // Unwrap envelope

// AFTER - @buildrbp/http-client
const { data } = await api.get("/users"); // Auto unwrap ✓
```

### Từ @buildrbp/http-client cũ sang mới

```typescript
// BREAKING CHANGES:

// 1. Response shape thay đổi
// BEFORE: { data: T, message: string, status: number }
// AFTER: Same ✓

// 2. Error shape thay đổi
// BEFORE: AxiosError
// AFTER: ApiError { message, status, code, details, originalError }

// 3. Auto token refresh
// BEFORE: Phải implement manual
// AFTER: Built-in với tokenRefresh config ✓

// 4. Cache không còn là separate import
// BEFORE: import { ResponseCache }
// AFTER: Chỉ có AbortManager được export ✓
```

---

**Document Version:** 1.0  
**Last Updated:** 2026-04-27  
**Total Pages:** ~30
