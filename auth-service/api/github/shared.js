const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

export function allowedOrigins() {
  return String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isAllowedOrigin(origin) {
  return allowedOrigins().includes(origin);
}

export function assertOrigin(origin) {
  if (!origin || !isAllowedOrigin(origin)) {
    throw new Error("Origin is not allowed.");
  }
}

export function createState() {
  return crypto.randomUUID().replace(/-/g, "");
}

export function setCookie(res, name, value) {
  const current = res.getHeader("Set-Cookie");
  const next = `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;

  if (!current) {
    res.setHeader("Set-Cookie", [next]);
    return;
  }

  const items = Array.isArray(current) ? current : [current];
  res.setHeader("Set-Cookie", [...items, next]);
}

export function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  const match = raw.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? match[1] : "";
}

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

export function sendAuthResult(res, status, payload, origin) {
  const body = `<!doctype html>
<html lang="en">
  <body>
    <script>
      (function () {
        var message = {
          source: "maobaolong-auth",
          type: ${JSON.stringify(status === "success" ? "github:success" : "github:error")},
          payload: ${JSON.stringify(payload)}
        };
        if (window.opener) {
          window.opener.postMessage(message, ${JSON.stringify(origin)});
        }
        window.close();
      })();
    </script>
  </body>
</html>`;

  res.statusCode = status === "success" ? 200 : 401;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(body);
}

export async function exchangeCodeForToken({ clientId, clientSecret, code }) {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "maobaolong-auth-service"
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code
    })
  });

  return response.json();
}

export { GITHUB_AUTHORIZE_URL };
