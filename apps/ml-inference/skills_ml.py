"""
Beceri çıkarımı ve şirket beceri haritası (öneri üretir; profile/aday kaydına OTOMATİK yazmaz):

  POST /skills/extract - CV / profil metninden sözlük + n-gram eşleşmesiyle beceriler (ai_tools.SKILLS +
                         skill_synonyms.json Türkçe/İngilizce eş anlamlıları) ve şirketin yetkinlik
                         kataloğuyla (learning-service yetkinlikleri) eşleşmeler; her eşleşmenin
                         kanıtı (metinde geçen ifade) ve güveni ('high' | 'medium') döner.
  POST /skills/graph   - çalışan başına (kimliksiz) departman + beceri listesinden beceri ↔ departman
                         sayıları ve birlikte görülme (co-occurrence) bağları. KVKK: 5'ten az kişide
                         görülen beceri, hücre ve bağlar gösterilmez; 5'ten küçük departmanlar "Diğer".

Kayıt yazma kararı her zaman kullanıcıdadır (çalışan profilinde onaylar, İK aday kaydında seçer).
"""

from __future__ import annotations

import json
import os
import re
from collections import Counter
from functools import lru_cache
from itertools import combinations

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from ai_tools import LANGUAGES, SHORT_SKILLS, SKILLS
from tr_text import STOPWORDS, fold, stem

router = APIRouter(prefix="/skills", tags=["skills"])

MIN_GROUP = 5
OTHER = "Diğer"
SYN_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "skill_synonyms.json")


@lru_cache(maxsize=1)
def catalog_index() -> dict[str, dict]:
    """Kanonik anahtar -> {label, phrases}. Etiketi olmayan sözlük becerisi kendi adıyla gösterilir."""
    with open(SYN_PATH, encoding="utf-8") as f:
        data = json.load(f)
    idx: dict[str, dict] = {}
    for s in sorted(SKILLS):
        label = LANGUAGES.get(s) or (s if any(c in s for c in "#./+") or s.isupper() else s[:1].upper() + s[1:])
        idx[s] = {"label": label, "phrases": [s]}
    for e in data["skills"]:
        key = e["key"]
        entry = idx.setdefault(key, {"label": e["label"], "phrases": [key]})
        entry["label"] = e["label"]
        entry["phrases"] = list(dict.fromkeys([key, *(fold(a) for a in e.get("aliases", []))]))
    return idx


@lru_cache(maxsize=1)
def alias_lookup() -> dict[str, str]:
    """İndirgenmiş yazım -> kanonik anahtar (profil becerilerini normalize etmek için)."""
    out: dict[str, str] = {}
    for key, e in catalog_index().items():
        for p in e["phrases"]:
            out.setdefault(p, key)
        out.setdefault(fold(e["label"]), key)
    return out


def _phrase_rx(p: str) -> re.Pattern:
    return re.compile(r"(?<![a-z0-9])" + re.escape(p) + r"(?![a-z0-9])")


@lru_cache(maxsize=4096)
def _rx(p: str) -> re.Pattern:
    return _phrase_rx(p)


def find_skills(text: str) -> list[dict]:
    """Metindeki kanonik beceriler: [{key, label, evidence}] (kanıt = metinde geçen yazım)."""
    n = " " + fold(text) + " "
    out = []
    for key, e in catalog_index().items():
        if key in SHORT_SKILLS:
            m = re.search(SHORT_SKILLS[key], text or "")
            if m:
                out.append({"key": key, "label": e["label"], "evidence": m.group()})
            continue
        for p in e["phrases"]:
            if len(p) < 2:
                continue
            m = _rx(p).search(n)
            if m:
                out.append({"key": key, "label": e["label"], "evidence": p})
                break
    return out


def _content_stems(s: str) -> set[str]:
    return {stem(t) for t in re.findall(r"[a-z0-9#+.]+", fold(s)) if len(t) >= 3 and t not in STOPWORDS}


class CatalogItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(max_length=64)
    name: str = Field(min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=120)


def match_catalog(text: str, catalog: list[CatalogItem], found: list[dict]) -> list[dict]:
    n = " " + fold(text) + " "
    found_keys = {f["key"]: f for f in found}
    text_stems = _content_stems(text)
    idx = catalog_index()
    out = []
    for item in catalog:
        name = fold(item.name).strip()
        hit = None
        if len(name) >= 3 and _rx(name).search(n):
            hit = ("high", item.name)
        if hit is None:
            # Katalog adı bir sözlük becerisini içeriyor ve o beceri metinde var: "C# ile geliştirme" ↔ "csharp".
            for key, f in found_keys.items():
                if any(len(p) >= 2 and _rx(p).search(" " + name + " ") for p in idx[key]["phrases"]):
                    hit = ("high", f["evidence"])
                    break
        if hit is None:
            st = _content_stems(item.name)
            common = st & text_stems
            if len(st) >= 2 and len(common) / len(st) >= 0.67:
                hit = ("medium", ", ".join(sorted(common)))
            elif len(st) == 1 and common and len(next(iter(common))) >= 5:
                hit = ("medium", next(iter(common)))
        if hit:
            out.append({"id": item.id, "name": item.name, "category": item.category, "confidence": hit[0], "evidence": hit[1]})
    out.sort(key=lambda r: (r["confidence"] != "high", r["name"]))
    return out


class ExtractRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=200_000)
    catalog: list[CatalogItem] = Field(default_factory=list, max_length=5000)
    known: list[str] = Field(default_factory=list, max_length=500, description="Profilde zaten olan beceriler (öneriden çıkarılır)")


def extract(req: ExtractRequest) -> dict:
    found = find_skills(req.text)
    known = {alias_lookup().get(fold(k).strip(), fold(k).strip()) for k in req.known}
    suggestions = [f for f in found if f["key"] not in known and fold(f["label"]) not in known]
    return {
        "skills": suggestions,
        "already_known": [f for f in found if f not in suggestions],
        "catalog_matches": match_catalog(req.text, req.catalog, found),
        "method": "Sözlük + n-gram eşleşmesi (Türkçe/İngilizce eş anlamlılar, hafif ek budama). Öneridir; kaydı kullanıcı onaylar.",
    }


@router.post("/extract")
async def extract_route(req: ExtractRequest) -> dict:
    return extract(req)


# ------------------------------------------------------------------ beceri haritası

class PersonSkills(BaseModel):
    model_config = ConfigDict(extra="forbid")
    department: str | None = Field(default=None, max_length=200)
    skills: list[str] = Field(default_factory=list, max_length=200)


class GraphRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    people: list[PersonSkills] = Field(default_factory=list, max_length=100_000)
    max_edges: int = Field(default=60, ge=1, le=500)


def normalize_skill(raw: str) -> tuple[str, str] | None:
    """(gruplama anahtarı, görünen ad). Sözlükte varsa kanonik ad; yoksa kullanıcının yazımı."""
    s = re.sub(r"\s+", " ", (raw or "").strip())
    if not s or len(s) > 80:
        return None
    f = fold(s)
    key = alias_lookup().get(f)
    if key:
        return key, catalog_index()[key]["label"]
    return f, s[:1].upper() + s[1:]


def skill_graph(req: GraphRequest) -> dict:
    dept_size = Counter((p.department or OTHER) for p in req.people)
    small = {d for d, c in dept_size.items() if c < MIN_GROUP}
    people = []
    labels: dict[str, Counter] = {}
    for p in req.people:
        d = p.department or OTHER
        d = OTHER if d in small else d
        keys = set()
        for raw in p.skills:
            n = normalize_skill(raw)
            if n:
                keys.add(n[0])
                labels.setdefault(n[0], Counter())[n[1]] += 1
        people.append((d, keys))
    other_size = sum(1 for d, _ in people if d == OTHER)
    hidden_people = other_size if 0 < other_size < MIN_GROUP else 0

    skill_people = Counter(k for _, ks in people for k in ks)
    visible = {k for k, c in skill_people.items() if c >= MIN_GROUP}
    label = {k: labels[k].most_common(1)[0][0] for k in visible}

    cells = Counter((d, k) for d, ks in people for k in ks if k in visible and not (d == OTHER and hidden_people))
    hidden_cells = sum(1 for c in cells.values() if c < MIN_GROUP)
    nodes = []
    for k in sorted(visible, key=lambda k: (-skill_people[k], label[k])):
        depts = sorted(((d, c) for (d, kk), c in cells.items() if kk == k and c >= MIN_GROUP), key=lambda x: -x[1])
        nodes.append({"skill": label[k], "people": skill_people[k],
                      "departments": [{"department": d, "people": c} for d, c in depts]})

    pairs = Counter()
    for _, ks in people:
        for a, b in combinations(sorted(ks & visible), 2):
            pairs[(a, b)] += 1
    edges = []
    for (a, b), c in pairs.items():
        if c < MIN_GROUP:
            continue
        union = skill_people[a] + skill_people[b] - c
        edges.append({"a": label[a], "b": label[b], "people": c, "jaccard": round(c / union, 3) if union else 0.0})
    edges.sort(key=lambda e: (-e["jaccard"], -e["people"]))

    departments = []
    for d in sorted({d for d, _ in people}):
        if d == OTHER and hidden_people:
            continue
        size = sum(1 for dd, _ in people if dd == d)
        top = sorted(((label[k], c) for (dd, k), c in cells.items() if dd == d and c >= MIN_GROUP), key=lambda x: -x[1])[:8]
        departments.append({"department": d, "people": size, "top_skills": [{"skill": s, "people": c} for s, c in top]})

    return {
        "people": len(req.people),
        "people_with_skills": sum(1 for _, ks in people if ks),
        "nodes": nodes,
        "edges": edges[: req.max_edges],
        "departments": departments,
        "hidden_skills": sum(1 for c in skill_people.values() if c < MIN_GROUP),
        "hidden_cells": hidden_cells,
        "hidden_people": hidden_people,
        "min_group": MIN_GROUP,
        "note": "5'ten az kişide görülen beceriler, departman hücreleri ve bağlar gösterilmez; 5'ten küçük departmanlar \"Diğer\" altında birleşir.",
    }


@router.post("/graph")
async def graph_route(req: GraphRequest) -> dict:
    return skill_graph(req)
