"""部署自检：在容器内创建一个演示企业并发布官网（不调用 LLM），用于验证 api / worker / sites 之间的
存储卷、软链接切换与 Nginx 托管是否打通。

用法（仅在隔离环境中使用）：
    docker compose -p aicmo-v2 exec api python -m app.workers.smoke_publish
输出：发布后的主机名与站点 ID（JSON）。
"""

from __future__ import annotations

import json
import secrets

from app.core.db import get_sessionmaker
from app.core.jobs import Job
from app.modules.companies.models import Company, CompanyProfile
from app.modules.sites import service
from app.modules.sites.content import SiteContent
from app.workers import handlers  # noqa: F401


def main() -> None:
    with get_sessionmaker()() as db:
        company = Company(name_cn="部署自检工厂", name_en=f"Smoke Check {secrets.token_hex(3)}", status="active")
        db.add(company)
        db.flush()
        db.add(CompanyProfile(company_id=company.id))
        site = service.get_or_create_site(db, company)
        content = SiteContent.model_validate(
            {
                "company_name": company.name_en,
                "hero": {"headline": "Deployment smoke check"},
                "contact": {"email": "smoke@example.com"},
                "seo": {"title": "Smoke check", "description": "Deployment smoke check page"},
            }
        )
        version = service.new_version(db, site, content, [], note="部署自检", user_id=None)
        site.task_status = "running"
        site.task_progress = []
        db.commit()
        job = Job(kind=service.PUBLISH_JOB, payload={"site_id": str(site.id), "version_id": str(version.id)})
        service.handle_publish(db, job)
        db.commit()
        print(json.dumps({"host": service.site_hosts(site)[0], "site_id": str(site.id)}))


if __name__ == "__main__":
    main()
