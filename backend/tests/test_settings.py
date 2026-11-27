import pytest

from app.settings import get_settings


def test_defaults_for_local_development(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("APP_VERSION", raising=False)
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)

    settings = get_settings()

    assert settings.app_version == "dev"
    assert settings.allowed_origins == ["http://localhost:5173"]


def test_allowed_origins_are_split_trimmed_and_without_blanks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ALLOWED_ORIGINS", " https://a.example, https://b.example ,")

    assert get_settings().allowed_origins == [
        "https://a.example",
        "https://b.example",
    ]


def test_app_version_comes_from_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_VERSION", "abc")

    assert get_settings().app_version == "abc"
