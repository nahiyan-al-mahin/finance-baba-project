'use strict';

/** An error whose `code` is safe to send to the client (the UI translates it). */
class AppError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

module.exports = { AppError };
