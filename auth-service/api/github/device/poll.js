import {
  assertOrigin,
  handlePreflight,
  pollAccessToken,
  readJsonBody,
  sendJson
} from "../shared.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    handlePreflight(req, res);
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed." }, req.headers.origin);
    return;
  }

  try {
    assertOrigin(String(req.headers.origin || ""));
  } catch (error) {
    sendJson(res, 403, { error: error.message }, req.headers.origin);
    return;
  }

  try {
    const body = await readJsonBody(req);
    const deviceCode = String(body?.deviceCode || "");
    if (!deviceCode) {
      sendJson(res, 400, { error: "Missing deviceCode." }, req.headers.origin);
      return;
    }

    const payload = await pollAccessToken(deviceCode);
    if (payload.error) {
      const status =
        payload.error === "authorization_pending" || payload.error === "slow_down"
          ? 200
          : 400;
      sendJson(res, status, payload, req.headers.origin);
      return;
    }

    sendJson(res, 200, payload, req.headers.origin);
  } catch (error) {
    sendJson(
      res,
      500,
      { error: error.message || "Failed to poll GitHub access token." },
      req.headers.origin
    );
  }
}
