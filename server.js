/**
 * DeepSeek Search — 本地演示服务
 *
 * 作用：
 *  1. 托管 public/ 下的静态页面；
 *  2. 作为同源代理转发 /v1/tools/search 与 /v1/tools/fetch，
 *     避免把 API Key 暴露在浏览器网络请求里，也绕过浏览器的跨域限制；
 *  3. 只监听 127.0.0.1，密钥不落盘、不写日志。
 *
 * 仅使用 Node.js 内置模块，无需安装任何依赖（Node >= 20）。
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

await loadEnvFile(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const RAW_SERVER_KEY = (process.env.DEEPSEEK_API_KEY || '').trim();
const SERVER_KEY = !RAW_SERVER_KEY || RAW_SERVER_KEY === 'sk-your-key-here' ? '' : RAW_SERVER_KEY;
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30000);
const MAX_BODY_BYTES = 64 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

class HttpError extends Error {
  constructor(status, message, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* 环境变量：极简 .env 解析（已存在的环境变量优先）                     */
/* ------------------------------------------------------------------ */
async function loadEnvFile(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, '请求体超过大小限制（64 KB）。', 'payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        reject(new HttpError(400, '请求体不能为空。', 'invalid_request_error'));
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('body must be an object');
        }
        resolve(parsed);
      } catch {
        reject(new HttpError(400, '请求体不是合法的 JSON 对象。', 'invalid_request_error'));
      }
    });
    req.on('error', reject);
  });
}

function unicodeLength(value) {
  return [...value].length;
}

function optionalString(value, field, { max = 128, allowNull = true } = {}) {
  if (value === undefined || (value === null && allowNull)) return undefined;
  if (typeof value !== 'string') {
    throw new HttpError(400, `'${field}' 必须是字符串。`, 'invalid_request_error');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    if (allowNull) return undefined;
    throw new HttpError(400, `'${field}' 不能为空。`, 'invalid_request_error');
  }
  if (unicodeLength(trimmed) > max) {
    throw new HttpError(400, `'${field}' 不能超过 ${max} 个字符。`, 'invalid_request_error');
  }
  return trimmed;
}

function normalizeSearch(body) {
  if (typeof body.query !== 'string') {
    throw new HttpError(400, "'query' 是必填字段，且必须是字符串。", 'invalid_request_error');
  }
  const query = body.query.trim();
  if (!query) {
    throw new HttpError(400, "'query' 不能为空或全为空白。", 'invalid_request_error');
  }
  if (unicodeLength(query) > 128) {
    throw new HttpError(400, "'query' 不能超过 128 个字符。", 'invalid_request_error');
  }

  const payload = { query };

  if (body.count !== undefined && body.count !== null) {
    if (!Number.isInteger(body.count) || body.count < 1 || body.count > 50) {
      throw new HttpError(400, "'count' 必须是 1 到 50 之间的整数。", 'invalid_request_error');
    }
    payload.count = body.count;
  }

  const oriQuestion = optionalString(body.ori_question, 'ori_question', { max: 128 });
  if (oriQuestion !== undefined) payload.ori_question = oriQuestion;

  const localization = optionalString(body.localization, 'localization', { max: 128 });
  if (localization !== undefined) payload.localization = localization;

  if (body.need_content !== undefined && body.need_content !== null) {
    if (typeof body.need_content !== 'boolean') {
      throw new HttpError(400, "'need_content' 必须是布尔值。", 'invalid_request_error');
    }
    payload.need_content = body.need_content;
  }

  return payload;
}

function normalizeFetch(body) {
  if (typeof body.url !== 'string' || !body.url.trim()) {
    throw new HttpError(400, "'url' 是必填字段，且必须是非空字符串。", 'invalid_request_error');
  }
  const value = body.url.trim();
  if (value.length > 8192) {
    throw new HttpError(400, "'url' 不能超过 8192 个字符。", 'invalid_request_error');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError(400, "'url' 不是合法的 URL。", 'invalid_request_error');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError(400, "'url' 必须是 http 或 https 地址。", 'invalid_request_error');
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new HttpError(400, "'url' 必须包含 host，且不能携带用户名或密码。", 'invalid_request_error');
  }
  return { url: value };
}

/** 优先使用用户自带 Key，其次使用服务端环境变量。 */
function resolveKey(req) {
  const headerKey = req.headers['x-deepseek-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) return headerKey.trim();
  return SERVER_KEY;
}

async function callUpstream(pathname, payload, apiKey) {
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(`${BASE_URL}${pathname}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'deepseek-search-playground/1.0',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new HttpError(
      timedOut ? 504 : 502,
      timedOut
        ? `DeepSeek API 响应超时（${Math.round(REQUEST_TIMEOUT_MS / 1000)} 秒），请稍后重试。`
        : '无法连接 DeepSeek API，请检查本机网络或 DEEPSEEK_BASE_URL 配置。',
      timedOut ? 'upstream_timeout' : 'upstream_unreachable',
    );
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message =
      (data && data.error && typeof data.error.message === 'string' && data.error.message) ||
      `DeepSeek API 返回 HTTP ${response.status}。`;
    const code =
      (data && data.error && data.error.code) || (response.status === 429 ? 'rate_limited' : 'upstream_error');
    throw new HttpError(response.status, message, code);
  }

  if (!data || typeof data !== 'object') {
    throw new HttpError(502, 'DeepSeek API 返回了无法解析的响应。', 'bad_upstream_response');
  }

  return { data, elapsedMs: Date.now() - startedAt };
}

/* ------------------------------------------------------------------ */
/* 静态文件                                                            */
/* ------------------------------------------------------------------ */
async function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendText(res, 400, 'Bad Request');
    return;
  }

  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  if (relative.includes('\0') || relative.split('/').includes('..')) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  let info;
  try {
    info = await stat(filePath);
  } catch {
    sendText(res, 404, 'Not Found');
    return;
  }
  if (!info.isFile()) {
    sendText(res, 404, 'Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  const cacheControl = ext === '.html' ? 'no-cache' : 'public, max-age=300';

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': contentType,
      'Content-Length': body.length,
      'Cache-Control': cacheControl,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    sendText(res, 500, 'Internal Server Error');
  }
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  let pathname = '/';
  try {
    pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
  } catch {
    sendText(res, 400, 'Bad Request');
    return;
  }

  try {
    if (req.method === 'GET' && pathname === '/api/config') {
      sendJson(res, 200, {
        hasServerKey: Boolean(SERVER_KEY),
        keySource: SERVER_KEY ? 'server' : 'client',
        maxCount: 50,
        defaultCount: 10,
        docsUrl: 'https://api-docs.deepseek.com/zh-cn/api/search',
        guideUrl: 'https://api-docs.deepseek.com/zh-cn/guides/search',
        upstream: new URL(BASE_URL).host,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { ok: true, hasServerKey: Boolean(SERVER_KEY), uptime: process.uptime() });
      return;
    }

    if (pathname === '/api/search') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        sendJson(res, 405, { error: { message: '仅支持 POST 请求。', type: 'invalid_request_error', param: null, code: 'method_not_allowed' } });
        return;
      }
      const apiKey = resolveKey(req);
      if (!apiKey) {
        throw new HttpError(401, '尚未配置 API Key。请点击右上角「API Key」填入，或在 .env 中设置 DEEPSEEK_API_KEY。', 'missing_api_key');
      }
      const payload = normalizeSearch(await readJsonBody(req));
      const { data, elapsedMs } = await callUpstream('/v1/tools/search', payload, apiKey);
      sendJson(res, 200, { ...data, elapsed_ms: elapsedMs });
      return;
    }

    if (pathname === '/api/fetch') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        sendJson(res, 405, { error: { message: '仅支持 POST 请求。', type: 'invalid_request_error', param: null, code: 'method_not_allowed' } });
        return;
      }
      const apiKey = resolveKey(req);
      if (!apiKey) {
        throw new HttpError(401, '尚未配置 API Key。请点击右上角「API Key」填入，或在 .env 中设置 DEEPSEEK_API_KEY。', 'missing_api_key');
      }
      const payload = normalizeFetch(await readJsonBody(req));
      const { data, elapsedMs } = await callUpstream('/v1/tools/fetch', payload, apiKey);
      sendJson(res, 200, { ...data, elapsed_ms: elapsedMs });
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: { message: '接口不存在。', type: 'invalid_request_error', param: null, code: 'not_found' } });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendText(res, 405, 'Method Not Allowed');
      return;
    }

    await serveStatic(req, res, pathname);
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error instanceof HttpError) {
      sendJson(res, error.status, {
        error: {
          message: error.message,
          type: error.status === 401 ? 'authentication_error' : 'invalid_request_error',
          param: null,
          code: error.code,
        },
      });
      return;
    }
    console.error('[server] unexpected error:', error);
    sendJson(res, 500, {
      error: { message: '本地服务发生内部错误，请查看终端日志。', type: 'server_error', param: null, code: 'internal_error' },
    });
  } finally {
    const ms = Date.now() - startedAt;
    if (ms > 1500) console.log(`[slow] ${req.method} ${pathname} ${ms}ms`);
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。请设置 PORT 环境变量后重试，例如：PORT=8788 npm start`);
    process.exit(1);
  }
  console.error('[server] failed:', error);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  DeepSeek Search · 本地演示');
  console.log(`  ➜  页面：http://${HOST}:${PORT}`);
  console.log(`  ➜  上游：${BASE_URL}`);
  console.log(`  ➜  密钥：${SERVER_KEY ? '已由服务端环境变量提供' : '未配置（可在页面右上角填写）'}`);
  if (RAW_SERVER_KEY && !SERVER_KEY) {
    console.log('  ⚠  .env 中的 DEEPSEEK_API_KEY 仍是示例占位值，请在页面中填写或替换它。');
  }
  console.log('');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\n[server] 正在关闭…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
