# PartyHause Django API container (production)
FROM python:3.9-slim

WORKDIR /app

# Disable apt HTTP pipelining (deb.debian.org/Fastly intermittently corrupts
# .debs when pipelined — same fix as Dockerfile.combined).
RUN echo 'Acquire::http::Pipeline-Depth "0"; Acquire::http::No-Cache true;' \
  > /etc/apt/apt.conf.d/99nopipeline && \
  apt-get update -y && apt-get install -y --no-install-recommends \
    gcc libpq-dev && \
  rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Collect static files for WhiteNoise
ENV DJANGO_SETTINGS_MODULE=partyhause.settings
ENV PYTHONUNBUFFERED=1

# Port 8001 matches the running dev backend the Vite proxy forwards to
EXPOSE 8001

# Gunicorn production server on port 8001
CMD ["gunicorn", "partyhause.wsgi:application", "--bind", "0.0.0.0:8001", "--workers", "3", "--timeout", "120"]
