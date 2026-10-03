"""
MLflow model kaydi (Registry) islemleri - devir riski modeli.

- Yayindaki surum "champion" takma adiyla (alias) isaretlenir. Takma ad yoksa
  (eski kurulum) MODEL_STAGE ortam degiskenindeki surum kullanilir.
- Her egitim yeni bir MLflow calismasi (run) ve yeni bir model surumu uretir;
  terfi etmeyen surumler kayitta kalir ("hr360.promoted" = false etiketiyle).
- Model kartinin meta verisi ve egitim referans histogramlari calismaya
  "attrition_meta.json" olarak yazilir (ham egitim satirlari YAZILMAZ).
- Veri kaymasi raporlari ayri bir deneyde (hr360-attrition-drift) tutulur.

mlflow ice aktarimi tembeldir: birim testleri bu modulu sahte bir depoyla degistirir.
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, field

CHAMPION = "champion"
META_FILE = "attrition_meta.json"
DRIFT_EXPERIMENT = "hr360-attrition-drift"
TRAIN_EXPERIMENT = "hr360-attrition-training"


@dataclass
class LoadedModel:
    model: object
    version: str
    meta: dict = field(default_factory=dict)


class ModelNotFound(Exception):
    pass


class MlflowModelStore:
    def __init__(self, name: str, fallback_version: str):
        self.name = name
        self.fallback_version = fallback_version

    @staticmethod
    def _client():
        from mlflow.tracking import MlflowClient
        return MlflowClient()

    def load_current(self) -> LoadedModel:
        import mlflow.sklearn
        from mlflow.exceptions import MlflowException

        client = self._client()
        try:
            client.get_registered_model(self.name)
        except MlflowException as e:
            if "RESOURCE_DOES_NOT_EXIST" in str(e):
                raise ModelNotFound(str(e)) from e
            raise
        try:
            mv = client.get_model_version_by_alias(self.name, CHAMPION)
        except MlflowException:
            try:
                mv = client.get_model_version(self.name, self.fallback_version)
            except MlflowException as e2:
                raise ModelNotFound(str(e2)) from e2
        model = mlflow.sklearn.load_model(f"models:/{self.name}/{mv.version}")
        return LoadedModel(model=model, version=str(mv.version), meta=self._meta(mv.run_id))

    @staticmethod
    def _meta(run_id: str | None) -> dict:
        if not run_id:
            return {}
        import mlflow.artifacts
        try:
            return mlflow.artifacts.load_dict(f"runs:/{run_id}/{META_FILE}")
        except Exception:  # noqa: BLE001 - eski surumlerde meta yok; kart kismi doner
            return {}

    def register(self, model, meta: dict, metrics: dict, params: dict, promote: bool) -> str:
        import mlflow
        import mlflow.sklearn

        mlflow.set_experiment(TRAIN_EXPERIMENT)
        with mlflow.start_run(run_name=f"attrition-{meta.get('trained_at', '')}") as run:
            mlflow.log_params(params)
            mlflow.log_metrics({k: v for k, v in metrics.items() if isinstance(v, (int, float)) and v == v})
            mlflow.set_tags({"hr360.source": meta.get("training_source", ""), "hr360.promoted": str(promote).lower()})
            mlflow.log_dict(meta, META_FILE)
            import numpy
            import sklearn
            # MLflow 3 modeli skops ile saklar ve agac dugum tipini acikca guvenilir saymak ister
            # (dosyayi bu servis uretir; disaridan model yuklenmez).
            info = mlflow.sklearn.log_model(
                model, name="model", registered_model_name=self.name,
                skops_trusted_types=["sklearn.tree._tree.Tree"],
                pip_requirements=[f"scikit-learn=={sklearn.__version__}", f"numpy=={numpy.__version__}"],
            )
            version = str(info.registered_model_version)
        client = self._client()
        client.set_model_version_tag(self.name, version, "hr360.promoted", str(promote).lower())
        if promote:
            client.set_registered_model_alias(self.name, CHAMPION, version)
        return version

    def log_drift(self, tenant: str, model_version: str | None, report: dict) -> None:
        import mlflow

        mlflow.set_experiment(DRIFT_EXPERIMENT)
        with mlflow.start_run(run_name=f"drift-{tenant}"):
            mlflow.set_tags({"hr360.tenant": tenant, "hr360.model_version": model_version or "",
                             "hr360.status": report.get("status", "")})
            mlflow.log_metrics({f"psi_{f['feature']}": f["psi"] for f in report.get("features", [])}
                               | {"max_psi": report.get("max_psi", 0.0), "rows": report.get("rows", 0)})
            mlflow.log_dict(report, "drift.json")

    def last_drift(self, tenant: str) -> dict | None:
        import mlflow
        import mlflow.artifacts

        exp = mlflow.get_experiment_by_name(DRIFT_EXPERIMENT)
        if exp is None:
            return None
        safe = tenant.replace("'", "")
        runs = self._client().search_runs([exp.experiment_id], filter_string=f"tags.`hr360.tenant` = '{safe}'",
                                          order_by=["attributes.start_time DESC"], max_results=1)
        if not runs:
            return None
        try:
            return mlflow.artifacts.load_dict(f"runs:/{runs[0].info.run_id}/drift.json")
        except Exception:  # noqa: BLE001
            return None


class LocalModelStore:
    """Dosya sistemi tabanli depo: MLflow olmadan (birim testi / gelistirme) ayni arayuz."""

    def __init__(self, root: str | None = None):
        self.root = root or tempfile.mkdtemp(prefix="hr360-models-")
        self.models: dict[str, tuple[object, dict]] = {}
        self.champion: str | None = None
        self.drifts: dict[str, dict] = {}
        self.promoted: dict[str, bool] = {}

    def load_current(self) -> LoadedModel:
        if self.champion is None:
            raise ModelNotFound("no model")
        model, meta = self.models[self.champion]
        return LoadedModel(model=model, version=self.champion, meta=meta)

    def register(self, model, meta, metrics, params, promote) -> str:
        version = str(len(self.models) + 1)
        self.models[version] = (model, json.loads(json.dumps(meta)))
        self.promoted[version] = promote
        if promote:
            self.champion = version
        return version

    def log_drift(self, tenant, model_version, report) -> None:
        self.drifts[tenant] = report
        with open(os.path.join(self.root, f"drift-{tenant}.json"), "w") as f:
            json.dump(report, f)

    def last_drift(self, tenant):
        return self.drifts.get(tenant)
