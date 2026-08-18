const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

export function allowedOrigins() {
  return String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };

  if (allowedOrigins().includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

export function assertOrigin(origin) {
  if (!origin || !allowedOrigins().includes(origin)) {
    throw new Error("Origin is not allowed.");
  }
}

export function sendJson(res, status, payload, origin) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    res.setHeader(key, value);
  }

  res.end(JSON.stringify(payload, null, 2));
}

export function handlePreflight(req, res) {
  const origin = String(req.headers.origin || "");
  const headers = corsHeaders(origin);
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.statusCode = 204;
  res.end();
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  return raw ? JSON.parse(raw) : {};
}

export async function postForm(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(body).toString()
  });

  return response.json();
}

export async function startDeviceCode(scope) {
  return postForm(DEVICE_CODE_URL, {
    client_id: process.env.GITHUB_CLIENT_ID,
    scope
  });
}

export async function pollAccessToken(deviceCode) {
  return postForm(ACCESS_TOKEN_URL, {
    client_id: process.env.GITHUB_CLIENT_ID,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code"
  });
}
