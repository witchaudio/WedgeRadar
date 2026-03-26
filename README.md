# Idea Machine

A small website that pulls live trend signals from Google, Reddit, Hacker News, GitHub, and optional X, then turns them into daily SEO, ASO, and SaaS ideas.

## Run it

1. Copy `.env.example` to `.env.local`.
2. Add `GROQ_API_KEY` if you want Groq-generated ideas. Without it, the app still works with the built-in fallback idea engine.
3. Run `npm run dev`.
4. Open `http://localhost:3000`.

## Optional keys

- `TWITTER_BEARER_TOKEN`: enables live X signals.
- `GITHUB_TOKEN`: raises GitHub API limits.

## How the daily refresh works

- The server stores one cache entry per day, category, and intensity band inside `.cache/ideas.json`.
- The first visit each day creates a new batch.
- The "Refresh today's batch" button bypasses the cache and forces a new pull.
