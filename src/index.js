'use strict';

const { TarogoAI } = require('./client');
const {
  TarogoAIError,
  APIConnectionError,
  BadRequestError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  RateLimitError,
  InternalServerError,
} = require('./errors');

module.exports = TarogoAI;
module.exports.TarogoAI = TarogoAI;
module.exports.routeOf = TarogoAI.routeOf;
module.exports.TarogoAIError = TarogoAIError;
module.exports.APIConnectionError = APIConnectionError;
module.exports.BadRequestError = BadRequestError;
module.exports.AuthenticationError = AuthenticationError;
module.exports.PermissionDeniedError = PermissionDeniedError;
module.exports.NotFoundError = NotFoundError;
module.exports.RateLimitError = RateLimitError;
module.exports.InternalServerError = InternalServerError;