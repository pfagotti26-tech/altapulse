# API do Alta Pulse (FastAPI). Os pacotes internos do Emergent (emergentintegrations/litellm) não são usados pelo código.
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY backend/requirements.txt /tmp/requirements.txt
RUN grep -viE '^(emergentintegrations|litellm)' /tmp/requirements.txt > /tmp/req.txt \
 && pip install --no-cache-dir -r /tmp/req.txt
COPY backend/ /app/
RUN rm -rf /app/tests /app/__pycache__
EXPOSE 8001
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
