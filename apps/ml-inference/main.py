from fastapi import FastAPI, Depends, HTTPException, Header
from pydantic import BaseModel
from prometheus_fastapi_instrumentator import Instrumentator
import httpx
import os
import mlflow
import mlflow.sklearn
import numpy as np

app = FastAPI(title="HR360 ML Inference Service")

# Performans ML katmani: anomali tespiti + yorunge tahmini.
# Terfi karari VERMEZ - karar performance-service icindeki kural
# motorunda, denetlenebilir sekilde aliniyor.
from performance_ml import router as performance_router
app.include_router(performance_router)
Instrumentator().instrument(app).expose(app)

KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "http://172.33.55.2:8080")
REALM = os.getenv("KEYCLOAK_REALM", "hr360")
CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "hr360-ml-inference")
CLIENT_SECRET = os.getenv("KEYCLOAK_CLIENT_SECRET", "")
MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI", "http://172.33.55.7:5000")
MODEL_NAME = os.getenv("MODEL_NAME", "hr360-attrition-risk")
MODEL_STAGE = os.getenv("MODEL_STAGE", "1")  # version 1

mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
model = None

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

@app.on_event("startup")
async def load_model():
    global model
    try:
        model_uri = f"models:/{MODEL_NAME}/{MODEL_STAGE}"
        model = mlflow.sklearn.load_model(model_uri)
        print(f"Model yüklendi: {model_uri}")
    except Exception as e:
        print(f"Model yüklenemedi: {e}")

@app.get("/health")
async def health():
    return {"status": "ok", "service": "hr360-ml-inference", "model_loaded": model is not None}

@app.post("/predict")
async def predict(req: PredictRequest, token_info: dict = Depends(verify_token)):
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    X = np.array(req.features).reshape(1, -1)
    pred = model.predict(X)
    proba = model.predict_proba(X)
    return {
        "prediction": int(pred[0]),
        "probability": proba[0].tolist(),
        "model": f"{MODEL_NAME}/v{MODEL_STAGE}",
        "authenticated_client": token_info.get("client_id", token_info.get("azp")),
    }

import shap

explainer = None

@app.on_event("startup")
async def load_explainer():
    global explainer
    if model is not None:
        try:
            explainer = shap.TreeExplainer(model)
            print("SHAP explainer hazır")
        except Exception as e:
            print(f"SHAP explainer yüklenemedi: {e}")

@app.post("/explain")
async def explain(req: PredictRequest, token_info: dict = Depends(verify_token)):
    if model is None or explainer is None:
        raise HTTPException(status_code=503, detail="Model or explainer not loaded")
    X = np.array(req.features).reshape(1, -1)
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
        "base_value": base_value,
        "model": f"{MODEL_NAME}/v{MODEL_STAGE}",
    }
# CI deploy retry - variable adi duzeltildi
# CI/CD deploy dogrulama - secret isim duzeltmesi sonrasi
