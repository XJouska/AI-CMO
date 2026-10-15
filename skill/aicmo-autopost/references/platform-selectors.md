# Platform DOM hints for OpenClaw

OpenClaw's browser tool can use role-based or text-based locators; raw CSS selectors change often, so prefer the **role/text hints** below. These are checked as of 2026-04 and should be verified at runtime.

## Reddit (`reddit.com`)

- Comment box: `role="textbox"` with placeholder `"Add a comment"` or `"What are your thoughts?"`
- On new Reddit, the editor is inside a `<faceplate-form>` web component; click once to expand, then type.
- Submit: button with text `"Comment"` (enabled only after text is entered).
- If Reddit asks to "Join Reddit to comment", the account is not logged in — stop and report.

## YouTube (`youtube.com`)

- Comments section may lazy-load; scroll to `#comments` until placeholder `"Add a comment…"` is visible.
- Click the placeholder (`id="placeholder-area"`), which reveals the real editor at `id="contenteditable-root"`.
- Submit: button with text `"Comment"` inside `ytd-comment-simplebox-renderer`.
- If you see `"Sign in to make a comment"`, account is not logged in.

## Twitter / X (`x.com` or `twitter.com`)

- Reply composer: `role="textbox"` with placeholder `"Post your reply"`.
- Usually requires clicking the tweet first to open the thread view, then clicking "Reply".
- Submit: button with text `"Reply"` (or `"Post"` for new tweets).
- If a "Log in" dialog appears, account is not logged in.

## Quora (`quora.com`)

- Answer box: click the `"Answer"` button on the question page, then the editor at `role="textbox"` appears.
- Submit: button with text `"Post"` or `"Submit"`.
- Quora aggressively prompts signup; make sure login cookie is present before navigating.

## Product Hunt (`producthunt.com`)

- Discussion page comment box: `role="textbox"` with placeholder `"Join the discussion"`.
- Submit: button with text `"Comment"`.

## Hacker News (`news.ycombinator.com`)

- Comment textarea: `<textarea name="text">` at the bottom of the item page.
- Submit: `<input type="submit" value="add comment">`.
- HN has no JS framework — simple form submit works reliably.

## General tips

- Always wait for network idle after `navigate()` before interacting.
- Before typing, click the input to focus; some editors swallow the first keystroke.
- After submit, wait 2–5s and verify by looking for your comment text in the DOM; if not present, mark the row as `failed`.
- If a CAPTCHA / "Are you human?" check appears, **pause and ask the user** — do not attempt to solve it.
