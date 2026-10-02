"""Tarayıcı uçtan uca testleri (Playwright, pytest).

Çalıştırma:  python3 -m pytest -q tests/e2e
Gereken: çalışan bir HR360 (HR360_BASE_URL), test kullanıcıları (tests/credentials.json
ya da HR360_TEST_USERS), `pip install pytest playwright` ve `playwright install chromium`.
"""

import os
import sys

import pytest
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "support"))
import hr360_login  # noqa: E402

BASE_URL = hr360_login.BASE_URL


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=["--no-sandbox"])
        yield b
        b.close()


class Watched:
    """Sayfa hatalarını, konsol hatalarını ve başarısız API yanıtlarını toplar."""

    def __init__(self, page):
        self.page = page
        self.errors: list[str] = []
        page.on("pageerror", lambda e: self.errors.append(f"PAGEERROR {e}"))
        page.on("console", lambda m: self.errors.append(f"CONSOLE {m.text[:200]}") if m.type == "error" else None)
        page.on("response", lambda r: self.errors.append(f"HTTP {r.status} {r.request.method} {r.url.replace(BASE_URL, '')[:120]}")
                if r.status >= 400 and ("/api/" in r.url or "/ml/" in r.url) else None)

    def take(self) -> list[str]:
        out, self.errors = self.errors, []
        return out


@pytest.fixture
def session(browser):
    """Kullanıcı adına oturum açmış sayfa üretir: session('ayse')."""
    contexts = []

    def make(who: str):
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="tr-TR")
        contexts.append(ctx)
        page = ctx.new_page()
        watched = Watched(page)
        hr360_login.login_page(page, who)
        page.wait_for_load_state("networkidle")
        watched.take()
        return page, watched

    yield make
    for c in contexts:
        c.close()


def users():
    return hr360_login.users()
