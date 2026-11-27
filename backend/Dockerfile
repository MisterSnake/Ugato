# syntax=docker/dockerfile:1

FROM python:3.14-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.11.27 /uv /bin/uv
# Use the image's Python, so the virtual environment also works in the final stage.
ENV UV_PYTHON_DOWNLOADS=0 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

FROM python:3.14-slim
RUN useradd --system --no-create-home --uid 10001 app
WORKDIR /app
COPY --from=build /app/.venv ./.venv
COPY app ./app
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION \
    PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1
USER app
EXPOSE 8000
# A single worker, never --workers: games live in process memory.
# The ingress terminates TLS, hence the proxy headers.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
