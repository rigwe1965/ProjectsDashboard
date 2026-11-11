// The product guides: one Markdown file per product in guides/<product>.md, written (or at least confirmed) by the owner. The AI guide may only
// say what is in the file. A product with no usable file has no guide. A file still marked as a draft (a line containing TODO(owner)) is not used,
// so text nobody has checked can never reach a customer.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../../lib/config.mjs';

export const GUIDES_DIR = join(root, 'guides');
export const MIN_CHARS = 200;
export const MAX_CHARS = 24000; // about 6,000 tokens: it is sent with every message, so it is kept small
const BOM = new RegExp('^' + String.fromCharCode(0xfeff));
export const DRAFT_MARK = 'TODO(owner)';

// -> { ok: true, text } or { ok: false, why: 'bad-id' | 'missing' | 'unreadable' | 'draft' | 'too-small' | 'too-big' }
export function loadGuide(product, dir = GUIDES_DIR) {
  if (typeof product !== 'string' || !/^[\w-]{1,60}$/.test(product)) return { ok: false, why: 'bad-id' }; // the id becomes part of a file name
  let raw;
  try { raw = readFileSync(join(dir, product + '.md'), 'utf8'); } catch (err) { return { ok: false, why: err?.code === 'ENOENT' ? 'missing' : 'unreadable' }; }
  const text = raw.replace(BOM, '').replace(/\r\n?/g, '\n').trim();
  if (text.includes(DRAFT_MARK)) return { ok: false, why: 'draft' };
  if (text.length < MIN_CHARS) return { ok: false, why: 'too-small' };
  if (text.length > MAX_CHARS) return { ok: false, why: 'too-big' };
  return { ok: true, text };
}
