---
name: tech-stack-preferences
description: Defines the preferred tech stack, project structure, design system, and product style for new projects. Includes FastAPI + React + TypeScript + PostgreSQL stack, dark theme CSS variables, i18n setup, Docker deployment, and API conventions. Use when starting a new product, setting up a project, or making technology decisions.
---

# Tech Stack & Product Style Preferences

Standard technology choices and design patterns for rapid product development.

## Backend Stack

- **Framework**: FastAPI (Python 3.11+)
- **ORM**: SQLAlchemy 2.0+
- **Database**: PostgreSQL 15+
- **Config**: Pydantic Settings (auto-load from `.env`)
- **Validation**: Pydantic v2 models
- **HTTP Client**: httpx (async), requests (sync)
- **Auth**: See `reusable-auth-system` skill

### Key Dependencies

```
fastapi>=0.109.0
uvicorn
pydantic>=2.0
pydantic-settings
email-validator
sqlalchemy>=2.0
psycopg2-binary
python-dotenv
httpx
aiofiles
```

### Config Pattern (Pydantic Settings)

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str = "postgresql://user:pass@localhost:5432/dbname"
    secret_key: str = ""
    cors_origins: str = "http://localhost:5173"
    log_level: str = "INFO"
    temp_dir: str = "/tmp/processing"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

settings = Settings()
```

### API Conventions

- REST API with prefix `/api/v1/`
- Bearer Token auth: `Authorization: Bearer <token>`
- Swagger docs at `/docs`, ReDoc at `/redoc`
- Route organization: separate files per domain (auth_routes, credit_routes, admin_routes)
- FastAPI `Depends()` for auth injection
- Standard error codes: 400 (bad request), 401 (unauthorized), 403 (forbidden), 404 (not found)

## Frontend Stack

- **Framework**: React 19 + TypeScript
- **Build Tool**: Vite 7
- **HTTP Client**: axios
- **Icons**: lucide-react
- **Charts**: recharts (admin dashboard)
- **i18n**: i18next + react-i18next + browser language detector
- **State**: React `useState` / `useEffect` (no Redux/Zustand)
- **Styling**: Vanilla CSS + CSS custom properties (no Tailwind, no CSS-in-JS)

### Key Dependencies

```json
{
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "axios": "^1.13.0",
    "i18next": "^25.0.0",
    "react-i18next": "^16.0.0",
    "i18next-browser-languagedetector": "^8.0.0",
    "lucide-react": "^0.561.0",
    "recharts": "^3.7.0"
  },
  "devDependencies": {
    "vite": "^7.2.0",
    "@vitejs/plugin-react": "^5.1.0",
    "typescript": "~5.9.0",
    "eslint": "^9.0.0"
  }
}
```

### axios Instance Pattern

```typescript
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Token auto-injection
const token = localStorage.getItem('auth_token');
if (token) {
  api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
}

export default api;
```

### i18n Setup

```typescript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './en.json';
import zh from './zh.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, zh: { translation: zh } },
    fallbackLng: 'en',
    detection: { order: ['localStorage', 'navigator'] },
    interpolation: { escapeValue: false },
  });
```

## Design System

### Dark Theme

Primary aesthetic: **dark, modern, with vibrant accent colors**.

```css
:root {
  /* Primary */
  --primary: #ff3b3b;
  --primary-hover: #ff5555;
  --primary-glow: rgba(255, 59, 59, 0.3);

  /* Accent */
  --accent: #ff9500;
  --accent-glow: rgba(255, 149, 0, 0.3);

  /* Backgrounds (darkest to lightest) */
  --bg-deep: #0a0a0a;
  --bg-dark: #111111;
  --bg-card: #1a1a1a;
  --bg-elevated: #222222;
  --bg-hover: #2a2a2a;

  /* Text */
  --text-primary: #ffffff;
  --text-secondary: #888888;
  --text-muted: #555555;

  /* Status */
  --success: #00d26a;
  --error: #ff4757;
  --warning: #ffa502;

  /* Borders */
  --border: rgba(255, 255, 255, 0.08);
  --border-light: rgba(255, 255, 255, 0.12);

  /* Border Radius */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;

  /* Shadows */
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 20px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8px 40px rgba(0, 0, 0, 0.5);
  --shadow-glow: 0 0 40px var(--primary-glow);
}
```

### Typography

```css
body {
  font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
```

### Background Pattern

```css
.app {
  background:
    radial-gradient(ellipse at top left, rgba(255, 59, 59, 0.05) 0%, transparent 50%),
    radial-gradient(ellipse at bottom right, rgba(255, 149, 0, 0.03) 0%, transparent 50%),
    var(--bg-deep);
}
```

### Header Style

```css
.header {
  background: rgba(17, 17, 17, 0.8);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
}
```

For complete CSS variable reference, see [style-reference.md](style-reference.md).

## Project Structure Template

```
project-root/
├── backend/
│   ├── app/
│   │   ├── api/              # Route modules
│   │   │   ├── routes.py     # Main business routes
│   │   │   ├── auth_routes.py
│   │   │   ├── admin_routes.py
│   │   │   └── credit_routes.py
│   │   ├── services/         # Business logic services
│   │   ├── middleware/        # Logging, CORS, etc.
│   │   ├── utils/            # Helpers
│   │   ├── config.py         # Pydantic Settings
│   │   ├── database.py       # ORM models + Database class
│   │   └── main.py           # FastAPI app + router registration
│   ├── Dockerfile
│   ├── requirements.txt
│   └── requirements-prod.txt
├── frontend/
│   ├── src/
│   │   ├── components/       # Feature-based component folders
│   │   ├── i18n/             # en.json, zh.json, index.ts
│   │   ├── api.ts            # axios instance + all API functions
│   │   ├── App.tsx           # Main app (routing, auth state)
│   │   ├── App.css           # Main styles + CSS variables
│   │   ├── index.css         # Reset + base styles
│   │   └── main.tsx          # Entry point
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── .env                      # Environment variables
├── docker-compose.prod.yml
├── docker-compose.dev.yml
├── deploy.sh                 # Deployment script
└── README.md
```

## Deployment

### Docker Compose (Production)

- Frontend: Nginx serving static build (port 9000)
- Backend: Uvicorn (port 9001)
- Database: PostgreSQL 15 (port 5433)
- Reverse proxy: Nginx handles TLS + routing

### Deploy Script Pattern

```bash
# Smart deploy: only rebuild what changed
./deploy.sh smart
./deploy.sh --frontend   # frontend only
./deploy.sh --backend    # backend only
./deploy.sh --restart    # restart containers
./deploy.sh --full       # rebuild everything
```

Features: parallel builds, maintenance mode, health checks, zero-downtime switching.

### Frontend Dockerfile

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

### Backend Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements-prod.txt .
RUN pip install --no-cache-dir -r requirements-prod.txt
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```
