# @buildrbp/http-client

> **Custom Axios HTTP Client** — TypeScript-first, production-ready, optimized for React Query.
> Xây dựng trên Axios với các tính năng: token refresh tự động, abort controller, upload/download progress, key transformation và mock adapter.

---

## ✨ Tính năng

| Feature                   | Mô tả                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| 🎯 **Typed API**          | Full TypeScript generics — `api.get<User[]>("/users")`                 |
| 🔑 **Auto Token Refresh** | Tự động refresh `401`, queue requests, retry sau khi có token mới      |
| 🚫 **Abort Controller**   | Hủy request theo `key` hoặc hủy tất cả, auto-cancel duplicate request  |
| 🪝 **Lifecycle Hooks**    | `beforeRequest`, `afterResponse`, `onError` — inject custom logic      |
| 🔄 **Key Transform**      | Auto `camelCase ↔ snake_case` và `SCREAMING_SNAKE_CASE` cho mọi object |
| 📤 **Upload Progress**    | Track tiến trình upload với callback `(percent, event)`                |
| 📥 **Download Progress**  | Track tiến trình + auto trigger browser download                       |
| 🎭 **Mock Mode**          | Mock handlers cho dev/test, đi qua interceptors như response thật      |
| 🍴 **Fork Instance**      | Tạo instance mới kế thừa config với overrides                          |
| 📋 **Dev Logging**        | Colorized log request/response với timing, tắt tự động ở production    |

---

## 📦 Cài đặt

```bash
npm install axios
```

Lib dùng Axios làm peer dependency. Không cần cài thêm package nào khác.

---

## 🚀 Quick Start

```typescript
import { createApiClient } from "./src";

const api = createApiClient({
  baseURL: "https://api.example.com",
});

// GET với TypeScript generic
interface User {
  id: number;
  firstName: string;
  email: string;
}

const { data, message, status } = await api.get<User[]>("/users");
// data: User[], message: string, status: number

// POST
await api.post("/users", { firstName: "John", email: "john@example.com" });

// PUT / PATCH / DELETE
await api.put("/users/1", { firstName: "Jane" });
await api.patch("/users/1", { email: "jane@example.com" });
await api.delete("/users/1");
```

---

## ⚙️ Cấu hình đầy đủ

```typescript
import { createApiClient } from "./src";

const api = createApiClient({
  // ── Bắt buộc ──────────────────────────────────────────────────────────────
  baseURL: "https://api.example.com",

  // ── Tùy chọn ──────────────────────────────────────────────────────────────
  timeout: 10_000, // ms, default: 10_000

  defaultHeaders: {
    "x-app-version": "1.0.0",
    "x-platform": "web",
  },

  // ── Token Refresh ─────────────────────────────────────────────────────────
  tokenRefresh: {
    // Hàm lấy access token hiện tại để gắn vào Authorization header
    getAccessToken: () => localStorage.getItem("access_token"),

    // Hàm refresh token — phải trả về access token mới
    refreshFn: async () => {
      const res = await fetch("/auth/refresh", {
        method: "POST",
        credentials: "include", // gửi refresh token cookie
      });
      if (!res.ok) throw new Error("Refresh failed");
      const { accessToken } = await res.json();
      localStorage.setItem("access_token", accessToken);
      return accessToken;
    },

    // Gọi khi refresh thất bại — thường là logout user
    onRefreshFailed: () => {
      localStorage.clear();
      window.location.href = "/login";
    },
  },

  // ── Các tùy chọn khác ─────────────────────────────────────────────────────
  transformKeys: true, // tự động camelCase↔snake_case, default: false
  logging: true, // log request/response ở dev, tắt tự động ở production
});
```

---

## 📖 API Reference

### `api.get<T>(url, options?)`

```typescript
const { data } = await api.get<Product[]>("/products", {
  params: { category: "electronics", page: 1 },
  headers: { "x-custom": "value" },
  timeout: 5_000, // override timeout cho request này
});
```

### `api.post<T>(url, data?, options?)`

```typescript
const { data } = await api.post<{ id: number }>("/products", {
  name: "MacBook Pro",
  price: 2499,
  categoryId: 3,
});
```

### `api.put / api.patch / api.delete`

```typescript
await api.put("/products/1", { name: "MacBook Pro M3", price: 2799 });
await api.patch("/products/1", { price: 2699 });
await api.delete("/products/1");
```

### `RequestOptions` — Tùy chọn per-request

Tất cả methods đều nhận `RequestOptions`, extend từ `AxiosRequestConfig` với thêm:

```typescript
interface RequestOptions {
  // ── Từ Axios (một số phổ biến) ───────────────────────────────────────────
  params?: Record<string, unknown>; // query string
  headers?: Record<string, string>; // headers bổ sung
  timeout?: number; // override timeout (ms)
  signal?: AbortSignal; // AbortSignal tùy chỉnh

  // ── Abort ────────────────────────────────────────────────────────────────
  abortKey?: string; // key để abort request sau, tự generate nếu không truyền

  // ── Progress (dùng với upload/download) ──────────────────────────────────
  onUploadProgress?: (percent: number, event: AxiosProgressEvent) => void;
  onDownloadProgress?: (percent: number, event: AxiosProgressEvent) => void;

  // ── Download ─────────────────────────────────────────────────────────────
  autoDownload?: boolean; // tự trigger browser download
  downloadFileName?: string; // tên file khi autoDownload = true
}
```

---

## 🔑 Token Refresh Chi Tiết

Khi server trả `401 Unauthorized`:

1. Request bị intercept lại
2. `refreshFn()` được gọi để lấy access token mới
3. Tất cả requests đang bị chặn (pending `401`) được **queue lại**
4. Sau khi có token mới → tất cả requests được **retry** tự động
5. Nếu refresh thất bại → `onRefreshFailed()` được gọi (thường là logout)

> **Multi-instance safe:** Mỗi instance và `fork()` có refresh state riêng biệt.
> Instance A refresh token không ảnh hưởng đến Instance B.

```typescript
// Chỉ cần config một lần khi tạo instance — xử lý tự động hoàn toàn
const { data } = await api.get<Profile>("/me");
// → Nếu token hết hạn: refresh → retry → trả về data bình thường
```

---

## 🚫 Abort Controller

```typescript
// 1. Gắn abortKey để có thể cancel sau
api.get("/search", {
  abortKey: "product-search",
  params: { q: "macbook" },
});

// 2. Cancel request đó
api.abort("product-search");

// 3. Cancel tất cả pending requests (vd: khi user logout hoặc route change)
api.abortAll();
```

**Auto-cancel duplicate:** Nếu gửi cùng request 2 lần với cùng `abortKey`,
request cũ sẽ tự động bị hủy trước khi request mới gửi đi.

**React pattern — cancel khi unmount:**

```typescript
useEffect(() => {
  api.get("/users", { abortKey: "users-page" }).then(({ data }) => {
    setUsers(data);
  }).catch((err) => {
    if (err.code === "ABORTED") return; // bỏ qua lỗi do cancel
    setError(err.message);
  });

  return () => api.abort("users-page"); // cleanup khi unmount
}, []);
```

---

## 🔄 Key Transform

Tự động chuyển đổi keys giữa `camelCase` (frontend) và `snake_case` (server).

```typescript
const api = createApiClient({
  baseURL: "https://api.example.com",
  transformKeys: true, // bật transform
});

// Gửi request: { firstName: "John" } → server nhận { first_name: "John" }
await api.post("/users", { firstName: "John", dateOfBirth: "1990-01-01" });

// Nhận response: server trả { first_name: "John", created_at: "..." }
//               → frontend nhận { firstName: "John", createdAt: "..." }
const { data } = await api.get<User>("/users/1");
data.firstName; // ✅

// Hỗ trợ SCREAMING_SNAKE_CASE từ một số APIs
// SERVER trả: { USER_ID: 1, USER_NAME: "Alice" }
// Frontend nhận: { userId: 1, userName: "Alice" }

// Hỗ trợ số trong key
// SERVER trả: { page_1_count: 10, http_200_ok: true }
// Frontend nhận: { page1Count: 10, http200Ok: true }

// Hỗ trợ đệ quy — objects và arrays lồng nhau đều được transform
// Date, Map, Set và các built-in objects được giữ nguyên (không bị phá vỡ)
```

---

## 📤 Upload File

```typescript
const formData = new FormData();
formData.append("file", fileInputElement.files[0]);
formData.append("description", "Profile avatar");

interface UploadResult {
  url: string;
  key: string;
  size: number;
}

const { data } = await api.upload<UploadResult>("/files/upload", formData, {
  abortKey: "avatar-upload",
  onUploadProgress: (percent, event) => {
    console.log(`Upload: ${percent}%`);
    // event.loaded: bytes đã upload
    // event.total: tổng bytes (undefined nếu server không gửi Content-Length)
    setUploadProgress(percent);
  },
});

console.log(data.url); // URL của file đã upload

// Cancel upload
api.abort("avatar-upload");
```

---

## 📥 Download File

```typescript
// Download và xử lý Blob thủ công
const blob = await api.download("/reports/monthly.pdf", {
  onDownloadProgress: (percent) => {
    setDownloadProgress(percent);
  },
});

// Tạo URL và mở tab mới
const url = URL.createObjectURL(blob);
window.open(url);
URL.revokeObjectURL(url);

// Auto trigger browser "Save As" dialog
await api.download("/exports/data.csv", {
  autoDownload: true,
  downloadFileName: "report-2026.csv", // tên file gợi ý
  onDownloadProgress: (percent) => console.log(`${percent}%`),
});
// Nếu không truyền downloadFileName, dùng Content-Disposition header từ server
// Fallback: "download"
```

---

## 🪝 Lifecycle Hooks

Hooks cho phép inject custom logic vào request/response flow mà không cần fork instance hay monkey-patch axios.

```typescript
import { createApiClient } from "./src";

const api = createApiClient({
  baseURL: "https://api.example.com",
  hooks: {
    // Chạy TRƯỚC khi request gửi đi (sau khi token đã inject)
    beforeRequest: [
      async (ctx) => {
        // ctx.method, ctx.url, ctx.params, ctx.body, ctx.headers
        ctx.headers["x-app-id"] = "my-app";
        ctx.headers["x-timestamp"] = Date.now().toString();
      },
    ],

    // Chạy SAU khi response thành công (sau normalize + key transform)
    afterResponse: [
      async (ctx) => {
        // ctx.data, ctx.message, ctx.status, ctx.method, ctx.url
        analytics.track("api_success", {
          url: ctx.url,
          status: ctx.status,
          duration: Date.now(),
        });
      },
    ],

    // Chạy khi request fail (không chạy cho abort)
    onError: [
      async (error) => {
        // error.message, error.status, error.code, error.details, error.originalError
        Sentry.captureException(error.originalError, {
          tags: { endpoint: error.details },
        });
      },
    ],
  },
});
```

### Execution Order

```
caller
  │
  ▼
beforeRequest hooks (tuần tự)
  │  → Có thể modify headers
  │  → Throw để cancel request
  ▼
[Auth, Transform, AbortController, Logging]
  │
  ▼
HTTP Request
  │
  ├── Success ──► [Transform keys, Unwrap envelope]
  │                    │
  │                    ▼
  │              afterResponse hooks (tuần tự)
  │                    │  → Nhận data đã normalize
  │                    │  → Throw để trigger error
  │                    ▼
  │               return ApiResponse<T>
  │
  └── Error ──► onError hooks (tuần tự)
                     │  → Nhận ApiError object
                     │  → Throw để replace error
                     ▼
                 throw ApiError
```

### Key Behaviors

| Hook | Khi nào chạy | Có thể modify | Throw |
|------|-------------|--------------|-------|
| `beforeRequest` | Trước HTTP, sau auth inject | Headers | Cancel request |
| `afterResponse` | Sau normalize, trước caller | - | Chuyển thành error |
| `onError` | Khi fail (trừ abort) | - | Replace error |

> **Abort không trigger onError** — Abort là hành động chủ động của user, không phải lỗi cần track.

### Multiple Hooks

```typescript
hooks: {
  beforeRequest: [
    // Chạy theo thứ tự: hook1 → hook2 → hook3
    (ctx) => { ctx.headers["x-source"] = "web"; },
    async (ctx) => { await logRequest(ctx); },
    (ctx) => { ctx.headers["x-session"] = getSessionId(); },
  ],
}
```

### Fork & Hooks

```typescript
const base = createApiClient({
  baseURL: "https://api.example.com",
  hooks: {
    beforeRequest: [addAppId],
    onError: [logToSentry],
  },
});

// Child kế thừa hooks từ parent
const child = base.fork({ timeout: 30_000 });

// Override hooks hoàn toàn (không merge)
const noHooks = base.fork({ hooks: {} });
```

---

## 🎭 Mock Mode

Mock handler **đi qua toàn bộ response interceptors** như response thật
(normalize, camelCase transform, envelope unwrap) — behavior nhất quán với production.

```typescript
import { createApiClient } from "./src";
import type { MockHandler } from "./src";

const mocks: MockHandler[] = [
  // Static response với delay giả lập
  {
    method: "get",
    url: "/users",
    response: [
      { id: 1, first_name: "Alice", email: "alice@example.com" },
      { id: 2, first_name: "Bob", email: "bob@example.com" },
    ],
    delay: 300,
    status: 200,
  },

  // Dynamic response — nhận config của request
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

  // Match bằng RegExp — mock DELETE /users/:id
  {
    method: "delete",
    url: /^\/users\/\d+$/,
    response: null,
    status: 204,
  },

  // Simulate lỗi server
  {
    method: "get",
    url: "/admin/dashboard",
    response: { message: "Forbidden", code: "PERMISSION_DENIED" },
    status: 403,
  },
];

// Tạo API client với mocks
const api = createApiClient({
  baseURL: "https://api.example.com",
  mocks,
  transformKeys: true, // mock response cũng được transform
});

// Nếu URL không match bất kỳ mock nào → gửi HTTP request thật
```

> **Tip:** Dùng `fork()` để tạo instance riêng cho test mà không ảnh hưởng instance production.

---

## 🍴 Fork Instance

Tạo instance mới kế thừa **toàn bộ config**, chỉ override những gì cần:

```typescript
// Instance gốc
const api = createApiClient({
  baseURL: "https://api.example.com",
  timeout: 10_000,
  tokenRefresh: { ... },
});

// Instance cho file upload — timeout dài hơn, baseURL khác
const uploadApi = api.fork({
  baseURL: "https://upload.example.com",
  timeout: 120_000,
});

// Instance cho public APIs — không cần auth
const publicApi = api.fork({
  tokenRefresh: undefined,
});

// Instance cho testing — dùng mocks, tắt logging
const testApi = api.fork({
  mocks: [...mockHandlers],
  logging: false,
});
```

> **Lưu ý quan trọng:** Mỗi forked instance có `AbortManager` riêng biệt.
> `api.abortAll()` trên instance gốc **không hủy** requests của forked instance.

---

## ❌ Error Handling

Tất cả lỗi được normalize thành `ApiError`:

```typescript
interface ApiError {
  message: string; // message từ server hoặc error.message
  status: number; // HTTP status (0 = network error / abort)
  code?: string; // "ABORTED" | "UNAUTHORIZED" | "TOKEN_REFRESH_FAILED" | code từ server
  details?: unknown; // toàn bộ error response từ server
  originalError?: unknown; // AxiosError gốc
}
```

```typescript
import type { ApiError } from "./src";

async function loadUser(id: number) {
  try {
    const { data } = await api.get<User>(`/users/${id}`);
    return data;
  } catch (err) {
    const error = err as ApiError;

    // Request bị cancel chủ động — thường bỏ qua
    if (error.code === "ABORTED") return null;

    // Token refresh thất bại — user đã bị logout bởi onRefreshFailed
    if (error.code === "TOKEN_REFRESH_FAILED") return null;

    // Network error (offline, DNS fail...)
    if (error.status === 0) {
      showToast("Không có kết nối mạng");
      return null;
    }

    // HTTP errors
    switch (error.status) {
      case 401: showToast("Phiên đăng nhập hết hạn"); break;
      case 403: showToast("Không có quyền truy cập"); break;
      case 404: showToast("Không tìm thấy dữ liệu"); break;
      case 422: showValidationErrors(error.details); break;
      default:  showToast(error.message);
    }
    return null;
  }
}
```

---

## 📋 Logging

Logger chỉ active ở **localhost/127.0.0.1** (browser) hoặc `NODE_ENV=development` (Node).
Tắt hoàn toàn ở production — không cần cấu hình gì thêm.

```
[HTTP] ➤ POST /auth/login
[HTTP] ✔ 200 POST /auth/login (142ms)
[HTTP] ✖ 401 GET /me (38ms)
[HTTP] ⚠ [Mock] GET /users → 200
```

Tắt logging cho một instance cụ thể:
```typescript
const api = createApiClient({ baseURL: "...", logging: false });
```

---

## 🏗️ Kiến trúc

### Request / Response Flow

```
api.get("/users")
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
    HTTP Request (hoặc Mock Adapter nếu có handler match)
    │
    ▼
[Response Interceptor]
  ├── Success:
  │   ├── Cleanup AbortController
  │   ├── Log response
  │   ├── Transform keys (snake_case → camelCase)
  │   └── Unwrap envelope { data, message, status }
  └── Error:
      ├── Cleanup AbortController
      ├── Log error
      ├── ERR_CANCELED → ApiError { code: "ABORTED" }
      ├── 401 → refresh token → retry (hoặc onRefreshFailed nếu fail)
      └── Khác → build ApiError và reject
    │
    ▼
return ApiResponse<T> = { data: T, message: string, status: number }
```

---

## 📁 Cấu trúc project

```
src/
├── core/
│   ├── AbortManager.ts              # Quản lý AbortController lifecycle
│   ├── createInstance.ts            # Factory function — kết hợp tất cả features
│   └── interceptors/
│       ├── requestInterceptors.ts   # Auth, trace headers, key transform, abort
│       └── responseInterceptors.ts  # Normalize, envelope unwrap, 401/token refresh
│
├── features/
│   ├── uploadDownload.ts            # Upload/Download với progress tracking
│   └── mockAdapter.ts               # Custom axios adapter cho mock
│
├── utils/
│   ├── buildRequestKey.ts           # Tạo JSON key từ method+url+params
│   ├── logger.ts                    # Dev logger (browser + node, auto-disable)
│   └── transformKeys.ts             # camelCase ↔ snake_case ↔ SCREAMING_SNAKE (đệ quy)
│
├── types/
│   └── index.ts                     # Tất cả TypeScript interfaces
│
└── index.ts                         # Public API entry point
```

---

## 🧪 Testing

```bash
npm test              # chạy tất cả tests (vitest)
npm run build         # compile TypeScript → dist/
npm run dev           # watch mode
```

**Kết quả:** 298 tests / 14 files — 100% pass ✅

---

## 📦 Public API

```typescript
// Factory
import { createApiClient } from "./src";

// Standalone class (nếu cần AbortManager riêng)
import { AbortManager } from "./src";

// Utilities (nếu cần dùng trực tiếp)
import { toCamelCase, toSnakeCase, keysToCamelCase, keysToSnakeCase } from "./src";
import { buildRequestKey } from "./src";
import { logger } from "./src";

// Types
import type {
  ApiClient,
  ApiClientConfig,
  ApiResponse,
  ApiError,
  RequestOptions,
  TokenRefreshConfig,
  MockHandler,
  HooksConfig,
  RequestContext,
  ResponseContext,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from "./src";
```

---

## 🎯 Tại sao không có Cache / Retry / Deduplication?

Library này được thiết kế để dùng với **React Query** (TanStack Query), vì vậy các tính năng sau được xử lý bởi React Query:

- **Cache**: React Query có `staleTime`, `cacheTime`, `refetchOnMount`, `refetchOnWindowFocus`
- **Retry**: React Query có `retry`, `retryDelay` config
- **Deduplication**: React Query tự động deduplicate theo `queryKey`

Điều này giúp:
- ✅ Tránh conflict giữa 2 layer cache
- ✅ Dễ debug hơn (chỉ 1 source of truth)
- ✅ Giảm bundle size
- ✅ Tận dụng tối đa React Query features (UI integration, optimistic updates, etc.)

**Ví dụ sử dụng với React Query:**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createApiClient } from './src';

const api = createApiClient({
  baseURL: 'https://api.example.com',
  tokenRefresh: { ... },
  transformKeys: true,
});

// Query
function UserList() {
  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<User[]>('/users').then(res => res.data),
    staleTime: 60_000, // cache 60s
    retry: 3, // retry 3 lần
  });

  if (isLoading) return <div>Loading...</div>;
  return <ul>{data?.map(user => <li key={user.id}>{user.firstName}</li>)}</ul>;
}

// Mutation
function CreateUser() {
  const queryClient = useQueryClient();
  
  const mutation = useMutation({
    mutationFn: (newUser: CreateUserDto) => 
      api.post<User>('/users', newUser).then(res => res.data),
    onSuccess: () => {
      // Invalidate và refetch
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  return (
    <button onClick={() => mutation.mutate({ firstName: 'John', email: 'john@example.com' })}>
      Create User
    </button>
  );
}
```

---

## 📄 License

MIT
