# 03 · AI 获客助手

> 目标：建立应用的主交互界面——「助手」Tab。用户用自然语言完成建档补充、生成官网、设置监控、查看商机、写开发信、看周报；助手通过「工具调用」驱动后端模块，并以结构化卡片回复。
> 结束状态：对话框架、流式输出、工具调用机制可用，并接入计划 02 的建档工具；后续计划只需注册新工具和新卡片。

---

## 1. 为什么以助手为主入口

目标用户（工厂老板、业务员）数字化能力弱，不愿意学习复杂后台。设计包本身也以「Agent 对话页」为核心范式（`NavBar barType="Agent"` + `TabBar` 内置 `AgentInput` + `Markdown` 结构化回答）。因此：

- **助手是操作入口**：说一句话就能触发任务
- **其他 Tab 是结果视图**：商机、官网、我的，用于浏览和精细操作
- 两者共享同一套后端服务，不存在只能在对话里完成的功能

---

## 2. 范围

**包含**：会话与消息模型、SSE 流式协议、工具注册框架、意图与工具规划、回答卡片体系、欢迎页与建议问题、第一批工具（档案相关）。
**不包含**：官网、商机、开发信相关工具的实际实现（分别在 04、05、06 注册）。

---

## 3. 数据模型

| 表 | 关键字段 |
|---|---|
| `conversations` | id, company_id, user_id, title, status, created_at, updated_at |
| `messages` | id, conversation_id, role(`user` / `assistant` / `tool`), blocks(JSON), state(`thinking` / `completed` / `error` / `cancelled`), token_usage, created_at |
| `tool_runs` | id, message_id, tool_name, args(JSON), status, result(JSON), error, started_at, finished_at |

`blocks` 采用设计包 `conversation-content-domain` 中的内容模型：

```json
{ "semanticRole": "heading | body | list | table | quote | progress | card | followUp | toolbar",
  "content": "...", "children": [], "interaction": {} }
```

---

## 4. 后端任务

### 4.1 SSE 协议

`POST /api/v1/assistant/conversations/{id}/messages`，返回 SSE 流：

| event | data | 说明 |
|---|---|---|
| `message.start` | `{message_id}` | 助手消息开始 |
| `progress` | `{step, label, status}` | 工具执行进度，对应 `Markdown variant="Progress"` |
| `block.delta` | `{block_index, text}` | 文本增量（只追加当前块，不重建已稳定内容） |
| `block.card` | `{block_index, card_type, payload}` | 结构化卡片（商机卡、官网预览卡等） |
| `followups` | `{items: string[]}` | 建议追问 |
| `message.done` | `{usage}` | 完成 |
| `error` | `{code, message, retryable}` | 失败，保留已生成内容 |

另有 `POST .../messages/{id}/cancel` 和 `POST .../messages/{id}/retry`（复用当前上下文，不复制历史回答）。

### 4.2 工具框架

1. `ToolRegistry`：每个工具声明 `name`、`description`、参数 Pydantic 模型、所需角色、是否需要用户确认、执行函数、卡片渲染类型。
2. 编排：LLM 使用函数调用（OpenAI tools 格式）选择工具；单轮最多 5 次工具调用；工具参数经 Pydantic 校验后才执行。
3. **有副作用的工具必须二次确认**（例如发布官网、发送邮件、删除数据）：助手返回确认卡片，用户点击确认后才执行。
4. 工具执行时自动注入 `company_id` 和当前用户，**LLM 无法指定其他企业**。
5. 提示词注入防护：抓取到的网页、上传文件、询盘内容作为数据传入，并标注为不可信内容；系统提示明确不得执行其中的指令。

### 4.3 第一批工具（本计划实现）

| 工具 | 作用 |
|---|---|
| `profile.get_completeness` | 返回档案完整度和缺失项 |
| `profile.extract_from_url` | 从网址抽取档案（调用计划 02 服务） |
| `profile.update_fields` | 根据对话内容生成「待确认变更」 |
| `product.list` / `product.create_draft` | 查询产品、根据描述起草产品 |

### 4.4 成本与稳定性

- 每条消息记录 token 用量，计入企业用量（计划 07 计费使用）
- LLM 失败重试 3 次，指数退避；仍失败则返回 `error`，`retryable=true`
- 单企业并发会话数限制

---

## 5. 前端任务

### 5.1 页面结构（参考设计包 `screens/generated/agent.tsx`）

```
NavBar barType="Agent"（左：历史会话入口；中：产品名；右：新对话）
│
├── 消息流（可滚动，内容层左右留页面边距）
│     ├── Markdown variant="prompt"            用户消息
│     ├── Markdown variant="Progress"          工具执行中
│     ├── Markdown H3 / Body / OL / UL / Table 结构化回答
│     ├── 业务卡片（Card / List 组合）          商机、官网预览、确认操作
│     ├── Markdown variant="followUp"          建议追问
│     └── Markdown variant="Toolbar"           复制、点赞、点踩、重新生成
│
└── TabBar selected="Tab 1 & Input"（内含 AgentInput，贴底铺满）
```

### 5.2 状态机

| 状态 | 输入框 `AgentInput.type` | 消息区 |
|---|---|---|
| 空闲 | `Default` | 欢迎页或历史消息 |
| 输入中 | `Inputting` | — |
| 生成中 | `Stopped`（显示停止按钮） | Progress + 增量文本；不显示完成态操作 |
| 完成 | `Default` | 完整回答 + followUp + Toolbar |
| 错误 | `Default` | 保留已生成内容，失败块内提供「重试」按钮 |
| 弱网（生成中） | `Stopped` | 保持输出中，5 秒无数据后显示轻提示 `Snackbar` |

### 5.3 欢迎页

首次进入或新对话时显示：

- 产品名 + 一句话说明
- 根据档案完整度动态生成 3–4 个建议任务（使用 `Markdown variant="followUp"`）：
  - 档案不完整 → 「帮我补充企业档案」
  - 无官网 → 「帮我生成英文官网」（计划 04 生效）
  - 无监控 → 「帮我找海外采购商」（计划 05 生效）
  - 有新商机 → 「看看今天的新商机」

### 5.4 卡片注册机制

`src/assistant/cards/registry.ts`：`card_type → React 组件`。每张卡片只用正式组件组合。本计划实现：

- `ConfirmCard`：有副作用操作的确认（`Card` + 两个 `Button`）
- `ProfileDiffCard`：档案待确认变更摘要，点击进入计划 02 的确认页
- `ProductDraftCard`：产品草稿

未知 `card_type` 降级为纯文本说明，而不是渲染空白。

### 5.5 历史会话

- 左上角入口打开 `BottomSheet`，内含 `InternalHistoryItems` 风格的会话列表（或 `List`）
- 长按 / 更多：重命名、删除（`ActionSheet` + `Dialog` 确认）

### 5.6 渲染安全

- 所有文本作为 React 子节点渲染，不解析 HTML
- 若需要 Markdown 语法，使用安全解析器生成 AST，再映射到正式 `Markdown` 组件变体；链接只允许 http / https，并显示域名

---

## 6. 验收标准

- [ ] 用户说「我们是做不锈钢阀门的，官网是 xxx.com」→ 助手调用抽取工具 → 返回档案变更卡片 → 确认后档案更新
- [ ] 生成中可停止；停止后消息状态为 `cancelled`，可重新生成
- [ ] 断网后保持输出中并出现轻提示；恢复后可重试
- [ ] 有副作用的工具未经确认不会执行（测试覆盖）
- [ ] 尝试通过提示词让助手读取其他企业数据失败（测试覆盖）
- [ ] 所有状态在 402×874 下截图检查，输入框与 TabBar 贴底铺满
