#!/usr/bin/env bash
# HR360 testlerini calistirir.
#
#   scripts/test.sh unit          Birim testleri: .NET (xUnit), arayuz (Vitest), ML (pytest)
#   scripts/test.sh integration   API entegrasyon testleri: Slack/Teams, takvim/toplanti, LLM
#                                 (sahte saglayici sunucusu "chatmock" otomatik baslar; bitince
#                                 governance-service normal ayarlarla yeniden baslatilir)
#   scripts/test.sh e2e           Tarayici testleri (Playwright): tum ekranlar x tum roller, izin akisi
#   scripts/test.sh all           Hepsi
#
# integration ve e2e calisan bir kurulum ister. Test kullanicilari: tests/credentials.json
# (ornek: tests/credentials.example.json) ya da HR360_TEST_USERS. Adres: HR360_BASE_URL.
# Gereken: docker; e2e/integration icin python3 + `pip install pytest playwright` + `playwright install chromium`.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
what="${1:-unit}"
fail=0
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
run() { if "$@"; then echo "OK"; else echo "BASARISIZ: $*"; fail=1; fi; }

if ! declare -F docker >/dev/null && ! docker info >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
  docker() { command sudo docker "$@"; }
fi

unit() {
  step ".NET birim testleri"
  if command -v dotnet >/dev/null 2>&1; then
    for p in tests/dotnet/*/; do run dotnet test "$p" --nologo -v q; done
  else
    run docker run --rm -v "$ROOT:/src" -v hr360-nuget:/root/.nuget/packages -w /src/tests/dotnet \
      mcr.microsoft.com/dotnet/sdk:9.0 sh -c 'for p in */; do dotnet test "$p" --nologo -v q || exit 1; done'
  fi
  step "Arayuz birim testleri (Vitest)"
  (cd apps/web && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && run npx vitest run)
  step "ML servisi (pytest)"
  run docker run --rm -v "$ROOT/apps/ml-inference:/src:ro" python:3.11-slim sh -c \
    "cp -r /src /w && cd /w && grep -E '^(fastapi|pydantic|httpx|numpy|scikit-learn)==' requirements.txt > r.txt && cat requirements-ai.txt requirements-dev.txt >> r.txt && pip install -q -r r.txt >/dev/null 2>&1 && python -m pytest -q -p no:warnings tests"
}

integration() {
  step "Sahte saglayici sunucusu (Slack, Teams, Google, Microsoft Graph, Zoom, LLM)"
  docker rm -f chatmock >/dev/null 2>&1 || true
  docker run -d --name chatmock --network hr360-net -v "$ROOT/tests/integration:/t:ro" python:3.11-slim \
    sh -c "pip install -q cryptography pyjwt 2>/dev/null && python -u /t/chatmock.py" >/dev/null
  docker compose -f docker-compose.yml -f deploy/testing/chat-mock.yml up -d governance-service >/dev/null
  for _ in $(seq 1 60); do docker logs chatmock 2>&1 | grep -q "chatmock :8000" && break; sleep 2; done
  sleep 10
  for t in test_chat test_calendar test_ai_llm; do
    step "Entegrasyon: $t"
    run python3 "tests/integration/$t.py"
  done
  step "Temizlik: governance-service normal ayarlarla"
  docker compose up -d governance-service >/dev/null
  docker rm -f chatmock >/dev/null 2>&1 || true
}

e2e() {
  step "Tarayici testleri (Playwright)"
  run python3 -m pytest -q -p no:cacheprovider tests/e2e
}

case "$what" in
  unit) unit ;;
  integration) integration ;;
  e2e) e2e ;;
  all) unit; integration; e2e ;;
  *) echo "kullanim: scripts/test.sh unit|integration|e2e|all" >&2; exit 2 ;;
esac

echo
if [ "$fail" = 0 ]; then echo "Tum testler gecti."; else echo "Basarisiz test var."; fi
exit "$fail"
