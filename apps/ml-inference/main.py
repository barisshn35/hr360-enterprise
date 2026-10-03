from fastapi import FastAPI, Depends, HTTPException, Header
from pydantic import BaseModel
from prometheus_fastapi_instrumentator import Instrumentator
import asyncio
from contextlib import asynccontextmanager
import httpx
import os
import mlflow
import mlflow.sklearn
import numpy as np
import shap

# MLflow'un varsayilan HTTP zaman asimi (120sn) ve tekrar deneme sayisi (5,
# ustel geri cekilmeyle) cok yuksek - MLflow ayaga kalkmadan once
# ml-inference baslarsa (docker compose'da mlflow icin bir healthcheck
# olmadigindan bu her zaman mumkun), model yukleme denemesi DAKIKALARCA
# askida kalabilir ve FastAPI'nin startup event'i bunu bekledigi icin
# /health de dahil HICBIR istek bu sure boyunca yanit vermez. Servisin kendi
# tasarimi zaten "model yuklenemezse calismaya devam et" (asagidaki
# try/except) oldugundan, burada sadece bu basarisizligin HIZLI gerceklesmesini
# sagliyoruz - operator farkli bir deger set etmisse onu eziyoruz (setdefault).
os.environ.setdefault("MLFLOW_HTTP_REQUEST_TIMEOUT", "10")
os.environ.setdefault("MLFLOW_HTTP_REQUEST_MAX_RETRIES", "2")

_background: set[asyncio.Task] = set()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Bilerek AWAIT edilmiyor: MLflow henuz hazir degilse (docker compose'da
    # mlflow icin healthcheck yok, ml-inference sadece container'in
    # BASLAMIS olmasini bekliyor) bu cagri dakikalarca surebilir. Arka
    # planda calistirarak /health ve diger uclar bu sure boyunca da yanit
    # vermeye devam eder; model hazir olunca 'model_loaded' otomatik true olur.
    # Gorev referansi tutulur (aksi halde cop toplayici yarida kesebilir).
    task = asyncio.create_task(_load_model_and_explainer())
    _background.add(task)
    task.add_done_callback(_background.discard)
    yield


app = FastAPI(title="HR360 ML Inference Service", lifespan=lifespan)

# Performans ML katmani: anomali tespiti + yorunge tahmini.
# Terfi karari VERMEZ - karar performance-service icindeki kural
# motorunda, denetlenebilir sekilde aliniyor.
from performance_ml import router as performance_router
app.include_router(performance_router)
Instrumentator().instrument(app).expose(app)

KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "http://keycloak:8080/auth")
REALM = os.getenv("KEYCLOAK_REALM", "hr360")
CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "hr360-ml-inference")
CLIENT_SECRET = os.getenv("KEYCLOAK_CLIENT_SECRET", "")
MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI", "http://mlflow:5000")
MODEL_NAME = os.getenv("MODEL_NAME", "hr360-attrition-risk")
MODEL_STAGE = os.getenv("MODEL_STAGE", "1")  # version 1

mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)

class PredictRequest(BaseModel):
    features: list[float]

async def verify_token(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ")[1]
    introspect_url = f"{KEYCLOAK_URL}/realms/{REALM}/protocol/openid-connect/token/introspect"
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            introspect_url,
            data={"token": token, "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET},
        )
    if resp.status_code != 200 or not resp.json().get("active"):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return resp.json()

# Yapay zeka destekli IK araclari (CV ayristirma, ilan yazici + ayrimci ifade,
# performans ozeti, aday-ilan eslesmesi, izin tahmini, egitim onerisi).
# Hepsi yerel, aciklanabilir yontemler; tum uclar Keycloak jetonu ister.
from ai_tools import router as ai_router
app.include_router(ai_router, dependencies=[Depends(verify_token)])

# Fiş okuma (yerel Tesseract): çağıranın Keycloak jetonu gerekir (expense-service iletir).
from ocr import router as ocr_router
app.include_router(ocr_router, dependencies=[Depends(verify_token)])


# Devir riski modeli: yuklenme, model karti, yeniden egitim ve veri kaymasi
# (model_routes.py). Yayindaki surum MLflow'da "champion" takma adiyla isaretlenir;
# takma ad yoksa MODEL_STAGE surumu yuklenir. Kayitli model hic yoksa (yeni kurulum)
# sentetik ureteciyle ilk surum egitilir (ATTRITION_BOOTSTRAP=false ile kapatilir).
from model_routes import ModelService, build_router, tenant_of
from model_store import MlflowModelStore

model_service = ModelService(
    MlflowModelStore(MODEL_NAME, MODEL_STAGE),
    MODEL_NAME,
    explainer_factory=shap.TreeExplainer,
    bootstrap=os.getenv("ATTRITION_BOOTSTRAP", "true").lower() != "false",
)
app.include_router(build_router(verify_token, model_service))


async def _load_model_and_explainer():
    await model_service.load()

@app.get("/health")
async def health():
    st = model_service.state
    return {"status": "ok", "service": "hr360-ml-inference", "model_loaded": st.model is not None,
            "model_version": st.version}

def _features(req: PredictRequest, model) -> np.ndarray:
    expected = getattr(model, "n_features_in_", None)
    if expected is not None and len(req.features) != expected:
        raise HTTPException(status_code=422, detail=f"Model {expected} özellik bekliyor, {len(req.features)} geldi.")
    return np.array(req.features, dtype=float).reshape(1, -1)


@app.post("/predict")
async def predict(req: PredictRequest, token_info: dict = Depends(verify_token)):
    st = model_service.state
    # Dislanan nitelik denetimi (cinsiyet, yas, medeni durum, saglik ve vekilleri) gecmeyen
    # bir model surumuyle tahmin yapilmaz.
    model = model_service.guard()
    X = _features(req, model)
    pred = model.predict(X)
    proba = model.predict_proba(X)
    # Kayma izleme: girdi yalnizca kiracinin TOPLU histogramina sayilir (kisi/kimlik saklanmaz).
    model_service.record_prediction(tenant_of(token_info), X[0])
    return {
        "prediction": int(pred[0]),
        "probability": proba[0].tolist(),
        "model": f"{MODEL_NAME}/v{st.version}",
        "authenticated_client": token_info.get("client_id", token_info.get("azp")),
    }

@app.post("/explain")
async def explain(req: PredictRequest, token_info: dict = Depends(verify_token)):
    st = model_service.state
    model_service.guard()
    explainer = st.explainer
    if st.model is None or explainer is None:
        raise HTTPException(status_code=503, detail="Model or explainer not loaded")
    X = _features(req, st.model)
    raw = explainer.shap_values(X)
    arr = np.array(raw)
    # arr shape genelde (n_samples, n_features, n_classes) ya da (n_classes, n_samples, n_features)
    # pozitif sinifin (class 1) katkilarini duz bir listeye indirgeyelim
    if arr.ndim == 3 and arr.shape[-1] == 2:
        contributions = arr[0, :, 1].tolist()
    elif arr.ndim == 3 and arr.shape[0] == 2:
        contributions = arr[1, 0, :].tolist()
    else:
        contributions = np.array(raw).reshape(-1).tolist()

    base = explainer.expected_value
    if isinstance(base, (list, np.ndarray)):
        base_value = float(np.array(base).reshape(-1)[-1])
    else:
        base_value = float(base)

    return {
        "feature_contributions": contributions,
        # Katkilar giris sirasindadir; adlar model kartindaki ozellik sirasidir.
        "feature_names": list(st.meta.get("features") or []),
        "base_value": base_value,
        "model": f"{MODEL_NAME}/v{st.version}",
    }
# CI deploy retry - variable adi duzeltildi
# CI/CD deploy dogrulama - secret isim duzeltmesi sonrasi
