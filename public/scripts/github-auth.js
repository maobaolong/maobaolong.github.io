const STORAGE_KEY = "maobaolong-github-session";
const API_VERSION = "2022-11-28";

function parseJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) {
      return null;
    }

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalized));
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function buildPopupFeatures() {
  const width = 720;
  const height = 860;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));

  return `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
}

function openAuthPopup(url) {
  const popup = window.open(url, "maobaolong-github-auth", buildPopupFeatures());
  if (!popup) {
    throw new Error("浏览器拦截了登录弹窗，请允许弹窗后重试。");
  }

  popup.focus();
  return popup;
}

function waitForPopupMessage(popup, authBaseUrl) {
  return new Promise((resolve, reject) => {
    const expectedOrigin = new URL(authBaseUrl).origin;
    const timer = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error("GitHub 登录窗口已关闭。"));
      }
    }, 500);

    const cleanup = () => {
      window.clearInterval(timer);
      window.removeEventListener("message", onMessage);
    };

    const onMessage = (event) => {
      if (event.origin !== expectedOrigin) {
        return;
      }

      const data = event.data;
      if (!data || data.source !== "maobaolong-auth") {
        return;
      }

      cleanup();

      if (data.type === "github:success") {
        resolve(data.payload);
        return;
      }

      reject(new Error(data.payload?.error || "GitHub 授权失败。"));
    };

    window.addEventListener("message", onMessage);
  });
}

export function getStoredSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveStoredSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isSessionExpired(session) {
  if (!session?.expiresAt) {
    return false;
  }

  return Date.now() >= new Date(session.expiresAt).getTime() - 60_000;
}

export async function githubJson(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", options.accept || "application/vnd.github.full+json");
  headers.set("X-GitHub-Api-Version", API_VERSION);

  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.error_description ||
      payload?.error ||
      response.statusText;
    throw new Error(message);
  }

  return payload;
}

export async function fetchGitHubUser(accessToken) {
  const user = await githubJson("https://api.github.com/user", {
    token: accessToken,
    accept: "application/vnd.github+json"
  });

  return {
    login: user.login,
    avatarUrl: user.avatar_url,
    htmlUrl: user.html_url,
    name: user.name || user.login
  };
}

export async function getActiveSession() {
  const session = getStoredSession();
  if (!session) {
    return null;
  }

  if (isSessionExpired(session)) {
    clearStoredSession();
    return null;
  }

  return session;
}

export async function startWebFlowLogin(config, callbacks = {}) {
  if (!config.authBaseUrl) {
    throw new Error("缺少 GitHub 授权服务地址。");
  }

  const authUrl = new URL("/api/github/auth", config.authBaseUrl);
  authUrl.searchParams.set("origin", window.location.origin);
  authUrl.searchParams.set("scope", config.scope || "public_repo read:user");

  callbacks.onOpen?.();
  const popup = openAuthPopup(authUrl.toString());
  const tokenPayload = await waitForPopupMessage(popup, config.authBaseUrl);
  const accessToken = tokenPayload.accessToken || tokenPayload.access_token;
  const expiresAt = tokenPayload.expires_in
    ? new Date(Date.now() + tokenPayload.expires_in * 1000).toISOString()
    : null;
  const user = await fetchGitHubUser(accessToken);
  const tokenDetails = parseJwtPayload(accessToken);

  const session = {
    accessToken,
    scope: tokenPayload.scope || config.scope,
    tokenType: tokenPayload.token_type || "bearer",
    expiresAt,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    user,
    tokenDetails
  };

  saveStoredSession(session);
  callbacks.onSuccess?.(session);
  return session;
}
