import {
  GITHUB_AUTHORIZE_URL,
  assertOrigin,
  createState,
  sendJson,
  setCookie
} from "./shared.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    sendJson(res, 500, {
      error: "Missing service secrets.",
      required: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"]
    });
    return;
  }

  const origin = String(req.query.origin || "");
  const scope = String(req.query.scope || "public_repo read:user");

  try {
    assertOrigin(origin);
  } catch (error) {
    sendJson(res, 403, { error: error.message });
    return;
  }

  const state = createState();
  const serviceOrigin = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;
  const redirectUrl = new URL(GITHUB_AUTHORIZE_URL);
  redirectUrl.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID);
  redirectUrl.searchParams.set("redirect_uri", `${serviceOrigin}/api/github/callback`);
  redirectUrl.searchParams.set("scope", scope);
  redirectUrl.searchParams.set("state", state);

  setCookie(res, "mb_state", state);
  setCookie(res, "mb_origin", encodeURIComponent(origin));
  res.statusCode = 302;
  res.setHeader("Location", redirectUrl.toString());
  res.end();
}
