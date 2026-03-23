# AgentGo 完整 API 能力文档

> 来源：[官方文档](https://docs.agentgo.live/) · [ClawHub Skill](https://clawhub.ai/tammy-hash/agentgo-browser) · [Scrape API](https://docs.agentgo.live/api-reference/endpoints/scrape)

---

## 一、AgentGo 是什么

AgentGo 是一个**分布式云浏览器平台**。你不需要自己维护浏览器集群，它提供：

- 远程浏览器实例（Chromium），通过 WebSocket 连接
- 内置代理 IP（全球 100+ 国家/地区节点）
- 内置 CAPTCHA 自动处理（reCAPTCHA V2、Cloudflare Turnstile）
- 沙箱隔离的安全环境
- Session Inspector / Session Replay 可观测性

---

## 二、两种使用方式

### 方式 A：WebSocket + Playwright（核心能力）

通过 `playwright@1.51.0` 的 `chromium.connect()` 直接连接云浏览器。**这是最灵活的方式**，可以做任何浏览器能做的事。

```javascript
import { chromium } from "playwright"; // 必须是 1.51.0

const options = {
  _apikey: process.env.AGENTGO_API_KEY,
  _region: "us",           // 可选，默认 us
  _sessionId: "xxx",       // 可选，复用已有 session
  _disable_proxy: false    // 可选，默认开启代理
};

const wsUrl = `wss://app.browsers.live?launch-options=${encodeURIComponent(JSON.stringify(options))}`;
const browser = await chromium.connect(wsUrl);
const page = await browser.newPage();
// ... 任意 Playwright 操作 ...
await browser.close();
```

### 方式 B：Scrape REST API（简化版）

一个 HTTP 调用直接获取页面内容，无需写 Playwright 代码。

```bash
curl -X POST https://app.agentgo.live/api/scrape \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "url": "https://example.com",
    "formats": ["markdown", "html", "screenshot"],
    "timeout": 30000
  }'
```

**Scrape API 支持的返回格式：**

| 格式 | 说明 |
|------|------|
| `html` | 清理后的 HTML（默认） |
| `markdown` | 页面内容转 Markdown |
| `rawHtml` | 原始完整 HTML |
| `screenshot` | Base64 编码的页面截图 |

返回还附带 `links`（页面所有链接）和 `imgs`（页面所有图片）。

---

## 三、Node.js SDK

```bash
npm i @agentgo-dev/sdk
```

### Session 管理 API

| 操作 | 方法 | 说明 |
|------|------|------|
| 创建 Session | `client.sessions.create({ region, keepAlive })` | 创建新的浏览器会话 |
| 列出 Sessions | `client.sessions.list({ status, region, limit })` | 按状态/区域过滤 |
| 查询 Session | `client.sessions.retrieve(sessionId)` | 获取详情和状态 |

```typescript
import { AgentGo } from '@agentgo-dev/sdk';

const client = new AgentGo({ apiKey: 'xxx' });

const session = await client.sessions.create({
  region: 'us',
  keepAlive: true   // 防止 30 秒无活动超时
});

// session.id — 用于 Playwright _sessionId
// session.connectionUrl — 连接地址
// session.status — IDLE / RUNNING / EXPIRED
```

Session 状态流转：`IDLE`（空闲） → `RUNNING`（使用中） → `EXPIRED`（过期）

---

## 四、连接参数（launch-options）

| 参数 | 类型 | 必需 | 默认 | 说明 |
|------|------|------|------|------|
| `_apikey` | string | 是 | — | API 密钥 |
| `_region` | string | 否 | `"us"` | 地理区域代码（小写） |
| `_sessionId` | string | 否 | 自动生成 | 指定/复用 session |
| `_disable_proxy` | boolean | 否 | `false` | 是否禁用代理 |

---

## 五、支持的地区（100+ 国家/地区）

| 大洲 | 示例代码 |
|------|----------|
| **欧洲** (26) | `uk` `de` `fr` `es` `it` `nl` `se` `pl` `ch` `no` `dk` `fi` `ie` `at` `be` `pt` ... |
| **亚洲** (25) | `jp` `kr` `sg` `in` `id` `th` `vn` `my` `ph` `il` `ae` `sa` `tr` `kz` ... |
| **北美** (15) | `us` `ca` `mx` `cr` `pa` `gt` `jm` `pr` `cu` ... |
| **南美** (10) | `br` `ar` `cl` `co` `pe` `ec` `uy` `ve` `bo` `py` |
| **非洲** (23) | `za` `ng` `ke` `eg` `ma` `gh` `tz` `et` `rw` ... |
| **大洋洲** (7) | `au` `nz` `pg` `pw` `to` `tv` `vu` |

> 注意：没有 `hk`（香港）和 `cn`（中国大陆）的官方区域码，但实测 `hk` 可以连接。

---

## 六、技术限制

| 限制 | 说明 |
|------|------|
| 最大并发页面 | 每个 browser 实例 **4 个** page |
| 无活动超时 | **30 秒**（无 I/O 自动释放），SDK 可用 `keepAlive: true` 延长至 **120 秒** |
| 文件操作 | **不支持**上传/下载 |
| CDP 网络功能 | `page.on()` / `page.route()` 需联系客服开通 |
| 连接协议 | 仅支持 `chromium.connect()`，**不支持** `connectOverCDP()` |
| Playwright 版本 | 必须 `1.50.0` ~ `1.51.0`，更高版本有协议不兼容 |
| CAPTCHA 超时 | reCAPTCHA 解决耗时较长，建议设 `timeout: 90000` |

---

## 七、内置 CAPTCHA 自动处理

AgentGo 自动处理以下验证码，无需额外代码：

- **reCAPTCHA V2** — 自动识别并通过
- **Cloudflare Turnstile** — 自动跳过验证页

---

## 八、反检测 & 高级技巧

| 技巧 | 说明 |
|------|------|
| 移动端模拟 | 使用 iPhone context 绕过反爬 |
| 人类行为模拟 | 模拟打字速度、鼠标滚动、随机延迟 |
| Cookie 注入 | 提前注入登录 cookie 跳过登录页（X/Twitter 等） |
| 自然导航 | 先访问首页再跳转目标页，模拟真实用户路径 |

X (Twitter) 专用：通过注入 `auth_token` + `ct0` cookie 实现免登录操作。

---

## 九、Playwright 可用操作一览

通过 WebSocket 连接后，可以执行**所有标准 Playwright 操作**：

| 类别 | 操作 |
|------|------|
| **导航** | `goto()` `goBack()` `goForward()` `reload()` |
| **点击/交互** | `click()` `dblclick()` `fill()` `type()` `press()` `selectOption()` `check()` |
| **等待** | `waitForSelector()` `waitForLoadState()` `waitForTimeout()` `waitForNavigation()` |
| **数据提取** | `textContent()` `innerHTML()` `getAttribute()` `$$eval()` `evaluate()` |
| **截图** | `screenshot({ path, fullPage })` |
| **多页面** | `browser.newPage()` 最多 4 个并发 |

---

## 十、认证方式汇总

| 方式 | 用途 |
|------|------|
| 环境变量 `AGENTGO_API_KEY` | SDK 自动读取 |
| SDK 构造参数 `apiKey` | 代码中显式传入 |
| WebSocket URL `_apikey` 参数 | Playwright 直连 |
| HTTP Header `x-api-key` | Scrape REST API |

---

## 十一、连接辅助函数（推荐复用）

```javascript
import { chromium } from "playwright";

export async function connectAgentGo(region = "us") {
  if (!process.env.AGENTGO_API_KEY) throw new Error("AGENTGO_API_KEY is not set");
  const options = {
    _apikey: process.env.AGENTGO_API_KEY,
    _region: region,
    _disable_proxy: false,
  };
  const wsUrl = `wss://app.browsers.live?launch-options=${encodeURIComponent(JSON.stringify(options))}`;
  return chromium.connect(wsUrl, { timeout: 60000 });
}
```

---

## 总结：AgentGo 能做什么

| 场景 | 说明 |
|------|------|
| **网页抓取/爬虫** | 访问任何网站，提取内容，自动过 Cloudflare |
| **自动化操作** | 填表、点击、提交、模拟用户行为 |
| **全球节点访问** | 100+ 国家/地区 IP，地理定位内容访问 |
| **截图/监控** | 对网页截图，监控页面变化 |
| **AI Agent 的"眼睛和手"** | 给 AI 加上浏览网页的能力 |
| **社交媒体自动化** | 配合 cookie 注入，操作 X、Reddit 等平台 |
| **简化版 Scrape API** | 一个 HTTP 请求获取 markdown/html/截图 |
