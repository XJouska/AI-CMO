# Design System - Complete Style Reference

## CSS Custom Properties (Full Set)

```css
:root {
  /* ===== Colors ===== */

  /* Primary - vibrant red */
  --primary: #ff3b3b;
  --primary-hover: #ff5555;
  --primary-glow: rgba(255, 59, 59, 0.3);

  /* Accent - warm orange */
  --accent: #ff9500;
  --accent-glow: rgba(255, 149, 0, 0.3);

  /* Backgrounds (5-level grayscale, darkest to lightest) */
  --bg-deep: #0a0a0a;       /* page background */
  --bg-dark: #111111;        /* header, footer */
  --bg-card: #1a1a1a;        /* cards, panels */
  --bg-elevated: #222222;    /* elevated elements */
  --bg-hover: #2a2a2a;       /* hover states */

  /* Text (3-level hierarchy) */
  --text-primary: #ffffff;
  --text-secondary: #888888;
  --text-muted: #555555;

  /* Status colors */
  --success: #00d26a;
  --success-glow: rgba(0, 210, 106, 0.2);
  --error: #ff4757;
  --warning: #ffa502;

  /* Borders (semi-transparent white) */
  --border: rgba(255, 255, 255, 0.08);
  --border-light: rgba(255, 255, 255, 0.12);

  /* ===== Spacing & Sizing ===== */

  /* Border radius scale */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;

  /* Shadow scale */
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 20px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8px 40px rgba(0, 0, 0, 0.5);
  --shadow-glow: 0 0 40px var(--primary-glow);
}
```

## Typography

```css
body {
  font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: linear-gradient(135deg, #0c0c0c 0%, #151515 50%, #0c0c0c 100%);
  color: #ffffff;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

Load Manrope from Google Fonts:
```html
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
```

## Reset & Base Styles

```css
*, *::before, *::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  width: 100%;
}
```

## Common Component Patterns

### App Container with Gradient Atmosphere

```css
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(ellipse at top left, rgba(255, 59, 59, 0.05) 0%, transparent 50%),
    radial-gradient(ellipse at bottom right, rgba(255, 149, 0, 0.03) 0%, transparent 50%),
    var(--bg-deep);
}
```

### Sticky Header with Blur

```css
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2.5rem;
  background: rgba(17, 17, 17, 0.8);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
}
```

### Card Pattern

```css
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 2rem;
  box-shadow: var(--shadow-sm);
}

.card:hover {
  border-color: var(--border-light);
  box-shadow: var(--shadow-md);
}
```

### Primary Button

```css
.btn-primary {
  background: linear-gradient(135deg, var(--primary), var(--accent));
  color: white;
  border: none;
  border-radius: var(--radius-md);
  padding: 0.875rem 2rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-glow);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}
```

### Input Field

```css
.input {
  width: 100%;
  padding: 1rem 1.25rem;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 1rem;
  transition: all 0.3s ease;
}

.input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-glow);
}

.input::placeholder {
  color: var(--text-muted);
}
```

### Status Badge

```css
.badge-success { background: rgba(0, 210, 106, 0.15); color: var(--success); }
.badge-error { background: rgba(255, 71, 87, 0.15); color: var(--error); }
.badge-warning { background: rgba(255, 165, 2, 0.15); color: var(--warning); }
```

### Logo Glow Effect

```css
.logo svg {
  color: var(--primary);
  filter: drop-shadow(0 0 8px var(--primary-glow));
}
```

## Animation Patterns

```css
/* Standard transition */
transition: all 0.3s ease;

/* Hover lift */
.hover-lift:hover {
  transform: translateY(-2px);
}

/* Glow on hover */
.hover-glow:hover {
  box-shadow: var(--shadow-glow);
}

/* Pulse animation for loading */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

## Responsive Breakpoints

```css
/* Mobile first approach */
@media (max-width: 768px) {
  .header { padding: 0.75rem 1rem; }
  .main-content { padding: 1rem; }
}

@media (max-width: 480px) {
  /* Extra small adjustments */
}
```

## i18n File Structure

### en.json (excerpt)

```json
{
  "common": {
    "appName": "Product Name",
    "loading": "Loading...",
    "error": "An error occurred",
    "cancel": "Cancel",
    "confirm": "Confirm",
    "save": "Save"
  },
  "auth": {
    "login": "Login",
    "register": "Register",
    "email": "Email",
    "password": "Password",
    "username": "Username"
  },
  "pricing": {
    "title": "Get Credits",
    "balance": "Your Balance",
    "recharge": "Recharge"
  }
}
```

### zh.json (excerpt)

```json
{
  "common": {
    "appName": "产品名称",
    "loading": "加载中...",
    "error": "发生错误",
    "cancel": "取消",
    "confirm": "确认",
    "save": "保存"
  },
  "auth": {
    "login": "登录",
    "register": "注册",
    "email": "邮箱",
    "password": "密码",
    "username": "用户名"
  },
  "pricing": {
    "title": "获取积分",
    "balance": "你的余额",
    "recharge": "充值"
  }
}
```
