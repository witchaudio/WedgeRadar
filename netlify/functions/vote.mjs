import { applyVote, jsonResponse } from "./shared/idea-service.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Use POST for votes." }, 405);
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Vote request body is invalid." }, 400);
  }

  const result = await applyVote({
    ideaId: body.ideaId,
    voterId: body.voterId || req.headers.get("x-voter-id") || "",
    direction: body.direction,
  });

  if (result.error) {
    return jsonResponse({ error: result.error }, 400);
  }

  return jsonResponse(result, 200);
};

export const config = {
  path: "/api/vote",
};
