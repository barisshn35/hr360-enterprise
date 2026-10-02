"""İngilizce arayüz: dil seçimi saklanır, tüm ekranlar hatasız açılır ve arayüzde çevrilmemiş
metin kalmaz. Ad, pozisyon, kural adı gibi kullanıcı verileri Türkçe kalabileceği için kontrol,
görünen metinlerin sözlükteki Türkçe kaynak metinlerden biriyle birebir aynı olup olmadığına bakar
(çeviri sözlüğe girmediyse ya da koddaki metin tx() ile sarılmadıysa yakalanır)."""

import json
import os
import re

from conftest import BASE_URL
from test_smoke import ROUTES

EN = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "apps", "web", "src", "locales", "en.json"), encoding="utf-8"))
TR = re.compile("[çğıöşüÇĞİÖŞÜ]")
# Çevirisi kaynakla aynı olan (bot komutu, örnek veri) ve yer tutuculu anahtarlar hariç.
SOURCES = {k for k, v in EN.items() if not k.startswith("@server:") and "{" not in k and v != k and TR.search(k) and len(k) > 2}


def ui_texts(page):
    return page.evaluate("""() => [...document.querySelectorAll(
        'header nav a, header button, h1, h2, h3, th, label, button, [role=tab], [role=menuitem]')]
        .filter(e => e.offsetParent !== null).map(e => e.innerText.trim()).filter(Boolean)""")


def test_ingilizce_arayuz(session):
    page, watched = session("admin")
    page.goto(BASE_URL + "/panel?lang=en", wait_until="networkidle")
    assert page.evaluate("document.documentElement.lang") == "en"
    # Dil seçimi saklanır: parametresiz adreste de İngilizce kalır.
    page.goto(BASE_URL + "/panel/izin", wait_until="networkidle")
    assert page.evaluate("document.documentElement.lang") == "en"
    assert page.get_by_role("button", name="New leave request").first.is_visible()

    problems, turkish = {}, {}
    for route in ROUTES:
        page.goto(BASE_URL + route, wait_until="domcontentloaded")
        try:
            page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:  # noqa: BLE001 — SSE akışı ağı boşta bırakmaz
            page.wait_for_timeout(1500)
        errs = [e for e in watched.take() if "events/stream" not in e]
        if errs:
            problems[route] = errs
        left = sorted({t[:60] for t in ui_texts(page) if t in SOURCES or any(line.strip() in SOURCES for line in t.splitlines())})
        if left:
            turkish[route] = left
    assert not problems, "\n".join(f"{r}: {e}" for r, e in problems.items())
    assert not turkish, "Çevrilmemiş arayüz metni:\n" + "\n".join(f"{r}: {t}" for r, t in turkish.items())

    # Türkçeye dönüş
    page.goto(BASE_URL + "/panel?lang=tr", wait_until="networkidle")
    assert page.evaluate("document.documentElement.lang") == "tr"
