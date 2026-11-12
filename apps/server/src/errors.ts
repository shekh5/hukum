/**
 * An error whose `message` is safe to show the user. The global error handler sends
 * `{ error: message }` with `statusCode`; any other error becomes a generic 500.
 * `cause` (the original error) is logged but never sent to the client.
 */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ApiError';
  }
}

/** Map any thrown value to a status + message that is safe to show the user. */
export function toPublicError(error: unknown): { statusCode: number; message: string } {
  if (error instanceof ApiError) return { statusCode: error.statusCode, message: error.message };

  const statusCode = statusOf(error);
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;

  if (code === 'FST_REQ_FILE_TOO_LARGE') {
    return { statusCode: 413, message: 'Recording too long - the limit is 10 MB.' };
  }
  if (code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
    return { statusCode: 415, message: 'Send the request as multipart/form-data.' };
  }
  if (statusCode === 413) return { statusCode, message: 'Upload has too many files or fields.' };
  if (statusCode === 429) {
    return { statusCode, message: 'Too many requests - wait a minute and try again.' };
  }
  if (statusCode >= 400 && statusCode < 500) {
    // Fastify's own 4xx messages describe the client's mistake and contain no secrets.
    const message = error instanceof Error ? error.message : 'Bad request.';
    return { statusCode, message };
  }
  return { statusCode: 500, message: 'Something went wrong on the server.' };
}

/** HTTP status carried by an error (Fastify errors and plugins set `statusCode`), else 500. */
function statusOf(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const { statusCode } = error;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600) return statusCode;
  }
  return 500;
}
