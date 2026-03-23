# Auth System - Complete Code Reference

## Database Manager (database.py)

Full implementation of the Database class with all auth-related methods.

### Connection Setup

```python
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://ytuser:ytpassword123@localhost:5432/ytdownloader")
engine = create_engine(DATABASE_URL, pool_pre_ping=True, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
```

### User Creation with Referral

```python
def create_user(self, username: str, email: str, password: str,
                referral_code: Optional[str] = None) -> Optional[int]:
    session = self.get_session()
    try:
        password_hash = self.hash_password(password)
        new_referral_code = self._generate_referral_code(session)

        referrer_id = None
        if referral_code:
            referrer = session.query(User).filter(
                User.referral_code == referral_code.upper().strip()
            ).first()
            if referrer:
                referrer_id = referrer.id

        initial_credits = 2
        if referrer_id:
            initial_credits += 2

        user = User(
            username=username, email=email,
            password_hash=password_hash,
            credit_balance=initial_credits,
            referral_code=new_referral_code,
            referred_by=referrer_id,
        )
        session.add(user)
        session.flush()

        quota = UserQuota(user_id=user.id, free_downloads_remaining=999999, total_downloads=0)
        session.add(quota)

        tx = CreditTransaction(
            user_id=user.id, type="recharge", amount=2,
            balance_after=initial_credits, description="Registration bonus 2 credits",
        )
        session.add(tx)

        if referrer_id:
            tx_new = CreditTransaction(
                user_id=user.id, type="recharge", amount=2,
                balance_after=initial_credits,
                description=f"Referral bonus (referrer ID: {referrer_id})",
            )
            session.add(tx_new)
            referrer = session.query(User).filter(User.id == referrer_id).with_for_update().first()
            if referrer:
                referrer.credit_balance += 2
                tx_referrer = CreditTransaction(
                    user_id=referrer_id, type="recharge", amount=2,
                    balance_after=referrer.credit_balance,
                    description=f"Referral reward (invited: {username})",
                )
                session.add(tx_referrer)

        session.commit()
        return user.id
    except Exception as e:
        session.rollback()
        return None
    finally:
        session.close()
```

### Authentication & Session

```python
def authenticate_user(self, email: str, password: str) -> Optional[Dict[str, Any]]:
    session = self.get_session()
    try:
        password_hash = self.hash_password(password)
        user = session.query(User).filter(
            User.email == email,
            User.password_hash == password_hash
        ).first()
        if user:
            return {
                "id": user.id, "username": user.username, "email": user.email,
                "is_active": user.is_active, "is_premium": user.is_premium,
                "is_admin": user.is_admin, "credit_balance": user.credit_balance,
                "referral_code": user.referral_code or "",
            }
        return None
    finally:
        session.close()

def create_session(self, user_id: int, expires_in_hours: int = 24) -> str:
    session = self.get_session()
    try:
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now() + timedelta(hours=expires_in_hours)
        db_session = SessionModel(user_id=user_id, token=token, expires_at=expires_at)
        session.add(db_session)
        session.commit()
        return token
    finally:
        session.close()

def verify_token(self, token: str) -> Optional[Dict[str, Any]]:
    session = self.get_session()
    try:
        db_session = session.query(SessionModel).filter(
            SessionModel.token == token,
            SessionModel.expires_at > datetime.now()
        ).first()
        if not db_session:
            return None
        user = session.query(User).filter(User.id == db_session.user_id).first()
        if user:
            return {
                "id": user.id, "username": user.username, "email": user.email,
                "is_active": user.is_active, "is_premium": user.is_premium,
                "is_admin": user.is_admin, "credit_balance": user.credit_balance,
            }
        return None
    finally:
        session.close()
```

### Credit Management

```python
def get_credit_balance(self, user_id: int) -> int:
    session = self.get_session()
    try:
        user = session.query(User).filter(User.id == user_id).first()
        return user.credit_balance if user else 0
    finally:
        session.close()

def add_credits(self, user_id: int, amount: int, description: str = "",
                order_number: Optional[str] = None) -> tuple[bool, int]:
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

def deduct_credit(self, user_id: int, amount: int = 1, description: str = "",
                  video_url: Optional[str] = None) -> tuple[bool, int]:
    session = self.get_session()
    try:
        user = session.query(User).filter(User.id == user_id).with_for_update().first()
        if not user or user.credit_balance < amount:
            return False, user.credit_balance if user else 0
        user.credit_balance -= amount
        tx = CreditTransaction(
            user_id=user_id, type="consume", amount=-amount,
            balance_after=user.credit_balance,
            description=description or "Service usage",
            video_url=video_url,
        )
        session.add(tx)
        session.commit()
        return True, user.credit_balance
    except Exception:
        session.rollback()
        return False, 0
    finally:
        session.close()

def refund_credit(self, user_id: int, amount: int = 1, description: str = "",
                  video_url: Optional[str] = None) -> tuple[bool, int]:
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
            video_url=video_url,
        )
        session.add(tx)
        session.commit()
        return True, user.credit_balance
    except Exception:
        session.rollback()
        return False, 0
    finally:
        session.close()
```

### API Key Management

```python
def generate_api_key(self, user_id: int, name: Optional[str] = None) -> Optional[str]:
    session = self.get_session()
    try:
        raw_key = f"sk-yt-{secrets.token_urlsafe(32)}"
        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
        key_prefix = raw_key[:12]
        api_key = UserApiKey(
            user_id=user_id, key_hash=key_hash,
            key_prefix=key_prefix, name=name or "Default",
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
        api_key.last_used_at = datetime.now()
        session.commit()
        user = session.query(User).filter(User.id == api_key.user_id).first()
        if not user or not user.is_active:
            return None
        return {
            "id": user.id, "username": user.username, "email": user.email,
            "credit_balance": user.credit_balance, "is_active": user.is_active,
            "api_key_id": api_key.id, "api_key_name": api_key.name,
        }
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()
```

### Register Route

```python
@router.post("/register", response_model=AuthResponse)
async def register(request: RegisterRequest):
    db = get_database()
    user_id = db.create_user(
        request.username, request.email, request.password,
        referral_code=request.referral_code
    )
    if not user_id:
        raise HTTPException(status_code=400, detail="Username or email already exists")
    token = db.create_session(user_id)
    user = db.get_user_by_id(user_id)
    return AuthResponse(
        success=True, message="Registration successful",
        token=token,
        user={
            "id": user["id"], "username": user["username"],
            "email": user["email"], "is_premium": user["is_premium"],
            "is_admin": user.get("is_admin", False),
            "credit_balance": user.get("credit_balance", 0),
            "referral_code": user.get("referral_code", ""),
        },
    )
```

### Login Route

```python
@router.post("/login", response_model=AuthResponse)
async def login(request: LoginRequest):
    db = get_database()
    user = db.authenticate_user(request.email, request.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="Account disabled")
    token = db.create_session(user["id"])
    return AuthResponse(
        success=True, message="Login successful",
        token=token,
        user={
            "id": user["id"], "username": user["username"],
            "email": user["email"], "is_premium": user["is_premium"],
            "is_admin": user.get("is_admin", False),
            "credit_balance": user.get("credit_balance", 0),
            "referral_code": user.get("referral_code", ""),
        },
    )
```

### Frontend TypeScript Interfaces

```typescript
export interface UserInfo {
  id: string;
  email: string;
  username: string | null;
  created_at: string;
  is_premium?: boolean;
  is_admin?: boolean;
  credit_balance?: number;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  token: string;
  user: UserInfo;
}

export interface QuotaInfo {
  daily_limit: number;
  used_today: number;
  remaining: number;
  is_premium: boolean;
}
```

### Dependencies (requirements.txt)

```
fastapi>=0.109.0
uvicorn
pydantic>=2.0
pydantic-settings
email-validator
sqlalchemy>=2.0
psycopg2-binary
python-dotenv
```
