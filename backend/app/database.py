import hashlib
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List

from sqlalchemy import (
    create_engine, Column, Integer, String, Boolean, Float, Text, DateTime,
    ForeignKey, JSON, BigInteger, text
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import sessionmaker, declarative_base, relationship

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ======================== Models ========================

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False)
    email = Column(String(120), unique=True, nullable=False)
    password_hash = Column(String(128), nullable=False)
    is_active = Column(Boolean, default=True)
    is_premium = Column(Boolean, default=False)
    is_admin = Column(Boolean, default=False)
    credit_balance = Column(Integer, default=0)
    response_language = Column(String(10), default="en")  # en/zh/ja/ko/es/fr/de/pt/ru/ar
    referral_code = Column(String(10), unique=True)
    referred_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    brand_voice = Column(Text, nullable=True)
    primary_url = Column(Text, nullable=True)
    onboarding_completed = Column(Boolean, default=False)
    register_ip = Column(String(50), nullable=True)
    last_login_ip = Column(String(50), nullable=True)
    country = Column(String(80), nullable=True)
    last_login_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    sessions = relationship("Session", back_populates="user")
    conversations = relationship("Conversation", back_populates="user")


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token = Column(String(64), unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)

    user = relationship("User", back_populates="sessions")


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(200), default="New Analysis")
    input_type = Column(String(20))  # "url" | "keyword"
    input_value = Column(Text)
    product_profile = Column(JSON, nullable=True)
    status = Column(String(20), default="analyzing")  # analyzing | completed | failed
    credits_consumed = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="conversations")
    recommendations = relationship("Recommendation", back_populates="conversation", cascade="all, delete-orphan")
    strategy = relationship("OverallStrategy", back_populates="conversation", uselist=False, cascade="all, delete-orphan")


class Recommendation(Base):
    __tablename__ = "recommendations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=False)
    rank = Column(Integer, nullable=False)
    platform = Column(String(50))
    url = Column(Text)
    title = Column(Text)
    engagement_stats = Column(JSON, nullable=True)
    composite_score = Column(Float, default=0)
    scoring_detail = Column(JSON, nullable=True)
    why_recommend = Column(Text, nullable=True)
    estimated_exposure = Column(String(100), nullable=True)
    best_timing = Column(String(200), nullable=True)
    risk_level = Column(String(20), nullable=True)
    risk_note = Column(Text, nullable=True)
    suggested_comment = Column(Text, nullable=True)
    comment_strategy = Column(Text, nullable=True)
    is_premium_only = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    conversation = relationship("Conversation", back_populates="recommendations")


class OverallStrategy(Base):
    __tablename__ = "overall_strategies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=False)
    priority_actions = Column(JSON, nullable=True)
    weekly_plan = Column(Text, nullable=True)
    content_calendar = Column(Text, nullable=True)
    kpi_targets = Column(Text, nullable=True)
    budget_suggestion = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    conversation = relationship("Conversation", back_populates="strategy")


class UserApiKey(Base):
    __tablename__ = "user_api_keys"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    key_hash = Column(String(64), unique=True, nullable=False)
    key_prefix = Column(String(16), nullable=False)  # "sk-cmo-xxxx" for display
    name = Column(String(100), default="Default")
    is_active = Column(Boolean, default=True)
    last_used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class PaymentOrder(Base):
    __tablename__ = "payment_orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    order_number = Column(String(50), unique=True, nullable=False)
    amount = Column(Float, nullable=False)
    credit_amount = Column(Integer, nullable=False)
    plan_type = Column(String(20), default="credit")
    status = Column(String(20), default="pending")  # pending | paid | failed
    paid_at = Column(DateTime, nullable=True)
    lemon_order_id = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class CreditTransaction(Base):
    __tablename__ = "credit_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    type = Column(String(20), nullable=False)  # recharge | consume | refund
    amount = Column(Integer, nullable=False)
    balance_after = Column(Integer, nullable=False)
    description = Column(Text, default="")
    order_number = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ProductProfile(Base):
    __tablename__ = "product_profiles"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String(200))
    url = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    brand_voice = Column(Text, nullable=True)
    target_audience = Column(Text, nullable=True)
    is_primary = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Competitor(Base):
    __tablename__ = "competitors"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String(200))
    url = Column(Text)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SEOHealthSnapshot(Base):
    __tablename__ = "seo_health_snapshots"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    url = Column(Text)
    page_speed_score = Column(Float, nullable=True)
    seo_score = Column(Float, nullable=True)
    core_web_vitals = Column(JSON, nullable=True)
    issues = Column(JSON, nullable=True)
    passed_checks = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class GEOVisibility(Base):
    __tablename__ = "geo_visibility"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    brand_name = Column(String(200))
    platform = Column(String(50))
    visibility_score = Column(Float, default=0)
    mentions = Column(JSON, nullable=True)
    checked_at = Column(DateTime, default=datetime.utcnow)


class RecommendationFeedback(Base):
    __tablename__ = "recommendation_feedbacks"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recommendation_id = Column(UUID(as_uuid=True), ForeignKey("recommendations.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    is_useful = Column(Boolean)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ActivityFeed(Base):
    __tablename__ = "activity_feeds"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    event_type = Column(String(50))
    title = Column(String(300))
    detail = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    conversation_id = Column(UUID(as_uuid=True), nullable=True)
    role = Column(String(20))
    content = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


# ======================== Database Manager ========================

class DatabaseManager:
    """Centralized database operations"""

    @staticmethod
    def hash_password(password: str) -> str:
        return hashlib.sha256(password.encode()).hexdigest()

    @staticmethod
    def _generate_referral_code(session) -> str:
        for _ in range(10):
            code = secrets.token_hex(4).upper()[:8]
            if not session.query(User).filter(User.referral_code == code).first():
                return code
        return secrets.token_hex(5).upper()[:10]

    def get_session(self):
        return SessionLocal()

    # ---- User Management ----

    def create_user(self, username: str, email: str, password: str,
                    referral_code: Optional[str] = None,
                    response_language: str = "en") -> Optional[int]:
        session = self.get_session()
        try:
            # Check existing
            if session.query(User).filter(
                (User.email == email) | (User.username == username)
            ).first():
                return None

            password_hash = self.hash_password(password)
            new_referral_code = self._generate_referral_code(session)

            referrer_id = None
            if referral_code:
                referrer = session.query(User).filter(
                    User.referral_code == referral_code.upper().strip()
                ).first()
                if referrer:
                    referrer_id = referrer.id

            initial_credits = 1
            if referrer_id:
                initial_credits += 1

            user = User(
                username=username, email=email,
                password_hash=password_hash,
                credit_balance=initial_credits,
                response_language=response_language,
                referral_code=new_referral_code,
                referred_by=referrer_id,
            )
            session.add(user)
            session.flush()

            tx = CreditTransaction(
                user_id=user.id, type="recharge", amount=1,
                balance_after=initial_credits,
                description="Registration bonus: 1 free analysis",
            )
            session.add(tx)

            if referrer_id:
                tx_bonus = CreditTransaction(
                    user_id=user.id, type="recharge", amount=1,
                    balance_after=initial_credits,
                    description=f"Referral bonus (referrer ID: {referrer_id})",
                )
                session.add(tx_bonus)

                referrer = session.query(User).filter(User.id == referrer_id).with_for_update().first()
                if referrer:
                    referrer.credit_balance += 1
                    tx_referrer = CreditTransaction(
                        user_id=referrer_id, type="recharge", amount=1,
                        balance_after=referrer.credit_balance,
                        description=f"Referral reward (invited: {username})",
                    )
                    session.add(tx_referrer)

            session.commit()
            return user.id
        except Exception:
            session.rollback()
            return None
        finally:
            session.close()

    def authenticate_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """Find user by email only (for Google OAuth)."""
        session = self.get_session()
        try:
            user = session.query(User).filter(User.email == email).first()
            if user:
                return {
                    "id": user.id, "username": user.username, "email": user.email,
                    "is_active": user.is_active, "is_premium": user.is_premium,
                    "is_admin": user.is_admin, "credit_balance": user.credit_balance,
                    "referral_code": user.referral_code or "",
                    "response_language": user.response_language or "en",
                    "brand_voice": user.brand_voice or "",
                    "primary_url": user.primary_url or "",
                }
            return None
        finally:
            session.close()

    def authenticate_user(self, email: str, password: str) -> Optional[Dict[str, Any]]:
        session = self.get_session()
        try:
            password_hash = self.hash_password(password)
            user = session.query(User).filter(
                User.email == email, User.password_hash == password_hash
            ).first()
            if user:
                return {
                    "id": user.id, "username": user.username, "email": user.email,
                    "is_active": user.is_active, "is_premium": user.is_premium,
                    "is_admin": user.is_admin, "credit_balance": user.credit_balance,
                    "referral_code": user.referral_code or "",
                    "response_language": user.response_language or "en",
                    "brand_voice": user.brand_voice or "",
                    "primary_url": user.primary_url or "",
                }
            return None
        finally:
            session.close()

    def get_user_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        session = self.get_session()
        try:
            user = session.query(User).filter(User.id == user_id).first()
            if user:
                return {
                    "id": user.id, "username": user.username, "email": user.email,
                    "is_active": user.is_active, "is_premium": user.is_premium,
                    "is_admin": user.is_admin, "credit_balance": user.credit_balance,
                    "referral_code": user.referral_code or "",
                    "response_language": user.response_language or "en",
                    "brand_voice": user.brand_voice or "",
                    "primary_url": user.primary_url or "",
                }
            return None
        finally:
            session.close()

    # ---- Session Management ----

    def create_session(self, user_id: int, expires_in_hours: int = 168) -> str:
        session = self.get_session()
        try:
            token = secrets.token_urlsafe(32)
            expires_at = datetime.utcnow() + timedelta(hours=expires_in_hours)
            db_session = Session(user_id=user_id, token=token, expires_at=expires_at)
            session.add(db_session)
            session.commit()
            return token
        finally:
            session.close()

    def verify_token(self, token: str) -> Optional[Dict[str, Any]]:
        session = self.get_session()
        try:
            db_session = session.query(Session).filter(
                Session.token == token, Session.expires_at > datetime.utcnow()
            ).first()
            if not db_session:
                return None
            user = session.query(User).filter(User.id == db_session.user_id).first()
            if user and user.is_active:
                return {
                    "id": user.id, "username": user.username, "email": user.email,
                    "is_active": user.is_active, "is_premium": user.is_premium,
                    "is_admin": user.is_admin, "credit_balance": user.credit_balance,
                    "referral_code": user.referral_code or "",
                    "response_language": user.response_language or "en",
                    "brand_voice": user.brand_voice or "",
                    "primary_url": user.primary_url or "",
                }
            return None
        finally:
            session.close()

    def delete_session(self, token: str) -> bool:
        session = self.get_session()
        try:
            result = session.query(Session).filter(Session.token == token).delete()
            session.commit()
            return result > 0
        finally:
            session.close()

    # ---- Credit Management ----

    def get_credit_balance(self, user_id: int) -> int:
        session = self.get_session()
        try:
            user = session.query(User).filter(User.id == user_id).first()
            return user.credit_balance if user else 0
        finally:
            session.close()

    def add_credits(self, user_id: int, amount: int, description: str = "",
                    order_number: Optional[str] = None) -> tuple:
        session = self.get_session()
        try:
            user = session.query(User).filter(User.id == user_id).with_for_update().first()
            if not user:
                return False, 0
            user.credit_balance += amount
            tx = CreditTransaction(
                user_id=user_id, type="recharge", amount=amount,
                balance_after=user.credit_balance, description=description,
                order_number=order_number,
            )
            session.add(tx)
            session.commit()
            return True, user.credit_balance
        except Exception:
            session.rollback()
            return False, 0
        finally:
            session.close()

    def deduct_credit(self, user_id: int, amount: int = 1,
                      description: str = "") -> tuple:
        session = self.get_session()
        try:
            user = session.query(User).filter(User.id == user_id).with_for_update().first()
            if not user or user.credit_balance < amount:
                return False, user.credit_balance if user else 0
            user.credit_balance -= amount
            tx = CreditTransaction(
                user_id=user_id, type="consume", amount=-amount,
                balance_after=user.credit_balance,
                description=description or "Analysis usage",
            )
            session.add(tx)
            session.commit()
            return True, user.credit_balance
        except Exception:
            session.rollback()
            return False, 0
        finally:
            session.close()

    # ---- API Key Management ----

    def generate_api_key(self, user_id: int, name: str = "Default") -> Optional[str]:
        session = self.get_session()
        try:
            raw_key = f"sk-cmo-{secrets.token_urlsafe(32)}"
            key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
            key_prefix = raw_key[:12]
            api_key = UserApiKey(
                user_id=user_id, key_hash=key_hash,
                key_prefix=key_prefix, name=name,
            )
            session.add(api_key)
            session.commit()
            return raw_key
        except Exception:
            session.rollback()
            return None
        finally:
            session.close()

    def verify_api_key(self, raw_key: str) -> Optional[Dict[str, Any]]:
        session = self.get_session()
        try:
            key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
            api_key = session.query(UserApiKey).filter(
                UserApiKey.key_hash == key_hash, UserApiKey.is_active == True,
            ).first()
            if not api_key:
                return None
            api_key.last_used_at = datetime.utcnow()
            session.commit()
            user = session.query(User).filter(User.id == api_key.user_id).first()
            if not user or not user.is_active:
                return None
            return {
                "id": user.id, "username": user.username, "email": user.email,
                "is_active": user.is_active, "is_premium": user.is_premium,
                "is_admin": user.is_admin, "credit_balance": user.credit_balance,
                "referral_code": user.referral_code or "",
                "response_language": user.response_language or "en",
                "brand_voice": user.brand_voice or "",
                "primary_url": user.primary_url or "",
            }
        except Exception:
            session.rollback()
            return None
        finally:
            session.close()

    def list_api_keys(self, user_id: int) -> List[Dict]:
        session = self.get_session()
        try:
            keys = session.query(UserApiKey).filter(
                UserApiKey.user_id == user_id
            ).order_by(UserApiKey.created_at.desc()).all()
            return [{
                "id": k.id, "name": k.name, "prefix": k.key_prefix,
                "is_active": k.is_active,
                "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None,
                "created_at": k.created_at.isoformat() if k.created_at else None,
            } for k in keys]
        finally:
            session.close()

    def revoke_api_key(self, key_id: int, user_id: int) -> bool:
        session = self.get_session()
        try:
            key = session.query(UserApiKey).filter(
                UserApiKey.id == key_id, UserApiKey.user_id == user_id
            ).first()
            if key:
                key.is_active = False
                session.commit()
                return True
            return False
        finally:
            session.close()

    def delete_api_key(self, key_id: int, user_id: int) -> bool:
        session = self.get_session()
        try:
            key = session.query(UserApiKey).filter(
                UserApiKey.id == key_id, UserApiKey.user_id == user_id
            ).first()
            if key:
                session.delete(key)
                session.commit()
                return True
            return False
        finally:
            session.close()

    def refund_credit(self, user_id: int, amount: int = 1,
                      description: str = "") -> tuple:
        session = self.get_session()
        try:
            user = session.query(User).filter(User.id == user_id).with_for_update().first()
            if not user:
                return False, 0
            user.credit_balance += amount
            tx = CreditTransaction(
                user_id=user_id, type="refund", amount=amount,
                balance_after=user.credit_balance,
                description=description or "Refund on failure",
            )
            session.add(tx)
            session.commit()
            return True, user.credit_balance
        except Exception:
            session.rollback()
            return False, 0
        finally:
            session.close()

    def get_credit_transactions(self, user_id: int, limit: int = 50) -> List[Dict]:
        session = self.get_session()
        try:
            txns = session.query(CreditTransaction).filter(
                CreditTransaction.user_id == user_id
            ).order_by(CreditTransaction.created_at.desc()).limit(limit).all()
            return [{
                "id": t.id, "type": t.type, "amount": t.amount,
                "balance_after": t.balance_after, "description": t.description,
                "order_number": t.order_number,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            } for t in txns]
        finally:
            session.close()

    # ---- Payment Orders ----

    def create_credit_order(self, user_id: int, usd_amount: float,
                            credit_amount: int) -> str:
        session = self.get_session()
        try:
            order_number = f"CRD{datetime.utcnow().strftime('%Y%m%d%H%M%S')}{secrets.token_hex(4)}"
            order = PaymentOrder(
                user_id=user_id, order_number=order_number,
                amount=usd_amount, credit_amount=credit_amount, plan_type="credit",
            )
            session.add(order)
            session.commit()
            return order_number
        finally:
            session.close()

    def complete_credit_order(self, order_number: str,
                              lemon_order_id: Optional[str] = None) -> tuple:
        session = self.get_session()
        try:
            order = session.query(PaymentOrder).filter(
                PaymentOrder.order_number == order_number
            ).first()
            if not order or order.status == "paid":
                return False, 0
            order.status = "paid"
            order.paid_at = datetime.utcnow()
            if lemon_order_id:
                order.lemon_order_id = lemon_order_id
            session.commit()
            credit_amount = order.credit_amount or int(order.amount * 5)
            success, balance = self.add_credits(
                user_id=order.user_id, amount=credit_amount,
                description=f"Recharge ${order.amount} = {credit_amount} credits",
                order_number=order_number,
            )
            return success, credit_amount
        except Exception:
            session.rollback()
            return False, 0
        finally:
            session.close()

    # ---- Conversation Management ----

    def create_conversation(self, user_id: int, input_type: str,
                            input_value: str, title: str = "New Analysis") -> str:
        session = self.get_session()
        try:
            conv = Conversation(
                user_id=user_id, input_type=input_type,
                input_value=input_value, title=title,
            )
            session.add(conv)
            session.commit()
            return str(conv.id)
        finally:
            session.close()

    def update_conversation(self, conv_id: str, **kwargs):
        session = self.get_session()
        try:
            conv = session.query(Conversation).filter(Conversation.id == conv_id).first()
            if conv:
                for k, v in kwargs.items():
                    setattr(conv, k, v)
                session.commit()
        finally:
            session.close()

    def save_recommendations(self, conv_id: str, recommendations: List[Dict]):
        session = self.get_session()
        try:
            for rec in recommendations:
                r = Recommendation(
                    conversation_id=conv_id,
                    rank=rec.get("rank", 0),
                    platform=rec.get("platform", ""),
                    url=rec.get("url", ""),
                    title=rec.get("title", ""),
                    engagement_stats=rec.get("engagement_stats"),
                    composite_score=rec.get("composite_score", 0),
                    scoring_detail=rec.get("scoring_detail"),
                    why_recommend=rec.get("why_recommend", ""),
                    estimated_exposure=rec.get("estimated_exposure", ""),
                    best_timing=rec.get("best_timing", ""),
                    risk_level=rec.get("risk_level", "low"),
                    risk_note=rec.get("risk_note", ""),
                    suggested_comment=rec.get("suggested_comment", ""),
                    comment_strategy=rec.get("comment_strategy", ""),
                    is_premium_only=rec.get("rank", 0) > 3,
                )
                session.add(r)
            session.commit()
        finally:
            session.close()

    def save_strategy(self, conv_id: str, strategy: Dict):
        session = self.get_session()
        try:
            s = OverallStrategy(
                conversation_id=conv_id,
                priority_actions=strategy.get("priority_actions"),
                weekly_plan=strategy.get("weekly_plan", ""),
                content_calendar=strategy.get("content_calendar", ""),
                kpi_targets=strategy.get("kpi_targets", ""),
                budget_suggestion=strategy.get("budget_suggestion", ""),
            )
            session.add(s)
            session.commit()
        finally:
            session.close()

    def get_conversations(self, user_id: int, limit: int = 50) -> List[Dict]:
        session = self.get_session()
        try:
            convs = session.query(Conversation).filter(
                Conversation.user_id == user_id
            ).order_by(Conversation.created_at.desc()).limit(limit).all()
            return [{
                "id": str(c.id), "title": c.title, "input_type": c.input_type,
                "input_value": c.input_value, "status": c.status,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            } for c in convs]
        finally:
            session.close()

    def get_conversation_detail(self, conv_id: str, user_id: int) -> Optional[Dict]:
        session = self.get_session()
        try:
            conv = session.query(Conversation).filter(
                Conversation.id == conv_id, Conversation.user_id == user_id
            ).first()
            if not conv:
                return None
            recs = session.query(Recommendation).filter(
                Recommendation.conversation_id == conv_id
            ).order_by(Recommendation.rank).all()
            strat = session.query(OverallStrategy).filter(
                OverallStrategy.conversation_id == conv_id
            ).first()
            return {
                "id": str(conv.id), "title": conv.title,
                "input_type": conv.input_type, "input_value": conv.input_value,
                "product_profile": conv.product_profile, "status": conv.status,
                "created_at": conv.created_at.isoformat() if conv.created_at else None,
                "recommendations": [{
                    "id": str(r.id), "rank": r.rank, "platform": r.platform, "url": r.url,
                    "title": r.title, "engagement_stats": r.engagement_stats,
                    "composite_score": r.composite_score, "scoring_detail": r.scoring_detail,
                    "why_recommend": r.why_recommend, "estimated_exposure": r.estimated_exposure,
                    "best_timing": r.best_timing, "risk_level": r.risk_level,
                    "risk_note": r.risk_note, "suggested_comment": r.suggested_comment,
                    "comment_strategy": r.comment_strategy,
                    "is_premium_only": r.is_premium_only,
                } for r in recs],
                "strategy": {
                    "priority_actions": strat.priority_actions,
                    "weekly_plan": strat.weekly_plan,
                    "content_calendar": strat.content_calendar,
                    "kpi_targets": strat.kpi_targets,
                    "budget_suggestion": strat.budget_suggestion,
                } if strat else None,
            }
        finally:
            session.close()

    def delete_conversation(self, conv_id: str, user_id: int) -> bool:
        session = self.get_session()
        try:
            conv = session.query(Conversation).filter(
                Conversation.id == conv_id, Conversation.user_id == user_id
            ).first()
            if conv:
                session.delete(conv)
                session.commit()
                return True
            return False
        finally:
            session.close()

    # ---- Dashboard ----

    def get_dashboard_overview(self, user_id: int) -> Dict[str, Any]:
        session = self.get_session()
        try:
            from sqlalchemy import func
            total_analyses = session.query(func.count(Conversation.id)).filter(
                Conversation.user_id == user_id
            ).scalar() or 0
            total_recs = session.query(func.count(Recommendation.id)).join(Conversation).filter(
                Conversation.user_id == user_id
            ).scalar() or 0
            platforms = session.query(func.count(func.distinct(Recommendation.platform))).join(Conversation).filter(
                Conversation.user_id == user_id
            ).scalar() or 0
            user = session.query(User).filter(User.id == user_id).first()

            recent = session.query(Conversation).filter(
                Conversation.user_id == user_id
            ).order_by(Conversation.created_at.desc()).limit(5).all()

            platform_dist = {}
            dist_rows = session.query(
                Recommendation.platform, func.count(Recommendation.id)
            ).join(Conversation).filter(
                Conversation.user_id == user_id
            ).group_by(Recommendation.platform).all()
            for row in dist_rows:
                platform_dist[row[0]] = row[1]

            return {
                "total_analyses": total_analyses,
                "total_recommendations": total_recs,
                "platforms_covered": platforms,
                "credit_balance": user.credit_balance if user else 0,
                "recent_analyses": [{
                    "id": str(c.id), "title": c.title, "status": c.status,
                    "created_at": c.created_at.isoformat() if c.created_at else None,
                    "recommendation_count": session.query(func.count(Recommendation.id)).filter(
                        Recommendation.conversation_id == c.id).scalar() or 0,
                } for c in recent],
                "platform_distribution": platform_dist,
            }
        finally:
            session.close()

    # ---- Activity Feed ----

    def add_activity(self, user_id: int, event_type: str, title: str, detail: Dict = None):
        session = self.get_session()
        try:
            activity = ActivityFeed(
                user_id=user_id, event_type=event_type,
                title=title, detail=detail or {},
            )
            session.add(activity)
            session.commit()
        except Exception:
            session.rollback()
        finally:
            session.close()

    def get_recent_activities(self, user_id: int, limit: int = 20) -> List[Dict]:
        session = self.get_session()
        try:
            activities = session.query(ActivityFeed).filter(
                ActivityFeed.user_id == user_id
            ).order_by(ActivityFeed.created_at.desc()).limit(limit).all()
            return [{
                "id": str(a.id), "event_type": a.event_type,
                "title": a.title, "detail": a.detail,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            } for a in activities]
        finally:
            session.close()

    # ---- Recommendation Feedback ----

    def save_recommendation_feedback(self, rec_id: str, user_id: int,
                                     is_useful: bool, comment: str = "") -> bool:
        session = self.get_session()
        try:
            existing = session.query(RecommendationFeedback).filter(
                RecommendationFeedback.recommendation_id == rec_id,
                RecommendationFeedback.user_id == user_id,
            ).first()
            if existing:
                existing.is_useful = is_useful
                existing.comment = comment
            else:
                fb = RecommendationFeedback(
                    recommendation_id=rec_id, user_id=user_id,
                    is_useful=is_useful, comment=comment,
                )
                session.add(fb)
            session.commit()
            return True
        except Exception:
            session.rollback()
            return False
        finally:
            session.close()

    # ---- Chat Messages ----

    def save_chat_message(self, user_id: int, role: str, content: str,
                          conversation_id: str = None) -> str:
        session = self.get_session()
        try:
            msg = ChatMessage(
                user_id=user_id, role=role, content=content,
                conversation_id=conversation_id,
            )
            session.add(msg)
            session.commit()
            return str(msg.id)
        finally:
            session.close()

    def get_chat_messages(self, user_id: int, conversation_id: str = None,
                          limit: int = 50) -> List[Dict]:
        session = self.get_session()
        try:
            q = session.query(ChatMessage).filter(ChatMessage.user_id == user_id)
            if conversation_id:
                q = q.filter(ChatMessage.conversation_id == conversation_id)
            msgs = q.order_by(ChatMessage.created_at.asc()).limit(limit).all()
            return [{
                "id": str(m.id), "role": m.role, "content": m.content,
                "conversation_id": str(m.conversation_id) if m.conversation_id else None,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            } for m in msgs]
        finally:
            session.close()

    # ---- Competitors ----

    def add_competitor(self, user_id: int, name: str, url: str,
                       description: str = "") -> str:
        session = self.get_session()
        try:
            comp = Competitor(
                user_id=user_id, name=name, url=url, description=description,
            )
            session.add(comp)
            session.commit()
            return str(comp.id)
        finally:
            session.close()

    def get_competitors(self, user_id: int) -> List[Dict]:
        session = self.get_session()
        try:
            comps = session.query(Competitor).filter(
                Competitor.user_id == user_id
            ).order_by(Competitor.created_at.desc()).all()
            return [{
                "id": str(c.id), "name": c.name, "url": c.url,
                "description": c.description,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            } for c in comps]
        finally:
            session.close()

    def delete_competitor(self, comp_id: str, user_id: int) -> bool:
        session = self.get_session()
        try:
            comp = session.query(Competitor).filter(
                Competitor.id == comp_id, Competitor.user_id == user_id,
            ).first()
            if comp:
                session.delete(comp)
                session.commit()
                return True
            return False
        finally:
            session.close()

    # ---- Product Profiles ----

    def save_product_profile(self, user_id: int, name: str, url: str = None,
                             description: str = None, target_audience: str = None) -> str:
        session = self.get_session()
        try:
            existing = session.query(ProductProfile).filter(
                ProductProfile.user_id == user_id, ProductProfile.url == url
            ).first() if url else None
            if existing:
                existing.name = name
                if description:
                    existing.description = description
                if target_audience:
                    existing.target_audience = target_audience
                session.commit()
                return str(existing.id)
            profile = ProductProfile(
                user_id=user_id, name=name, url=url,
                description=description, target_audience=target_audience,
            )
            session.add(profile)
            session.commit()
            return str(profile.id)
        finally:
            session.close()

    def get_product_profiles(self, user_id: int) -> List[Dict]:
        session = self.get_session()
        try:
            profiles = session.query(ProductProfile).filter(
                ProductProfile.user_id == user_id
            ).order_by(ProductProfile.created_at.desc()).all()
            return [{
                "id": str(p.id), "name": p.name, "url": p.url,
                "description": p.description, "target_audience": p.target_audience,
                "is_primary": p.is_primary,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            } for p in profiles]
        finally:
            session.close()

    # ---- SEO Health ----

    def save_seo_snapshot(self, user_id: int, url: str, page_speed_score: float = None,
                          seo_score: float = None, core_web_vitals: dict = None,
                          issues: list = None, passed_checks: list = None) -> str:
        session = self.get_session()
        try:
            snapshot = SEOHealthSnapshot(
                user_id=user_id, url=url,
                page_speed_score=page_speed_score, seo_score=seo_score,
                core_web_vitals=core_web_vitals,
                issues=issues, passed_checks=passed_checks,
            )
            session.add(snapshot)
            session.commit()
            return str(snapshot.id)
        finally:
            session.close()

    def get_latest_seo(self, user_id: int) -> Optional[Dict]:
        session = self.get_session()
        try:
            snap = session.query(SEOHealthSnapshot).filter(
                SEOHealthSnapshot.user_id == user_id
            ).order_by(SEOHealthSnapshot.created_at.desc()).first()
            if not snap:
                return None
            return {
                "id": str(snap.id), "url": snap.url,
                "page_speed_score": snap.page_speed_score,
                "seo_score": snap.seo_score,
                "core_web_vitals": snap.core_web_vitals,
                "issues": snap.issues, "passed_checks": snap.passed_checks,
                "created_at": snap.created_at.isoformat() if snap.created_at else None,
            }
        finally:
            session.close()

    def get_seo_history(self, user_id: int, limit: int = 20) -> List[Dict]:
        session = self.get_session()
        try:
            snaps = session.query(SEOHealthSnapshot).filter(
                SEOHealthSnapshot.user_id == user_id
            ).order_by(SEOHealthSnapshot.created_at.desc()).limit(limit).all()
            return [{
                "id": str(s.id), "url": s.url,
                "page_speed_score": s.page_speed_score,
                "seo_score": s.seo_score,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            } for s in snaps]
        finally:
            session.close()

    # ---- GEO Visibility ----

    def save_geo_visibility(self, user_id: int, brand_name: str, platform: str,
                            visibility_score: float = 0, mentions: list = None) -> str:
        session = self.get_session()
        try:
            record = GEOVisibility(
                user_id=user_id, brand_name=brand_name, platform=platform,
                visibility_score=visibility_score, mentions=mentions,
            )
            session.add(record)
            session.commit()
            return str(record.id)
        finally:
            session.close()

    def get_latest_geo(self, user_id: int) -> List[Dict]:
        session = self.get_session()
        try:
            from sqlalchemy import func
            subq = session.query(
                GEOVisibility.platform,
                func.max(GEOVisibility.checked_at).label("latest")
            ).filter(
                GEOVisibility.user_id == user_id
            ).group_by(GEOVisibility.platform).subquery()

            records = session.query(GEOVisibility).join(
                subq, (GEOVisibility.platform == subq.c.platform) &
                       (GEOVisibility.checked_at == subq.c.latest)
            ).filter(GEOVisibility.user_id == user_id).all()
            return [{
                "id": str(r.id), "brand_name": r.brand_name,
                "platform": r.platform, "visibility_score": r.visibility_score,
                "mentions": r.mentions,
                "checked_at": r.checked_at.isoformat() if r.checked_at else None,
            } for r in records]
        finally:
            session.close()

    def get_geo_history(self, user_id: int, limit: int = 50) -> List[Dict]:
        session = self.get_session()
        try:
            records = session.query(GEOVisibility).filter(
                GEOVisibility.user_id == user_id
            ).order_by(GEOVisibility.checked_at.desc()).limit(limit).all()
            return [{
                "id": str(r.id), "brand_name": r.brand_name,
                "platform": r.platform, "visibility_score": r.visibility_score,
                "mentions": r.mentions,
                "checked_at": r.checked_at.isoformat() if r.checked_at else None,
            } for r in records]
        finally:
            session.close()


def init_db():
    """Create all tables"""
    Base.metadata.create_all(bind=engine)


_db_instance = None


def get_database() -> DatabaseManager:
    global _db_instance
    if _db_instance is None:
        _db_instance = DatabaseManager()
    return _db_instance
