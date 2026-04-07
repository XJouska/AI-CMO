import { useState } from 'react';
import { BookOpen, Key, Zap, Download, History, CreditCard, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';

const BASE_URL = window.location.origin;

function CodeBlock({ code }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="api-code-block">
      <button className="api-code-copy" onClick={handleCopy}>
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      <pre><code>{code}</code></pre>
    </div>
  );
}

function Section({ id, title, icon: Icon, children }: { id: string; title: string; icon: any; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="api-section" id={id}>
      <div className="api-section-header" onClick={() => setOpen(!open)}>
        <Icon size={18} />
        <h2>{title}</h2>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </div>
      {open && <div className="api-section-body">{children}</div>}
    </div>
  );
}

function Endpoint({ method, path, desc, children }: { method: string; path: string; desc: string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const methodColor = method === 'GET' ? '#10b981' : method === 'POST' ? '#6366f1' : method === 'PUT' ? '#f97316' : '#ef4444';
  return (
    <div className="api-endpoint">
      <div className="api-endpoint-header" onClick={() => setOpen(!open)}>
        <span className="api-method" style={{ background: methodColor }}>{method}</span>
        <code className="api-path">{path}</code>
        <span className="api-desc">{desc}</span>
        {children && (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
      </div>
      {open && children && <div className="api-endpoint-body">{children}</div>}
    </div>
  );
}

export default function APIDocsPage() {
  return (
    <div className="page-container" style={{ maxWidth: 900 }}>
      <div className="page-header">
        <h1><BookOpen size={24} /> AI-CMO API 文档</h1>
      </div>

      <div className="dashboard-card" style={{ marginBottom: '1.5rem' }}>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>
          AI-CMO 提供 REST API，支持外部工具（如 <strong>OpenClaw</strong>）集成，实现自动化社媒推广分析。
          所有 API 请求需在 Header 中携带 <code>x-api-key</code> 进行认证。
        </p>
        <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: 'rgba(99,102,241,0.08)', borderRadius: 8, fontSize: '0.85rem' }}>
          <strong>Base URL:</strong> <code>{BASE_URL}/api/v1/open</code><br />
          <strong>认证方式:</strong> Header <code>x-api-key: your_api_key</code><br />
          <strong>获取 API Key:</strong> 在 <a href="/settings" style={{ color: 'var(--primary)' }}>设置页面</a> 创建
        </div>
      </div>

      <Section id="auth" title="认证" icon={Key}>
        <p>所有 <code>/api/v1/open/*</code> 接口需要在请求 Header 中传入 API Key：</p>
        <CodeBlock code={`curl -H "x-api-key: sk-cmo-xxxxxxxxxxxx" ${BASE_URL}/api/v1/open/quota`} />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          API Key 在「设置 → API 密钥」中创建。每个 Key 仅显示一次，请妥善保管。
        </p>
      </Section>

      <Section id="quota" title="查询额度" icon={CreditCard}>
        <Endpoint method="GET" path="/api/v1/open/quota" desc="查询剩余积分">
          <p><strong>响应示例：</strong></p>
          <CodeBlock language="json" code={`{
  "credits_remaining": 15,
  "username": "your_name",
  "is_premium": false
}`} />
        </Endpoint>
      </Section>

      <Section id="analyze" title="分析产品" icon={Zap}>
        <Endpoint method="POST" path="/api/v1/open/analyze" desc="分析产品推广机会（消耗 1 积分）">
          <p><strong>请求体：</strong></p>
          <CodeBlock language="json" code={`{
  "product": "https://yourproduct.com",  // 必填：产品 URL 或名称
  "language": "zh",                       // 可选：en/zh/ja/ko 等
  "max_results": 10                       // 可选：返回结果数（1-20）
}`} />
          <p><strong>响应结构：</strong></p>
          <CodeBlock language="json" code={`{
  "success": true,
  "product_name": "Your Product",
  "product_type": "SaaS Tool",
  "total_found": 12,
  "platforms_searched": 6,
  "promotions": [
    {
      "rank": 1,
      "platform": "reddit",
      "url": "https://reddit.com/r/...",
      "title": "帖子标题",
      "suggested_comment": "建议评论话术...",
      "comment_strategy": "评论策略说明...",
      "why_recommend": "推荐理由...",
      "best_timing": "最佳发布时间",
      "risk_level": "low",
      "risk_note": "风险说明",
      "estimated_exposure": "~5K views",
      "composite_score": 85.5,
      "engagement_stats": {"upvotes": 150, "comments": 23}
    }
  ],
  "strategy": {
    "priority_actions": ["Action 1", "Action 2"],
    "weekly_plan": "每周计划...",
    "kpi_targets": "KPI 目标..."
  },
  "credits_remaining": 14
}`} />
        </Endpoint>

        <Endpoint method="POST" path="/api/v1/open/analyze/csv" desc="分析并直接导出 CSV（消耗 1 积分）⭐ OpenClaw 推荐">
          <p>与 <code>/analyze</code> 相同的请求体，但直接返回 CSV 文件而非 JSON。</p>
          <p><strong>适用场景：</strong>OpenClaw 自动化推流 — 一步获取可直接使用的推广数据。</p>
          <CodeBlock code={`curl -X POST "${BASE_URL}/api/v1/open/analyze/csv" \\
  -H "x-api-key: sk-cmo-xxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"product": "https://yoursite.com", "language": "en"}' \\
  -o promotions.csv`} />
          <p><strong>CSV 列：</strong></p>
          <table className="admin-table" style={{ fontSize: '0.8rem' }}>
            <thead><tr><th>列名</th><th>说明</th></tr></thead>
            <tbody>
              <tr><td>Rank</td><td>推荐排名</td></tr>
              <tr><td>Platform</td><td>平台名 (reddit, youtube, twitter...)</td></tr>
              <tr><td>URL</td><td>帖子/页面链接 — OpenClaw 访问此 URL</td></tr>
              <tr><td>Title</td><td>帖子标题</td></tr>
              <tr><td>Suggested Comment</td><td>建议评论内容 — OpenClaw 直接发送</td></tr>
              <tr><td>Comment Strategy</td><td>评论策略说明</td></tr>
              <tr><td>Why Recommend</td><td>推荐理由</td></tr>
              <tr><td>Best Timing</td><td>最佳发布时间</td></tr>
              <tr><td>Risk Level</td><td>风险等级 (low/medium/high)</td></tr>
              <tr><td>Estimated Exposure</td><td>预估曝光量</td></tr>
              <tr><td>Score</td><td>综合评分 (0-100)</td></tr>
            </tbody>
          </table>
        </Endpoint>
      </Section>

      <Section id="history" title="历史记录" icon={History}>
        <Endpoint method="GET" path="/api/v1/open/history" desc="获取分析历史列表">
          <p>Query 参数：<code>limit</code>（默认 20）</p>
          <CodeBlock code={`curl -H "x-api-key: sk-cmo-xxxx" "${BASE_URL}/api/v1/open/history?limit=5"`} />
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/open/history/{id}" desc="获取某次分析的完整结果">
          <CodeBlock code={`curl -H "x-api-key: sk-cmo-xxxx" "${BASE_URL}/api/v1/open/history/abc-123-def"`} />
        </Endpoint>

        <Endpoint method="GET" path="/api/v1/open/history/{id}/csv" desc="导出历史分析为 CSV">
          <p>将已有的分析结果导出为 CSV 文件（不消耗积分）。</p>
          <CodeBlock code={`curl -H "x-api-key: sk-cmo-xxxx" "${BASE_URL}/api/v1/open/history/abc-123-def/csv" -o result.csv`} />
        </Endpoint>
      </Section>

      <Section id="export" title="CSV 导出详解" icon={Download}>
        <div style={{ lineHeight: 1.8 }}>
          <h3>OpenClaw 自动化推流工作流</h3>
          <p>AI-CMO 的 CSV 导出专为 OpenClaw 等自动化工具设计。典型工作流：</p>
          <ol style={{ paddingLeft: '1.2rem' }}>
            <li><strong>调用 API</strong> — <code>POST /api/v1/open/analyze/csv</code> 获取推广数据</li>
            <li><strong>OpenClaw 读取 CSV</strong> — 逐行处理每个推广帖子</li>
            <li><strong>自动访问 URL</strong> — OpenClaw 打开帖子链接</li>
            <li><strong>自动发布评论</strong> — 使用 <code>Suggested Comment</code> 列内容发帖</li>
          </ol>
          <h3 style={{ marginTop: '1rem' }}>推荐频率</h3>
          <table className="admin-table" style={{ fontSize: '0.85rem' }}>
            <thead><tr><th>策略</th><th>频率</th><th>每次帖数</th><th>说明</th></tr></thead>
            <tbody>
              <tr><td>保守</td><td>每 2 天</td><td>3-5 条</td><td>低风险，适合新账号</td></tr>
              <tr><td>稳健</td><td>每天 1 次</td><td>5-8 条</td><td>平衡效果与风险</td></tr>
              <tr><td>激进</td><td>每天 1-2 次</td><td>8-10 条</td><td>适合老号、多账号轮换</td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="errors" title="错误码说明" icon={Key}>
        <table className="admin-table" style={{ fontSize: '0.85rem' }}>
          <thead><tr><th>状态码</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td><code>200</code></td><td>成功</td></tr>
            <tr><td><code>401</code></td><td>API Key 无效或缺失</td></tr>
            <tr><td><code>402</code></td><td>积分不足，请充值</td></tr>
            <tr><td><code>403</code></td><td>账户被禁用</td></tr>
            <tr><td><code>404</code></td><td>资源不存在</td></tr>
            <tr><td><code>500</code></td><td>服务器内部错误（分析失败会自动退款）</td></tr>
          </tbody>
        </table>
      </Section>
    </div>
  );
}
