export class NotFoundError extends Error { //404
    readonly  statusCode = 404;
  constructor(message: string) {
    super(message);
  }
}
export class ForbiddenError extends Error { //403

   readonly  statusCode = 403;
  constructor(message: string) {
    super(message);
  }
}
export class UnauthorizedError extends Error { //401
    statusCode = 401;
  constructor(message: string) {
    super(message);
  }
}
export class BadRequestError extends Error { //400
    readonly statusCode = 400;
    readonly details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.details = details;
  }
}
export class ServiceUnavailableError extends Error { //503
  readonly statusCode = 503;

  constructor(message: string) {
    super(message);
  }
}