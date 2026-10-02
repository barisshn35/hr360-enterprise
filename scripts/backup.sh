#!/usr/bin/env bash
# HR360 yedegi alir: PostgreSQL veritabanlari (uygulama, Keycloak, MLflow),
# MinIO nesneleri (logolar, belgeler, ML modelleri) ve istege bagli .env.
#
# Kullanim:
#   scripts/backup.sh [--out DIZIN] [--keep N] [--no-minio] [--with-env]
#
#   --out DIZIN   Arsivin yazilacagi dizin (varsayilan: ./backups)
#   --keep N      Bu dizinde en yeni N yedek kalsin, eskiler silinsin (varsayilan: 14)
#   --no-minio    Nesne deposunu yedekleme (yalnizca veritabanlari)
#   --with-env    .env dosyasini da arsive koy. DIKKAT: .env tum sifreleri ve
#                 JWT/tenant anahtarlarini icerir; arsivi buna gore saklayin.
#                 Bos bir sunucuya geri donmek icin gereklidir (restore --with-env).
#
# Cikti: <DIZIN>/hr360-YYYYmmdd-HHMMSS.tar.gz (izinler 600). Icinde her DB icin
# pg_dump -Fc dosyasi, minio.tar.gz, MANIFEST (surumler) ve SHA256SUMS bulunur.
# Servisler calisirken alinabilir: pg_dump tutarli anlik goruntu alir; MinIO
# dosya duzeyinde kopyalanir (yedek sirasinda yuklenen dosya eksik kalabilir).
#
# Zamanlanmis yedek ornegi (her gece 03:15, 30 yedek):
#   15 3 * * * cd /opt/hr360 && scripts/backup.sh --keep 30 >> backups/backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
OUT=backups; KEEP=14; MINIO=1; WITH_ENV=0
DATABASES=(hr360_operational keycloak hr360_mlflow)

die() { echo "HATA: $*" >&2; exit 1; }
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    --no-minio) MINIO=0; shift ;;
    --with-env) WITH_ENV=1; shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) die "bilinmeyen secenek: $1" ;;
  esac
done
[[ "$KEEP" =~ ^[0-9]+$ ]] || die "--keep sayi olmali"
[ -f .env ] || die ".env bulunamadi; once install.sh calistirin."

if ! declare -F docker >/dev/null && ! docker info >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
  docker() { command sudo docker "$@"; }
fi
PROJECT="$(docker compose config --format json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["name"])' 2>/dev/null || echo hr360)"

docker compose ps --status running --services 2>/dev/null | grep -qx postgres || die "postgres konteyneri calismiyor (docker compose up -d postgres)."

umask 077
mkdir -p "$OUT"
TS="$(date +%Y%m%d-%H%M%S)"
NAME="hr360-$TS"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/$NAME"
D="$WORK/$NAME"

echo "Yedek: $NAME"
for db in "${DATABASES[@]}"; do
  if ! docker compose exec -T postgres psql -U hr360admin -d postgres -Atc "select 1 from pg_database where datname='$db'" | grep -q 1; then
    echo "  - $db: yok, atlandi"; continue
  fi
  printf '  - %s ... ' "$db"
  docker compose exec -T postgres pg_dump -U hr360admin -d "$db" -Fc --no-owner --no-privileges > "$D/$db.dump"
  echo "$(du -h "$D/$db.dump" | cut -f1)"
done

if [ "$MINIO" = 1 ]; then
  printf '  - minio ... '
  docker pull -q alpine:3.20 >/dev/null
  docker run --rm -v "${PROJECT}_minio-data:/data:ro" -v "$D:/backup" alpine:3.20 \
    sh -c 'cd /data && tar czf /backup/minio.tar.gz . && chmod 600 /backup/minio.tar.gz' >/dev/null
  echo "$(du -h "$D/minio.tar.gz" | cut -f1)"
fi

if [ "$WITH_ENV" = 1 ]; then
  cp .env "$D/env"
  echo "  - .env (gizli bilgiler iceriyor)"
fi

{
  echo "name=$NAME"
  echo "created=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "host=$(hostname)"
  echo "git=$(git rev-parse --short HEAD 2>/dev/null || echo -)"
  echo "postgres=$(docker compose exec -T postgres postgres --version | tr -d '\r')"
  echo "databases=$(cd "$D" && ls *.dump 2>/dev/null | sed 's/\.dump$//' | tr '\n' ' ')"
  echo "minio=$MINIO"
  echo "env=$WITH_ENV"
} > "$D/MANIFEST"
(cd "$D" && sha256sum -- * > SHA256SUMS)

tar czf "$OUT/$NAME.tar.gz" -C "$WORK" "$NAME"
chmod 600 "$OUT/$NAME.tar.gz"
echo "Tamam: $OUT/$NAME.tar.gz ($(du -h "$OUT/$NAME.tar.gz" | cut -f1))"

if [ "$KEEP" -gt 0 ]; then
  # shellcheck disable=SC2012
  ls -1t "$OUT"/hr360-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
    rm -f -- "$old" && echo "Eski yedek silindi: $old"
  done
fi
