#!/usr/bin/env bash
# HR360 guvenlik taramasi (Trivy + npm audit + NuGet).
#
#   scripts/security-scan.sh repo     Depo: bagimlilik aciklari (npm, pip, NuGet kilitleri),
#                                     sizmis gizli anahtarlar, Dockerfile/compose yapilandirma hatalari
#   scripts/security-scan.sh images   Calisan kurulumun imajlari (isletim sistemi paketleri dahil)
#   scripts/security-scan.sh deps     npm audit + .NET "dotnet list package --vulnerable"
#   scripts/security-scan.sh all      Hepsi (varsayilan)
#
# Yalnizca HIGH/CRITICAL bulgular raporlanir; bulgu varsa cikis kodu 1'dir.
# Trivy ve .NET SDK Docker imaji olarak calisir; yerelde kurulum gerekmez.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
what="${1:-all}"
TRIVY_IMAGE="aquasec/trivy:0.57.1@sha256:5c59e08f980b5d4d503329773480fcea2c9bdad7e381d846fbf9f2ecb8050f6b"
SEVERITY="${SEVERITY:-HIGH,CRITICAL}"
fail=0
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

if ! docker info >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
  docker() { command sudo docker "$@"; }
fi

trivy() {
  docker run --rm -v "$ROOT:/src:ro" -v hr360-trivy-cache:/root/.cache \
    -v /var/run/docker.sock:/var/run/docker.sock "$TRIVY_IMAGE" "$@"
}

repo() {
  step "Trivy: depo (bagimliliklar, gizli anahtarlar, yapilandirma)"
  trivy fs --scanners vuln,secret,misconfig --file-patterns 'pip:requirements-.*\.txt' --severity "$SEVERITY" --exit-code 1 \
    --skip-dirs /src/apps/web/node_modules --skip-dirs /src/tests/load/results \
    --skip-files /src/tests/credentials.json --skip-files /src/.env /src || fail=1
}

images() {
  step "Trivy: imajlar (yalnizca duzeltmesi yayimlanmis aciklar)"
  local imgs
  imgs=$(docker compose config --images 2>/dev/null | sort -u)
  for img in $imgs; do
    docker image inspect "$img" >/dev/null 2>&1 || continue
    echo "-- $img"
    trivy image --scanners vuln --severity "$SEVERITY" --ignore-unfixed --exit-code 1 --quiet "$img" || fail=1
  done
}

deps() {
  step "npm audit (uretim bagimliliklari)"
  (cd apps/web && npm audit --omit=dev --audit-level=high) || fail=1
  step "NuGet: bilinen acigi olan paketler"
  docker run --rm -v "$ROOT:/src:ro" -v hr360-nuget:/root/.nuget/packages mcr.microsoft.com/dotnet/sdk:9.0 sh -c '
    rc=0
    for p in /src/apps/services/*/; do
      rm -rf /tmp/s && mkdir /tmp/s && cp "$p"/*.csproj /tmp/s/ && cd /tmp/s
      out=$(dotnet list package --vulnerable --include-transitive 2>&1)
      if echo "$out" | grep -q "has the following vulnerable packages"; then echo "$out"; rc=1
      elif echo "$out" | grep -qi "error"; then echo "$out"; rc=1
      else echo "temiz: $(basename "$p")"; fi
      cd /
    done
    exit $rc' || fail=1
}

case "$what" in
  repo) repo ;;
  images) images ;;
  deps) deps ;;
  all) repo; deps; images ;;
  *) echo "kullanim: scripts/security-scan.sh repo|images|deps|all" >&2; exit 2 ;;
esac

echo
if [ "$fail" = 0 ]; then echo "Bulgu yok ($SEVERITY)."; else echo "Bulgu var - yukaridaki ciktiya bakin."; fi
exit "$fail"
