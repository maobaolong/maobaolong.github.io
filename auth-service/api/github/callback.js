import {
  assertOrigin,
  exchangeCodeForToken,
  getCookie,
  sendAuthResult
} from "./shared.js";

export default async function handler(req, res) {
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  const savedState = getCookie(req, "mb_state");
  const origin = decodeURIComponent(getCookie(req, "mb_origin") || "");

  try {
    assertOrigin(origin);
  } catch (error) {
    sendAuthResult(res, "error", { error: error.message }, origin || "*");
    return;
  }

  if (!code || !state || !savedState || state !== savedState) {
    sendAuthResult(
      res,
      "error",
      { error: "Invalid or expired OAuth state." },
      origin
    );
    return;
  }

  const tokenResult = await exchangeCodeForToken({
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    code
  });

  if (tokenResult.error || !tokenResult.access_token) {
    sendAuthResult(
      res,
      "error",
      {
        error:
          tokenResult.error_description ||
          tokenResult.error ||
          "Unable to fetch GitHub token."
      },
      origin
    );
    return;
  }

  sendAuthResult(
    res,
    "success",
    {
      accessToken: tokenResult.access_token,
      scope: tokenResult.scope || "public_repo read:user",
      token_type: tokenResult.token_type || "bearer"
    },
    origin
  );
}
