'use strict';

/** TarogoAI 统一错误基类 */
class TarogoAIError extends Error {
  /**
   * @param {string} message
   * @param {number|null} [status] HTTP 状态码
   * @param {*} [body] 服务端返回的错误体
   * @param {Headers|null} [headers] 响应头
   */
  constructor(message, status = null, body = null, headers = null) {
    super(message);
    this.name = 'TarogoAIError';
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

class APIConnectionError extends TarogoAIError {
  constructor(message) {
    super(message);
    this.name = 'APIConnectionError';
  }
}

class BadRequestError extends TarogoAIError {}
class AuthenticationError extends TarogoAIError {}
class PermissionDeniedError extends TarogoAIError {}
class NotFoundError extends TarogoAIError {}
class RateLimitError extends TarogoAIError {}
class InternalServerError extends TarogoAIError {}

/** 根据 HTTP 状态码生成对应的错误类型 */
function createError(status, message, body, headers) {
  const map = {
    400: BadRequestError,
    401: AuthenticationError,
    403: PermissionDeniedError,
    404: NotFoundError,
    408: TarogoAIError,
    409: TarogoAIError,
    413: BadRequestError,
    422: BadRequestError,
    429: RateLimitError,
    500: InternalServerError,
    502: InternalServerError,
    503: InternalServerError,
    504: InternalServerError,
  };
  const Cls = map[status] || TarogoAIError;
  const err = new Cls(message, status, body, headers);
  err.status = status;
  return err;
}

module.exports = {
  TarogoAIError,
  APIConnectionError,
  BadRequestError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  RateLimitError,
  InternalServerError,
  createError,
};