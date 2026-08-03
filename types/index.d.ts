// Type definitions for tarogo-ai
// Project: https://api.tarogo.com

export interface TarogoAIOptions {
  /** API Key（也可通过环境变量 TAROGO_API_KEY 提供） */
  apiKey?: string;
  /** 上游基础地址，默认 https://api.tarogo.com（无需带 /v1）；仅需切换到其他云端时才需要填 */
  baseURL?: string;
  /** 请求超时（毫秒），默认 600000（10 分钟） */
  timeout?: number;
  /** 附加到每个请求的默认请求头 */
  defaultHeaders?: Record<string, string>;
  /** 自定义 fetch 实现（默认使用全局 fetch） */
  fetch?: typeof globalThis.fetch;
  /**
   * 本地 Ollama 自动路由配置（默认开启）：
   * 请求的模型命中本地 Ollama 已安装清单（/api/tags）时自动走本地，否则回落默认上游。
   * 传 false 可关闭。
   */
  ollama?: OllamaOptions | false;
}

export interface OllamaOptions {
  /** 是否启用本地路由，默认 true */
  enabled?: boolean;
  /** 本地 Ollama 地址，默认 http://localhost:11434 */
  host?: string;
  /** 模型清单缓存毫秒，默认 10000 */
  cacheTTL?: number;
  /** 探测超时毫秒，默认 800 */
  timeout?: number;
}

export interface RequestOptions {
  /** 单次请求覆盖上游基础地址（优先级高于构造参数，低于 body.base_url） */
  baseURL?: string;
  /** 单次请求超时（毫秒） */
  timeout?: number;
  /** 附加请求头 */
  headers?: Record<string, string>;
  /** 取消信号 */
  signal?: AbortSignal;
  /** 请求方法（通用 request 调用时使用） */
  method?: string;
}

// ---------- Chat Completions ----------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'function';
  content: string | null;
  name?: string;
  tool_call_id?: string;
}

export interface ChatCompletionCreateParams {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  n?: number;
  seed?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  response_format?: { type: 'text' | 'json_object' };
  user?: string;
  /** TarogoAI 扩展：单次请求覆盖上游地址（自动剥离，不会透传） */
  base_url?: string;
  [key: string]: unknown;
}

export interface ChatCompletionMessage {
  role: string;
  content: string | null;
  tool_calls?: unknown[];
  function_call?: unknown;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatCompletionMessage;
  finish_reason: string | null;
  logprobs?: unknown;
}

export interface ChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: string; content?: string | null; tool_calls?: unknown[] };
    finish_reason: string | null;
  }>;
}

// ---------- Completions ----------

export interface CompletionCreateParams {
  model: string;
  prompt: string | string[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  n?: number;
  echo?: boolean;
  logprobs?: number;
  user?: string;
  base_url?: string;
  [key: string]: unknown;
}

export interface Completion {
  id: string;
  object: 'text_completion';
  created: number;
  model: string;
  choices: Array<{ text: string; index: number; finish_reason: string | null }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ---------- Embeddings ----------

export interface EmbeddingsCreateParams {
  model: string;
  input: string | string[];
  encoding_format?: 'float' | 'base64';
  user?: string;
  base_url?: string;
  [key: string]: unknown;
}

export interface Embedding {
  object: 'embedding';
  index: number;
  embedding: number[];
}

export interface Embeddings {
  object: 'list';
  data: Embedding[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

// ---------- Models ----------

export interface Model {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export interface ModelList {
  object: 'list';
  data: Model[];
}

// ---------- 错误 ----------

export class TarogoAIError extends Error {
  status: number | null;
  body: unknown;
  headers: Headers | null;
  constructor(message: string, status?: number | null, body?: unknown, headers?: Headers | null);
}
export class APIConnectionError extends TarogoAIError {}
export class BadRequestError extends TarogoAIError {}
export class AuthenticationError extends TarogoAIError {}
export class PermissionDeniedError extends TarogoAIError {}
export class NotFoundError extends TarogoAIError {}
export class RateLimitError extends TarogoAIError {}
export class InternalServerError extends TarogoAIError {}

// ---------- 客户端 ----------

export type AsyncStream<T> = AsyncGenerator<T, void, unknown>;

export interface RouteInfo {
  /** 本次请求实际使用的上游地址（本地命中时为 Ollama 地址） */
  baseURL: string;
  /** 是否为本地 Ollama 命中 */
  local: boolean;
}

export class TarogoAI {
  constructor(options?: TarogoAIOptions);

  readonly apiKey: string;
  readonly baseURL: string;
  readonly timeout: number;

  chat: {
    completions: {
      create(
        body: ChatCompletionCreateParams & { stream?: false },
        options?: RequestOptions
      ): Promise<ChatCompletion>;
      create(
        body: ChatCompletionCreateParams & { stream: true },
        options?: RequestOptions
      ): Promise<AsyncStream<ChatCompletionChunk>>;
    };
  };

  completions: {
    create(
      body: CompletionCreateParams & { stream?: false },
      options?: RequestOptions
    ): Promise<Completion>;
    create(
      body: CompletionCreateParams & { stream: true },
      options?: RequestOptions
    ): Promise<AsyncStream<Completion>>;
  };

  embeddings: {
    create(body: EmbeddingsCreateParams, options?: RequestOptions): Promise<Embeddings>;
  };

  models: {
    list(options?: RequestOptions): Promise<ModelList>;
    retrieve(model: string, options?: RequestOptions): Promise<Model>;
  };

  /** 通用请求：调用任意 OpenAI 兼容路径 */
  request<T = unknown>(
    path: string,
    body?: Record<string, unknown> | null,
    options?: RequestOptions
  ): Promise<T>;

  /** 读取一次请求实际路由信息（结果对象或流上附带，非枚举属性） */
  static routeOf(result: unknown): RouteInfo | null;
}

/** 读取一次请求实际路由信息 */
export function routeOf(result: unknown): RouteInfo | null;

export default TarogoAI;