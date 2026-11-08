// One small error type for the web surfaces. Only HttpError messages with a status below 500 are ever sent to a client;
// everything else becomes a logged, generic 500.
export class HttpError extends Error {
  constructor(status, message, opts = {}) { super(message, opts); this.name = 'HttpError'; this.status = status; this.expose = status < 500; }
}
export const badRequest = (m) => new HttpError(400, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const tooLarge = () => new HttpError(413, 'too large');

// Turns anything thrown into { status, body }.
export function toResponse(e) {
  if (e instanceof HttpError && e.expose) return { status: e.status, body: { error: e.message } };
  if (e instanceof SyntaxError) return { status: 400, body: { error: 'bad request' } };
  return { status: 500, body: { error: 'internal error' } };
}
