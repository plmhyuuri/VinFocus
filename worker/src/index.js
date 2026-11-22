const ALLOWED_HOSTS = new Set(["lms-lti-timetables.vinschool.edu.vn"]);
const ALLOWED_METHODS = new Set(["GET", "POST", "HEAD"]);

const DROP_REQUEST_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "upgrade",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
]);

const DROP_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function timingSafeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function copyRequestHeaders(input) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(input || {})) {
    const lower = name.toLowerCase();
    if (DROP_REQUEST_HEADERS.has(lower)) {
      continue;
    }
    if (lower.startsWith("cf-") || lower.startsWith("x-forwarded-")) {
      continue;
    }
    try {
      headers.set(name, String(value));
    } catch {
      // Ignore headers the Workers runtime refuses to set.
    }
  }
  return headers;
}

function copyResponseHeaders(headers) {
  const result = {};
  for (const [name, value] of headers) {
    const lower = name.toLowerCase();
    if (DROP_RESPONSE_HEADERS.has(lower)) {
      continue;
    }
    result[lower] = value;
  }
  return result;
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405);
    }

    const expectedKey = env.RELAY_KEY;
    if (!expectedKey) {
      return jsonResponse({ error: "relay_key_not_configured" }, 500);
    }

    const providedKey = request.headers.get("x-relay-key") || "";
    if (!timingSafeEqual(providedKey, expectedKey)) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }

    if (!payload || typeof payload !== "object") {
      return jsonResponse({ error: "invalid_payload" }, 400);
    }

    let target;
    try {
      target = new URL(String(payload.url || ""));
    } catch {
      return jsonResponse({ error: "invalid_target" }, 400);
    }

    if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
      return jsonResponse({ error: "target_not_allowed" }, 403);
    }

    const method = String(payload.method || "GET").toUpperCase();
    if (!ALLOWED_METHODS.has(method)) {
      return jsonResponse({ error: "method_not_allowed" }, 405);
    }

    const headers = copyRequestHeaders(payload.headers);
    let body;

    if (method !== "GET" && method !== "HEAD" && payload.body != null) {
      if (payload.bodyEncoding === "base64") {
        try {
          body = fromBase64(String(payload.body));
        } catch {
          return jsonResponse({ error: "invalid_body" }, 400);
        }
      } else {
        body = String(payload.body);
      }
    }

    let upstream;
    try {
      upstream = await fetch(target.toString(), {
        method,
        headers,
        body,
        redirect: "manual",
      });
    } catch (error) {
      const detail = error && error.message ? error.message : String(error);
      return jsonResponse(
        { error: "upstream_fetch_failed", detail },
        502,
      );
    }

    const setCookie = typeof upstream.headers.getSetCookie === "function"
      ? upstream.headers.getSetCookie()
      : (upstream.headers.get("set-cookie")
        ? [upstream.headers.get("set-cookie")]
        : []);
    const buffer = await upstream.arrayBuffer();

    return jsonResponse({
      status: upstream.status,
      url: upstream.url || target.toString(),
      headers: copyResponseHeaders(upstream.headers),
      setCookie,
      bodyEncoding: "base64",
      body: toBase64(buffer),
    });
  },
};
