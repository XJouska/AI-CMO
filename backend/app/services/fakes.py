"""外部服务的假实现（测试与 TEST_MODE 使用）。不访问网络，结果可预测。"""

from __future__ import annotations

import json
import re
from collections import defaultdict, deque
from collections.abc import AsyncIterator, Callable
from typing import Any

from app.services.llm import LLMError, LLMResult, LLMUsage, Message

Responder = Callable[[list[Message]], LLMResult | str | dict[str, Any]]


def _last_user_text(messages: list[Message]) -> str:
    for message in reversed(messages):
        if message.get("role") == "user":
            content = message.get("content")
            return content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)
    return ""


def fake_profile_extract(messages: list[Message]) -> dict[str, Any]:
    """根据输入文本做简单的规则抽取，模拟 LLM 的结构化输出。"""
    text = _last_user_text(messages)
    result: dict[str, Any] = {"company": {}, "products": [], "certifications": [], "contacts": {}}
    company = result["company"]
    if m := re.search(r"(?:Founded in|成立于)\s*(\d{4})", text):
        company["founded_year"] = int(m.group(1))
    if m := re.search(r"(\d[\d,]*)\s*(?:employees|名员工|人)", text):
        company["employees"] = m.group(1).replace(",", "")
    if m := re.search(r"([\d,]+)\s*(?:square meters|平方米|㎡)", text):
        company["factory_area"] = f"{m.group(1)} m²"
    if m := re.search(r"Annual capacity\s*([^.<]+)", text, re.I):
        company["annual_capacity"] = m.group(1).strip()
    if m := re.search(r"<title>([^<]+)</title>", text):
        company["name_en"] = m.group(1).strip()
    markets = re.search(r"Export markets?:\s*([^.<]+)", text, re.I)
    if markets:
        company["export_markets"] = [part.strip() for part in markets.group(1).split(",") if part.strip()]
    certs = re.findall(r"\b(ISO\s?\d{4,5}|CE|FDA|RoHS|UL|API\s?6D)\b", text)
    result["certifications"] = sorted(set(c.replace("ISO", "ISO ").replace("  ", " ").strip() for c in certs))
    if m := re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", text):
        result["contacts"]["email"] = m.group(0)
    if re.search(r"valve|阀门", text, re.I):
        result["products"].append(
            {
                "name_en": "Stainless Steel Ball Valve",
                "name_cn": "不锈钢球阀",
                "category": "Valves",
                "keywords_en": ["stainless steel ball valve", "industrial valve"],
                "applications": ["water treatment", "oil and gas"],
            }
        )
        company.setdefault("usp", "Factory-direct stainless steel valves with in-house casting and testing.")
    return result


_URL_RE = re.compile(r"(?:https?://)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:/\S*)?", re.I)


def fake_assistant_chat(messages: list[Message]) -> LLMResult:
    """TEST_MODE 下的助手：按关键词选择工具，拿到工具结果后给出固定格式的回答。"""
    last = messages[-1] if messages else {}
    if last.get("role") == "tool":
        content = str(last.get("content", ""))
        if '"completeness"' in content:
            data = json.loads(content).get("untrusted_data", {})
            missing = "\n".join(f"- {item['label']}" for item in data.get("missing", [])[:3])
            score = data.get("completeness", 0)
            return LLMResult(content=f"### 档案情况\n目前完整度 **{score}%**，建议先补充：\n{missing}")
        if '"generating"' in content:
            return LLMResult(content="官网正在生成，通常需要一两分钟，完成后可以在「官网」页预览。")
        if '"extraction_id"' in content:
            return LLMResult(content="我已经开始整理，完成后请在上方卡片中确认要采纳的内容。")
        if '"waiting_for_user_confirmation"' in content:
            return LLMResult(content="")
        if '"markdown"' in content and "效果周报" in content:
            return LLMResult(content=json.loads(content).get("untrusted_data", {}).get("markdown", ""))
        if '"items"' in content and '"next_action"' in content:
            data = json.loads(content).get("untrusted_data", {})
            lines = "\n".join(
                f"{i}. {item['title']}（{item['next_action'] or item['stage']}）"
                for i, item in enumerate(data.get("items", []), 1)
            )
            return LLMResult(content=f"今天有 {data.get('count', 0)} 条商机需要跟进：\n{lines}")
        if '"count": 0' in content and '"items"' in content:
            return LLMResult(content="目前没有到期需要跟进的商机。")
        return LLMResult(content="好的，已经处理完成。")
    text = _last_user_text(messages)
    if m := _URL_RE.search(text):
        return _tool_call("profile_extract_from_url", {"url": m.group(0)})
    if re.search(r"周报", text):
        return _tool_call("report_weekly", {"week": "this" if "本周" in text else "last"})
    if re.search(r"跟进哪些|待跟进|该跟进", text):
        return _tool_call("pipeline_list_due", {})
    if re.search(r"发布官网|上线官网", text):
        return _tool_call("site_publish", {})
    if re.search(r"生成.*官网|官网.*生成", text):
        return _tool_call("site_generate_draft", {})
    if re.search(r"档案|完整度", text):
        return _tool_call("profile_get_completeness", {})
    if m := re.search(r"成立于?\s*(\d{4})", text):
        return _tool_call("profile_update_fields", {"company": {"founded_year": int(m.group(1))}})
    return LLMResult(content="我可以帮你整理企业档案、生成英文官网、寻找海外采购商。你想先做哪一件？")


def _tool_call(name: str, args: dict[str, Any]) -> LLMResult:
    return LLMResult(
        content="",
        usage=LLMUsage(prompt_tokens=50, completion_tokens=10),
        tool_calls=[{"id": f"call_{name}", "name": name, "arguments": json.dumps(args, ensure_ascii=False)}],
    )


def fake_site_generate(messages: list[Message]) -> dict[str, Any]:
    """TEST_MODE：根据档案数据生成固定格式的官网文案（只使用输入中的事实）。"""
    raw = _last_user_text(messages)
    try:
        data = json.loads(raw.split("<data>\n", 1)[1].rsplit("\n</data>", 1)[0])
    except (IndexError, json.JSONDecodeError):
        data = {"company": {}, "products": []}
    company = data.get("company", {})
    name = company.get("name_en") or company.get("name_cn") or "Our Company"
    products = data.get("products", [])
    first = products[0]["name_en"] if products else "industrial products"
    return {
        "hero": {
            "headline": f"{name}: Reliable {first} Manufacturer",
            "subheadline": company.get("usp") or "",
            "cta": "Request a Quote",
        },
        "about": {
            "title": "About Us",
            "body": company.get("about_en") or company.get("usp") or "",
            "highlights": [h for h in [company.get("usp")] if h],
        },
        "products": {
            "items": [
                {
                    "product_id": p["id"],
                    "name": p["name_en"],
                    "summary": f"{p['name_en']} for {', '.join(p.get('applications') or ['industrial use'])}.",
                }
                for p in products
            ]
        },
        "factory": {"body": f"Our factory covers {company['factory_area']}." if company.get("factory_area") else ""},
        "faq": {"items": [{"q": "What is your MOQ?", "a": "Please contact us for details."}]},
        "cases": {"items": []},
        "seo": {
            "title": f"{name} | {first} Manufacturer"[:70],
            "description": f"{name} manufactures {first}. Factory-direct supply for global B2B buyers."[:200],
            "keywords": [p["name_en"].lower() for p in products][:10],
        },
    }


def fake_site_rewrite(messages: list[Message]) -> dict[str, Any]:
    raw = _last_user_text(messages)
    try:
        section = json.loads(raw.split("<data>", 1)[1].split("</data>", 1)[0])
    except (IndexError, json.JSONDecodeError):
        return {}
    if isinstance(section, dict) and "headline" in section:
        section["headline"] = (section["headline"] + " — Factory Direct")[:120]
    return section


def fake_leads_analyze(messages: list[Message]) -> dict[str, Any]:
    """TEST_MODE：按关键词判断类型，从文本中提取买家域名与截止日期。"""
    text = _last_user_text(messages)
    data = text.split("<data>", 1)[-1]
    lower = data.lower()
    if re.search(r"encyclopedia|history of|market report|forecast", lower):
        return {"classification": "irrelevant", "confident": True}
    if re.search(r"we manufacture|best price|our factory|advertisement", lower):  # 卖家广告
        return {"classification": "irrelevant", "confident": True}
    if re.search(r"you won|prize|pay shipping|free samples to win", lower):  # 诈骗
        return {"classification": "irrelevant", "confident": True, "is_fake": True}
    kind = (
        "tender"
        if re.search(r"tender|invites bids|invites quotations", lower)
        else "rfq"
        if re.search(r"rfq|request(s)? (for )?quotation", lower)
        else "buyer_intent"
    )
    domain = m.group(1).rstrip(".") if (m := re.search(r"@([\w.-]+\.example)", data)) else ""
    host = m.group(1) if (m := re.search(r"https://([\w.-]+)/", data)) else ""
    country = m.group(1) if (m := re.search(r"\(([A-Z][a-z]+)\)", data)) else ""
    deadline = m.group(1) if (m := re.search(r"Deadline (\d{4}-\d{2}-\d{2})", data)) else ""
    buyer = f"Utility {country}".strip() if kind == "tender" else f"Distributor via {host}"
    return {
        "classification": kind,
        "confident": True,
        "product_match": 85,
        "products_matched": ["matched product"],
        "buyer_name": buyer,
        "buyer_domain": domain,
        "country": country,
        "deadline": deadline,
        "potential": 70 if kind == "tender" else 50,
        "has_contact": bool(domain),
        "has_bid_portal": kind == "tender",
        "summary_cn": "采购需求与贵司产品匹配" if kind != "tender" else "市政水务项目招标，需求与贵司产品匹配",
        "reasons": ["需求产品与主营产品一致", "目标市场在出口范围内"],
        "suggested_action": "准备产品目录与资质文件，在截止日期前联系采购方",
    }


def fake_outreach_draft(messages: list[Message]) -> dict[str, Any]:
    """TEST_MODE：只用输入中的事实拼出开发信；支持「再短一点」「强调 XX 认证」类修改。"""
    text = _last_user_text(messages)
    system = str(messages[0].get("content", "")) if messages else ""

    def tag(name: str) -> dict[str, Any]:
        m = re.search(rf"<{name}>(.*?)</{name}>", text, re.S)
        try:
            return json.loads(m.group(1)) if m else {}
        except ValueError:
            return {}

    facts, lead = tag("facts"), tag("lead")
    request = m.group(1) if (m := re.search(r"<revision_request>(.*?)</revision_request>", text, re.S)) else ""
    company = facts.get("company", {})
    product = (facts.get("products") or [{}])[0].get("name_en") or "industrial products"
    certs = company.get("certifications") or []
    if want := re.search(r"(ISO\s?\d{4,5}|CE|FDA|RoHS|UL)", request):
        certs = [c for c in certs if c.replace(" ", "") == want.group(1).replace(" ", "")] + [
            c for c in certs if c.replace(" ", "") != want.group(1).replace(" ", "")
        ]
    concise = "Tone: Short" in system or re.search(r"短|short", request, re.I)
    need = lead.get("title", "your requirement")
    sentences = [
        "Dear Purchasing Team,",
        f"I noticed your recent request: {need}. We are {company.get('name', 'a manufacturer')}, "
        f"a factory specialising in {product}, and I believe we can support this project directly.",
    ]
    if certs:
        sentences.append(
            f"Our products are certified to {', '.join(certs)}, which helps simplify your approval process."
        )
    if company.get("export_markets"):
        sentences.append(f"We already supply customers in {', '.join(company['export_markets'][:3])}.")
    if company.get("usp"):
        sentences.append(f"What sets us apart: {company['usp']}.")
    sentences.append(
        "Because we manufacture in-house, we can offer stable quality, clear documentation and flexible production "
        "planning for both trial orders and long-term supply."
    )
    if not concise:
        sentences.append(
            "We would be glad to review your technical specifications, confirm materials and testing requirements, "
            "and propose a delivery schedule that fits your timeline. Our engineering team can also suggest "
            "alternatives if any specification is difficult to source."
        )
    if facts.get("website"):
        sentences.append(f"You can find our product range at {facts['website']}.")
    sentences.append(
        "Could you share the detailed specifications and expected quantities? I will send a quotation and our "
        "catalogue within one working day."
    )
    sentences.append(f"Best regards,\n{facts.get('signature', '')}")
    body = "\n\n".join(sentences)
    filler = (
        "We understand that choosing a new supplier takes time, so we are happy to start with samples "
        "and share inspection reports for your review before any commitment."
    )
    while len(re.findall(r"[A-Za-z0-9'-]+", body)) < (120 if concise else 150):
        body = body.replace("Best regards,", f"{filler}\n\nBest regards,", 1)
        filler = "Thank you for considering us as a partner for this project."
    return {"subject": f"Re: {need}"[:120], "body": body}


def fake_outreach_kit(messages: list[Message]) -> dict[str, Any]:
    """TEST_MODE：按系统提示中列出的渠道，用输入事实拼出中英文对照话术。"""
    text = _last_user_text(messages)
    system = str(messages[0].get("content", "")) if messages else ""
    channels = re.findall(r"^- (email|whatsapp|phone|linkedin|form):", system, re.M)

    def tag(name: str) -> dict[str, Any]:
        m = re.search(rf"<{name}>(.*?)</{name}>", text, re.S)
        try:
            return json.loads(m.group(1)) if m else {}
        except ValueError:
            return {}

    facts, lead = tag("facts"), tag("lead")
    company = facts.get("company", {}).get("name", "our factory")
    product = (facts.get("products") or [{}])[0].get("name_en") or "industrial products"
    need = lead.get("title", "your requirement")
    signature = facts.get("signature", "")
    items = []
    for channel in channels:
        if channel == "email":
            email = fake_outreach_draft(messages)
            items.append(
                {
                    "channel": "email",
                    "subject": email["subject"],
                    "body": email["body"],
                    "subject_zh": f"回复：{need}",
                    "body_zh": f"您好，我们看到贵司的需求「{need}」。我们是{company}，专业生产{product}，"
                    "可以直接支持这个项目。请发来详细规格和数量，我们一个工作日内回复报价和目录。",
                }
            )
        elif channel == "whatsapp":
            items.append(
                {
                    "channel": "whatsapp",
                    "body": f"Hi, this is {company}. We make {product} and saw your request: {need}. "
                    "Could you share the specs and quantity? We can send a quotation within one day.",
                    "body_zh": f"您好，我们是{company}，生产{product}，看到了您的需求「{need}」。"
                    "方便发一下规格和数量吗？我们一天内给您报价。",
                }
            )
        elif channel == "phone":
            items.append(
                {
                    "channel": "phone",
                    "body": f"Hello, this is {signature.splitlines()[0] if signature else 'sales'} from {company}.\n"
                    f"- We manufacture {product}.\n- We saw your request: {need}.\n"
                    "- We can send samples and a quotation.\nAsk: Who handles purchasing for this project?\n"
                    "Close: May I email you our catalogue?",
                    "body_zh": f"您好，我是{company}的业务。\n- 我们生产{product}。\n- 看到了您的需求「{need}」。\n"
                    "- 可以寄样品并报价。\n提问：这个项目的采购由谁负责？\n结尾：我可以把产品目录发到您邮箱吗？",
                }
            )
        elif channel == "linkedin":
            items.append(
                {
                    "channel": "linkedin",
                    "body": f"Hi, I'm with {company}, a manufacturer of {product}. Saw your request ({need[:60]}) "
                    "and would be glad to connect.",
                    "body_zh": f"您好，我在{company}工作，我们生产{product}。看到贵司的需求，希望能和您建立联系。",
                }
            )
        elif channel == "form":
            items.append(
                {
                    "channel": "form",
                    "body": f"Dear team, we are {company}, a manufacturer of {product}. Regarding your request "
                    f"({need}), we can supply directly from our factory. Please let us know the specifications "
                    "and quantity, and we will reply with a quotation and catalogue within one working day.",
                    "body_zh": f"您好，我们是{company}，生产{product}。关于贵司的需求「{need}」，我们可以工厂直供。"
                    "请告知规格和数量，我们一个工作日内回复报价和目录。",
                }
            )
    return {"items": items}


DEFAULT_RESPONDERS: dict[str, Responder] = {
    "outreach.draft": fake_outreach_draft,
    "outreach.kit": fake_outreach_kit,
    "leads.analyze": fake_leads_analyze,
    "profile.extract": fake_profile_extract,
    "assistant.chat": fake_assistant_chat,
    "site.generate": fake_site_generate,
    "site.rewrite": fake_site_rewrite,
}


class FakeLLM:
    """按任务名返回预设结果。

    - `script(task, *responses)`：按顺序返回指定结果（字符串、dict 或 LLMResult；Exception 实例会被抛出）
    - 未设置脚本时使用 DEFAULT_RESPONDERS；仍没有则返回空 JSON 对象
    """

    def __init__(self) -> None:
        self._scripts: dict[str, deque[Any]] = defaultdict(deque)
        self.calls: list[dict[str, Any]] = []

    def script(self, task: str, *responses: Any) -> FakeLLM:
        self._scripts[task].extend(responses)
        return self

    def _respond(self, task: str, messages: list[Message]) -> LLMResult:
        queue = self._scripts.get(task)
        if queue:
            value = queue.popleft()
        else:
            responder = DEFAULT_RESPONDERS.get(task)
            value = responder(messages) if responder else {}
        if isinstance(value, Exception):
            raise value
        if callable(value):
            value = value(messages)
        prompt_chars = sum(len(str(m.get("content", ""))) for m in messages)
        if isinstance(value, LLMResult):
            if not value.usage.total:  # 模拟真实接口：每次调用都有 token 用量
                value.usage = LLMUsage(prompt_tokens=prompt_chars // 4, completion_tokens=len(value.content) // 4 + 1)
            return value
        content = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        return LLMResult(
            content=content,
            usage=LLMUsage(prompt_tokens=prompt_chars // 4, completion_tokens=len(content) // 4),
        )

    async def complete(
        self,
        messages: list[Message],
        *,
        task: str,
        json_mode: bool = False,
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 2048,
    ) -> LLMResult:
        # 保存调用时的消息快照（调用方之后会继续向同一个列表追加消息）
        self.calls.append(
            {"task": task, "messages": [dict(m) for m in messages], "json_mode": json_mode, "tools": tools}
        )
        return self._respond(task, messages)

    async def stream(self, messages: list[Message], *, task: str, max_tokens: int = 2048) -> AsyncIterator[str]:
        self.calls.append({"task": task, "messages": messages, "stream": True})
        result = self._respond(task, messages)
        for index in range(0, len(result.content), 8):
            yield result.content[index : index + 8]


class FailingLLM(FakeLLM):
    async def complete(self, messages: list[Message], **kwargs: Any) -> LLMResult:  # type: ignore[override]
        raise LLMError("模拟 LLM 故障")
