import TarogoAI from './index.js';

const { routeOf } = TarogoAI;

const {
  TarogoAIError,
  APIConnectionError,
  BadRequestError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  RateLimitError,
  InternalServerError,
} = TarogoAI;

export default TarogoAI;
export {
  routeOf,
  TarogoAIError,
  APIConnectionError,
  BadRequestError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  RateLimitError,
  InternalServerError,
};