"""
Yapay zekâ destekli İK araçları (HR360).

DÜRÜSTLÜK NOTU
--------------
Buradaki araçların hiçbiri büyük dil modeli (LLM) DEĞİLDİR. Hepsi açıklanabilir,
yerelde çalışan klasik yöntemlerdir:

  * CV ayrıştırma      : PDF/DOCX/TXT metin çıkarımı + düzenli ifade + beceri sözlüğü
  * İlan yazıcı        : şablon tabanlı metin üretimi (değişken cümle havuzu)
  * Ayrımcı ifade      : Türkçe kural/sözlük tabanlı tarama, her bulguya gerekçe + öneri
  * Performans özeti   : çıkarımsal özet (cümle puanlama) + tema sayımı
  * Aday–ilan eşleşme  : TF-IDF + kosinüs benzerliği + beceri kesişimi (scikit-learn)
  * İzin tahmini       : mevsimsellik + doğrusal eğilim (Holt-Winters benzeri, sade)
  * Eğitim önerisi     : TF-IDF içerik benzerliği + zorunlu/eksik eğitim önceliği

Kişi hakkında KARAR vermezler; yalnızca öneri ve gerekçe üretirler. Kişisel veri
servis dışına çıkmaz (harici API çağrısı yok).
"""

from __future__ import annotations

import io
import math
import re
import unicodedata
import zipfile
from collections import Counter
from datetime import date
from typing import Literal

import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

router = APIRouter(prefix="/ai", tags=["ai-tools"])

# --------------------------------------------------------------------- yardımcılar

TR_MAP = str.maketrans("ıİşŞğĞüÜöÖçÇâÂîÎûÛ", "iisSgGuUoOcCaAiIuU")


def norm(s: str) -> str:
    s = (s or "").replace("İ", "i").replace("I", "ı").lower()
    return s.translate(TR_MAP)


TR_STOP = set(
    """ve veya ile icin bir bu su o da de ki mi mu ama gibi daha cok en her olan olarak ise
    ya hem kadar sonra once uzerinde altinda icinde tum bazi biz siz onlar ben sen
    the and or for with of to in on a an is are be as at by from""".split()
)


def tokens(s: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9+#.]{2,}", norm(s)) if t not in TR_STOP]


# ------------------------------------------------------------------- beceri sözlüğü
SKILLS = {
    # yazılım
    "python", "java", "c#", ".net", "asp.net", "javascript", "typescript", "react", "angular", "vue", "node.js", "nodejs",
    "go", "golang", "rust", "kotlin", "swift", "php", "laravel", "django", "flask", "fastapi", "spring", "spring boot",
    "sql", "postgresql", "mysql", "mssql", "oracle", "mongodb", "redis", "kafka", "rabbitmq", "elasticsearch",
    "docker", "kubernetes", "terraform", "ansible", "aws", "azure", "gcp", "linux", "git", "ci/cd", "jenkins",
    "microservices", "mikroservis", "rest", "graphql", "grpc", "html", "css", "tailwind", "figma", "ux", "ui",
    "machine learning", "makine ogrenmesi", "deep learning", "nlp", "pandas", "numpy", "scikit-learn", "tensorflow", "pytorch",
    "power bi", "tableau", "excel", "sap", "erp", "crm", "salesforce", "jira", "scrum", "agile", "kanban",
    "selenium", "cypress", "playwright", "test otomasyonu", "qa", "devops", "sre", "siber guvenlik", "network",
    # iş / İK / finans
    "bordro", "muhasebe", "finans", "butce", "raporlama", "satis", "pazarlama", "dijital pazarlama", "seo", "sem",
    "musteri iliskileri", "proje yonetimi", "urun yonetimi", "tedarik zinciri", "lojistik", "satin alma",
    "insan kaynaklari", "ise alim", "egitim planlama", "performans yonetimi", "is hukuku", "sgk", "liderlik", "takim yonetimi",
    "iletisim", "sunum", "muzakere", "analitik dusunme", "problem cozme", "ingilizce", "almanca", "fransizca",
    "arapca", "rusca", "ispanyolca", "pmp", "itil", "six sigma", "lean", "iso 27001", "kvkk", "gdpr",
}
LANGUAGES = {"ingilizce": "İngilizce", "almanca": "Almanca", "fransizca": "Fransızca", "arapca": "Arapça",
             "rusca": "Rusça", "ispanyolca": "İspanyolca", "italyanca": "İtalyanca", "japonca": "Japonca", "english": "İngilizce",
             "german": "Almanca", "turkce": "Türkçe", "turkish": "Türkçe"}
EDU = [("doktora", "Doktora"), ("phd", "Doktora"), ("yuksek lisans", "Yüksek lisans"), ("master", "Yüksek lisans"),
       ("mba", "Yüksek lisans"), ("lisans", "Lisans"), ("bachelor", "Lisans"), ("universite", "Lisans"),
       ("on lisans", "Ön lisans"), ("meslek yuksekokulu", "Ön lisans"), ("lise", "Lise")]


def find_skills(text: str) -> list[str]:
    n = " " + norm(text) + " "
    found = []
    for s in SKILLS:
        pattern = r"(?<![a-z0-9])" + re.escape(s) + r"(?![a-z0-9])"
        if re.search(pattern, n):
            found.append(s)
    return sorted(set(found))


# ===================================================================== CV ayrıştırma

def extract_text(filename: str, data: bytes) -> str:
    name = (filename or "").lower()
    if name.endswith(".pdf") or data[:4] == b"%PDF":
        try:
            from pypdf import PdfReader
        except ImportError as exc:  # pragma: no cover
            raise HTTPException(500, "PDF okuyucu (pypdf) kurulu değil") from exc
        try:
            reader = PdfReader(io.BytesIO(data))
            return "\n".join((p.extract_text() or "") for p in reader.pages[:15])
        except Exception as exc:  # pypdf bozuk/sifreli dosyada farkli hatalar atar
            raise HTTPException(400, "PDF okunamadı (bozuk ya da şifreli olabilir)") from exc
    if name.endswith(".docx"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                xml = z.read("word/document.xml").decode("utf-8", "ignore")
        except (zipfile.BadZipFile, KeyError) as exc:
            raise HTTPException(400, "Geçerli bir .docx dosyası değil") from exc
        xml = re.sub(r"</w:p>", "\n", xml)
        return re.sub(r"<[^>]+>", "", xml)
    if name.endswith((".txt", ".md", ".text")) or not name:
        if b"\x00" in data[:4096]:
            raise HTTPException(415, "Metin dosyası ikili veri içeriyor")
        return data.decode("utf-8", "ignore")
    raise HTTPException(415, "Desteklenen biçimler: PDF, DOCX, TXT")


class CvResult(BaseModel):
    name: str | None
    email: str | None
    phone: str | None
    linkedin: str | None
    location: str | None
    skills: list[str]
    languages: list[str]
    education: str | None
    universities: list[str]
    experience_years: float | None
    experience_basis: str | None
    summary: str
    text_length: int
    warnings: list[str]


def parse_cv_text(text: str) -> CvResult:
    warnings: list[str] = []
    clean = re.sub(r"[ \t]+", " ", text)
    lines = [l.strip() for l in clean.splitlines() if l.strip()]
    email = next(iter(re.findall(r"[\w.+-]+@[\w-]+\.[\w.-]+", clean)), None)
    phone_m = re.search(r"(\+?90[\s-]?)?\(?0?5\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}", clean)
    phone = re.sub(r"[^\d+]", "", phone_m.group(0)) if phone_m else None
    linkedin = next(iter(re.findall(r"(?:https?://)?(?:[a-z]{2,3}\.)?linkedin\.com/in/[\w-]+/?", clean, re.I)), None)

    name = None
    for l in lines[:6]:
        words = l.split()
        if 2 <= len(words) <= 4 and all(w[:1].isupper() for w in words) and "@" not in l and not any(ch.isdigit() for ch in l):
            if norm(l) not in ("ozgecmis", "curriculum vitae", "cv", "resume"):
                name = l.title() if l.isupper() else l
                break
    if not name:
        warnings.append("Ad soyad otomatik bulunamadı.")

    city = None
    for c in ("İstanbul", "Ankara", "İzmir", "Bursa", "Antalya", "Kocaeli", "Konya", "Adana", "Gaziantep", "Eskişehir", "Kayseri", "Mersin", "Samsun", "Trabzon"):
        if norm(c) in norm(clean):
            city = c
            break

    n = norm(clean)
    edu = next((label for key, label in EDU if key in n), None)
    unis = sorted(set(m.strip() for m in re.findall(r"([A-ZÇĞİÖŞÜ][\wçğıöşü]+(?:\s[A-ZÇĞİÖŞÜ][\wçğıöşü]+){0,3}\s(?:Üniversitesi|University|Teknik Üniversitesi))", clean)))[:4]
    langs = sorted({label for key, label in LANGUAGES.items() if key in n})

    # deneyim: "8 yıl deneyim" veya tarih aralıkları (2017 - 2021, 2019 – Halen)
    years = None
    basis = None
    m = re.search(r"(\d{1,2})\+?\s*(?:yil|years?)\s*(?:lik)?\s*(?:deneyim|tecrube|experience|is deneyimi)", n)
    if m:
        years, basis = float(m.group(1)), "metindeki beyan"
    else:
        total = 0.0
        this_year = date.today().year
        for a, b in re.findall(r"((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2}|halen|devam|present|gunumuz|current)", n):
            end = this_year if not b[:2].isdigit() else int(b)
            if 1970 < int(a) <= end <= this_year:
                total += end - int(a)
        if total > 0:
            years, basis = min(total, 45.0), "tarih aralıklarının toplamı (çakışmalar dahil olabilir)"
    skills = find_skills(clean)
    if not skills:
        warnings.append("Sözlükte eşleşen beceri bulunamadı; metin okunamamış olabilir.")
    if len(clean) < 200:
        warnings.append("Çıkarılan metin çok kısa — taranmış (görüntü) PDF olabilir; OCR gerekir.")
    summary_bits = []
    if edu:
        summary_bits.append(f"{edu} mezunu")
    if years:
        summary_bits.append(f"yaklaşık {years:g} yıl deneyimli")
    if skills:
        summary_bits.append("öne çıkan beceriler: " + ", ".join(skills[:6]))
    summary = (name or "Aday") + (" — " + "; ".join(summary_bits) if summary_bits else "")
    return CvResult(name=name, email=email, phone=phone, linkedin=linkedin, location=city, skills=skills, languages=langs,
                    education=edu, universities=unis, experience_years=years, experience_basis=basis, summary=summary,
                    text_length=len(clean), warnings=warnings)


@router.post("/cv/parse", response_model=CvResult)
async def cv_parse(file: UploadFile = File(...)) -> CvResult:
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(413, "Dosya 5 MB'tan büyük olamaz")
    text = extract_text(file.filename or "", data)
    return parse_cv_text(text)


class CvText(BaseModel):
    text: str = Field(min_length=20, max_length=200_000)


@router.post("/cv/parse-text", response_model=CvResult)
def cv_parse_text(req: CvText) -> CvResult:
    return parse_cv_text(req.text)


# ============================================================ ayrımcı ifade denetimi

BIAS_RULES: list[tuple[str, str, str, str]] = [
    # (desen [normalize edilmiş metin üstünde], kategori, açıklama, öneri)
    (r"\b(genc|dinamik genc|genc ve dinamik)\b", "Yaş", "Yaşa dayalı ayrımcılık (İş K. m.5 eşit davranma).", "\"enerjik\", \"öğrenmeye açık\" gibi davranış odaklı ifadeler"),
    (r"\b(\d{2}\s*[-–]\s*\d{2}\s*yas|\d{2}\s*yas(?:ini)?\s*(?:gecmemis|altinda|ustunde)|yas siniri|en fazla \d{2} yas|maksimum \d{2} yas)", "Yaş", "Yaş sınırı adayları yaş temelinde eler.", "Gerekli deneyimi yıl aralığı olarak değil yetkinlik olarak yazın"),
    (r"\b(bayan|bay eleman|erkek eleman|kadin eleman|erkek aday|kadin aday|bayan aday|hanim|beyefendi)\b", "Cinsiyet", "Cinsiyet belirten ifade (İş K. m.5, KVKK özel nitelikli veri).", "\"aday\", \"çalışma arkadaşı\" gibi cinsiyetsiz ifadeler"),
    (r"\b(askerligini (?:yapmis|tamamlamis|bitirmis)|askerlik (?:yapmis|tecilli|muaf)|askerlikle ilisigi)", "Cinsiyet", "Askerlik şartı dolaylı olarak cinsiyete dayalı eleme yaratır.", "Yalnızca yasal zorunluluk varsa ve iş için gerekliyse yazın"),
    (r"\b(bekar|evli olmayan|evli|cocuksuz|cocugu olmayan|hamile olmayan)\b", "Medeni hâl / aile", "Medeni hâl ve aile durumu iş gereği değildir.", "Bu ifadeyi çıkarın; esnek çalışma beklentisini açıkça yazın"),
    (r"\b(guzel gorunumlu|hos gorunumlu|yakisikli|alimli|fizigi duzgun|fiziksel gorunumu|boy(?:u)? \d{3}|kilo(?:su)? \d{2})", "Dış görünüş", "Dış görünüşe dayalı şart ayrımcılık yaratır.", "\"profesyonel iletişim becerisi\" gibi işe dönük ifadeler"),
    (r"\b(anadili turkce olan|turk asilli|yerli aday|musluman|sunni|alevi|hristiyan)\b", "Köken / din", "Etnik köken veya din temelinde ayrımcılık (Anayasa m.10).", "Gerekli dil düzeyini (ör. \"ileri düzey Türkçe\") yazın"),
    (r"\b(saglikli|engeli olmayan|engelli olmayan|herhangi bir sagl?ik sorunu olmayan)\b", "Engellilik / sağlık", "Engelli adayları dışlar (4857 m.30 kotası ile çelişir).", "İşin fiziksel gereklerini nesnel olarak tarif edin"),
    (r"\b(sigara icmeyen)\b", "Kişisel yaşam", "Kişisel alışkanlık iş gereği değildir.", "Çalışma alanı kurallarını belirtin"),
]
SOFT_RULES: list[tuple[str, str, str]] = [
    (r"\b(agresif|baskin|rekabetci|savasci|korkusuz|ninja|rockstar)\b", "Erkek kodlu dil", "Bu kelimeler bazı adayların başvurusunu azaltabilir; \"kararlı\", \"sonuç odaklı\" tercih edin."),
    (r"\b(aile gibiyiz|aileyiz)\b", "Belirsiz kültür vaadi", "Somut yan hakları ve çalışma düzenini yazın."),
]


class BiasFinding(BaseModel):
    phrase: str
    category: str
    severity: Literal["high", "low"]
    reason: str
    suggestion: str
    start: int
    end: int


class BiasResult(BaseModel):
    score: int
    findings: list[BiasFinding]
    verdict: str


def bias_check_text(text: str) -> BiasResult:
    n = norm(text)
    findings: list[BiasFinding] = []
    for pattern, cat, reason, sug in BIAS_RULES:
        for m in re.finditer(pattern, n):
            findings.append(BiasFinding(phrase=text[m.start():m.end()], category=cat, severity="high", reason=reason,
                                        suggestion=sug, start=m.start(), end=m.end()))
    for pattern, cat, reason in SOFT_RULES:
        for m in re.finditer(pattern, n):
            findings.append(BiasFinding(phrase=text[m.start():m.end()], category=cat, severity="low", reason=reason,
                                        suggestion="Daha kapsayıcı bir ifade seçin", start=m.start(), end=m.end()))
    findings.sort(key=lambda f: f.start)
    high = sum(1 for f in findings if f.severity == "high")
    low = len(findings) - high
    score = max(0, 100 - high * 25 - low * 8)
    verdict = "Kapsayıcı görünüyor." if not findings else (
        f"{high} ayrımcı ifade bulundu — yayınlamadan önce düzeltin." if high else f"{low} iyileştirme önerisi var.")
    return BiasResult(score=score, findings=findings, verdict=verdict)


class BiasRequest(BaseModel):
    text: str = Field(min_length=1, max_length=50_000)


@router.post("/jobs/bias-check", response_model=BiasResult)
def bias_check(req: BiasRequest) -> BiasResult:
    return bias_check_text(req.text)


# ====================================================================== ilan yazıcı

class JobDraftRequest(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    department: str | None = None
    level: Literal["junior", "mid", "senior", "lead"] = "mid"
    skills: list[str] = []
    responsibilities: list[str] = []
    location: str | None = None
    work_model: Literal["office", "hybrid", "remote"] = "hybrid"
    employment_type: Literal["full", "part", "contract", "intern"] = "full"
    benefits: list[str] = []
    company: str | None = None
    tone: Literal["formal", "friendly"] = "friendly"


class JobDraft(BaseModel):
    title: str
    text: str
    sections: dict[str, list[str] | str]
    bias: BiasResult


LEVEL_TR = {"junior": "Başlangıç seviyesi", "mid": "Orta seviye", "senior": "Kıdemli", "lead": "Takım lideri"}
LEVEL_YEARS = {"junior": "0–2 yıl", "mid": "2–5 yıl", "senior": "5+ yıl", "lead": "7+ yıl ve ekip yönetimi"}
MODEL_TR = {"office": "Ofisten", "hybrid": "Hibrit (haftada 2–3 gün ofis)", "remote": "Tamamen uzaktan"}
TYPE_TR = {"full": "Tam zamanlı", "part": "Yarı zamanlı", "contract": "Sözleşmeli", "intern": "Stajyer"}


@router.post("/jobs/draft", response_model=JobDraft)
def job_draft(req: JobDraftRequest) -> JobDraft:
    company = req.company or "Şirketimiz"
    dept = f" {req.department} ekibimize" if req.department else " ekibimize"
    intro = (f"{company} olarak{dept} katılacak, {req.title} rolünde sorumluluk alacak bir çalışma arkadaşı arıyoruz."
             if req.tone == "friendly" else
             f"{company}{dept.replace(' ekibimize', ' bünyesinde')} görevlendirilmek üzere {req.title} pozisyonu için başvuru kabul edilmektedir.")
    skills = [s.strip() for s in req.skills if s.strip()]
    resp = [r.strip() for r in req.responsibilities if r.strip()] or [
        f"{req.title} rolünün gerektirdiği işleri planlamak ve uçtan uca sahiplenmek",
        "Ekip içi ve paydaşlarla düzenli, şeffaf iletişim kurmak",
        "Süreçleri ölçmek ve sürekli iyileştirmek",
    ]
    if req.level in ("senior", "lead"):
        resp.append("Ekip arkadaşlarına mentorluk yapmak ve teknik/operasyonel kararlara yön vermek")
    reqs = [f"İlgili alanda {LEVEL_YEARS[req.level]} deneyim veya eşdeğer yetkinlik"]
    reqs += [f"{s} konusunda yetkinlik" for s in skills[:8]]
    reqs.append("Takım çalışmasına ve öğrenmeye açıklık")
    nice = ["Benzer ölçekte projelerde yer almış olmak", "İleri düzey İngilizce"] if req.level != "junior" else ["Staj veya kişisel proje deneyimi"]
    benefits = [b.strip() for b in req.benefits if b.strip()] or ["Özel sağlık sigortası", "Yemek kartı", "Eğitim ve konferans bütçesi", "Esnek çalışma saatleri"]
    meta = f"{TYPE_TR[req.employment_type]} · {MODEL_TR[req.work_model]}" + (f" · {req.location}" if req.location else "") + f" · {LEVEL_TR[req.level]}"
    eeo = "Başvuruları yaş, cinsiyet, medeni hâl, engellilik, din veya köken gözetmeksizin yalnızca yetkinliğe göre değerlendiriyoruz."
    text = "\n".join([
        f"# {req.title}", meta, "", intro, "", "## Neler yapacaksın?", *[f"- {r}" for r in resp], "",
        "## Aradığımız yetkinlikler", *[f"- {r}" for r in reqs], "", "## Artı sayılır", *[f"- {r}" for r in nice], "",
        "## Sunduklarımız", *[f"- {b}" for b in benefits], "", eeo,
    ])
    return JobDraft(title=req.title, text=text, bias=bias_check_text(text), sections={
        "meta": meta, "intro": intro, "responsibilities": resp, "requirements": reqs, "niceToHave": nice, "benefits": benefits, "eeo": eeo,
    })


# ================================================================ performans özeti

class ReviewText(BaseModel):
    type: str | None = None
    strengths: str | None = None
    improvements: str | None = None
    comments: str | None = None


class GoalItem(BaseModel):
    title: str
    progress: float | None = None  # 0-100
    weight: float | None = None


class PerfSummaryRequest(BaseModel):
    name: str
    score: float | None = None
    previous_score: float | None = None
    goals: list[GoalItem] = []
    reviews: list[ReviewText] = []
    feedback: list[str] = []


class PerfSummary(BaseModel):
    headline: str
    paragraph: str
    strengths: list[str]
    development: list[str]
    themes: list[dict]
    goal_stats: dict
    method: str


THEMES = {
    "iletişim": ["iletisim", "sunum", "paylas", "anlat", "dinle"],
    "teknik yetkinlik": ["teknik", "kod", "mimari", "kalite", "test", "analiz"],
    "takım çalışması": ["takim", "ekip", "isbirligi", "destek", "yardim"],
    "sahiplenme": ["sahiplen", "sorumluluk", "inisiyatif", "proaktif", "takip"],
    "zaman yönetimi": ["zaman", "termin", "gecik", "oncelik", "planla"],
    "liderlik": ["liderlik", "mentor", "yonlendir", "karar", "vizyon"],
    "müşteri odağı": ["musteri", "kullanici", "deger", "memnuniyet"],
}


def _sentences(text: str | None) -> list[str]:
    if not text:
        return []
    parts = re.split(r"(?<=[.!?])\s+|\n+|;\s*", text)
    return [p.strip(" -•\t") for p in parts if len(p.strip()) > 8]


def _rank(sents: list[str], k: int) -> list[str]:
    if not sents:
        return []
    freq = Counter(t for s in sents for t in tokens(s))
    scored = sorted(((sum(freq[t] for t in set(tokens(s))) / (1 + len(tokens(s)) ** 0.5), i, s) for i, s in enumerate(sents)), reverse=True)
    seen, out = set(), []
    for _, _, s in scored:
        key = norm(s)[:40]
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
        if len(out) == k:
            break
    return out


@router.post("/performance/summary", response_model=PerfSummary)
def performance_summary(req: PerfSummaryRequest) -> PerfSummary:
    strengths = _rank([s for r in req.reviews for s in _sentences(r.strengths)] + [s for f in req.feedback for s in _sentences(f) if not re.search(r"gelistir|iyilestir|eksik|zayif", norm(s))], 4)
    dev = _rank([s for r in req.reviews for s in _sentences(r.improvements)] + [s for f in req.feedback for s in _sentences(f) if re.search(r"gelistir|iyilestir|eksik|zayif", norm(s))], 3)
    all_text = norm(" ".join([*(r.strengths or "" for r in req.reviews), *(r.improvements or "" for r in req.reviews), *(r.comments or "" for r in req.reviews), *req.feedback]))
    themes = sorted(({"theme": t, "mentions": sum(all_text.count(k) for k in keys)} for t, keys in THEMES.items()), key=lambda x: -x["mentions"])
    themes = [t for t in themes if t["mentions"] > 0][:4]
    progress = [g.progress for g in req.goals if g.progress is not None]
    done = sum(1 for p in progress if p >= 100)
    avg = round(sum(progress) / len(progress), 1) if progress else None
    goal_stats = {"total": len(req.goals), "completed": done, "averageProgress": avg}

    first = req.name.split()[0] if req.name else "Çalışan"
    if req.score is not None:
        band = "beklentilerin üzerinde" if req.score >= 85 else "beklentileri karşılayan" if req.score >= 65 else "gelişim gerektiren"
        headline = f"{first}: {band} bir dönem (puan {req.score:.0f})"
        if req.previous_score is not None:
            delta = req.score - req.previous_score
            headline += f", önceki döneme göre {'+' if delta >= 0 else ''}{delta:.0f}"
    else:
        headline = f"{first}: dönem özeti"
    parts = []
    if goal_stats["total"]:
        parts.append(f"{goal_stats['total']} hedefin {done} tanesini tamamladı" + (f" (ortalama ilerleme %{avg:g})" if avg is not None else "") + ".")
    if themes:
        parts.append("Geri bildirimlerde en sık öne çıkan konular: " + ", ".join(t["theme"] for t in themes[:3]) + ".")
    if strengths:
        parts.append("Güçlü yönler: " + strengths[0].rstrip(".") + ".")
    if dev:
        parts.append("Gelişim alanı: " + dev[0].rstrip(".") + ".")
    if not parts:
        parts.append("Bu dönem için yeterli değerlendirme metni yok; hedef ve geri bildirim girildikçe özet zenginleşir.")
    return PerfSummary(headline=headline, paragraph=" ".join(parts), strengths=strengths, development=dev, themes=themes,
                       goal_stats=goal_stats, method="Çıkarımsal özet: cümleler sıklık puanıyla seçildi; yeni cümle üretilmedi.")


# =========================================================== aday–ilan eşleşmesi

class MatchCandidate(BaseModel):
    id: str
    name: str
    text: str = ""
    skills: list[str] = []


class MatchRequest(BaseModel):
    job_title: str
    job_text: str = ""
    job_skills: list[str] = []
    candidates: list[MatchCandidate] = Field(default=[], max_length=500)


class MatchRow(BaseModel):
    id: str
    name: str
    score: int
    similarity: float
    skill_overlap: list[str]
    missing_skills: list[str]
    top_terms: list[str]


@router.post("/match/candidates", response_model=list[MatchRow])
def match_candidates(req: MatchRequest) -> list[MatchRow]:
    if not req.candidates:
        return []
    job_doc = " ".join([req.job_title] * 3 + [req.job_text] + req.job_skills * 2)
    docs = [job_doc] + [" ".join([c.text] + c.skills * 2) for c in req.candidates]
    vec = TfidfVectorizer(tokenizer=tokens, lowercase=False, token_pattern=None, ngram_range=(1, 2), min_df=1, sublinear_tf=True)
    try:
        m = vec.fit_transform(docs)
    except ValueError:
        return [MatchRow(id=c.id, name=c.name, score=0, similarity=0, skill_overlap=[], missing_skills=req.job_skills, top_terms=[]) for c in req.candidates]
    sims = cosine_similarity(m[0], m[1:]).ravel()
    vocab = np.array(vec.get_feature_names_out())
    job_vec = m[0].toarray().ravel()
    job_sk = {norm(s) for s in (req.job_skills or find_skills(job_doc))}
    rows = []
    for i, c in enumerate(req.candidates):
        cand_sk = {norm(s) for s in (c.skills or find_skills(c.text))}
        overlap = sorted(job_sk & cand_sk)
        missing = sorted(job_sk - cand_sk)
        cv = m[i + 1].toarray().ravel()
        contrib = job_vec * cv
        top = [vocab[j] for j in contrib.argsort()[::-1][:5] if contrib[j] > 0]
        skill_ratio = len(overlap) / len(job_sk) if job_sk else 0
        score = int(round(100 * (0.6 * float(sims[i]) ** 0.5 + 0.4 * skill_ratio)))
        rows.append(MatchRow(id=c.id, name=c.name, score=min(score, 100), similarity=round(float(sims[i]), 3),
                             skill_overlap=overlap, missing_skills=missing, top_terms=top))
    return sorted(rows, key=lambda r: -r.score)


# =================================================================== izin tahmini

class MonthValue(BaseModel):
    month: str  # YYYY-MM
    days: float


class ForecastRequest(BaseModel):
    history: list[MonthValue]
    horizon: int = Field(default=3, ge=1, le=12)


class ForecastPoint(BaseModel):
    month: str
    forecast: float
    low: float
    high: float


class ForecastResult(BaseModel):
    points: list[ForecastPoint]
    method: str
    trend_per_month: float
    seasonal: bool
    peak_month: str | None
    note: str


def _next_month(ym: str, k: int) -> str:
    y, m = map(int, ym.split("-"))
    m += k
    y += (m - 1) // 12
    m = (m - 1) % 12 + 1
    return f"{y:04d}-{m:02d}"


@router.post("/forecast/leave", response_model=ForecastResult)
def forecast_leave(req: ForecastRequest) -> ForecastResult:
    hist = sorted(req.history, key=lambda h: h.month)
    if not hist:
        raise HTTPException(400, "Geçmiş veri yok")
    # boş ayları sıfırla doldur
    filled: dict[str, float] = {}
    cur = hist[0].month
    last = hist[-1].month
    vals = {h.month: h.days for h in hist}
    while cur <= last:
        filled[cur] = vals.get(cur, 0.0)
        cur = _next_month(cur, 1)
    months = list(filled)
    y = np.array(list(filled.values()), dtype=float)
    n = len(y)
    x = np.arange(n)
    slope, intercept = (np.polyfit(x, y, 1) if n >= 3 else (0.0, float(y.mean())))
    seasonal = n >= 24
    resid = y - (intercept + slope * x)
    season = np.zeros(12)
    if seasonal:
        idx = np.array([int(mm[5:7]) - 1 for mm in months])
        for k in range(12):
            sel = resid[idx == k]
            season[k] = sel.mean() if len(sel) else 0.0
    sigma = float(np.std(resid - (season[[int(mm[5:7]) - 1 for mm in months]] if seasonal else 0))) if n > 2 else float(y.std() or 1.0)
    # Belirsizlik bandı hiçbir zaman sıfır olmasın (geçmiş tam doğrusal olsa bile).
    sigma = max(sigma, 0.1 * float(np.mean(y)) if len(y) else 0.0, 0.5)
    points = []
    for h in range(1, req.horizon + 1):
        ym = _next_month(last, h)
        f = intercept + slope * (n - 1 + h) + (season[int(ym[5:7]) - 1] if seasonal else 0)
        f = max(0.0, f)
        band = 1.28 * sigma * math.sqrt(1 + h / max(n, 1))
        points.append(ForecastPoint(month=ym, forecast=round(f, 1), low=round(max(0.0, f - band), 1), high=round(f + band, 1)))
    peak = None
    if seasonal:
        peak_idx = int(np.argmax(season))
        peak = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"][peak_idx]
    note = ("24 aydan az veri: mevsimsellik hesaba katılmadı, yalnızca eğilim kullanıldı." if not seasonal
            else f"Mevsimsel tepe ayı: {peak}.")
    return ForecastResult(points=points, method="Doğrusal eğilim" + (" + aylık mevsimsellik" if seasonal else "") + ", %80 tahmin aralığı",
                          trend_per_month=round(float(slope), 2), seasonal=seasonal, peak_month=peak, note=note)


# ================================================================= eğitim önerisi

class CourseItem(BaseModel):
    id: str
    title: str
    description: str | None = None
    category: str | None = None
    is_mandatory: bool = False


class TrainingRequest(BaseModel):
    position: str | None = None
    skills: list[str] = []
    goals: list[str] = []
    development_areas: list[str] = []
    completed_course_ids: list[str] = []
    courses: list[CourseItem]
    limit: int = Field(default=5, ge=1, le=20)


class TrainingRec(BaseModel):
    id: str
    title: str
    score: int
    reason: str
    is_mandatory: bool


@router.post("/recommend/training", response_model=list[TrainingRec])
def recommend_training(req: TrainingRequest) -> list[TrainingRec]:
    pool = [c for c in req.courses if c.id not in set(req.completed_course_ids)]
    if not pool:
        return []
    profile = " ".join([req.position or ""] * 2 + req.goals + req.development_areas * 3 + req.skills)
    docs = [profile] + [" ".join([c.title] * 2 + [c.description or "", c.category or ""]) for c in pool]
    try:
        vec = TfidfVectorizer(tokenizer=tokens, lowercase=False, token_pattern=None, ngram_range=(1, 2), sublinear_tf=True)
        m = vec.fit_transform(docs)
        sims = cosine_similarity(m[0], m[1:]).ravel()
    except ValueError:
        sims = np.zeros(len(pool))
    out = []
    for c, s in zip(pool, sims):
        score = int(round(100 * min(1.0, float(s) ** 0.6)))
        if c.is_mandatory:
            score = max(score, 95)
            reason = "Zorunlu eğitim — henüz tamamlanmadı."
        elif s > 0:
            prof = set(tokens(profile))
            words = [w for w in re.findall(r"\w+", c.title + " " + (c.description or "")) if norm(w) in prof]
            reason = ("Gelişim alanı/hedeflerle örtüşüyor: " + ", ".join(dict.fromkeys(w.lower() for w in words))) if words else "Profilinizle içerik benzerliği"
        else:
            reason = "Genel gelişim önerisi"
        out.append(TrainingRec(id=c.id, title=c.title, score=min(score, 100), reason=reason, is_mandatory=c.is_mandatory))
    return sorted(out, key=lambda r: -r.score)[: req.limit]


@router.get("/health")
def ai_health() -> dict:
    try:
        import pypdf  # noqa: F401
        pdf = True
    except ImportError:
        pdf = False
    return {"status": "ok", "pdf": pdf, "tools": ["cv", "bias", "job-draft", "perf-summary", "match", "leave-forecast", "training"]}
