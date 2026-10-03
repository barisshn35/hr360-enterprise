#!/usr/bin/env bash
# scripts/backup.sh ile alinmis bir yedegi geri yukler.
#
# Kullanim:
#   scripts/restore.sh <yedek.tar.gz> [--yes] [--only-db] [--with-env]
#
#   --yes        Onay sormadan devam et (otomasyon icin).
#   --only-db    Yalnizca veritabanlarini geri yukle; MinIO'ya dokunma.
#   --with-env   Arsivdeki .env'i de geri yukle (mevcut .env, .env.before-restore-*
#                olarak saklanir). Bos bir sunucuya tasirken kullanin: kayitli
#                sifreler ve anahtarlar olmadan eski veriler acilamaz.
#
# Ne yapar:
#   1. Arsivi acar ve SHA256SUMS ile dogrular.
#   2. Uygulama konteynerlerini durdurur (postgres ve minio calismaya devam eder).
#   3. Arsivdeki her veritabanini SILIP yeniden olusturur ve pg_restore ile doldurur.
#   4. MinIO verisini arsivdekiyle degistirir.
#   5. Tum servisleri yeniden baslatir.
#   6. KVKK: yedekten sonra imha edilmis kayitlar geri gelmis olabilir; etkin saklama
#      politikalari hemen yeniden calistirilir (imha tutanagina "Geri yukleme" olarak yazilir).
#
# Sifreli arsiv (.tar.gz.enc) .env'deki BACKUP_ENCRYPTION_KEY ile cozulur.
#
# UYARI: Hedef veritabanlarindaki mevcut veriler kalici olarak silinir. Emin
# degilseniz once scripts/backup.sh ile mevcut durumun yedegini alin.
set -euo pipefail

cd "$(dirname "$0")/.."
die() { echo "HATA: $*" >&2; exit 1; }

ARCHIVE=""; YES=0; ONLY_DB=0; WITH_ENV=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) YES=1; shift ;;
    --only-db) ONLY_DB=1; shift ;;
    --with-env) WITH_ENV=1; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    -*) die "bilinmeyen secenek: $1" ;;
    *) [ -z "$ARCHIVE" ] || die "tek bir arsiv verin"; ARCHIVE="$1"; shift ;;
  esac
done
[ -n "$ARCHIVE" ] || die "kullanim: scripts/restore.sh <yedek.tar.gz> [--yes] [--only-db] [--with-env]"
[ -f "$ARCHIVE" ] || die "arsiv bulunamadi: $ARCHIVE"
[ -f .env ] || [ "$WITH_ENV" = 1 ] || die ".env bulunamadi; once install.sh calistirin ya da --with-env kullanin."

if ! declare -F docker >/dev/null && ! docker info >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
  docker() { command sudo docker "$@"; }
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
if [[ "$ARCHIVE" == *.enc ]]; then
  KEY="$( { [ -f .env ] && grep -E '^BACKUP_ENCRYPTION_KEY=' .env | tail -1 | cut -d= -f2-; } || true)"
  [ -n "$KEY" ] || die "arsiv sifreli; .env'de BACKUP_ENCRYPTION_KEY gerekli"
  HR360_BK="$KEY" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$ARCHIVE" -out "$WORK/archive.tar.gz" -pass env:HR360_BK 2>/dev/null \
    || die "sifre cozulemedi (anahtar yanlis ya da arsiv bozuk)"
  ARCHIVE="$WORK/archive.tar.gz"
fi
tar xzf "$ARCHIVE" -C "$WORK"
D="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d -name 'hr360-*' | head -1)"
[ -n "$D" ] && [ -f "$D/MANIFEST" ] || die "gecerli bir HR360 yedegi degil (MANIFEST yok)"
(cd "$D" && sha256sum -c --quiet SHA256SUMS) || die "saglama toplami tutmuyor; arsiv bozuk"

echo "Yedek bilgisi:"
sed 's/^/  /' "$D/MANIFEST"
DBS=()
for f in "$D"/*.dump; do [ -e "$f" ] && DBS+=("$(basename "$f" .dump)"); done
[ "${#DBS[@]}" -gt 0 ] || die "arsivde veritabani dokumu yok"
HAS_MINIO=0; [ -f "$D/minio.tar.gz" ] && [ "$ONLY_DB" = 0 ] && HAS_MINIO=1
if [ "$WITH_ENV" = 1 ] && [ ! -f "$D/env" ]; then die "arsivde .env yok (yedek --with-env ile alinmamis)"; fi

echo
echo "Geri yuklenecek: ${DBS[*]}$([ "$HAS_MINIO" = 1 ] && echo ' + minio')$([ "$WITH_ENV" = 1 ] && echo ' + .env')"
echo "Bu veritabanlarindaki MEVCUT VERILER SILINECEK."
if [ "$YES" != 1 ]; then
  read -r -p "Devam etmek icin 'evet' yazin: " ans
  [ "$ans" = "evet" ] || die "iptal edildi"
fi

PROJECT="$(docker compose config --format json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["name"])' 2>/dev/null || echo hr360)"

if [ "$WITH_ENV" = 1 ]; then
  [ -f .env ] && cp .env ".env.before-restore-$(date +%Y%m%d-%H%M%S)"
  cp "$D/env" .env && chmod 600 .env
  echo ".env geri yuklendi."
fi
unset COMPOSE_PROFILES HR360_DB_PASSWORD

docker compose up -d postgres >/dev/null
for _ in $(seq 1 60); do
  docker compose exec -T postgres pg_isready -U hr360admin -d postgres >/dev/null 2>&1 && break
  sleep 2
done

if [ "$WITH_ENV" = 1 ]; then
  # Postgres verisi bu sunucuda yeni .env'den farkli bir sifreyle olusturulmus
  # olabilir; rol sifresi geri yuklenen .env ile esitlenir (konteyner ici soket).
  pw="$(grep '^HR360_DB_PASSWORD=' .env | tail -1 | cut -d= -f2-)"
  # -c ile verilen komutlarda psql degiskenleri acilmaz; stdin kullanilir.
  [ -n "$pw" ] && echo "ALTER ROLE hr360admin PASSWORD :'pw';" | docker compose exec -T postgres \
    psql -U hr360admin -d postgres -v ON_ERROR_STOP=1 -q -v pw="$pw" >/dev/null
fi

echo "Uygulama servisleri durduruluyor..."
mapfile -t RUNNING < <(docker compose ps --status running --services 2>/dev/null)
STOP=()
for s in "${RUNNING[@]}"; do
  case "$s" in postgres|minio) ;; *) STOP+=("$s") ;; esac
done
[ "${#STOP[@]}" -gt 0 ] && docker compose stop "${STOP[@]}" >/dev/null

for db in "${DBS[@]}"; do
  printf '  - %s ... ' "$db"
  docker compose exec -T postgres psql -U hr360admin -d postgres -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" \
    -c "CREATE DATABASE \"$db\" OWNER hr360admin" >/dev/null
  docker compose exec -T postgres pg_restore -U hr360admin -d "$db" --no-owner --no-privileges --exit-on-error < "$D/$db.dump"
  echo tamam
done

if [ "$HAS_MINIO" = 1 ]; then
  printf '  - minio ... '
  docker compose stop minio >/dev/null
  docker pull -q alpine:3.20 >/dev/null
  docker run --rm -v "${PROJECT}_minio-data:/data" -v "$D:/backup:ro" alpine:3.20 \
    sh -c 'find /data -mindepth 1 -delete && tar xzf /backup/minio.tar.gz -C /data' >/dev/null
  echo tamam
fi

echo "Servisler baslatiliyor..."
docker compose up -d >/dev/null 2>&1 || docker compose up -d

# KVKK: yedekten sonra imha edilen kayitlar geri gelmis olabilir; saklama politikalari yeniden calisir.
TOKEN="$(grep -E '^INTERNAL_SERVICE_TOKEN=' .env | tail -1 | cut -d= -f2- || true)"
if [ -n "$TOKEN" ]; then
  printf 'KVKK: saklama politikalari yeniden calistiriliyor ... '
  done_ok=0
  for _ in $(seq 1 40); do
    if out="$(docker compose exec -T gateway wget -qO- --header "X-Internal-Token: $TOKEN" --post-data '' \
         http://governance-service:8080/api/internal/retention/run 2>/dev/null)"; then
      echo "tamam ($out)"; done_ok=1; break
    fi
    sleep 5
  done
  [ "$done_ok" = 1 ] || echo "yapilamadi. Panelden KVKK > Saklama politikalari > Simdi calistir ile elle calistirin." >&2
else
  echo "UYARI: INTERNAL_SERVICE_TOKEN yok; saklama politikalarini panelden (KVKK > Saklama politikalari) yeniden calistirin." >&2
fi
echo "Geri yukleme tamamlandi. Servislerin acilmasi 1-2 dakika surebilir."
echo "NOT: Yedek tarihinden sonra yerine getirilen silme/anonimlestirme talepleri (ilgili kisi basvurulari)"
echo "     geri gelmis olabilir; KVKK > Basvurular ekranindan kontrol edip yeniden uygulayin."
