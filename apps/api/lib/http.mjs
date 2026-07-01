import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
};

/**
 * Apply security response headers required for enterprise deployments.
 * Called automatically by sendJson / sendText so all API endpoints are covered.
 */
export function applySecureHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // Modern browsers ignore X-XSS-Protection; set to 0 to disable the legacy scanner.
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // API responses must never be cached by proxy or browser.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
}

export function sendJson(res, statusCode, payload) {
  applySecureHeaders(res);
  const body = Buffer.from(JSON.stringify(payload, null, 2));
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
  });
  res.end(body);
}

export function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  applySecureHeaders(res);
  const body = Buffer.from(text);
  res.writeHead(statusCode, {
    'content-type': contentType,
    'content-length': body.length,
  });
  res.end(body);
}

export async function sendFile(res, filePath, contentType) {
  const body = await readFile(filePath);
  // Static assets may be cached by the browser for 1 hour.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.writeHead(200, {
    'content-type': contentType || mimeFor(filePath),
    'content-length': body.length,
  });
  res.end(body);
}

export function mimeFor(filePath) {
  return MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

export function safeJoin(root, relativePath) {
  const joined = join(root, relativePath);
  if (!joined.startsWith(root)) {
    throw new Error('Invalid path');
  }
  return joined;
}

export async function readBody(req, limitBytes = 8 * 1024 * 1024) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJsonBody(req, limitBytes = 8 * 1024 * 1024) {
  const raw = await readBody(req, limitBytes);
  if (!raw.length) {
    return {};
  }
  return JSON.parse(raw.toString('utf8'));
}

export function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf('=');
      if (index === -1) return acc;
      const key = part.slice(0, index).trim();
      const value = decodeURIComponent(part.slice(index + 1).trim());
      acc[key] = value;
      return acc;
    }, {});
}

export function setCookie(res, name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  segments.push(`Path=${options.path || '/'}`);
  if (options.httpOnly !== false) segments.push('HttpOnly');
  if (options.sameSite) {
    segments.push(`SameSite=${options.sameSite}`);
  } else {
    segments.push('SameSite=Lax');
  }
  if (options.maxAge != null) segments.push(`Max-Age=${options.maxAge}`);
  if (options.secure) segments.push('Secure');
  const existing = res.getHeader('set-cookie');
  const next = Array.isArray(existing) ? [...existing, segments.join('; ')] : [segments.join('; ')];
  res.setHeader('Set-Cookie', next);
}

export function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0 });
}

export function getIpAddress(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

export function notFound(res) {
  sendJson(res, 404, { error: 'Not found' });
}

export function badRequest(res, message) {
  sendJson(res, 400, { error: message || 'Bad request' });
}

export function unauthorized(res, message = 'Unauthorized') {
  sendJson(res, 401, { error: message });
}

export function forbidden(res, message = 'Forbidden') {
  sendJson(res, 403, { error: message });
}
