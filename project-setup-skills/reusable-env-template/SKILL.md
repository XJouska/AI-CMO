---
name: reusable-env-template
description: Provides a comprehensive .env template with all environment variables needed for a full-stack product (database, auth, payments, storage, AI services, deployment). Use when setting up a new project, configuring environment variables, or creating a .env file.
---

# Reusable .env Template

A comprehensive environment variable template covering all infrastructure components.

## Usage

Copy `.env.template` to your project root as `.env`:

```bash
cp ~/.cursor/skills/reusable-env-template/.env.template /path/to/your/project/.env
```

Then fill in the actual values for your project.

## Sections

| Section | Variables | Purpose |
|---------|-----------|---------|
| Database | `DATABASE_URL` | PostgreSQL connection |
| Auth | `SECRET_KEY`, `SUPABASE_*` | Session tokens, optional Supabase |
| LemonSqueezy | `LEMONSQUEEZY_*` | International payments (SGD) |
| Alipay | `ALIPAY_*` | China payments (CNY) |
| Storage | `OSS_*` | Aliyun OSS file storage |
| AI | `QWEN_*` | AI/LLM services |
| App | `CORS_ORIGINS`, `LOG_LEVEL` | Application config |
| Frontend | `VITE_API_URL` | Vite env vars |

## Notes

- Backend variables are loaded via Pydantic Settings (`BaseSettings` with `env_file`)
- Frontend variables must be prefixed with `VITE_` for Vite to expose them
- Place frontend-specific vars in `frontend/.env` or `frontend/.env.production`
- Never commit the actual `.env` file; only commit `.env.example` with placeholder values

## Template File

See [.env.template](.env.template) for the complete template.
