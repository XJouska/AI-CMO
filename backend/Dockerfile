FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates fonts-liberation libnss3 libatk-bridge2.0-0 \
    libdrm2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 \
    libpango-1.0-0 libcairo2 libcups2 libxss1 libgtk-3-0 libxshmfence1 \
    libglu1-mesa dbus xvfb \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && playwright install chromium

COPY . .

RUN mkdir -p /app/browser-profiles/default

EXPOSE 9001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9001"]
