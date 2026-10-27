"""企业、成员、邀请、企业档案、产品、资料、AI 建档接口。

路由分两类：
- `/companies/{company_id}/...`：路径中带企业 ID，直接校验成员关系
- `/profile`、`/products`、`/assets`、`/extractions`：通过请求头 X-Company-Id 确定企业（current_company）
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from fastapi.responses import Response as RawResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db, utcnow
from app.core.deps import (
    MANAGER_ROLES,
    CompanyScope,
    current_company,
    current_user,
    load_scope,
)
from app.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from app.core.providers import providers
from app.core.security.crypto import make_signed_query, new_token, token_hash, verify_signed
from app.core.security.ssrf import validate_url
from app.modules.auth.models import User
from app.modules.companies import extraction as extraction_service
from app.modules.companies.models import (
    Asset,
    Company,
    CompanyMember,
    CompanyProfile,
    Invite,
    Product,
    ProfileExtraction,
)
from app.modules.companies.profile import (
    CONTACT_FIELDS,
    apply_profile_fields,
    get_or_create_profile,
    refresh_completeness,
)
from app.modules.companies.uploads import ALLOWED_KINDS, display_name, process_upload

router = APIRouter(tags=["companies"])

DOWNLOAD_TTL_SECONDS = 600
MAX_COMPANIES_PER_USER = 20


# ── 企业 ───────────────────────────────────────────────────────────────


class CompanyIn(BaseModel):
    name_cn: str = Field(min_length=2, max_length=100)
    name_en: str = Field(default="", max_length=150)

    @field_validator("name_cn", "name_en")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class CompanyPatch(BaseModel):
    name_cn: str | None = Field(default=None, min_length=2, max_length=100)
    name_en: str | None = Field(default=None, max_length=150)


class CompanyOut(BaseModel):
    id: str
    name_cn: str
    name_en: str
    plan: str
    role: str


def company_out(company: Company, role: str) -> CompanyOut:
    return CompanyOut(
        id=str(company.id), name_cn=company.name_cn, name_en=company.name_en, plan=company.plan, role=role
    )


@router.post("/companies", response_model=CompanyOut, status_code=201)
def create_company(
    body: CompanyIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> CompanyOut:
    owned = (
        db.scalar(select(func.count()).select_from(CompanyMember).where(CompanyMember.user_id == user.id))
        or 0
    )
    if owned >= MAX_COMPANIES_PER_USER:
        raise AppError("企业数量已达上限", code="company_limit")
    company = Company(name_cn=body.name_cn, name_en=body.name_en)
    db.add(company)
    db.flush()
    db.add(CompanyMember(company_id=company.id, user_id=user.id, role="owner"))
    db.add(CompanyProfile(company_id=company.id))
    db.flush()
    refresh_completeness(db, company)
    db.commit()
    return company_out(company, "owner")


@router.get("/companies", response_model=list[CompanyOut])
def list_companies(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[CompanyOut]:
    rows = db.execute(
        select(Company, CompanyMember.role)
        .join(CompanyMember, CompanyMember.company_id == Company.id)
        .where(CompanyMember.user_id == user.id, Company.status == "active")
        .order_by(CompanyMember.created_at)
    ).all()
    return [company_out(company, role) for company, role in rows]


def path_scope(
    company_id: uuid.UUID, user: User, db: Session, roles: tuple[str, ...] | None = None
) -> CompanyScope:
    scope = load_scope(db, user, company_id)
    if roles and scope.role not in roles:
        raise ForbiddenError("没有权限执行此操作")
    return scope


@router.get("/companies/{company_id}", response_model=CompanyOut)
def get_company(
    company_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> CompanyOut:
    scope = path_scope(company_id, user, db)
    return company_out(scope.company, scope.role)


@router.patch("/companies/{company_id}", response_model=CompanyOut)
def patch_company(
    company_id: uuid.UUID,
    body: CompanyPatch,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> CompanyOut:
    scope = path_scope(company_id, user, db, MANAGER_ROLES)
    if body.name_cn is not None:
        scope.company.name_cn = body.name_cn.strip()
    if body.name_en is not None:
        profile = get_or_create_profile(db, company_id)
        apply_profile_fields(scope.company, profile, {"name_en": body.name_en.strip()}, source="manual")
    refresh_completeness(db, scope.company)
    db.commit()
    return company_out(scope.company, scope.role)


# ── 成员与邀请 ─────────────────────────────────────────────────────────


class MemberOut(BaseModel):
    user_id: str
    name: str
    email: str
    role: str
    is_me: bool


@router.get("/companies/{company_id}/members", response_model=list[MemberOut])
def list_members(
    company_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> list[MemberOut]:
    path_scope(company_id, user, db)
    rows = db.execute(
        select(User, CompanyMember.role)
        .join(CompanyMember, CompanyMember.user_id == User.id)
        .where(CompanyMember.company_id == company_id)
        .order_by(CompanyMember.created_at)
    ).all()
    return [
        MemberOut(
            user_id=str(member.id),
            name=member.name,
            email=member.email,
            role=role,
            is_me=member.id == user.id,
        )
        for member, role in rows
    ]


@router.delete("/companies/{company_id}/members/{user_id}", status_code=204)
def remove_member(
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> Response:
    path_scope(company_id, user, db, ("owner",))
    member = db.get(CompanyMember, {"company_id": company_id, "user_id": user_id})
    if member is None:
        raise NotFoundError("成员不存在")
    if member.role == "owner":
        raise AppError("不能移除企业所有者", code="cannot_remove_owner")
    db.delete(member)
    db.commit()
    return Response(status_code=204)


class InviteIn(BaseModel):
    role: Literal["member", "operator"] = "member"


class InviteOut(BaseModel):
    token: str
    expires_at: str
    role: str


@router.post("/companies/{company_id}/invites", response_model=InviteOut, status_code=201)
def create_invite(
    company_id: uuid.UUID, body: InviteIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> InviteOut:
    path_scope(company_id, user, db, MANAGER_ROLES)
    if body.role == "operator" and not user.is_staff:
        raise ForbiddenError("只有平台运营人员可以邀请代运营角色")
    token = new_token()
    expires = utcnow() + timedelta(hours=get_settings().invite_ttl_hours)
    db.add(
        Invite(
            company_id=company_id,
            token_hash=token_hash(token),
            role=body.role,
            expires_at=expires,
            created_by=user.id,
        )
    )
    db.commit()
    return InviteOut(token=token, expires_at=expires.isoformat(), role=body.role)


class InvitePreview(BaseModel):
    company_name: str
    role: str
    expires_at: str


def _valid_invite(db: Session, token: str, *, lock: bool = False) -> Invite:
    stmt = select(Invite).where(Invite.token_hash == token_hash(token))
    if lock:
        stmt = stmt.with_for_update()
    invite = db.scalar(stmt)
    if invite is None or invite.accepted_at is not None or invite.expires_at <= utcnow():
        raise NotFoundError("邀请链接无效或已过期", code="invite_invalid")
    return invite


@router.get("/invites/{token}", response_model=InvitePreview)
def preview_invite(
    token: str, _: User = Depends(current_user), db: Session = Depends(get_db)
) -> InvitePreview:
    invite = _valid_invite(db, token)
    company = db.get(Company, invite.company_id)
    assert company is not None
    return InvitePreview(
        company_name=company.name_cn, role=invite.role, expires_at=invite.expires_at.isoformat()
    )


@router.post("/invites/{token}/accept", response_model=CompanyOut)
def accept_invite(
    token: str, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> CompanyOut:
    invite = _valid_invite(db, token, lock=True)
    company = db.get(Company, invite.company_id)
    assert company is not None
    existing = db.get(CompanyMember, {"company_id": company.id, "user_id": user.id})
    if existing is not None:
        raise ConflictError("你已经是该企业的成员", code="already_member")
    if invite.role == "operator" and not user.is_staff:
        raise ForbiddenError("该邀请仅限平台运营人员接受")
    db.add(CompanyMember(company_id=company.id, user_id=user.id, role=invite.role))
    invite.accepted_by, invite.accepted_at = user.id, utcnow()
    db.commit()
    return company_out(company, invite.role)


# ── 企业档案 ───────────────────────────────────────────────────────────


class MissingItem(BaseModel):
    key: str
    label: str
    weight: int
    section: str


class ProfileOut(BaseModel):
    company_id: str
    name_cn: str
    name_en: str
    founded_year: int | None
    employees: str
    factory_area: str
    annual_capacity: str
    export_markets: list[str]
    certifications: list[str]
    main_customers_public: list[str]
    usp: str
    about_en: str
    contacts: dict[str, str]
    field_sources: dict[str, Any]
    completeness: int
    missing: list[MissingItem]
    product_count: int


def short_text(limit: int) -> Any:
    return Field(default=None, max_length=limit)


class ProfilePatch(BaseModel):
    name_en: str | None = short_text(150)
    founded_year: int | None = Field(default=None, ge=1900, le=2100)
    employees: str | None = short_text(32)
    factory_area: str | None = short_text(64)
    annual_capacity: str | None = short_text(200)
    export_markets: list[str] | None = Field(default=None, max_length=50)
    certifications: list[str] | None = Field(default=None, max_length=50)
    main_customers_public: list[str] | None = Field(default=None, max_length=50)
    usp: str | None = short_text(2000)
    about_en: str | None = short_text(4000)
    contacts: dict[str, str] | None = None

    @field_validator("export_markets", "certifications", "main_customers_public")
    @classmethod
    def _items(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned = [item.strip()[:80] for item in value if item.strip()]
        return list(dict.fromkeys(cleaned))

    @field_validator("contacts")
    @classmethod
    def _contacts(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        if value is None:
            return None
        unknown = set(value) - set(CONTACT_FIELDS)
        if unknown:
            raise ValueError("未知的联系方式字段")
        return {key: item.strip()[:200] for key, item in value.items()}


def profile_out(db: Session, company: Company) -> ProfileOut:
    profile = get_or_create_profile(db, company.id)
    score, missing = refresh_completeness(db, company)
    count = db.scalar(select(func.count()).select_from(Product).where(Product.company_id == company.id)) or 0
    return ProfileOut(
        company_id=str(company.id),
        name_cn=company.name_cn,
        name_en=company.name_en,
        founded_year=profile.founded_year,
        employees=profile.employees,
        factory_area=profile.factory_area,
        annual_capacity=profile.annual_capacity,
        export_markets=profile.export_markets,
        certifications=profile.certifications,
        main_customers_public=profile.main_customers_public,
        usp=profile.usp,
        about_en=profile.about_en,
        contacts={k: str(v) for k, v in (profile.contacts or {}).items()},
        field_sources=profile.field_sources or {},
        completeness=score,
        missing=[MissingItem(key=m.key, label=m.label, weight=m.weight, section=m.section) for m in missing],
        product_count=count,
    )


@router.get("/profile", response_model=ProfileOut)
def get_profile(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> ProfileOut:
    out = profile_out(db, scope.company)
    db.commit()
    return out


@router.patch("/profile", response_model=ProfileOut)
def patch_profile(
    body: ProfilePatch, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> ProfileOut:
    profile = get_or_create_profile(db, scope.company_id)
    fields: dict[str, Any] = {}
    for key, value in body.model_dump(exclude_unset=True).items():
        if key == "contacts":
            fields.update({f"contacts.{k}": v for k, v in (value or {}).items()})
        elif value is not None or key == "founded_year":
            fields[key] = value.strip() if isinstance(value, str) else value
    apply_profile_fields(scope.company, profile, fields, source="manual")
    out = profile_out(db, scope.company)
    db.commit()
    return out


# ── 产品 ───────────────────────────────────────────────────────────────


def clean_specs(value: dict[str, str]) -> dict[str, str]:
    if len(value) > 30:
        raise ValueError("规格项过多")
    return {k.strip()[:60]: str(v).strip()[:200] for k, v in value.items() if k.strip()}


class ProductIn(BaseModel):
    name_en: str = Field(min_length=1, max_length=200)
    name_cn: str = Field(default="", max_length=100)
    category: str = Field(default="", max_length=100)
    hs_codes: list[str] = Field(default_factory=list, max_length=20)
    specs: dict[str, str] = Field(default_factory=dict)
    moq: str = Field(default="", max_length=100)
    lead_time: str = Field(default="", max_length=100)
    applications: list[str] = Field(default_factory=list, max_length=30)
    keywords_en: list[str] = Field(default_factory=list, max_length=30)
    images: list[uuid.UUID] = Field(default_factory=list, max_length=12)

    @field_validator("hs_codes", "applications", "keywords_en")
    @classmethod
    def _items(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(item.strip()[:80] for item in value if item.strip()))

    @field_validator("specs")
    @classmethod
    def _specs(cls, value: dict[str, str]) -> dict[str, str]:
        return clean_specs(value)


class ProductPatch(BaseModel):
    name_en: str | None = Field(default=None, min_length=1, max_length=200)
    name_cn: str | None = Field(default=None, max_length=100)
    category: str | None = Field(default=None, max_length=100)
    hs_codes: list[str] | None = Field(default=None, max_length=20)
    specs: dict[str, str] | None = None
    moq: str | None = Field(default=None, max_length=100)
    lead_time: str | None = Field(default=None, max_length=100)
    applications: list[str] | None = Field(default=None, max_length=30)
    keywords_en: list[str] | None = Field(default=None, max_length=30)
    images: list[uuid.UUID] | None = Field(default=None, max_length=12)

    @field_validator("hs_codes", "applications", "keywords_en")
    @classmethod
    def _items(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        return list(dict.fromkeys(item.strip()[:80] for item in value if item.strip()))

    @field_validator("specs")
    @classmethod
    def _specs(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        return None if value is None else clean_specs(value)


class ProductOut(BaseModel):
    id: str
    name_en: str
    name_cn: str
    category: str
    hs_codes: list[str]
    specs: dict[str, Any]
    moq: str
    lead_time: str
    applications: list[str]
    keywords_en: list[str]
    images: list[str]
    source: str


def product_out(product: Product) -> ProductOut:
    return ProductOut(
        id=str(product.id),
        name_en=product.name_en,
        name_cn=product.name_cn,
        category=product.category,
        hs_codes=product.hs_codes,
        specs=product.specs,
        moq=product.moq,
        lead_time=product.lead_time,
        applications=product.applications,
        keywords_en=product.keywords_en,
        images=product.images,
        source=product.source,
    )


def _own_product(db: Session, scope: CompanyScope, product_id: uuid.UUID) -> Product:
    product = db.get(Product, product_id)
    if product is None or product.company_id != scope.company_id:
        raise NotFoundError("产品不存在")
    return product


def _check_images(db: Session, scope: CompanyScope, image_ids: list[uuid.UUID]) -> list[str]:
    if not image_ids:
        return []
    found = set(
        db.scalars(
            select(Asset.id).where(
                Asset.company_id == scope.company_id, Asset.id.in_(image_ids), Asset.mime.like("image/%")
            )
        )
    )
    if len(found) != len(set(image_ids)):
        raise AppError("图片不存在或不是图片文件", code="invalid_images")
    return [str(i) for i in dict.fromkeys(image_ids)]


@router.get("/products", response_model=list[ProductOut])
def list_products(
    scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> list[ProductOut]:
    products = db.scalars(
        select(Product).where(Product.company_id == scope.company_id).order_by(Product.created_at)
    ).all()
    return [product_out(p) for p in products]


@router.post("/products", response_model=ProductOut, status_code=201)
def create_product(
    body: ProductIn, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> ProductOut:
    count = (
        db.scalar(select(func.count()).select_from(Product).where(Product.company_id == scope.company_id))
        or 0
    )
    if count >= 500:
        raise AppError("产品数量已达上限", code="product_limit")
    data = body.model_dump()
    data["images"] = _check_images(db, scope, body.images)
    product = Product(company_id=scope.company_id, source="manual", **data)
    db.add(product)
    db.flush()
    refresh_completeness(db, scope.company)
    db.commit()
    return product_out(product)


@router.get("/products/{product_id}", response_model=ProductOut)
def get_product(
    product_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> ProductOut:
    return product_out(_own_product(db, scope, product_id))


@router.patch("/products/{product_id}", response_model=ProductOut)
def patch_product(
    product_id: uuid.UUID,
    body: ProductPatch,
    scope: CompanyScope = Depends(current_company),
    db: Session = Depends(get_db),
) -> ProductOut:
    product = _own_product(db, scope, product_id)
    data = body.model_dump(exclude_unset=True)
    if "images" in data:
        data["images"] = _check_images(db, scope, body.images or [])
    for key, value in data.items():
        if value is not None:
            setattr(product, key, value)
    product.updated_at = utcnow()
    refresh_completeness(db, scope.company)
    db.commit()
    return product_out(product)


@router.delete("/products/{product_id}", status_code=204)
def delete_product(
    product_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> Response:
    product = _own_product(db, scope, product_id)
    db.delete(product)
    db.flush()
    refresh_completeness(db, scope.company)
    db.commit()
    return Response(status_code=204)


# ── 资料（上传文件）──────────────────────────────────────────────────


class AssetOut(BaseModel):
    id: str
    kind: str
    mime: str
    size: int
    display_name: str
    has_text: bool
    created_at: str


def asset_out(asset: Asset) -> AssetOut:
    return AssetOut(
        id=str(asset.id),
        kind=asset.kind,
        mime=asset.mime,
        size=asset.size,
        display_name=asset.display_name,
        has_text=bool(asset.text_content),
        created_at=asset.created_at.isoformat(),
    )


async def _read_limited(upload: UploadFile, limit: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while chunk := await upload.read(1024 * 1024):
        total += len(chunk)
        if total > limit:
            raise AppError(
                f"文件不能超过 {limit // (1024 * 1024)}MB", code="payload_too_large", status_code=413
            )
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/assets", response_model=AssetOut, status_code=201)
async def upload_asset(
    file: UploadFile = File(...),
    kind: str = Form("image"),
    scope: CompanyScope = Depends(current_company),
    db: Session = Depends(get_db),
) -> AssetOut:
    if kind not in ALLOWED_KINDS:
        raise AppError("不支持的资料类型", code="invalid_kind")
    limit = get_settings().max_upload_bytes
    processed = process_upload(await _read_limited(file, limit), limit)
    if kind == "image" and not processed.mime.startswith("image/"):
        raise AppError("请上传图片文件", code="unsupported_file", status_code=415)
    key = f"{scope.company_id}/{uuid.uuid4().hex}"
    providers.storage().put(key, processed.data)
    asset = Asset(
        company_id=scope.company_id,
        kind=kind,
        storage_key=key,
        mime=processed.mime,
        size=len(processed.data),
        sha256=processed.sha256,
        display_name=display_name(file.filename),
        text_content=processed.text,
        created_by=scope.user.id,
    )
    db.add(asset)
    db.commit()
    return asset_out(asset)


@router.get("/assets", response_model=list[AssetOut])
def list_assets(
    kind: str | None = Query(default=None),
    scope: CompanyScope = Depends(current_company),
    db: Session = Depends(get_db),
) -> list[AssetOut]:
    stmt = select(Asset).where(Asset.company_id == scope.company_id).order_by(Asset.created_at.desc())
    if kind:
        stmt = stmt.where(Asset.kind == kind)
    return [asset_out(a) for a in db.scalars(stmt.limit(200))]


def _own_asset(db: Session, scope: CompanyScope, asset_id: uuid.UUID) -> Asset:
    asset = db.get(Asset, asset_id)
    if asset is None or asset.company_id != scope.company_id:
        raise NotFoundError("资料不存在")
    return asset


class DownloadUrl(BaseModel):
    url: str
    expires_in: int


@router.get("/assets/{asset_id}/download-url", response_model=DownloadUrl)
def asset_download_url(
    asset_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> DownloadUrl:
    asset = _own_asset(db, scope, asset_id)
    query = make_signed_query("asset", f"{asset.id}:{asset.company_id}", DOWNLOAD_TTL_SECONDS)
    return DownloadUrl(url=f"/api/v1/files/{asset.id}?{query}", expires_in=DOWNLOAD_TTL_SECONDS)


@router.delete("/assets/{asset_id}", status_code=204)
def delete_asset(
    asset_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> Response:
    asset = _own_asset(db, scope, asset_id)
    asset_id_str = str(asset.id)
    for product in db.scalars(select(Product).where(Product.company_id == scope.company_id)):
        if asset_id_str in product.images:
            product.images = [i for i in product.images if i != asset_id_str]
    providers.storage().delete(asset.storage_key)
    db.delete(asset)
    db.flush()
    refresh_completeness(db, scope.company)
    db.commit()
    return Response(status_code=204)


@router.get("/files/{asset_id}")
def download_file(
    asset_id: uuid.UUID,
    exp: int = Query(...),
    sig: str = Query(..., max_length=128),
    db: Session = Depends(get_db),
) -> RawResponse:
    """带签名、带过期时间的下载链接（无需登录，签名绑定资料 ID 与企业 ID）。"""
    asset = db.get(Asset, asset_id)
    if asset is None or not verify_signed("asset", f"{asset.id}:{asset.company_id}", exp, sig):
        raise NotFoundError("链接无效或已过期", code="link_invalid")
    data = providers.storage().get(asset.storage_key)
    disposition = "inline" if asset.mime.startswith("image/") else "attachment"
    return RawResponse(
        content=data,
        media_type=asset.mime,
        headers={
            "Content-Disposition": f'{disposition}; filename="{asset.id}"',
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


# ── AI 建档 ────────────────────────────────────────────────────────────


class ExtractionIn(BaseModel):
    source: Literal["url", "file", "chat"]
    url: str | None = Field(default=None, max_length=2048)
    asset_ids: list[uuid.UUID] = Field(default_factory=list, max_length=10)
    text: str | None = Field(default=None, max_length=10_000)


class ExtractionOut(BaseModel):
    id: str
    source: str
    status: str
    progress: list[dict[str, Any]]
    changes: list[dict[str, Any]]
    error: str
    created_at: str


def extraction_out(item: ProfileExtraction) -> ExtractionOut:
    return ExtractionOut(
        id=str(item.id),
        source=item.source,
        status=item.status,
        progress=item.progress,
        changes=item.result.get("changes", []),
        error=item.error,
        created_at=item.created_at.isoformat(),
    )


MAX_ACTIVE_EXTRACTIONS = 3


@router.post("/extractions", response_model=ExtractionOut, status_code=201)
def create_extraction(
    body: ExtractionIn, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> ExtractionOut:
    active = (
        db.scalar(
            select(func.count())
            .select_from(ProfileExtraction)
            .where(
                ProfileExtraction.company_id == scope.company_id,
                ProfileExtraction.status.in_(("pending", "running")),
            )
        )
        or 0
    )
    if active >= MAX_ACTIVE_EXTRACTIONS:
        raise AppError("已有整理任务在进行中，请稍后再试", code="extraction_busy", status_code=429)
    if body.source == "url":
        raw = (body.url or "").strip()
        if raw and "://" not in raw:
            raw = f"https://{raw}"
        parsed = validate_url(raw)  # 语法与 IP 字面量校验；DNS 校验在抓取时执行
        payload: dict[str, Any] = {"url": parsed.url}
    elif body.source == "file":
        if not body.asset_ids:
            raise AppError("请先上传资料", code="assets_required")
        owned = set(
            db.scalars(
                select(Asset.id).where(Asset.company_id == scope.company_id, Asset.id.in_(body.asset_ids))
            )
        )
        if len(owned) != len(set(body.asset_ids)):
            raise NotFoundError("资料不存在")
        payload = {"asset_ids": [str(i) for i in dict.fromkeys(body.asset_ids)]}
    else:
        text = (body.text or "").strip()
        if len(text) < 10:
            raise AppError("请多介绍一些企业和产品信息", code="text_too_short")
        payload = {"text": text}
    item = extraction_service.create_extraction(
        db, scope.company, scope.user.id, source=body.source, payload=payload
    )
    db.commit()
    return extraction_out(item)


def _own_extraction(db: Session, scope: CompanyScope, extraction_id: uuid.UUID) -> ProfileExtraction:
    item = db.get(ProfileExtraction, extraction_id)
    if item is None or item.company_id != scope.company_id:
        raise NotFoundError("整理任务不存在")
    return item


@router.get("/extractions/{extraction_id}", response_model=ExtractionOut)
def get_extraction(
    extraction_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> ExtractionOut:
    return extraction_out(_own_extraction(db, scope, extraction_id))


class ApplyIn(BaseModel):
    accept: list[str] = Field(max_length=200)
    overrides: dict[str, Any] = Field(default_factory=dict)


class ApplyOut(BaseModel):
    changed_fields: list[str]
    created_products: list[str]
    completeness: int


@router.post("/extractions/{extraction_id}/apply", response_model=ApplyOut)
def apply_extraction(
    extraction_id: uuid.UUID,
    body: ApplyIn,
    scope: CompanyScope = Depends(current_company),
    db: Session = Depends(get_db),
) -> ApplyOut:
    item = _own_extraction(db, scope, extraction_id)
    db.refresh(item, with_for_update=True)
    if item.status != "succeeded":
        raise ConflictError("该整理结果已处理或尚未完成", code="extraction_not_ready")
    try:
        result = extraction_service.apply_changes(db, scope.company, item, body.accept, body.overrides)
    except ValueError as exc:
        raise AppError("提交的变更项无效", code="invalid_changes") from exc
    db.commit()
    return ApplyOut(**result)
