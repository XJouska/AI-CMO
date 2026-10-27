"""全部 ORM 模型的汇总导入点（Alembic 与测试使用）。各计划新增模型后在此登记。"""

from app.core.jobs import Job
from app.modules.assistant.models import Conversation, Message, ToolRun
from app.modules.auth.models import LoginAttempt, Session, User
from app.modules.companies.models import (
    Asset,
    Company,
    CompanyMember,
    CompanyProfile,
    Invite,
    Product,
    ProfileExtraction,
)
from app.modules.leads.models import (
    Buyer,
    Lead,
    LeadFeedback,
    LeadSignal,
    Signal,
    SourceConfig,
    SourceRequest,
    Watch,
    WatchRun,
)
from app.modules.outreach.models import (
    EmailSuppression,
    LeadActivity,
    LeadPipeline,
    MailAccount,
    OutreachDraft,
    WeeklyReport,
)
from app.modules.sites.models import Notification, Site, SiteHealthReport, SiteInquiry, SiteVersion

__all__ = [
    "Asset",
    "Buyer",
    "Company",
    "CompanyMember",
    "CompanyProfile",
    "Conversation",
    "EmailSuppression",
    "Invite",
    "Job",
    "Lead",
    "LeadActivity",
    "LeadFeedback",
    "LeadPipeline",
    "LeadSignal",
    "LoginAttempt",
    "MailAccount",
    "Message",
    "Notification",
    "OutreachDraft",
    "Product",
    "ProfileExtraction",
    "Session",
    "Signal",
    "Site",
    "SiteHealthReport",
    "SiteInquiry",
    "SiteVersion",
    "SourceConfig",
    "SourceRequest",
    "ToolRun",
    "User",
    "Watch",
    "WatchRun",
    "WeeklyReport",
]
