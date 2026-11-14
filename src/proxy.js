'use strict';

/**
 * Outbound HTTP plumbing.
 *
 * This agent runs behind an egress proxy. The `ws` library and Node's
 * `https` module do not pick up proxy settings on their own, so every
 * outbound request goes through an explicit HttpsProxyAgent.
 *
 * The proxy URL is sanitized: any embedded username/password is stripped
 * because proxy credentials rotate and stale ones are rejected (407).
 * The proxy accepts credential-less requests, so the sanitized form is
 * the reliable one.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');

const DEFAULT_PROXY_URL = 'http://hatch-egress-proxy:3128';
const SYSTEM_CA_BUNDLE = '/etc/ssl/certs/ca-certificates.crt';

function sanitizeProxyUrl(raw) {
  if (!raw) return DEFAULT_PROXY_URL;
  try {
    const parsed = new URL(raw);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return DEFAULT_PROXY_URL;
  }
}

function proxyUrl() {
  const raw =
    process.env.RADAR_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    DEFAULT_PROXY_URL;
  return sanitizeProxyUrl(raw);
}

let agentSingleton = null;

function proxyAgent() {
  if (agentSingleton) return agentSingleton;
  const options = { keepAlive: true };
  // The egress proxy re-signs TLS with a local CA that lives in the
  // system bundle. When the bundle exists, trust it (it is a superset
  // of the Mozilla roots, so public certificates still verify).
  // When it does not exist, fall back to Node's default trust store.
  try {
    if (fs.existsSync(SYSTEM_CA_BUNDLE)) {
      options.ca = fs.readFileSync(SYSTEM_CA_BUNDLE);
    }
  } catch {
    // Ignore: default trust store will be used.
  }
  agentSingleton = new HttpsProxyAgent(proxyUrl(), options);
  return agentSingleton;
}

function isLocalhost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/**
 * Minimal JSON-capable fetch built on http/https so the proxy agent is
 * always applied explicitly. Returns parsed JSON, or null for empty
 * bodies. Throws on timeout, non-2xx, or invalid JSON.
 */
function fetchJson(url, { method = 'GET', body = null, timeoutMs = 8000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const payload = body === null ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const req = lib.request(
      {
        method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'agentgames-radar/1.0',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
        agent: isLocalhost(parsed.hostname) ? undefined : proxyAgent(),
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode} from ${parsed.hostname}`));
            return;
          }
          if (!text.trim()) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error(`Invalid JSON from ${parsed.hostname}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error(`Timeout after ${timeoutMs}ms: ${parsed.hostname}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { proxyUrl, proxyAgent, fetchJson, DEFAULT_PROXY_URL };
