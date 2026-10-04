// Throw these from your code; the API layer maps them to HTTP codes.
export class NotFoundError extends Error {
  readonly status = 404;
}
export class ConflictError extends Error {
  readonly status = 409;
}
export class InvalidTransitionError extends Error {
  readonly status = 422;
}
export class ValidationError extends Error {
  readonly status = 400;
  constructor(message: string, readonly issues: unknown = undefined) {
    super(message);
  }
}
export class UnauthorizedError extends Error {
  readonly status = 401;
}
export class ConflictStateError extends Error {
  readonly status = 409;
}
export class ForbiddenError extends Error {
  readonly status = 403;
}
export class ServiceUnavailableError extends Error {
  readonly status = 503;
}
export class TooManyRequestsError extends Error {
  readonly status = 429;
  constructor(message: string, readonly retryAfterSeconds?: number) {
    super(message);
  }
}
