import http from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";

loadEnvFiles();

const rootDir = process.cwd();
const publicDir = path.join(rootDir, "public");
const cacheDir = path.join(rootDir, ".cache");
const cacheFile = path.join(cacheDir, "ideas.json");
const votesFile = path.join(cacheDir, "votes.json");
const port = Number.parseInt(process.env.PORT || "3000", 10);
const cacheVersion = "v5";

const CATEGORY_CONFIG = {
  all: {
    label: "All",
    searchQuery:
      '"seo" OR "saas" OR "app growth" OR "startup idea" OR "AI workflow"',
    redditQuery: "seo saas app growth startup ideas",
    hnQuery: "AI growth SaaS startup SEO",
    githubQuery: "seo saas app growth automation AI",
    audiences: ["founders", "growth teams", "small agencies", "operators"],
    channels: ["founder Twitter threads", "SEO communities", "product demos", "micro-tools"],
  },
  seo: {
    label: "SEO",
    searchQuery:
      '"SEO" OR "Google update" OR "search traffic" OR "content brief" OR "keyword gap"',
    redditQuery: "SEO Google update keyword content traffic",
    hnQuery: "SEO search traffic AI content",
    githubQuery: "SEO search analytics ranking content",
    audiences: ["content teams", "agencies", "local businesses", "solo marketers"],
    channels: ["SEO newsletters", "agency partnerships", "free site audits", "search communities"],
  },
  aso: {
    label: "ASO",
    searchQuery:
      '"app store optimization" OR "mobile growth" OR "subscription app" OR "app retention" OR "app screenshots"',
    redditQuery: '"app store optimization" mobile growth retention subscription app',
    hnQuery: "mobile app growth retention App Store",
    githubQuery: "mobile analytics app store growth ASO",
    audiences: ["mobile founders", "subscription apps", "game studios", "growth managers"],
    channels: ["indie hacker demos", "app teardown content", "growth audits", "mobile dev communities"],
  },
  saas: {
    label: "SaaS",
    searchQuery:
      '"B2B SaaS" OR "AI workflow" OR "automation startup" OR "customer support AI" OR "vertical SaaS"',
    redditQuery: '"B2B SaaS" automation AI workflow startup',
    hnQuery: "B2B SaaS AI automation startup",
    githubQuery: "automation workflow AI b2b saas",
    audiences: ["operations teams", "vertical software buyers", "support teams", "small business owners"],
    channels: ["cold outbound with live demos", "partner agencies", "ROI calculators", "niche communities"],
  },
};

const INTENSITY_BANDS = [
  {
    key: "grounded",
    label: "Normal",
    min: 0,
    max: 24,
    temperature: 0.55,
    promptStyle:
      "Keep the ideas practical, easy to explain, and close to clear market demand.",
  },
  {
    key: "bold",
    label: "Fresh",
    min: 25,
    max: 49,
    temperature: 0.8,
    promptStyle:
      "Keep the ideas realistic, but push into sharper positioning and stronger differentiation.",
  },
  {
    key: "wild",
    label: "Bold",
    min: 50,
    max: 74,
    temperature: 1,
    promptStyle:
      "Allow unusual combinations of trends if they still sound buildable and sellable.",
  },
  {
    key: "chaotic",
    label: "Crazy",
    min: 75,
    max: 100,
    temperature: 1.15,
    promptStyle:
      "Go weird and memorable, but keep one believable business angle in each idea.",
  },
];

const SOURCE_META = {
  google: { label: "Google", baseScore: 92 },
  x: { label: "X", baseScore: 88 },
  hackernews: { label: "Hacker News", baseScore: 84 },
  reddit: { label: "Reddit", baseScore: 78 },
  github: { label: "GitHub", baseScore: 72 },
  fallback: { label: "Backup", baseScore: 56 },
};

const STATIC_FILES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (requestUrl.pathname === "/api/ideas") {
      await handleIdeasRequest(req, requestUrl, res);
      return;
    }

    if (requestUrl.pathname === "/api/vote") {
      await handleVoteRequest(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, now: new Date().toISOString() });
      return;
    }

    await serveStaticFile(requestUrl.pathname, res);
  } catch (error) {
    sendJson(res, 500, {
      error: "Unexpected server error.",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

server.listen(port, () => {
  console.log(`Idea Machine running at http://localhost:${port}`);
});

async function handleIdeasRequest(req, requestUrl, res) {
  const voterId = normalizeVoterId(req.headers["x-voter-id"]);
  const category = normalizeCategory(requestUrl.searchParams.get("category"));
  const intensityValue = clamp(Number.parseInt(requestUrl.searchParams.get("intensity") || "12", 10), 0, 100);
  const intensityBand = getIntensityBand(intensityValue);
  const refresh = requestUrl.searchParams.get("refresh") === "1";
  const todayKey = new Date().toISOString().slice(0, 10);
  const cacheKey = `${cacheVersion}:${todayKey}:${category}:${intensityBand.key}`;

  if (!refresh) {
    const cachedPayload = await readCacheEntry(cacheKey);
    if (cachedPayload) {
      sendJson(res, 200, await withVoteData(cachedPayload, voterId, cacheKey));
      return;
    }
  }

  const collected = await collectTrendSignals(category);
  const ideas = await generateIdeas({
    category,
    intensityValue,
    intensityBand,
    signals: collected.signals,
  });

  const payload = {
    category,
    categoryLabel: CATEGORY_CONFIG[category].label,
    generatedAt: new Date().toISOString(),
    generatedDateLabel: formatDateLabel(new Date()),
    intensity: intensityValue,
    intensityBand: intensityBand.label,
    groqEnabled: Boolean(process.env.GROQ_API_KEY),
    unavailableSources: collected.unavailableSources,
    signalSummary: summarizeSignals(collected.signals),
    ideas: ideas.map((idea, index) => attachIdeaIdentity(idea, cacheKey, index)),
  };

  await writeCacheEntry(cacheKey, payload);
  sendJson(res, 200, await withVoteData(payload, voterId, cacheKey));
}

async function handleVoteRequest(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST for votes." });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Vote request body is invalid." });
    return;
  }

  const ideaId = normalizeIdeaId(body.ideaId);
  const voterId = normalizeVoterId(body.voterId || req.headers["x-voter-id"]);
  const direction = normalizeVoteDirection(body.direction);

  if (!ideaId || !voterId || !direction) {
    sendJson(res, 400, { error: "Vote request is missing a valid idea, voter, or direction." });
    return;
  }

  const votesStore = await readVotesStore();
  const record = normalizeVoteRecord(votesStore[ideaId]);
  const previousVote = record.voters[voterId] || null;

  if (previousVote === "up") {
    record.up = Math.max(0, record.up - 1);
  }

  if (previousVote === "down") {
    record.down = Math.max(0, record.down - 1);
  }

  let userVote = null;

  if (direction === "up") {
    record.up += 1;
    record.voters[voterId] = "up";
    userVote = "up";
  } else if (direction === "down") {
    record.down += 1;
    record.voters[voterId] = "down";
    userVote = "down";
  } else {
    delete record.voters[voterId];
  }

  if (!record.up && !record.down && !Object.keys(record.voters).length) {
    delete votesStore[ideaId];
  } else {
    votesStore[ideaId] = record;
  }

  await writeVotesStore(votesStore);

  sendJson(res, 200, {
    ideaId,
    votes: {
      up: record.up,
      down: record.down,
    },
    userVote,
  });
}

async function collectTrendSignals(category) {
  const config = CATEGORY_CONFIG[category];
  const settled = await Promise.allSettled([
    fetchGoogleSignals(config.searchQuery),
    fetchRedditSignals(config.redditQuery),
    fetchHackerNewsSignals(config.hnQuery),
    fetchGithubSignals(config.githubQuery),
    fetchXSignals(config.searchQuery),
  ]);

  const signals = [];
  const unavailableSources = [];
  const sourceKeys = ["google", "reddit", "hackernews", "github", "x"];

  if (!process.env.TWITTER_BEARER_TOKEN) {
    unavailableSources.push("X is optional and not connected yet.");
  }

  settled.forEach((result, index) => {
    const sourceKey = sourceKeys[index];
    if (result.status === "fulfilled") {
      if (!result.value.length && sourceKey !== "x") {
        unavailableSources.push(`${SOURCE_META[sourceKey].label} returned no matching signals.`);
      }
      signals.push(...result.value);
      return;
    }

    if (sourceKey !== "x" || process.env.TWITTER_BEARER_TOKEN) {
      unavailableSources.push(`${SOURCE_META[sourceKey].label} is unavailable right now.`);
    }
  });

  const dedupedSignals = dedupeSignals(signals);

  if (!dedupedSignals.length) {
    return {
      signals: buildBackupSignals(category),
      unavailableSources: unavailableSources.length
        ? unavailableSources
        : ["Live sources were quiet, so the app used the backup signal set."],
    };
  }

  return {
    signals: dedupedSignals.slice(0, 18),
    unavailableSources,
  };
}

async function generateIdeas({ category, intensityValue, intensityBand, signals }) {
  const groqIdeas = await generateIdeasWithGroq({
    category,
    intensityValue,
    intensityBand,
    signals: signals.slice(0, 12),
  });

  if (groqIdeas?.length) {
    return groqIdeas.slice(0, 9);
  }

  return generateFallbackIdeas({
    category,
    intensityValue,
    intensityBand,
    signals: signals.slice(0, 12),
  });
}

async function fetchGoogleSignals(query) {
  const url =
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(query) +
    "&hl=en-US&gl=US&ceid=US:en";
  const xml = await fetchText(url);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 6);

  return items
    .map((match) => {
      const block = match[1];
      const title = cleanFeedText(extractXmlValue(block, "title"));
      const link = cleanFeedText(extractXmlValue(block, "link"));
      const pubDate = cleanFeedText(extractXmlValue(block, "pubDate"));
      const shortTitle = title.replace(/\s+-\s+[^-]+$/, "").trim();
      return buildSignal({
        source: "google",
        title: shortTitle || title,
        url: link,
        summary: title,
        publishedAt: pubDate,
      });
    })
    .filter(Boolean);
}

async function fetchRedditSignals(query) {
  const url =
    "https://www.reddit.com/search.json?q=" +
    encodeURIComponent(query) +
    "&sort=hot&limit=6";
  const data = await fetchJson(url, {
    headers: {
      "User-Agent": "IdeaMachine/1.0",
    },
  });

  return (data.data?.children || []).map((item) =>
    buildSignal({
      source: "reddit",
      title: item.data?.title || "Untitled Reddit post",
      url: item.data?.url_overridden_by_dest || `https://www.reddit.com${item.data?.permalink || ""}`,
      summary: `Hot Reddit discussion in r/${item.data?.subreddit || "startup"}`,
      publishedAt: item.data?.created_utc ? new Date(item.data.created_utc * 1000).toISOString() : undefined,
    }),
  );
}

async function fetchHackerNewsSignals(query) {
  const url =
    "https://hn.algolia.com/api/v1/search?hitsPerPage=6&tags=story&query=" +
    encodeURIComponent(query);
  const data = await fetchJson(url);

  return (data.hits || []).map((item) =>
    buildSignal({
      source: "hackernews",
      title: item.title || item.story_title || "Untitled Hacker News story",
      url: item.url || item.story_url || `https://news.ycombinator.com/item?id=${item.objectID}`,
      summary: "Popular Hacker News story connected to software or growth.",
      publishedAt: item.created_at,
    }),
  );
}

async function fetchGithubSignals(query) {
  const monthStart = new Date();
  monthStart.setDate(1);
  const q = `${query} pushed:>=${monthStart.toISOString().slice(0, 10)}`;
  const url =
    "https://api.github.com/search/repositories?q=" +
    encodeURIComponent(q) +
    "&sort=stars&order=desc&per_page=6";

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "IdeaMachine/1.0",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const data = await fetchJson(url, { headers });

  return (data.items || []).map((item) =>
    buildSignal({
      source: "github",
      title: item.full_name || item.name || "Trending GitHub repo",
      url: item.html_url,
      summary: item.description || "Open-source momentum around this topic is climbing.",
      publishedAt: item.updated_at,
    }),
  );
}

async function fetchXSignals(query) {
  if (!process.env.TWITTER_BEARER_TOKEN) {
    return [];
  }

  const url =
    "https://api.twitter.com/2/tweets/search/recent?max_results=10&tweet.fields=created_at,lang&query=" +
    encodeURIComponent(`${query} lang:en -is:retweet`);

  const data = await fetchJson(url, {
    headers: {
      Authorization: `Bearer ${process.env.TWITTER_BEARER_TOKEN}`,
    },
  });

  return (data.data || []).slice(0, 6).map((item) =>
    buildSignal({
      source: "x",
      title: truncate(item.text?.replace(/\s+/g, " ").trim() || "Trending X post", 120),
      url: "https://twitter.com/i/web/status/" + item.id,
      summary: "Recent X post connected to growth or product demand.",
      publishedAt: item.created_at,
    }),
  );
}

async function generateIdeasWithGroq({ category, intensityValue, intensityBand, signals }) {
  if (!process.env.GROQ_API_KEY) {
    return null;
  }

  const categoryName = CATEGORY_CONFIG[category].label;
  const signalLines = signals
    .map(
      (signal, index) =>
        `${index + 1}. [${signal.sourceLabel}] ${signal.title} | ${signal.summary} | ${signal.url}`,
    )
    .join("\n");
  const prompt = [
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    `Create 9 startup ideas for the ${categoryName} category.`,
    `Slider intensity: ${intensityValue}/100 (${intensityBand.label}). ${intensityBand.promptStyle}`,
    "Every idea must feel specific, timely, and directly tied to the trend signals.",
    "Avoid generic filler like vague dashboards, vague assistants, or copycat wrappers.",
    "Each idea must name a clear user, a painful job to be done, and a sharp product wedge.",
    "Make the writing simple enough for a beginner to scan fast.",
    'Write the idea line in this format: "For [buyer], this [product] ..."',
    "The why must be no more than 2 short sentences.",
    'The starter prompt must be short, begin with "Build", and be useful for vibe coding a first version.',
    "Title rules: 2 to 5 words. Do not use these title words anywhere: AI, SaaS, App, Tool, Platform, Marketplace, Assistant, Dashboard, Solution, Consultant, Specialist, Optimizer, Tracker, Engine.",
    "Bad idea example: AI SEO Auditor for websites.",
    "Good idea example: SERP Drop Triage for agencies, which watches post-update ranking losses and drafts the first recovery brief page by page.",
    "Bad idea example: SaaS benchmarking platform.",
    "Good idea example: Renewal Leak Finder for finance teams, which reads SaaS invoices and flags quiet price creep before renewal calls.",
    "Return JSON only with this shape:",
    '{"ideas":[{"title":"","idea":"","why":"","starterPrompt":"","sourceMix":[""],"trendScore":0,"wildness":0}]}',
    "Trend signals:",
    signalLines,
  ].join("\n");

  const rawIdeas = await requestGroqIdeas({
    prompt,
    temperature: intensityBand.temperature,
  });

  if (!rawIdeas.length) {
    return null;
  }

  const normalizedIdeas = rawIdeas.map((idea, index) =>
    normalizeIdea({
      title: idea.title,
      idea: idea.idea || idea.description,
      why: idea.why || idea.whyNow,
      starterPrompt: idea.starterPrompt || idea.goToMarket,
      sourceMix: Array.isArray(idea.sourceMix) ? idea.sourceMix : inferSources(signals.slice(index, index + 2)),
      trendScore: idea.trendScore,
      wildness: idea.wildness,
      signals: [signals[index % signals.length], signals[(index + 2) % signals.length]].filter(Boolean),
    }),
  );

  if (countGenericIdeas(normalizedIdeas) >= 3) {
    const rewritePrompt = [
      `Rewrite these ${categoryName} ideas so they are less generic and more concrete.`,
      "Make each one narrower, more opinionated, and more obviously tied to a real workflow.",
      "Do not use these title words anywhere: AI, SaaS, App, Tool, Platform, Marketplace, Assistant, Dashboard, Solution, Consultant, Specialist, Optimizer, Tracker, Engine.",
      'Make the idea line use this format: "For [buyer], this [product] ..." and mention the exact job being automated or improved.',
      "Make the why line specific and tied to the signals in 2 sentences max.",
      "Make the starter prompt begin with Build and mention the first workflow to prototype.",
      "Return JSON only with the same shape as before.",
      "Trend signals:",
      signalLines,
      "Draft ideas to improve:",
      JSON.stringify(normalizedIdeas),
    ].join("\n");

    const rewrittenIdeas = await requestGroqIdeas({
      prompt: rewritePrompt,
      temperature: Math.min(1.2, intensityBand.temperature + 0.1),
    });

    if (rewrittenIdeas.length) {
      return rewrittenIdeas.map((idea, index) =>
        normalizeIdea({
          title: idea.title,
          idea: idea.idea || idea.description,
          why: idea.why || idea.whyNow,
          starterPrompt: idea.starterPrompt || idea.goToMarket,
          sourceMix: Array.isArray(idea.sourceMix) ? idea.sourceMix : inferSources(signals.slice(index, index + 2)),
          trendScore: idea.trendScore,
          wildness: idea.wildness,
          signals: [signals[index % signals.length], signals[(index + 2) % signals.length]].filter(Boolean),
        }),
      );
    }
  }

  return normalizedIdeas;
}

async function requestGroqIdeas({ prompt, temperature }) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      temperature,
      messages: [
        {
          role: "system",
          content:
            "You are a sharp product strategist who turns live trend signals into concrete software ideas people would actually want to build or buy. You always return strict JSON with no markdown.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  const rawContent = data.choices?.[0]?.message?.content;
  const parsed = safeParseJson(rawContent);
  return Array.isArray(parsed?.ideas) ? parsed.ideas : Array.isArray(parsed) ? parsed : [];
}

function countGenericIdeas(ideas) {
  return ideas.filter((idea) => isGenericIdea(idea)).length;
}

function isGenericIdea(idea) {
  const text = `${idea.title} ${idea.idea} ${idea.why}`.toLowerCase();
  const badTitleWord = /\b(ai|saas|app|tool|platform|marketplace|assistant|dashboard|solution|consultant|specialist|optimizer|tracker|engine)\b/i.test(
    idea.title || "",
  );
  const genericPatterns = [
    "ai-powered",
    "platform for",
    "tool for",
    "marketplace for",
    "assistant to help",
    "helps businesses",
    "improve their online presence",
    "stay competitive",
    "provides actionable recommendations",
    "helps a ",
    "helps businesses",
  ];

  return badTitleWord || !/^for\s/i.test((idea.idea || "").trim()) || genericPatterns.some((pattern) => text.includes(pattern));
}

function generateFallbackIdeas({ category, intensityValue, intensityBand, signals }) {
  const config = CATEGORY_CONFIG[category];
  const mechanics = {
    grounded: ["assistant", "radar", "dashboard", "tracker", "copilot"],
    bold: ["studio", "engine", "mapper", "workbench", "finder"],
    wild: ["fusion lab", "signal engine", "autopilot", "simulator", "idea forge"],
    chaotic: ["mutation lab", "trend blender", "demand shifter", "mood engine", "zero-click bot"],
  };

  const outcomes = {
    all: ["faster validation", "sharper positioning", "quicker launch timing", "better market timing"],
    seo: ["higher search wins", "faster content decisions", "better SERP coverage", "smarter topic selection"],
    aso: ["better install conversion", "stronger retention loops", "faster experiment cycles", "better screenshot testing"],
    saas: ["quicker pipeline creation", "better onboarding", "less manual ops", "clearer expansion paths"],
  };

  const themes = deriveThemes(category, signals);
  const selectedMechanics = mechanics[intensityBand.key];
  const selectedOutcomes = outcomes[category];

  return Array.from({ length: 9 }, (_, index) => {
    const primarySignal = signals[index % signals.length];
    const secondarySignal = signals[(index + 2) % signals.length];
    const themeA = themes[index % themes.length];
    const themeB = themes[(index + 3) % themes.length];
    const audience = config.audiences[index % config.audiences.length];
    const mechanic = selectedMechanics[index % selectedMechanics.length];
    const outcome = selectedOutcomes[index % selectedOutcomes.length];
    const title = buildIdeaTitle(themeA, themeB, mechanic);

    return normalizeIdea({
      title,
      idea: buildFallbackIdeaLine({
        audience,
        themeA,
        themeB,
        outcome,
        category,
      }),
      why: buildFallbackWhy({
        primarySignal,
        secondarySignal,
      }),
      starterPrompt: buildFallbackPrompt({
        title,
        audience,
        themeA,
        themeB,
        category,
      }),
      sourceMix: inferSources([primarySignal, secondarySignal]),
      trendScore: Math.round(((primarySignal.score + secondarySignal.score) / 2) + (index % 4) * 2),
      wildness: clamp(intensityValue + index * 3, 8, 98),
      signals: [primarySignal, secondarySignal],
    });
  });
}

function summarizeSignals(signals) {
  const sourceTotals = new Map();

  for (const signal of signals) {
    sourceTotals.set(signal.sourceLabel, (sourceTotals.get(signal.sourceLabel) || 0) + 1);
  }

  const topSources = [...sourceTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))
    .slice(0, 5);

  return {
    totalSignals: signals.length,
    topSources,
    headlines: signals.slice(0, 8).map((signal) => ({
      source: signal.sourceLabel,
      title: signal.title,
      url: signal.url,
      score: signal.score,
    })),
  };
}

function buildSignal({ source, title, url, summary, publishedAt }) {
  if (!title || !url) {
    return null;
  }

  const meta = SOURCE_META[source];
  const freshness = publishedAt ? freshnessBoost(publishedAt) : 0;

  return {
    id: `${source}:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    source,
    sourceLabel: meta.label,
    title: truncate(title.trim(), 140),
    url,
    summary: truncate(summary?.trim() || title.trim(), 160),
    publishedAt: publishedAt || null,
    score: clamp(meta.baseScore + freshness, 45, 99),
    keywords: extractKeywords(`${title} ${summary || ""}`),
  };
}

function normalizeIdea({ title, idea, why, starterPrompt, sourceMix, trendScore, wildness, signals }) {
  const backupTitle = buildIdeaTitle("Trend", "Signal", "studio");

  return {
    title: truncate(cleanSentence(title) || backupTitle, 48),
    idea: truncate(cleanSentence(idea) || "A fresh software idea pulled from today's trend signals.", 190),
    why: truncate(
      limitSentences(cleanSentence(why) || "Multiple sources are moving around the same customer pain right now.", 2),
      190,
    ),
    starterPrompt: truncate(
      cleanSentence(starterPrompt) ||
        "Build a simple MVP for this idea with one main workflow, clear inputs, and a clean results screen.",
      220,
    ),
    sourceMix: Array.isArray(sourceMix) && sourceMix.length ? sourceMix.slice(0, 3) : inferSources(signals),
    trendScore: clamp(Number.parseInt(trendScore, 10) || averageSignalScore(signals), 40, 99),
    wildness: clamp(Number.parseInt(wildness, 10) || averageWildness(signals), 5, 99),
    sourceTitles: signals.map((signal) => signal.title).slice(0, 2),
  };
}

function inferSources(signals) {
  return [...new Set(signals.filter(Boolean).map((signal) => signal.sourceLabel))].slice(0, 3);
}

function averageSignalScore(signals) {
  if (!signals.length) {
    return 68;
  }

  return Math.round(signals.reduce((sum, signal) => sum + signal.score, 0) / signals.length);
}

function averageWildness(signals) {
  if (!signals.length) {
    return 24;
  }

  return clamp(Math.round(35 + signals.length * 4), 10, 80);
}

function deriveThemes(category, signals) {
  const pool = CATEGORY_THEME_POOLS[category];
  const matchedThemes = [];

  for (const signal of signals) {
    for (const keyword of signal.keywords || []) {
      const mappedTheme = KEYWORD_THEME_MAP[keyword];
      if (mappedTheme && pool.includes(mappedTheme)) {
        matchedThemes.push(mappedTheme);
      }
    }
  }

  const themes = [...new Set([...matchedThemes, ...pool])].slice(0, 10);
  return themes.length ? themes : ["Search", "Growth", "Workflow", "Demand", "Launch"];
}

function buildIdeaTitle(themeA, themeB, mechanic) {
  const compactMechanic = titleCase(mechanic.replace(/\s+/g, " "));
  return `${titleCase(themeA)} ${titleCase(themeB)} ${compactMechanic}`.replace(/\s+/g, " ").trim();
}

function dedupeSignals(signals) {
  const seen = new Set();
  const uniqueSignals = signals
    .filter(Boolean)
    .filter((signal) => {
      const key = signal.title.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score);

  const buckets = new Map();
  for (const signal of uniqueSignals) {
    if (!buckets.has(signal.source)) {
      buckets.set(signal.source, []);
    }
    buckets.get(signal.source).push(signal);
  }

  const balancedSignals = [];
  let keepLooping = true;

  while (keepLooping) {
    keepLooping = false;
    for (const bucket of buckets.values()) {
      if (!bucket.length) {
        continue;
      }

      balancedSignals.push(bucket.shift());
      keepLooping = true;
    }
  }

  return balancedSignals;
}

function buildBackupSignals(category) {
  const label = CATEGORY_CONFIG[category].label;
  const examples = [
    `Teams keep asking for faster ${label.toLowerCase()} research loops.`,
    `Operators want a cleaner way to see trend changes without five tools.`,
    `Founders are pushing for smaller AI tools with quicker payback.`,
    `People want clearer launch timing based on what is already moving.`,
    `Small businesses keep searching for lower-effort growth workflows.`,
    `Buyers respond well to software that turns messy signals into one clear next step.`,
  ];

  return examples.map((title, index) =>
    buildSignal({
      source: "fallback",
      title,
      url: "https://example.com/backup-signal",
      summary: "Backup signal used when live sources are unavailable.",
      publishedAt: new Date(Date.now() - index * 60 * 60 * 1000).toISOString(),
    }),
  );
}

function buildFallbackIdeaLine({ audience, themeA, themeB, outcome, category }) {
  const categoryFrame = {
    all: "idea finder",
    seo: "SEO tool",
    aso: "mobile growth tool",
    saas: "B2B SaaS tool",
  };

  return `${articleFor(categoryFrame[category])} ${categoryFrame[category]} for ${audience} that turns ${themeA.toLowerCase()} and ${themeB.toLowerCase()} signals into ${outcome}.`;
}

function buildFallbackWhy({ primarySignal, secondarySignal }) {
  return `People are already reacting to "${shortenHeadline(primarySignal.title)}" and "${shortenHeadline(secondarySignal.title)}". That makes this a good moment to ship something focused before the space gets crowded.`;
}

function buildFallbackPrompt({ title, audience, themeA, themeB, category }) {
  const categoryLabel = category === "all" ? "startup" : category.toUpperCase();
  return `Build a simple ${categoryLabel} MVP called "${title}" for ${audience} with one main workflow, one input screen, and one AI action that combines ${themeA.toLowerCase()} plus ${themeB.toLowerCase()} signals.`;
}

function attachIdeaIdentity(idea, cacheKey, index) {
  return {
    ...idea,
    id: idea.id || buildIdeaId(cacheKey, index, idea.title),
    votes: idea.votes || { up: 0, down: 0 },
    userVote: idea.userVote || null,
  };
}

function buildIdeaId(cacheKey, index, title) {
  return `idea_${slugify(`${cacheKey}-${index}-${title}`)}`.slice(0, 160);
}

async function withVoteData(payload, voterId, cacheKey) {
  const votesStore = await readVotesStore();

  return {
    ...payload,
    ideas: (payload.ideas || []).map((idea, index) => {
      const stableIdea = attachIdeaIdentity(idea, cacheKey, index);
      const record = normalizeVoteRecord(votesStore[stableIdea.id]);

      return {
        ...stableIdea,
        votes: {
          up: record.up,
          down: record.down,
        },
        userVote: voterId ? record.voters[voterId] || null : null,
      };
    }),
  };
}

function normalizeVoteRecord(record) {
  return {
    up: Math.max(0, Number.parseInt(record?.up || "0", 10) || 0),
    down: Math.max(0, Number.parseInt(record?.down || "0", 10) || 0),
    voters: record && typeof record.voters === "object" && record.voters ? { ...record.voters } : {},
  };
}

async function serveStaticFile(requestPath, res) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const safePath = path.normalize(normalizedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    sendJson(res, 404, { error: "File not found." });
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = STATIC_FILES[extension] || "application/octet-stream";

  res.writeHead(200, { "Content-Type": contentType });
  createReadStream(filePath).pipe(res);
}

async function readCacheEntry(key) {
  try {
    const cache = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    return cache[key] || null;
  } catch {
    return null;
  }
}

async function writeCacheEntry(key, payload) {
  mkdirSync(cacheDir, { recursive: true });

  let currentCache = {};
  try {
    currentCache = JSON.parse(await fs.readFile(cacheFile, "utf8"));
  } catch {
    currentCache = {};
  }

  currentCache[key] = payload;
  await fs.writeFile(cacheFile, JSON.stringify(currentCache, null, 2), "utf8");
}

async function readVotesStore() {
  try {
    return JSON.parse(await fs.readFile(votesFile, "utf8"));
  } catch {
    return {};
  }
}

async function writeVotesStore(payload) {
  mkdirSync(cacheDir, { recursive: true });
  await fs.writeFile(votesFile, JSON.stringify(payload, null, 2), "utf8");
}

function loadEnvFiles() {
  for (const name of [".env.local", ".env"]) {
    const fullPath = path.join(process.cwd(), name);
    if (!existsSync(fullPath)) {
      continue;
    }

    const content = readFileSync(fullPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");

      if (key && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

function getIntensityBand(value) {
  return INTENSITY_BANDS.find((band) => value >= band.min && value <= band.max) || INTENSITY_BANDS[0];
}

function normalizeCategory(value) {
  return value && Object.hasOwn(CATEGORY_CONFIG, value) ? value : "all";
}

function extractXmlValue(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? match[1] : "";
}

function cleanFeedText(value) {
  return decodeHtmlEntities(
    value
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function readJsonBody(req) {
  const chunks = [];
  let totalSize = 0;

  for await (const chunk of req) {
    totalSize += chunk.length;
    if (totalSize > 20 * 1024) {
      throw new Error("Request body is too large.");
    }
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function safeParseJson(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    const start = Math.min(
      ...["{", "["]
        .map((token) => value.indexOf(token))
        .filter((index) => index !== -1),
    );
    const end = Math.max(value.lastIndexOf("}"), value.lastIndexOf("]"));

    if (!Number.isFinite(start) || end === -1) {
      return null;
    }

    try {
      return JSON.parse(value.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function cleanSentence(value) {
  if (!value || typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").replace(/^["'`]+|["'`]+$/g, "").trim();
}

function limitSentences(value, maxSentences) {
  const parts = value.match(/[^.!?]+[.!?]?/g) || [];
  return parts.slice(0, maxSentences).join(" ").trim();
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function freshnessBoost(publishedAt) {
  const publishedTime = new Date(publishedAt).getTime();
  if (!Number.isFinite(publishedTime)) {
    return 0;
  }

  const hoursOld = Math.max(0, (Date.now() - publishedTime) / (1000 * 60 * 60));
  if (hoursOld < 24) {
    return 8;
  }
  if (hoursOld < 72) {
    return 4;
  }
  if (hoursOld < 168) {
    return 2;
  }
  return 0;
}

function extractKeywords(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((word) => word.length > 2);
}

function shortenHeadline(value) {
  return truncate(value, 72);
}

function truncate(value, maxLength) {
  if (!value || value.length <= maxLength) {
    return value || "";
  }
  return `${value.slice(0, maxLength - 1).trim()}…`;
}

function articleFor(value) {
  return /^[aeiou]/i.test(value.trim()) ? "An" : "A";
}

function normalizeIdeaId(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/[^a-z0-9_-]/gi, "").slice(0, 160);
}

function normalizeVoterId(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (typeof rawValue !== "string") {
    return "";
  }

  return rawValue.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64);
}

function normalizeVoteDirection(value) {
  return value === "up" || value === "down" || value === "clear" ? value : "";
}

function titleCase(value) {
  return value
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function formatDateLabel(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

const COMMON_WORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "have",
  "about",
  "your",
  "into",
  "their",
  "google",
  "github",
  "reddit",
  "hacker",
  "news",
  "startup",
  "founder",
  "using",
  "will",
  "just",
  "over",
  "more",
  "than",
  "ideas",
  "idea",
  "tool",
  "tools",
  "saas",
  "seo",
  "app",
  "apps",
]);

const CATEGORY_THEME_POOLS = {
  all: ["Search", "Workflow", "Retention", "Pricing", "Automation", "Support", "Launch", "Analytics", "Demand", "Reviews"],
  seo: ["Keyword", "Ranking", "Content", "SERP", "Backlink", "Local", "Review", "Authority", "Intent", "Snippet"],
  aso: ["Screenshot", "Retention", "Onboarding", "Subscription", "Review", "Store", "Experiment", "Keyword", "Creative", "Paywall"],
  saas: ["Workflow", "Automation", "Support", "Pricing", "Compliance", "Sales", "Churn", "Onboarding", "Expansion", "Analytics"],
};

const KEYWORD_THEME_MAP = {
  ai: "Automation",
  analytics: "Analytics",
  app: "Store",
  apps: "Store",
  authority: "Authority",
  automation: "Automation",
  backlink: "Backlink",
  backlinks: "Backlink",
  b2b: "Sales",
  churn: "Churn",
  compliance: "Compliance",
  content: "Content",
  conversion: "Paywall",
  creative: "Creative",
  customer: "Support",
  demand: "Demand",
  experiment: "Experiment",
  experiments: "Experiment",
  growth: "Launch",
  install: "Store",
  intent: "Intent",
  keyword: "Keyword",
  keywords: "Keyword",
  local: "Local",
  onboarding: "Onboarding",
  paywall: "Paywall",
  pricing: "Pricing",
  ranking: "Ranking",
  retention: "Retention",
  review: "Review",
  reviews: "Review",
  sales: "Sales",
  screenshot: "Screenshot",
  screenshots: "Screenshot",
  search: "SERP",
  serp: "SERP",
  snippet: "Snippet",
  snippets: "Snippet",
  store: "Store",
  subscription: "Subscription",
  subscriptions: "Subscription",
  support: "Support",
  traffic: "Ranking",
  workflow: "Workflow",
};
