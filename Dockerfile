# Online backend (rooms, accounts, WebSockets). The web app is built separately with npm run build.
# Build and run from the repository root:
#   docker build -t declare-backend .
#   docker run -p 8000:8000 -v declare-data:/data --env-file .env declare-backend
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATABASE_PATH=/data/declare.sqlite3

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY shared shared
COPY backend backend

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8000

# Hosts such as Render, Railway, and Fly set PORT. Default to 8000 locally.
CMD ["sh", "-c", "uvicorn backend.app:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
