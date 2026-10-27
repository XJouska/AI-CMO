# AI 获客助手（计划 03）

## 数据

| 表 | 说明 |
|---|---|
| `conversations` | 会话，按「企业 + 用户」隔离（同企业其他成员看不到） |
| `messages` | `role` user / assistant；`blocks` 采用 conversation-content-domain 内容模型；`state` thinking → completed / error / cancelled |
| `tool_runs` | 每次工具调用的记录；有副作用的工具先以 `pending_confirm` 创建 |

## SSE 协议

`POST /api/v1/assistant/conversations/{id}/messages {text}` 返回 `text/event-stream`。事件定义与样例见
[`contracts/sse-assistant.json`](../../contracts/sse-assistant.json)，前后端测试都使用这个文件。

- `retry`：覆盖原回答重新生成，复用原用户消息与之前的上下文；该回答下未确认的操作标记为 `expired`
- `cancel`：把状态改为 `cancelled`；同一实例上立即中断，其他实例在下一个检查点（每次 LLM 调用前后、每段文本推送前）中断；
  客户端断开连接也会触发取消
- 单企业同时生成中的回答最多 3 条；超过 5 分钟仍为 thinking 的回答视为超时

## 工具

`app/modules/assistant/tools.py`：`@tool(name, description, args, label, requires_confirmation, roles, describe_confirm)`。

- 参数模型继承 `ToolArgs`（`extra="forbid"`），**不包含 company_id**；执行时由框架注入 `ToolContext`（当前企业、用户、角色）
- 工具结果以 `{"untrusted_data": ...}` 回传给 LLM；系统提示要求忽略其中的任何指令
- `requires_confirmation=True` 的工具只生成确认卡片，用户点击确认后通过 `POST /assistant/tool-runs/{id}/confirm` 执行；
  只能由发起人在 24 小时内确认一次
- 单轮最多 5 次工具调用，第 6 次 LLM 调用不再提供工具

| 工具 | 确认 | 卡片 |
|---|---|---|
| `profile_get_completeness` | 否 | `profile_completeness` |
| `profile_extract_from_url` | 否（只生成待确认变更） | `profile_diff` |
| `profile_update_fields` | 否（只生成待确认变更） | `profile_diff` |
| `product_list` | 否 | — |
| `product_create_draft` | 否（只生成草稿） | `product_draft` |
| `product_delete` | **是**（owner / operator） | `confirm` |

后续计划注册新工具时：在模块中用 `@tool` 声明，并在 `app/modules/assistant/router.py` 导入该模块；
前端在 `src/assistant/cards/registry.tsx` 注册卡片类型（未注册的卡片类型降级为文本）。

## 前端

- `src/assistant/turn.ts`：事件 → 显示模型的纯函数状态机
- `src/assistant/markdown.ts`：安全 Markdown（只支持标题、段落、列表、引用、分割线、加粗、http/https 链接），映射到正式 `Markdown` 变体
- `src/assistant/useConversation.ts`：发送、停止、重试、弱网（5 秒无数据显示 Snackbar）
