const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function renderAuthResult(status, content) {
  const body = `<!doctype html>
<html lang="en">
  <body>
    <script>
      (function() {
        function receiveMessage(message) {
          window.opener.postMessage(
            'authorization:github:${status}:${JSON.stringify(content)}',
            message.origin
          );
          window.removeEventListener('message', receiveMessage, false);
          window.close();
        }
        window.addEventListener('message', receiveMessage, false);
        window.opener.postMessage('authorizing:github', '*');
      })();
    </script>
  </body>
</html>`;

  return new Response(body, {
    status: status === "success" ? 200 : 401,
    headers: {
      "content-type": "text/html; charset=utf-8"
    }
  });
}

function createState() {
  return crypto.randomUUID().replace(/-/g, "");
}

function setCookie(headers, name, value) {
  headers.append(
    "set-cookie",
    `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );
}

function getCookie(request, name) {
  const raw = request.headers.get("cookie");
  if (!raw) {
    return "";
  }

  const match = raw.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? match[1] : "";
}

function assertOrigin(origin, allowedOrigin) {
  if (!origin || !allowedOrigin || origin !== allowedOrigin) {
    throw new Error("Origin is not allowed.");
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowedOrigin = env.ALLOWED_ORIGIN;

    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      return jsonResponse(
        {
          error: "Missing worker secrets",
          required: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"]
        },
        500
      );
    }

    if (url.pathname === "/auth") {
      const origin = url.searchParams.get("origin") || allowedOrigin;

      try {
        assertOrigin(origin, allowedOrigin);
      } catch (error) {
        return jsonResponse({ error: error.message }, 403);
      }

      const state = createState();
      const redirectUrl = new URL(GITHUB_AUTHORIZE_URL);
      redirectUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      redirectUrl.searchParams.set("redirect_uri", `${url.origin}/callback`);
      redirectUrl.searchParams.set("scope", "repo user");
      redirectUrl.searchParams.set("state", state);

      const headers = new Headers({
        location: redirectUrl.toString()
      });

      setCookie(headers, "decap_state", state);
      setCookie(headers, "decap_origin", encodeURIComponent(origin));

      return new Response(null, {
        status: 302,
        headers
      });
    }

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const savedState = getCookie(request, "decap_state");
      const origin = decodeURIComponent(getCookie(request, "decap_origin"));

      try {
        assertOrigin(origin, allowedOrigin);
      } catch (error) {
        return renderAuthResult("error", { error: error.message });
      }

      if (!code || !state || !savedState || state !== savedState) {
        return renderAuthResult("error", {
          error: "Invalid or expired OAuth state."
        });
      }

      const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "maobaolong-decap-oauth-worker"
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code
        })
      });

      const result = await tokenResponse.json();

      if (!tokenResponse.ok || result.error || !result.access_token) {
        return renderAuthResult("error", {
          error: result.error || "Unable to fetch GitHub access token."
        });
      }

      return renderAuthResult("success", {
        token: result.access_token,
        provider: "github"
      });
    }

    return jsonResponse({
      service: "maobaolong-decap-oauth-worker",
      endpoints: ["/auth", "/callback"]
    });
  }
};
