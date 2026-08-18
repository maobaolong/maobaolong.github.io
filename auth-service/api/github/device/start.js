import {
  assertOrigin,
  handlePreflight,
  readJsonBody,
  sendJson,
  startDeviceCode
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

  if (!process.env.GITHUB_CLIENT_ID) {
    sendJson(
      res,
      500,
      { error: "Missing GITHUB_CLIENT_ID." },
      req.headers.origin
    );
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
    const scope = String(body?.scope || "public_repo read:user");
    const payload = await startDeviceCode(scope);
    if (payload.error) {
      sendJson(res, 400, payload, req.headers.origin);
      return;
    }

    sendJson(res, 200, payload, req.headers.origin);
  } catch (error) {
    sendJson(
      res,
      500,
      { error: error.message || "Failed to start GitHub device flow." },
      req.headers.origin
    );
  }
}
