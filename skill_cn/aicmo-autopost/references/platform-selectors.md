# 各平台 DOM 定位提示（供 OpenClaw 使用）

OpenClaw 的浏览器工具可以用 role 或 text 定位器；原始 CSS 选择器经常改动，优先使用下面这些 **role / 文本** 提示。这些提示核对于 2026-04，运行时仍应复核。

## Reddit（`reddit.com`）

- 评论框：`role="textbox"`，placeholder 为 `"Add a comment"` 或 `"What are your thoughts?"`。
- 新版 Reddit 的编辑器包在 `<faceplate-form>` Web Component 里，先点击展开再输入。
- 提交按钮：文本为 `"Comment"`（输入内容后才可点）。
- 如果提示 `"Join Reddit to comment"`，说明账号未登录 —— 停止并报告。

## YouTube（`youtube.com`）

- 评论区是懒加载的：滚动到 `#comments`，直到 placeholder `"Add a comment…"` 出现。
- 点击 placeholder（`id="placeholder-area"`）会展开真正的编辑器 `id="contenteditable-root"`。
- 提交按钮：`ytd-comment-simplebox-renderer` 内文本为 `"Comment"`。
- 若看到 `"Sign in to make a comment"`，说明账号未登录。

## Twitter / X（`x.com` 或 `twitter.com`）

- 回复编辑器：`role="textbox"`，placeholder 为 `"Post your reply"`。
- 一般需要先点击推文进入线程视图，再点 "Reply"。
- 提交按钮：文本为 `"Reply"`（新推是 `"Post"`）。
- 出现 "Log in" 弹窗则说明账号未登录。

## Quora（`quora.com`）

- 回答框：在问题页点击 `"Answer"` 按钮后出现 `role="textbox"` 编辑器。
- 提交按钮：文本为 `"Post"` 或 `"Submit"`。
- Quora 会频繁弹注册提示；进入页面前务必确认已有登录 Cookie。

## Product Hunt（`producthunt.com`）

- 讨论页评论框：`role="textbox"`，placeholder 为 `"Join the discussion"`。
- 提交按钮：文本为 `"Comment"`。

## Hacker News（`news.ycombinator.com`）

- 评论输入框：item 页底部的 `<textarea name="text">`。
- 提交按钮：`<input type="submit" value="add comment">`。
- HN 没有 JS 框架，普通表单提交就行。

## 通用技巧

- `navigate()` 之后要等网络空闲再交互。
- 输入前先点击输入框让其获得焦点；某些编辑器会吞掉第一个按键。
- 提交后等 2–5 秒，再检查 DOM 里是否能搜索到你发的文本；如果找不到，将该行标记为 `failed`。
- 出现 CAPTCHA / "Are you human?" 检查时 **暂停并询问用户**，不要试图自行绕过。
