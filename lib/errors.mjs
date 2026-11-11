// One small error type for the web surfaces. Only HttpError messages with a status below 500 are ever sent to a client;
// everything else becomes a logged, generic 500.
export class HttpError extends Error {
  constructor(status, message, opts = {}) { super(message, opts); this.name = 'HttpError'; this.status = status; this.expose = status < 500; }
}
export const badRequest = (m) => new HttpError(400, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const tooLarge = () => new HttpError(413, 'too large');
// A request body that must be a JSON object. A syntax error here IS the client's mistake, so it is answered as one (400) at the place the
// body is read. A SyntaxError anywhere else (damaged stored data, say) is a server fault and must not be blamed on the client (audit F-15).
export function parseJsonObject(text) {
  let v;
  try { v = JSON.parse(text || '{}'); } catch { throw badRequest('Body is not valid JSON'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest('Expected a JSON object');
  return v;
}

// Turns anything thrown into { status, body }.
export function toResponse(e) {
  if (e instanceof HttpError && e.expose) return { status: e.status, body: { error: e.message } };
  return { status: 500, body: { error: 'internal error' } };
}
