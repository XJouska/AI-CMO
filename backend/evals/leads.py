"""商机质量评测（plans/05 第 8 节）。

数据集：evals/datasets/*.jsonl，每行一条标注好的信号：
  {"id", "title", "snippet", "label": tender|rfq|buyer_intent|prospect|irrelevant,
   "valid": bool, "duplicate_of": id|null}

指标：
- intent_accuracy：意图分类准确率
- top20_valid_rate：按评分排序后前 20 条中有效商机的比例
- duplicate_rate：输出的商机中重复（同一需求出现多次）的比例
- fake_rate：输出的商机中虚假 / 无效的比例

用法：
  python -m evals.leads                       # 使用 TEST_MODE 的规则化分析器（回归基线）
  python -m evals.leads --live                # 使用真实 LLM（需要 LLM_API_KEY）
  python -m evals.leads --check baseline.json # 与基线对比，指标下降则退出码 1
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.modules.leads import scoring
from app.modules.leads.pipeline import Analysis, analysis_messages
from app.services.llm import LLMClient, parse_json_object

DATASETS = Path(__file__).parent / "datasets"
TARGETS = {"top20_valid_rate": 0.6, "duplicate_rate": 0.05}


@dataclass
class Sample:
    id: str
    title: str
    snippet: str
    label: str
    valid: bool
    duplicate_of: str | None


def load(path: Path) -> list[Sample]:
    return [Sample(**json.loads(line)) for line in path.read_text().splitlines() if line.strip()]


class _Company:
    name_en = "Evaluation Factory"
    name_cn = "评测工厂"


class _Product:
    def __init__(self, name: str, keywords: list[str]) -> None:
        self.name_en = name
        self.keywords_en = keywords


async def evaluate(samples: list[Sample], llm: LLMClient) -> dict[str, Any]:
    from app.modules.sources.connectors import RawSignal

    products = [_Product("Ball Valve", ["ball valve", "gate valve", "industrial valve"])]
    predictions: list[tuple[Sample, Analysis, int]] = []
    for sample in samples:
        signal = RawSignal("eval", f"https://eval.example/{sample.id}", sample.title, sample.snippet)
        result = await llm.complete(
            analysis_messages(_Company(), products, signal),
            task="leads.analyze",  # type: ignore[arg-type]
            json_mode=True,
        )
        analysis = Analysis.model_validate(parse_json_object(result.content))
        total, _ = scoring.score(
            scoring.ScoreInput(
                type=analysis.classification,
                product_match=analysis.product_match,
                published_at=None,
                deadline=None,
                potential=analysis.potential,
                has_contact=analysis.has_contact,
                has_bid_portal=analysis.has_bid_portal,
                source_trust=60,
                now=datetime.now(UTC),
            )
        )
        predictions.append((sample, analysis, total))

    correct = sum(1 for s, a, _ in predictions if a.classification == s.label)
    candidates = sorted(
        [(s, a, t) for s, a, t in predictions if a.classification != "irrelevant" and not a.is_fake],
        key=lambda x: -x[2],
    )
    # 与流水线相同的去重：同一买家（域名 / 名称）且标题相似或截止日期相同的需求合并为一条
    leads: list[tuple[Sample, Analysis, int]] = []
    for sample, analysis, total in candidates:
        current = {
            "buyer": analysis.buyer_name,
            "domain": analysis.buyer_domain,
            "title": sample.title,
            "deadline": analysis.deadline,
        }
        if any(
            scoring.same_requirement(
                current, {"buyer": a.buyer_name, "domain": a.buyer_domain, "title": s.title, "deadline": a.deadline}
            )
            for s, a, _ in leads
        ):
            continue
        leads.append((sample, analysis, total))
    top = leads[:20]
    ids = {s.id for s, _, _ in leads}
    duplicates = sum(1 for s, _, _ in leads if s.duplicate_of and s.duplicate_of in ids)
    fake = sum(1 for s, _, _ in leads if not s.valid)
    return {
        "samples": len(samples),
        "leads": len(leads),
        "intent_accuracy": round(correct / len(samples), 3) if samples else 0,
        "top20_valid_rate": round(sum(1 for s, _, _ in top if s.valid) / len(top), 3) if top else 0,
        "duplicate_rate": round(duplicates / len(leads), 3) if leads else 0,
        "fake_rate": round(fake / len(leads), 3) if leads else 0,
        "confusion": [
            {"id": s.id, "label": s.label, "predicted": a.classification}
            for s, a, _ in predictions
            if a.classification != s.label
        ],
    }


def regressions(current: dict[str, Any], baseline: dict[str, Any]) -> list[str]:
    """越高越好的指标不得下降；越低越好的指标不得上升。"""
    problems = []
    for key in ("intent_accuracy", "top20_valid_rate"):
        if current[key] + 1e-9 < baseline.get(key, 0):
            problems.append(f"{key} 从 {baseline[key]} 下降到 {current[key]}")
    for key in ("duplicate_rate", "fake_rate"):
        if current[key] - 1e-9 > baseline.get(key, 1):
            problems.append(f"{key} 从 {baseline[key]} 上升到 {current[key]}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default=str(DATASETS / "valves_synthetic.jsonl"))
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--check")
    args = parser.parse_args()
    if args.live:
        from app.services.llm import OpenAICompatLLM

        llm: LLMClient = OpenAICompatLLM()
    else:
        from app.services.fakes import FakeLLM

        llm = FakeLLM()
    metrics = asyncio.run(evaluate(load(Path(args.dataset)), llm))
    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    if args.check:
        problems = regressions(metrics, json.loads(Path(args.check).read_text()))
        for problem in problems:
            print(f"✗ {problem}", file=sys.stderr)
        return 1 if problems else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
