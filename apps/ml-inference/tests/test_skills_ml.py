"""Beceri çıkarımı (eş anlamlılar, katalog eşleşmesi) ve beceri haritası (5'ten küçük grup gizli)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import skills_ml as sm  # noqa: E402
from ai_tools import parse_cv_text  # noqa: E402


def keys(found):
    return {f["key"] for f in found}


def test_es_anlamlilar_ve_kisa_beceriler():
    k = keys(sm.find_skills("5 yıl k8s ve csharp deneyimi; payroll süreçleri; Project Management"))
    assert {"kubernetes", "c#", "bordro", "proje yonetimi"} <= k
    assert "go" not in keys(sm.find_skills("projeye go live sürecinde katıldım"))
    assert "go" in keys(sm.find_skills("Backend: Go, PostgreSQL"))


def test_katalog_eslesmesi_ve_guven():
    catalog = [sm.CatalogItem(id="1", name="C# ile geliştirme"), sm.CatalogItem(id="2", name="Sunum becerisi"),
               sm.CatalogItem(id="3", name="Bütçe planlama ve kontrol"), sm.CatalogItem(id="4", name="Muhasebe")]
    res = sm.extract(sm.ExtractRequest(text="csharp ile mikroservis geliştirdim. Yıllık bütçe planlaması yaptım.", catalog=catalog))
    by = {m["id"]: m for m in res["catalog_matches"]}
    assert by["1"]["confidence"] == "high"
    assert "3" in by and by["3"]["confidence"] in ("high", "medium")
    assert "2" not in by and "4" not in by


def test_profilde_olan_beceri_onerilmez():
    res = sm.extract(sm.ExtractRequest(text="Python ve Kubernetes", known=["python", "K8s"]))
    assert keys(res["skills"]) == set()
    assert {f["key"] for f in res["already_known"]} == {"python", "kubernetes"}


def test_cv_ayristirma_es_anlamlilari_kullanir():
    cv = parse_cv_text("Ayşe Yılmaz\nayse@example.com\nDeneyim: k8s, csharp, payroll\n" + "x " * 120)
    assert {"kubernetes", "c#", "bordro"} <= set(cv.skills)


def test_beceri_haritasi_kucuk_grup_gizler():
    people = [sm.PersonSkills(department="Mühendislik", skills=["Python", "k8s"]) for _ in range(6)]
    people += [sm.PersonSkills(department="Mühendislik", skills=["Rust"]) for _ in range(2)]
    people += [sm.PersonSkills(department="Finans", skills=["Muhasebe", "Excel"]) for _ in range(5)]
    people += [sm.PersonSkills(department="Hukuk", skills=["İş hukuku"]) for _ in range(3)]
    res = sm.skill_graph(sm.GraphRequest(people=people))
    names = {n["skill"] for n in res["nodes"]}
    assert "Kubernetes" in names and "Python" in names and "Muhasebe" in names
    assert "Rust" not in names  # 2 kişi
    assert res["hidden_skills"] >= 2
    depts = {d["department"] for d in res["departments"]}
    assert "Hukuk" not in depts and "Diğer" not in depts  # 3 kişilik departman birleşip yine küçük → gizli
    assert res["hidden_people"] == 3
    edge = next(e for e in res["edges"] if {e["a"], e["b"]} == {"Python", "Kubernetes"})
    assert edge["people"] == 6 and edge["jaccard"] == 1.0
