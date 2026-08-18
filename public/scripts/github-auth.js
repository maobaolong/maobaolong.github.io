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

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(
      payload.error_description || payload.error || "GitHub 授权请求失败。"
    );
    error.code = payload.error || "";
    error.payload = payload;
    throw error;
  }

  return payload;
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

export async function startDeviceFlowLogin(config, callbacks = {}) {
  if (!config.authBaseUrl) {
    throw new Error("缺少 GitHub 授权服务地址。");
  }

  const popup = window.open("https://github.com/login/device", "_blank");
  const startUrl = new URL("/api/github/device/start", config.authBaseUrl);
  const device = await postJson(startUrl.toString(), {
    scope: config.scope || "public_repo read:user"
  });

  callbacks.onCode?.(device);

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(device.user_code);
    }
  } catch {
    // Ignore clipboard failures. The code is still visible in the UI.
  }

  if (popup) {
    try {
      popup.location.href = device.verification_uri;
    } catch {
      // Ignore cross-window assignment issues and rely on the initial URL.
    }
    popup.focus();
  }

  const pollUrl = new URL("/api/github/device/poll", config.authBaseUrl);
  const startedAt = Date.now();
  let intervalMs = Math.max(5, device.interval || 5) * 1000;

  while (Date.now() - startedAt < device.expires_in * 1000) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    const tokenPayload = await postJson(pollUrl.toString(), {
      deviceCode: device.device_code
    }).catch((error) => {
      const code = String(error.code || error.payload?.error || "");
      const message = String(error.message || "");
      if (code === "authorization_pending" || message.includes("authorization request is still pending")) {
        return { authorization_pending: true };
      }
      if (code === "slow_down" || message.includes("slow down")) {
        intervalMs += 5000;
        return { slow_down: true };
      }
      if (code === "expired_token") {
        throw new Error("GitHub 验证码已过期，请重新发起登录。");
      }
      if (code === "access_denied") {
        throw new Error("GitHub 授权被取消。");
      }
      throw error;
    });

    if (
      !tokenPayload ||
      tokenPayload.authorization_pending ||
      tokenPayload.slow_down ||
      tokenPayload.error === "authorization_pending" ||
      tokenPayload.error === "slow_down"
    ) {
      continue;
    }

    if (tokenPayload.error === "expired_token") {
      throw new Error("GitHub 验证码已过期，请重新发起登录。");
    }

    if (tokenPayload.error === "access_denied") {
      throw new Error("GitHub 授权被取消。");
    }

    const accessToken = tokenPayload.access_token;
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

  throw new Error("GitHub 登录超时，请重试。");
}
