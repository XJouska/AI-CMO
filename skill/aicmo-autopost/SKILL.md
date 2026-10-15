---
name: aicmo-autopost
description: End-to-end social-media marketing automation. Use this skill when the user wants to automatically promote a product (by URL or name) across Reddit, YouTube, Twitter/X, Quora, Product Hunt, and Hacker News. The skill calls the AI-CMO API to rank posts and generate tailored comments, then drives the user's own logged-in browser (via OpenClaw) to visit each post and submit the suggested comment. Triggers include "promote my product", "auto post to Reddit/Twitter", "全自动营销", "定时推流", "AI-CMO", "social media promotion", "find places to promote".
license: MIT
---

# AI-CMO × OpenClaw — Autonomous Social Media Promotion

This skill turns AI-CMO's promotion analytics into **real comments posted from the user's own browser session**. AI-CMO (cloud) picks *where* and *what* to post; OpenClaw (local browser) does the actual posting, using the user's already-logged-in social accounts.

> **Base URL:** `https://www.aicmo.site/api/v1/open`
> **Auth:** every request needs the `x-api-key: <AICMO_API_KEY>` header.

---

## Quick start (for the user) — 3 steps

1. **Get your key** — sign up at https://www.aicmo.site → Settings → API Keys → Create Key. Give it to OpenClaw (paste it in chat, or set env var `AICMO_API_KEY`).
2. **Tell the agent to promote something**, e.g.:
   > *"Use aicmo-autopost to promote https://my-product.com"*
3. **Do the two things only you can do**, when the agent asks:
   - Log in to the social platforms you care about in the browser window it opens.
   - Review the Top-5 list it shows and reply `yes` to start posting.

That's it. The agent handles analysis, navigation, commenting, pacing, and reporting.

---

## Agent operating procedure (follow in order)

When this skill is invoked, the agent **MUST** walk the user through these phases. Do not skip phases. Do not batch them silently.

### Phase 1 — Ensure API key

1. Check environment variable `AICMO_API_KEY`.
2. If missing or empty, show this message to the user verbatim:

   > I need an AI-CMO API key to continue.
   > 1. Register / log in at https://www.aicmo.site
   > 2. Go to **Settings → API Keys → Create Key**
   > 3. Top up a few credits (each analysis costs 1 credit; failed analyses are auto-refunded)
   > 4. Paste the key here, or set it in OpenClaw as env var `AICMO_API_KEY`.

3. After the user provides the key, validate by running `scripts/check_quota.sh`. If `credits_remaining <= 0`, tell the user to top up and stop.

### Phase 2 — Collect the product input

Ask the user for **one** of:

- Product URL (preferred, e.g. `https://your-product.com`)
- Product name (e.g. `"U2forU YouTube Downloader"`)

Optional follow-ups (use sensible defaults if user doesn't answer):

- `language`: `en` (default) / `zh` / `ja` / `ko` / `es` / `fr` / `de` / `pt` / `ru` / `ar`
- `max_results`: default `8` (range 1–20)

### Phase 3 — Browser login handshake (CRITICAL, do not skip)

OpenClaw will post comments **using whatever accounts are currently logged in inside the browser profile OpenClaw controls**. So before any posting happens, the agent **MUST**:

1. Open a visible browser window via OpenClaw's browser tool (non-headless, so the user can see and interact).
2. Show the user this checklist and wait for explicit "I'm logged in" confirmation before proceeding:

   > Please log in to every platform you want to promote on, **in the browser window I just opened**:
   >
   > - [ ] Reddit — https://www.reddit.com/login
   > - [ ] YouTube — https://accounts.google.com
   > - [ ] Twitter / X — https://x.com/login
   > - [ ] Quora — https://www.quora.com
   > - [ ] Product Hunt — https://www.producthunt.com/sign-in
   > - [ ] Hacker News — https://news.ycombinator.com/login
   >
   > You only need the platforms you care about. Complete any CAPTCHA / 2FA yourself. When done, reply **"logged in"**.

3. Do **not** proceed until the user confirms. Never attempt to log in on the user's behalf (passwords are not part of this skill).

### Phase 4 — Fetch promotion targets

Run `scripts/fetch_promotions.sh` with the collected inputs. It calls `POST /analyze/csv` and writes `promotions.csv` to the current working directory. Consumes 1 credit.

Parse the CSV (UTF-8 with BOM, comma-separated). Keep rows where `Risk Level` is `low` or `medium`, sort by `Score` descending. Show the user a short summary:

```
Found N promotion spots. Top 5 by score:
 #1 [reddit] "Post title…"  score 87  risk low   → https://…
 #2 [youtube] "…"           score 82  risk low   → https://…
 …
Ready to start posting? (yes / edit list / cancel)
```

Let the user approve, trim, or edit the list before continuing.

### Phase 5 — Autonomous posting loop

For each approved row, OpenClaw's browser tool should execute:

1. `navigate(url)` — open the post in the already-logged-in browser.
2. `sleep(random 5–15s)` — simulate reading.
3. Scroll down until the platform's reply/comment box is in view.
4. Click the reply/comment box (see `references/platform-selectors.md` for per-platform hints).
5. Type the content of the `Suggested Comment` column. **Humanize it** by:
   - Replacing 1–2 words with synonyms,
   - Varying punctuation/casing slightly,
   so multiple sessions don't produce identical text.
6. Click submit.
7. Wait `random 30–120s` before the next row (mandatory, anti-spam).
8. Record result (`posted` / `skipped` / `failed` + error) into `run-report.json`.

After the loop, summarize to the user:

```
✅ Posted: 4
⚠️  Skipped (comment box not found): 1
❌ Failed (rate-limited): 0
See run-report.json for details.
```

### Safety rails — the agent MUST enforce these

- **Max 10 comments per run** regardless of CSV size.
- **Never post to the same URL twice** in one week (check `run-report.json` history if present).
- **Never bypass CAPTCHA** — if one appears, pause and ask the user to solve it manually.
- **Never read or exfiltrate the user's cookies / session tokens.** OpenClaw already has the browser context; the skill only drives UI actions.
- **Respect platform rules.** If a subreddit's sidebar forbids self-promotion, skip it and log the reason.

---

## Scripts provided by this skill

| Script | What it does |
|---|---|
| `scripts/check_quota.sh` | `GET /quota`; prints remaining credits or exits non-zero |
| `scripts/fetch_promotions.sh` | `POST /analyze/csv`; writes `promotions.csv` |

Both read `AICMO_API_KEY` from the environment. Usage is documented at the top of each file.

## References (load on demand)

- `references/api.md` — full REST API reference (all endpoints, fields, error codes)
- `references/platform-selectors.md` — per-platform DOM hints for locating the reply input and submit button

## FAQ

**Does analysis cost credits?** Yes, 1 credit per `/analyze` or `/analyze/csv` call. Exporting past analyses via `/history/{id}/csv` is free.

**What if analysis fails?** The credit is automatically refunded server-side.

**Can I schedule this?** Yes — run the skill on a cron / OpenClaw schedule. Recommended cadence: every 1–2 days; content freshness decays quickly on social platforms.
