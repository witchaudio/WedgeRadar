import { getIdeasPayload, jsonResponse } from "./shared/idea-service.mjs";

export default async (req) => {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Use GET for ideas." }, 405);
  }

  const requestUrl = new URL(req.url);
  const payload = await getIdeasPayload({
    category: requestUrl.searchParams.get("category"),
    intensity: requestUrl.searchParams.get("intensity"),
    refresh: requestUrl.searchParams.get("refresh") === "1",
    voterId: req.headers.get("x-voter-id") || "",
  });

  return jsonResponse(payload, 200);
};

export const config = {
  path: "/api/ideas",
};
