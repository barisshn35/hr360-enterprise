"""
Devir riski modelinin yonetim uclari: model karti, yeniden egitim, veri kaymasi.

  GET  /model/card        - kullanilan ozellikler, egitim tarihi, metrikler, veri buyuklugu,
                            BILEREK dislanan nitelikler ve bunlarin ozellik listesinde
                            olmadigina dair otomatik denetim (IK rolleri).
  POST /model/retrain     - toplu ve takma adli (kimliksiz) egitim satirlarindan ya da
                            sentetik ureteciden aday model egitir, MLflow'a yeni surum
                            olarak yazar, mevcut modelle AYNI degerlendirme kumesinde
                            karsilastirir; AUC'de 0,02'den fazla kotuyse YAYIMLAMAZ.
                            Sentetik kaynak: IK rolleri (hr-admin, tenant-admin,
                            platform-admin). Satir/CSV kaynagi (model tum kiracilarca
                            paylasildigindan): platform yoneticisi ya da X-Internal-Token.
                            Yanit, governance'in denetim kaydina yazmasi icin "audit" icerir.
  POST /model/drift       - son donemin toplu ozellik satirlari icin ozellik basina PSI
                            (egitim referans dagilimina gore; PSI > 0,2 belirgin kayma).
  GET  /model/drift/last  - cagiranin kiracisi icin son kayma olcumu.
  GET  /model/drift/recent- son tahmin girdilerinin TOPLU histogramindan PSI (kiraci basina,
                            bellekte yalnizca kova sayilari; kisi bazli kayit yok).
  GET  /model/importance  - kuresel ozellik onemi (ortalama |SHAP|, referans dagilimindan
                            orneklenen yapay satirlarla; ham egitim verisi gerekmez).

Her kayma olcumu Prometheus'a hr360_model_feature_psi{feature} olarak yazilir.

Kisi bazli tahmin bu dosyada degil: /predict ve /explain yalnizca governance
uzerinden cagrilir (KVKK m.11 itiraz denetimi ve erisim kaydi orada).
"""

from __future__ import annotations

import asyncio
import csv
import hmac
import io
import logging
import os
import secrets
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Callable, Literal

import numpy as np
from fastapi import APIRouter, Depends, Header, HTTPException
from prometheus_client import Gauge
from pydantic import BaseModel, ConfigDict, Field

import attrition_ml as aml
from model_store import LoadedModel, ModelNotFound

logger = logging.getLogger(__name__)

HR_ROLES = {"hr-admin", "tenant-admin", "platform-admin"}
DRIFT_MIN_ROWS = 30
IMPORTANCE_SAMPLE_ROWS = 400

# Son kayma olcumunun ozellik basina PSI degeri (/metrics; instrumentator varsayilan kayit
# defterini yayimlar). Etikette kiraci yok: deger son olcumu gosterir.
FEATURE_PSI = Gauge("hr360_model_feature_psi", "Devir riski modeli: son ölçümde özellik başına PSI (veri kayması)",
                    ["feature"])


# ------------------------------------------------------------------ durum

@dataclass
class ModelState:
    model: object | None = None
    explainer: object | None = None
    version: str | None = None
    meta: dict = field(default_factory=dict)
    importance: dict | None = None
    blocked_reason: str | None = None


class ModelService:
    def __init__(self, store, name: str, explainer_factory: Callable | None = None,
                 bootstrap: bool = True, bootstrap_rows: int = 4000):
        self.store = store
        self.name = name
        self.explainer_factory = explainer_factory
        self.bootstrap = bootstrap
        self.bootstrap_rows = bootstrap_rows
        self.state = ModelState()
        self.train_lock = asyncio.Lock()
        self.last_drift: dict[str, dict] = {}
        # Kiraci -> toplu tahmin girdisi histogrami (yalnizca kova sayilari).
        self.recent: dict[str, aml.PredictionHistogram] = {}

    # -- yukleme
    def _explainer(self, model):
        if self.explainer_factory is None:
            return None
        try:
            return self.explainer_factory(model)
        except Exception as e:  # noqa: BLE001
            logger.warning("SHAP explainer yüklenemedi: %s", e)
            print(f"SHAP explainer yüklenemedi: {e}")
            return None

    def _activate(self, loaded: LoadedModel) -> None:
        meta = loaded.meta or {}
        names = meta.get("features") or list(aml.FEATURE_NAMES)
        try:
            # Kayittan gelen surumun ozellik listesi dislanan nitelik iceriyorsa SUNULMAZ.
            aml.assert_allowed(names)
        except aml.ForbiddenFeatureError as e:
            print(f"Model v{loaded.version} sunulmadı: {e}")
            self.state = ModelState(version=loaded.version, meta=meta, blocked_reason=str(e))
            return
        self.state = ModelState(model=loaded.model, explainer=self._explainer(loaded.model),
                                version=loaded.version, meta=meta, importance=meta.get("global_importance"))

    def guard(self) -> object:
        """/predict ve /explain oncesi: yuklu model yoksa ya da ozellik denetimi gecmiyorsa durdurur."""
        s = self.state
        if s.blocked_reason:
            raise HTTPException(status_code=503, detail={"message": "Model, dışlanan nitelik denetiminden geçmediği için "
                                                                    "devre dışı.", "reason": s.blocked_reason})
        if s.model is None:
            raise HTTPException(status_code=503, detail="Model not loaded")
        try:
            aml.assert_allowed(s.meta.get("features") or list(aml.FEATURE_NAMES))
        except aml.ForbiddenFeatureError as e:
            raise HTTPException(status_code=503, detail={"message": str(e), "violations": e.violations}) from None
        return s.model

    # -- toplu tahmin girdisi (kayma izleme)
    def record_prediction(self, tenant: str, values) -> None:
        reference = (self.state.meta or {}).get("reference")
        if not reference or len(values) != len(aml.FEATURE_NAMES):
            return
        h = self.recent.get(tenant)
        if h is None or h.version != self.state.version:
            h = self.recent[tenant] = aml.PredictionHistogram(reference, self.state.version)
        h.add(values)

    # -- kuresel onem
    def importance(self) -> dict:
        s = self.state
        if s.model is None:
            raise HTTPException(status_code=503, detail="Model yüklenmedi.")
        if s.importance is None:
            reference = (s.meta or {}).get("reference")
            if not reference:
                raise HTTPException(status_code=409, detail="Yayındaki modelin referans dağılımı yok; önce modeli yeniden eğitin.")
            X = aml.sample_from_reference(reference, IMPORTANCE_SAMPLE_ROWS, seed=0)
            s.importance = aml.global_importance(s.model, X, s.explainer)
        return {"model": self.name, "version": s.version, **s.importance}

    async def load(self, attempts: int = 30, delay: float = 10.0) -> None:
        """MLflow'dan yayindaki modeli yukler. Kayitli model hic yoksa ve izin verilmisse
        sentetik ureteciyle ilk surumu egitip yayimlar. MLflow henuz ayakta degilse
        araliklarla yeniden dener (bu sirada /health ve diger uclar yanit verir)."""
        for attempt in range(attempts):
            try:
                loaded = await asyncio.to_thread(self.store.load_current)
                await asyncio.to_thread(self._activate, loaded)
                print(f"Model yüklendi: {self.name} v{loaded.version}")
                return
            except ModelNotFound as e:
                if not self.bootstrap:
                    print(f"Model yüklenemedi: {e}")
                    return
                print("Kayıtlı model yok; sentetik veriyle ilk sürüm eğitiliyor")
                try:
                    async with self.train_lock:
                        await asyncio.to_thread(self._bootstrap_blocking)
                    return
                except Exception as e2:  # noqa: BLE001
                    print(f"İlk model eğitilemedi: {e2}")
            except Exception as e:  # noqa: BLE001 - MLflow erisilemiyor
                print(f"Model yüklenemedi (deneme {attempt + 1}/{attempts}): {e}")
            await asyncio.sleep(delay)

    def _bootstrap_blocking(self) -> None:
        req = RetrainRequest(source="synthetic", synthetic=SyntheticOptions(n=self.bootstrap_rows, seed=42))
        result = self._retrain_blocking(req)
        print(f"İlk model yayımlandı: v{result['candidate_version']} (AUC {result['candidate']['auc']})")

    # -- egitim
    def _retrain_blocking(self, req: "RetrainRequest") -> dict:
        # Semayi degistiren biri dislanan bir nitelik eklerse egitim durur (ForbiddenFeatureError -> 422).
        aml.assert_allowed(aml.FEATURE_NAMES)
        check = aml.check_features(aml.FEATURE_NAMES)
        seed = req.seed
        synth_meta = None
        if req.source == "synthetic":
            opts = req.synthetic or SyntheticOptions()
            X_train, y_train = aml.synthetic_dataset(opts.n, opts.seed, opts.label_noise)
            # Degerlendirme her zaman TEMIZ (gurultusuz) ayri bir sentetik kumede: gurultulu
            # etiketle egitilmis bir aday kendi gurultulu verisinde iyi gorunemez.
            X_eval, y_eval = aml.synthetic_dataset(2000, opts.seed + 1_000_003, 0.0)
            eval_source = "synthetic-clean"
            synth_meta = {"seed": opts.seed, "rows": opts.n, "label_noise": opts.label_noise,
                          "description": aml.SYNTHETIC_DESCRIPTION}
            seed = opts.seed
        else:
            rows = req.rows or []
            if req.source == "csv":
                rows = parse_training_csv(req.csv or "")
                if len(rows) < 200:
                    raise HTTPException(status_code=422, detail="Eğitim için en az 200 satır gerekir.")
            X = aml.rows_to_matrix([r.model_dump() for r in rows])
            y = np.array([r.label for r in rows], dtype=int)
            _require_classes(y, minimum=20, what="Eğitim verisi")
            if req.evaluation_rows:
                X_train, y_train = X, y
                X_eval = aml.rows_to_matrix([r.model_dump() for r in req.evaluation_rows])
                y_eval = np.array([r.label for r in req.evaluation_rows], dtype=int)
                _require_classes(y_eval, minimum=5, what="Değerlendirme verisi")
                eval_source = "provided-evaluation"
            else:
                X_train, X_eval, y_train, y_eval = aml.split(X, y, seed)
                eval_source = "provided-holdout"

        candidate = aml.train_model(X_train, y_train, seed, aml.FEATURE_NAMES)
        cand_metrics = aml.evaluate(candidate, X_eval, y_eval)
        current = self.state
        cur_metrics = None
        if current.model is not None:
            try:
                cur_metrics = aml.evaluate(current.model, X_eval, y_eval)
            except Exception as e:  # noqa: BLE001 - eski model farkli semada olabilir
                logger.warning("Mevcut model değerlendirilemedi: %s", e)
        decision = aml.promotion_decision(cand_metrics, cur_metrics)
        if req.dry_run:
            decision = {**decision, "promote": False, "reason": "Deneme eğitimi (dry_run): aday kaydedildi, yayımlanmadı. "
                        + decision["reason"]}

        trained_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        meta = {
            "model_name": self.name,
            "trained_at": trained_at,
            "training_source": "synthetic" if req.source == "synthetic" else "provided",
            "data_window": req.data_window.model_dump(mode="json") if req.data_window else None,
            "training_rows": int(len(y_train)),
            "evaluation_source": eval_source,
            "evaluation_rows": int(len(y_eval)),
            "metrics": cand_metrics,
            "algorithm": aml.ALGORITHM,
            "features": list(aml.FEATURE_NAMES),
            "excluded_check": check,
            "reference": (reference := aml.reference_histograms(X_train)),
            "global_importance": aml.global_importance(
                candidate, aml.sample_from_reference(reference, IMPORTANCE_SAMPLE_ROWS, seed=0), self._explainer(candidate)),
            "synthetic": synth_meta,
            "promotion": {**decision, "compared_with_version": current.version, "compared_with_metrics": cur_metrics},
        }
        params = {"source": req.source, "training_rows": meta["training_rows"],
                  "evaluation_source": eval_source, "seed": seed, **{k: v for k, v in aml.ALGORITHM.items()}}
        metrics = {"auc": cand_metrics["auc"], "accuracy": cand_metrics["accuracy"],
                   "positive_rate": cand_metrics["positive_rate"]}
        version = self.store.register(candidate, meta, metrics, params, decision["promote"])
        if decision["promote"]:
            self._activate(LoadedModel(model=candidate, version=version, meta=meta))
        return {
            "candidate_version": version,
            "promoted": decision["promote"],
            "decision": decision,
            "candidate": cand_metrics,
            "current": cur_metrics,
            "current_version": current.version,
            "serving_version": self.state.version,
            "training": {"source": meta["training_source"], "rows": meta["training_rows"]},
            "evaluation": {"source": eval_source, "rows": meta["evaluation_rows"]},
            "trained_at": trained_at,
            "tolerance": aml.PROMOTION_TOLERANCE,
            "data_window": meta["data_window"],
        }

    # -- kart
    def card(self) -> dict:
        s = self.state
        meta = s.meta or {}
        names = meta.get("features") or list(aml.FEATURE_NAMES)
        check = aml.check_features(names)
        return {
            "model": self.name,
            "loaded": s.model is not None,
            "version": s.version,
            "trained_at": meta.get("trained_at"),
            "training_source": meta.get("training_source"),
            "training_rows": meta.get("training_rows"),
            "data_window": meta.get("data_window"),
            "data_window_note": None if meta.get("data_window") else (
                "Sentetik veri: zaman penceresi yok." if meta.get("training_source") == "synthetic"
                else "Eğitim verisinin zaman penceresi bildirilmedi."),
            "serving": s.model is not None and not s.blocked_reason,
            "blocked_reason": s.blocked_reason,
            "evaluation_source": meta.get("evaluation_source"),
            "evaluation_rows": meta.get("evaluation_rows"),
            "metrics": meta.get("metrics"),
            "algorithm": meta.get("algorithm") or aml.ALGORITHM,
            "features": [{"name": f.name, "label": f.label, "unit": f.unit, "description": f.description,
                          "min": f.lo, "max": f.hi} for f in aml.FEATURES if f.name in names],
            "feature_order": names,
            "excluded_attributes": [{"key": k, "label": v} for k, v in aml.EXCLUDED_ATTRIBUTES],
            "excluded_check": check,
            "synthetic": meta.get("synthetic"),
            "promotion": meta.get("promotion"),
            "drift_thresholds": {"moderate": aml.PSI_MODERATE, "significant": aml.PSI_SIGNIFICANT},
            "promotion_tolerance": aml.PROMOTION_TOLERANCE,
            "intended_use": "İK'nın elde tutma görüşmelerini önceliklendirmesine yardımcı bir sinyal. "
                            "Tek başına işe alım, terfi, ücret ya da işten çıkarma kararı için kullanılamaz.",
            "limitations": [
                "Skor bir olasılık tahminidir; nedensellik göstermez.",
                "Sentetik veriyle eğitilmiş sürüm yalnızca tanıtım/doğrulama içindir; gerçek kararlarda "
                "şirketin toplu ve takma adlı verisiyle yeniden eğitilmelidir.",
                "Veri dağılımı değiştikçe (PSI > 0,2) doğruluk düşebilir; kayma izlenmelidir.",
            ],
            "fairness": {
                "note": "Model cinsiyet, yaş/doğum tarihi, medeni durum, sağlık, din, etnik köken ve sendika "
                        "üyeliğini ya da bunların vekillerini kullanmaz; her eğitim ve tahminden önce özellik "
                        "listesi otomatik denetlenir, ihlalde eğitim/tahmin reddedilir.",
                "residual_risk": "Kullanılan iş özellikleri (ör. fazla mesai, ücret oranı) korunan gruplarla dolaylı "
                                 "ilişkili olabilir. Gruplar arası hata oranı karşılaştırması bu serviste yapılamaz "
                                 "(korunan nitelik bilinçli olarak tutulmaz); sonuçlar insan incelemesiyle "
                                 "değerlendirilmelidir.",
            },
            "kvkk": "Kişi bazlı skor yalnızca governance üzerinden üretilir; çalışan itiraz edebilir (m.11/1-g) ve "
                    "her hesaplama erişim kaydına yazılır. Eğitim satırları kimlik içermez ve saklanmaz; "
                    "modelle yalnızca toplu histogramlar tutulur.",
        }

    # -- kayma
    def _drift_blocking(self, tenant: str, rows: list["DriftRow"]) -> dict:
        reference = (self.state.meta or {}).get("reference")
        if self.state.model is None or not reference:
            raise HTTPException(status_code=409, detail="Yayındaki modelin referans dağılımı yok; önce modeli yeniden eğitin.")
        X = aml.rows_to_matrix([r.model_dump() for r in rows])
        report = aml.drift_report(reference, X)
        return self._finish_drift(tenant, report, "batch")

    def _finish_drift(self, tenant: str, report: dict, source: str) -> dict:
        report["model_version"] = self.state.version
        report["source"] = source
        report["computed_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        for f in report.get("features", []):
            FEATURE_PSI.labels(feature=f["feature"]).set(f["psi"])
        self.last_drift[tenant] = report
        try:
            self.store.log_drift(tenant, self.state.version, report)
        except Exception as e:  # noqa: BLE001 - kayit basarisizsa olcum yine doner
            logger.warning("Kayma raporu MLflow'a yazılamadı: %s", e)
        return report

    def _recent_drift_blocking(self, tenant: str) -> dict:
        reference = (self.state.meta or {}).get("reference")
        if self.state.model is None or not reference:
            raise HTTPException(status_code=409, detail="Yayındaki modelin referans dağılımı yok; önce modeli yeniden eğitin.")
        h = self.recent.get(tenant)
        rows = h.rows if h and h.version == self.state.version else 0
        if rows < DRIFT_MIN_ROWS:
            return {"available": False, "rows": rows, "min_rows": DRIFT_MIN_ROWS, "model_version": self.state.version}
        report = aml.drift_report_from_counts(reference, h.counts, rows, h.means())
        return {"available": True, **self._finish_drift(tenant, report, "recent-predictions")}


def _require_classes(y: np.ndarray, minimum: int, what: str) -> None:
    pos = int(y.sum())
    neg = int(len(y) - pos)
    if pos < minimum or neg < minimum:
        raise HTTPException(status_code=422, detail=f"{what} her iki sınıftan da en az {minimum} satır içermeli "
                                                    f"(ayrılan: {pos}, kalan: {neg}).")


# ------------------------------------------------------------------ istek semalari
# Satir semalari EK ALAN KABUL ETMEZ: kimlik, ad, cinsiyet, yas vb. gonderilirse 422.

class _Features(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tenure_years: float = Field(ge=0, le=45)
    compa_ratio: float = Field(ge=0.3, le=2.0)
    last_rating: float = Field(ge=1, le=5)
    months_since_promotion: float = Field(ge=0, le=360)
    overtime_hours_month: float = Field(ge=0, le=200)
    training_hours_year: float = Field(ge=0, le=500)


class DriftRow(_Features):
    pass


class TrainingRow(_Features):
    label: int = Field(ge=0, le=1, description="1 = son 12 ayda ayrıldı")


class SyntheticOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    n: int = Field(default=4000, ge=500, le=20000)
    seed: int = Field(default_factory=lambda: secrets.randbelow(1_000_000))
    label_noise: float = Field(default=0.0, ge=0.0, le=1.0,
                               description="Etiketlerin bu oranı rastgele değiştirilir (dayanıklılık denemesi).")


class DataWindow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: date
    end: date


class RetrainRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: Literal["synthetic", "rows", "csv"] = "synthetic"
    rows: list[TrainingRow] | None = Field(default=None, max_length=50000)
    csv: str | None = Field(default=None, max_length=5_000_000,
                            description="Başlık satırı: 6 özellik adı + label. Kimlik ya da ek sütun kabul edilmez.")
    data_window: DataWindow | None = Field(default=None, description="Toplu verinin kapsadığı dönem (model kartına yazılır).")
    evaluation_rows: list[TrainingRow] | None = Field(default=None, max_length=20000)
    synthetic: SyntheticOptions | None = None
    seed: int = 42
    dry_run: bool = False


class DriftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: list[DriftRow] = Field(min_length=30, max_length=20000,
                                 description="Son dönemin toplu, kimliksiz özellik satırları (en az 30).")


def parse_training_csv(text: str) -> list[TrainingRow]:
    """Toplu, kimliksiz ozellik tablosu (CSV). Baslik tam olarak 6 ozellik + label olmalidir;
    dislanan bir nitelik ya da kimlik sutunu varsa ACIK bir hatayla reddedilir."""
    reader = csv.reader(io.StringIO(text.strip()))
    try:
        header = [h.strip() for h in next(reader)]
    except StopIteration:
        raise HTTPException(status_code=422, detail="CSV boş.") from None
    check = aml.check_features([h for h in header if h != "label"])
    if not check["passed"]:
        raise HTTPException(status_code=422, detail={"message": "CSV dışlanan nitelik içeriyor; eğitim reddedildi.",
                                                     "violations": check["violations"]})
    expected = set(aml.FEATURE_NAMES) | {"label"}
    if set(header) != expected or len(header) != len(expected):
        raise HTTPException(status_code=422, detail={"message": "CSV başlığı yalnızca model özellikleri ve 'label' olmalı.",
                                                     "expected": sorted(expected),
                                                     "unexpected": sorted(set(header) - expected),
                                                     "missing": sorted(expected - set(header))})
    out = []
    for i, rec in enumerate(reader, start=2):
        if not rec or all(not c.strip() for c in rec):
            continue
        try:
            d = dict(zip(header, (c.strip() for c in rec), strict=True))
            out.append(TrainingRow(**{k: (int(float(v)) if k == "label" else float(v)) for k, v in d.items()}))
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=422, detail=f"CSV satır {i} geçersiz: {e}") from None
    if len(out) > 50000:
        raise HTTPException(status_code=422, detail="CSV en fazla 50 000 satır olabilir.")
    return out


# ------------------------------------------------------------------ yetki

def roles_of(info: dict) -> set[str]:
    return set((info.get("realm_access") or {}).get("roles") or [])


def tenant_of(info: dict) -> str:
    org = info.get("organization")
    if isinstance(org, dict) and org:
        return sorted(org.keys())[0]
    if isinstance(org, list) and org:
        return str(org[0])
    return str(info.get("tenant") or info.get("tenant_slug") or "platform")


def actor_of(info: dict) -> dict:
    return {"user_id": info.get("sub"), "username": info.get("preferred_username") or info.get("client_id"),
            "roles": sorted(roles_of(info) & HR_ROLES)}


def _internal_ok(given: str | None) -> bool:
    expected = os.getenv("INTERNAL_SERVICE_TOKEN", "")
    return bool(expected) and bool(given) and hmac.compare_digest(expected.encode(), given.encode())


def build_router(verify_token, service: ModelService) -> APIRouter:
    router = APIRouter(prefix="/model", tags=["attrition-model"])

    async def hr_only(info: dict = Depends(verify_token),
                      x_internal_token: str | None = Header(default=None)) -> dict:
        if roles_of(info) & HR_ROLES or _internal_ok(x_internal_token):
            return info
        raise HTTPException(status_code=403, detail="Bu bilgi yalnızca İK yöneticilerine açıktır.")

    async def retrain_caller(info: dict = Depends(verify_token),
                             x_internal_token: str | None = Header(default=None)) -> dict:
        # Keycloak jetonu her durumda gerekir (verify_token); IK rolu ya da servisler arasi anahtar.
        if roles_of(info) & HR_ROLES or _internal_ok(x_internal_token):
            return {**info, "_internal": _internal_ok(x_internal_token)}
        raise HTTPException(status_code=403, detail="Modeli yalnızca İK yöneticileri yeniden eğitebilir.")

    @router.get("/card")
    async def model_card(_: dict = Depends(hr_only)) -> dict:
        return service.card()

    @router.get("/importance")
    async def importance(_: dict = Depends(hr_only)) -> dict:
        return await asyncio.to_thread(service.importance)

    @router.post("/retrain")
    async def retrain(req: RetrainRequest, info: dict = Depends(retrain_caller)) -> dict:
        platform = bool(info.get("_internal") or "platform-admin" in roles_of(info))
        if req.source in ("rows", "csv") and not platform:
            # Model tum kiracilarca paylasilir: bir kiracinin verisiyle egitim yalnizca platform
            # duzeyinde (toplu ve takma adli veriyle) yapilir; kiraci IK'si sentetik egitim calistirabilir.
            raise HTTPException(status_code=403, detail="Kiracı verisiyle eğitim yalnızca platform yöneticisine ya da "
                                                        "servisler arası çağrıya açıktır.")
        if req.source == "rows" and not req.rows:
            raise HTTPException(status_code=422, detail="source=rows için 'rows' zorunlu.")
        if req.source == "csv" and not (req.csv or "").strip():
            raise HTTPException(status_code=422, detail="source=csv için 'csv' zorunlu.")
        if req.source == "rows" and len(req.rows) < 200:
            raise HTTPException(status_code=422, detail="Eğitim için en az 200 satır gerekir.")
        # Paylasilan modeli yayina alma (promote) yalnizca platform yoneticisi ya da servisler arasi cagri:
        # kiraci IK'si yalnizca deneme egitimi yapar (aday degerlendirilir, yayimlanmaz). 403 yerine
        # dry_run olarak calistirilir ve yanitta bildirilir.
        dry_run_forced = not platform and not req.dry_run
        if dry_run_forced:
            req = req.model_copy(update={"dry_run": True})
        if service.train_lock.locked():
            raise HTTPException(status_code=409, detail="Başka bir eğitim sürüyor; birazdan yeniden deneyin.")
        async with service.train_lock:
            try:
                result = await asyncio.to_thread(service._retrain_blocking, req)
            except aml.ForbiddenFeatureError as e:
                raise HTTPException(status_code=422, detail={"message": str(e), "violations": e.violations}) from None
        # Denetim kaydi governance'ta tutulur: cagiran bu yuku audit_log'a yazar (bu servis veritabanina yazmaz).
        result["audit"] = {
            "action": "ModelPromoted" if result["promoted"] else "ModelRetrainRejected",
            "entityType": "AttritionModel",
            "entityId": f"{service.name}/v{result['candidate_version']}",
            "tenant": tenant_of(info),
            "actor": actor_of(info),
            "changes": {"candidate_version": result["candidate_version"], "previous_version": result["current_version"],
                        "serving_version": result["serving_version"], "promoted": result["promoted"],
                        "reason": result["decision"]["reason"], "auc_candidate": result["candidate"].get("auc"),
                        "auc_current": (result["current"] or {}).get("auc"), "source": req.source,
                        "training_rows": result["training"]["rows"], "data_window": result["data_window"]},
            "occurred_at": result["trained_at"],
        }
        result["dry_run"] = req.dry_run
        result["dry_run_only"] = not platform
        if dry_run_forced:
            result["audit"]["changes"]["dry_run_forced"] = True
            result["notice"] = ("Yalnızca deneme eğitimi: aday değerlendirildi, yayımlanmadı. "
                                "Yayımlama platform yöneticisindedir.")
        return result

    @router.post("/drift")
    async def drift(req: DriftRequest, info: dict = Depends(hr_only)) -> dict:
        return await asyncio.to_thread(service._drift_blocking, tenant_of(info), req.rows)

    @router.get("/drift/recent")
    async def drift_recent(info: dict = Depends(hr_only)) -> dict:
        return await asyncio.to_thread(service._recent_drift_blocking, tenant_of(info))

    @router.get("/drift/last")
    async def drift_last(info: dict = Depends(hr_only)) -> dict:
        tenant = tenant_of(info)
        report = service.last_drift.get(tenant)
        if report is None:
            try:
                report = await asyncio.to_thread(service.store.last_drift, tenant)
            except Exception as e:  # noqa: BLE001
                logger.warning("Son kayma ölçümü okunamadı: %s", e)
            if report is not None:
                service.last_drift[tenant] = report
        if report is None:
            return {"available": False}
        return {"available": True, **report}

    return router


__all__ = ["ModelService", "ModelState", "build_router", "RetrainRequest", "DriftRequest", "ModelNotFound"]
