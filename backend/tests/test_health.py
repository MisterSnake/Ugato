from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.settings import Settings, get_settings

client = TestClient(app)


@pytest.fixture(autouse=True)
def clear_overrides() -> Iterator[None]:
    yield
    app.dependency_overrides.clear()


def test_health_reports_dev_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("APP_VERSION", raising=False)

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "dev"}


def test_health_reports_the_configured_version() -> None:
    settings = Settings(app_version="abc123", allowed_origins=[])
    app.dependency_overrides[get_settings] = lambda: settings

    response = client.get("/api/health")

    assert response.status_code == 200
    # TEMPORARY: broken on purpose to verify that CI fails (task 4.1). Do not merge.
    assert response.json() == {"status": "ok", "version": "broken-on-purpose"}
