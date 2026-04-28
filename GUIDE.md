# 📚 Hướng Dẫn Chi Tiết Thư Viện @buildrbp/http-client

> **Custom Axios HTTP Client** — TypeScript-first, production-ready, optimized for React Query.

---

## Mục Lục

1. [Tổng Quan Kiến Trúc](#1-tổng-quan-kiến-trúc)
2. [Factory Function: `createApiClient`](#2-factory-function-createapiclient)
3. [AbortManager - Quản Lý Hủy Request](#3-abortmanager---quản-lý-hủy-request)
4. [Request Interceptors](#4-request-interceptors)
5. [Response Interceptors](#5-response-interceptors)
6. [Token Refresh - Tự Động Làm Mới Token](#6-token-refresh---tự-động-làm-mới-token)
7. [Key Transform - Chuyển Đổi Key](#7-key-transform---chuyển-đổi-key)
8. [Upload & Download](#8-upload--download)
9. [Mock Adapter](#9-mock-adapter)
10. [Fork Instance](#10-fork-instance)
11. [Error Handling](#11-error-handling)
12. [Logger](#12-logger)
13. [React Query Integration](#13-react-query-integration)

---

## 1. Tổng Quan Kiến Trúc

### 1.1 Request Flow

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
    HTTP Request (hoặc Mock Adapter)
    │
    ▼
[Response Interceptor]
  ├── Success: cleanup, log, transform, unwrap envelope
  └── Error: cleanup, log, 401 → refresh token → retry
    │
    ▼
return ApiResponse<T> = { data: T, message: string, status: number }
```

### 1.2 Cấu Trúc Files

```
src/
├── core/
│   ├── AbortManager.ts              # Quản lý AbortController
│   ├── createInstance.ts            # Factory - kết hợp tất cả features
│   └── interceptors/
│       ├── requestInterceptors.ts   # Auth, trace, transform, abort
│       └── responseInterceptors.ts  # Normalize, envelope, 401/refresh
├── features/
│   ├── uploadDownload.ts            # Upload/Download với progress
│   └── mockAdapter.ts               # Custom axios adapter cho mock
├── utils/
│   ├── buildRequestKey.ts           # Tạo JSON key từ method+url+params
│   ├── logger.ts                    # Dev logger
│   └── transformKeys.ts             # camelCase ↔ snake_case
├── types/
│   └── index.ts                     # Tất cả TypeScript interfaces
└── index.ts                         # Public API entry point
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
  
  /** Cấu hình token refresh */
  tokenRefresh?: TokenRefreshConfig;
  
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
  tokenRefresh: {
    getAccessToken: () => localStorage.getItem("token"),
    refreshFn: async () => {
      const res = await fetch("/auth/refresh", { method: "POST", credentials: "include" });
      const { accessToken } = await res.json();
      localStorage.setItem("token", accessToken);
      return accessToken;
    },
    onRefreshFailed: () => {
      localStorage.clear();
      window.location.href = "/login";
    },
  },
  transformKeys: true,
});

// Sử dụng
const { data, message, status } = await api.get<User[]>("/users");
```

### 2.4 Returned ApiClient Interface

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

---

## 4. Request Interceptors

### 4.1 Chi Tiết Từng Bước

#### Bước 1: Timestamp & Retry Count

```typescript
// Ghi thời điểm bắt đầu request (cho logging)
requestConfig._startTime = Date.now();
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

#### Bước 4: Transform Body Keys

```typescript
if (config.transformKeys && requestConfig.data) {
  requestConfig.data = keysToSnakeCase(requestConfig.data);
}
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

// 4. Blob download
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
const { data } = await api.get<Profile>("/profile");
// → Nếu 401: refresh → retry → trả về data
```

---

## 7. Key Transform - Chuyển Đổi Key

### 7.1 Cách Hoạt Động

```typescript
// Request: camelCase → snake_case
{ firstName: "John", dateOfBirth: "1990-01-01" }
// → Server nhận
{ first_name: "John", date_of_birth: "1990-01-01" }

// Response: snake_case → camelCase
{ first_name: "John", created_at: "2024-01-01T00:00:00Z" }
// → Frontend nhận
{ firstName: "John", createdAt: "2024-01-01T00:00:00Z" }
```

### 7.2 Hỗ Trợ Đặc Biệt

```typescript
// SCREAMING_SNAKE_CASE
{ USER_ID: 1, USER_NAME: "Alice" }
// → { userId: 1, userName: "Alice" }

// Số trong key
{ page_1_count: 10, http_200_ok: true }
// → { page1Count: 10, http200Ok: true }

// Nested objects và arrays
{
  user: { first_name: "John" },
  items: [{ item_name: "A" }, { item_name: "B" }]
}
// → { user: { firstName: "John" }, items: [{ itemName: "A" }, { itemName: "B" }] }

// Built-in objects không bị transform
new Date(), new Map(), new Set() // → giữ nguyên
```

---

## 8. Upload & Download

### 8.1 Upload File

```typescript
const formData = new FormData();
formData.append("file", fileInputElement.files[0]);
formData.append("description", "Profile avatar");

const { data } = await api.upload<UploadResult>("/files/upload", formData, {
  abortKey: "avatar-upload",
  onUploadProgress: (percent, event) => {
    console.log(`Upload: ${percent}%`);
    setUploadProgress(percent);
  },
});

// Cancel upload
api.abort("avatar-upload");
```

### 8.2 Download File

```typescript
// Download và xử lý Blob thủ công
const blob = await api.download("/reports/monthly.pdf", {
  onDownloadProgress: (percent) => {
    setDownloadProgress(percent);
  },
});

const url = URL.createObjectURL(blob);
window.open(url);
URL.revokeObjectURL(url);

// Auto trigger browser "Save As" dialog
await api.download("/exports/data.csv", {
  autoDownload: true,
  downloadFileName: "report-2026.csv",
  onDownloadProgress: (percent) => console.log(`${percent}%`),
});
```

---

## 9. Mock Adapter

### 9.1 Cách Sử Dụng

```typescript
const mocks: MockHandler[] = [
  // Static response
  {
    method: "get",
    url: "/users",
    response: [
      { id: 1, first_name: "Alice" },
      { id: 2, first_name: "Bob" },
    ],
    delay: 300,
    status: 200,
  },

  // Dynamic response
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

  // RegExp matching
  {
    method: "delete",
    url: /^\/users\/\d+$/,
    response: null,
    status: 204,
  },

  // Error simulation
  {
    method: "get",
    url: "/admin/dashboard",
    response: { message: "Forbidden", code: "PERMISSION_DENIED" },
    status: 403,
  },
];

const api = createApiClient({
  baseURL: "https://api.example.com",
  mocks,
  transformKeys: true, // mock response cũng được transform
});
```

---

## 10. Fork Instance

### 10.1 Cách Sử Dụng

```typescript
// Instance gốc
const api = createApiClient({
  baseURL: "https://api.example.com",
  timeout: 10_000,
  tokenRefresh: { ... },
});

// Instance cho file upload
const uploadApi = api.fork({
  baseURL: "https://upload.example.com",
  timeout: 120_000,
});

// Instance cho public APIs
const publicApi = api.fork({
  tokenRefresh: undefined,
});

// Instance cho testing
const testApi = api.fork({
  mocks: [...mockHandlers],
  logging: false,
});
```

---

## 11. Error Handling

### 11.1 ApiError Interface

```typescript
interface ApiError {
  message: string;
  status: number;
  code?: string;
  details?: unknown;
  originalError?: unknown;
}
```

### 11.2 Ví Dụ

```typescript
async function loadUser(id: number) {
  try {
    const { data } = await api.get<User>(`/users/${id}`);
    return data;
  } catch (err) {
    const error = err as ApiError;

    if (error.code === "ABORTED") return null;
    if (error.code === "TOKEN_REFRESH_FAILED") return null;

    if (error.status === 0) {
      showToast("Không có kết nối mạng");
      return null;
    }

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

## 12. Logger

Logger chỉ active ở **localhost/127.0.0.1** (browser) hoặc `NODE_ENV=development` (Node).

```
[HTTP] ➤ POST /auth/login
[HTTP] ✔ 200 POST /auth/login (142ms)
[HTTP] ✖ 401 GET /me (38ms)
[HTTP] ⚠ [Mock] GET /users → 200
```

Tắt logging:
```typescript
const api = createApiClient({ baseURL: "...", logging: false });
```

---

## 13. React Query Integration

### 13.1 Tại Sao Không Có Cache/Retry/Dedup?

Library này được thiết kế để dùng với **React Query**, vì vậy:

- **Cache**: React Query có `staleTime`, `cacheTime`
- **Retry**: React Query có `retry`, `retryDelay`
- **Deduplication**: React Query tự động deduplicate theo `queryKey`

### 13.2 Ví Dụ Sử Dụng

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

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
    staleTime: 60_000,
    retry: 3,
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

### 13.3 Best Practices

1. **Dùng React Query cho data fetching logic**
   - `staleTime` thay cho cache TTL
   - `retry` thay cho retry logic
   - `queryKey` để deduplicate

2. **Dùng http-client cho infrastructure concerns**
   - Token refresh
   - Abort controller
   - Key transformation
   - Upload/download progress

3. **Invalidate cache sau mutation**
   ```typescript
   queryClient.invalidateQueries({ queryKey: ['users'] });
   ```

4. **Cancel requests khi unmount**
   ```typescript
   useEffect(() => {
     const abortKey = 'dashboard-data';
     api.get('/dashboard', { abortKey }).then(/* ... */);
     return () => api.abort(abortKey);
   }, []);
   ```

---

## 📄 License

MIT
