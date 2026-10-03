#!/usr/bin/env bash
# HR360 yedegi: PostgreSQL veritabanlari (uygulama, Keycloak, MLflow), MinIO nesneleri
# (logolar, belgeler, ML modelleri) ve istege bagli .env.
#
# Kullanim:
#   scripts/backup.sh [--out DIZIN] [--keep N] [--no-minio] [--with-env] [--no-encrypt] [--no-s3]
#   scripts/backup.sh schedule [--at SS:DD] [--keep N] [--verify-weekly]   Her gece otomatik yedek (cron)
#   scripts/backup.sh unschedule                                         Zamanlanmis yedegi kaldir
#   scripts/backup.sh verify [ARSIV]                                     Geri yukleme testi (gecici veritabaninda)
#   scripts/backup.sh status                                             Son yedek, zamanlama, son dogrulama
#
#   --out DIZIN   Arsivin yazilacagi dizin (varsayilan: ./backups)
#   --keep N      Bu dizinde en yeni N yedek kalsin, eskiler silinsin (varsayilan: 14)
#   --no-minio    Nesne deposunu yedekleme (yalnizca veritabanlari)
#   --with-env    .env dosyasini da arsive koy. DIKKAT: .env tum sifreleri icerir.
#   --no-encrypt  Sifrelemeyi kapat (BACKUP_ENCRYPTION_KEY tanimli olsa da)
#   --no-s3       Dis depoya (S3) gondermeyi atla
#
# KVKK (m.12 veri guvenligi, m.9 yurt disi aktarim):
#   - .env'de BACKUP_ENCRYPTION_KEY varsa (kurulum uretir) arsiv AES-256 ile sifrelenir
#     (openssl, PBKDF2): hr360-*.tar.gz.enc. Anahtari yedekten AYRI bir yerde saklayin.
#   - Dis depo (S3 uyumlu: MinIO, Ceph, yerli bulut): BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET,
#     BACKUP_S3_ACCESS_KEY, BACKUP_S3_SECRET_KEY (istege bagli BACKUP_S3_PREFIX). Yalnizca
#     sifreli arsiv gonderilir. Yurt disi bilinen bir saglayiciysa (AWS, Azure, GCP, ...) KVKK m.9
#     dayanagi olmadan gonderilmez; dayanak varsa BACKUP_S3_ABROAD_OK=1.
#   - Yedekten geri yukleme yapilirsa imha edilmis kayitlar yeniden silinir (bkz. restore.sh).
#
# Cikti: <DIZIN>/hr360-YYYYmmdd-HHMMSS.tar.gz[.enc] (izinler 600). Icinde her DB icin
# pg_dump -Fc dosyasi, minio.tar.gz, MANIFEST (surumler) ve SHA256SUMS bulunur.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT=backups; KEEP=14; MINIO=1; WITH_ENV=0; ENCRYPT=auto; S3=auto
DATABASES=(hr360_operational keycloak hr360_mlflow)
CRON_MARK="# hr360-backup"

die() { echo "HATA: $*" >&2; exit 1; }
envval() { [ -f .env ] && grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }

CMD=backup
case "${1:-}" in schedule|unschedule|verify|status) CMD="$1"; shift ;; esac

AT="03:15"; VERIFY_WEEKLY=0; ARCHIVE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    --no-minio) MINIO=0; shift ;;
    --with-env) WITH_ENV=1; shift ;;
    --no-encrypt) ENCRYPT=0; shift ;;
    --no-s3) S3=0; shift ;;
    --at) AT="$2"; shift 2 ;;
    --verify-weekly) VERIFY_WEEKLY=1; shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    -*) die "bilinmeyen secenek: $1" ;;
    *) [ "$CMD" = verify ] && [ -z "$ARCHIVE" ] || die "beklenmeyen arguman: $1"; ARCHIVE="$1"; shift ;;
  esac
done
[[ "$KEEP" =~ ^[0-9]+$ ]] || die "--keep sayi olmali"

if ! declare -F docker >/dev/null && ! docker info >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
  docker() { command sudo docker "$@"; }
fi

latest_archive() {
  # shellcheck disable=SC2012
  { ls -1t "$OUT"/hr360-*.tar.gz "$OUT"/hr360-*.tar.gz.enc 2>/dev/null || true; } | head -1
}

# ---------------------------------------------------------------- zamanlama
if [ "$CMD" = schedule ] || [ "$CMD" = unschedule ]; then
  command -v crontab >/dev/null 2>&1 || die "crontab bulunamadi (cron paketi kurulu olmali)"
  current="$(crontab -l 2>/dev/null | grep -v "$CRON_MARK" || true)"
  if [ "$CMD" = unschedule ]; then
    printf '%s\n' "$current" | sed '/^$/d' | crontab -
    echo "Zamanlanmis yedek kaldirildi."
    exit 0
  fi
  [[ "$AT" =~ ^([01]?[0-9]|2[0-3]):([0-5][0-9])$ ]] || die "--at SS:DD biciminde olmali (ornek 03:15)"
  h="${BASH_REMATCH[1]#0}"; m="${BASH_REMATCH[2]#0}"; h="${h:-0}"; m="${m:-0}"
  dir="$(pwd)"
  mkdir -p "$OUT"
  lines="$m $h * * * cd $dir && scripts/backup.sh --keep $KEEP >> $OUT/backup.log 2>&1 $CRON_MARK"
  # Haftalik geri yukleme testi (Pazar, yedekten 1 saat sonra).
  [ "$VERIFY_WEEKLY" = 1 ] && lines="$lines
$m $(( (h + 1) % 24 )) * * 0 cd $dir && scripts/backup.sh verify >> $OUT/verify.log 2>&1 $CRON_MARK"
  printf '%s\n%s\n' "$current" "$lines" | sed '/^$/d' | crontab -
  echo "Her gece $AT yedek alinacak (son $KEEP yedek tutulur)$([ "$VERIFY_WEEKLY" = 1 ] && echo '; Pazar gunleri geri yukleme testi yapilacak')."
  [ -n "$(envval BACKUP_ENCRYPTION_KEY)" ] || echo "UYARI: BACKUP_ENCRYPTION_KEY yok; yedekler sifrelenmeyecek." >&2
  exit 0
fi

# ---------------------------------------------------------------- durum
if [ "$CMD" = status ]; then
  last="$(latest_archive)"
  echo "Son yedek: ${last:-yok}$([ -n "$last" ] && printf ' (%s)' "$(du -h "$last" | cut -f1)")"
  if command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -q "$CRON_MARK"; then
    echo "Zamanlama: $(crontab -l | grep "$CRON_MARK" | grep -v verify | awk '{printf "%02d:%02d", $2, $1}') her gece"
  else
    echo "Zamanlama: yok (scripts/backup.sh schedule)"
  fi
  echo "Sifreleme: $([ -n "$(envval BACKUP_ENCRYPTION_KEY)" ] && echo acik || echo kapali)"
  echo "Dis depo: $([ -n "$(envval BACKUP_S3_BUCKET)" ] && echo "$(envval BACKUP_S3_ENDPOINT)/$(envval BACKUP_S3_BUCKET)" || echo yok)"
  [ -f "$OUT/verify.log" ] && echo "Son dogrulama: $(grep -E '^(DOGRULANDI|DOGRULANAMADI)' "$OUT/verify.log" | tail -1)"
  exit 0
fi

[ -f .env ] || die ".env bulunamadi; once install.sh calistirin."
KEY="$(envval BACKUP_ENCRYPTION_KEY)"

# ---------------------------------------------------------------- dogrulama (geri yukleme testi)
if [ "$CMD" = verify ]; then
  [ -n "$ARCHIVE" ] || ARCHIVE="$(latest_archive)"
  [ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ] || die "dogrulanacak yedek bulunamadi"
  WORK="$(mktemp -d)"; CID=""
  cleanup() { [ -n "$CID" ] && docker rm -f "$CID" >/dev/null 2>&1; rm -rf "$WORK"; }
  trap cleanup EXIT
  fail() { echo "DOGRULANAMADI $(date -u +%FT%TZ) $(basename "$ARCHIVE"): $*"; exit 1; }
  src="$ARCHIVE"
  if [[ "$ARCHIVE" == *.enc ]]; then
    [ -n "$KEY" ] || fail "arsiv sifreli ama BACKUP_ENCRYPTION_KEY yok"
    HR360_BK="$KEY" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$ARCHIVE" -out "$WORK/a.tar.gz" -pass env:HR360_BK 2>/dev/null \
      || fail "sifre cozulemedi (anahtar yanlis ya da arsiv bozuk)"
    src="$WORK/a.tar.gz"
  fi
  tar xzf "$src" -C "$WORK" || fail "arsiv acilamadi"
  D="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d -name 'hr360-*' | head -1)"
  [ -n "$D" ] && [ -f "$D/MANIFEST" ] || fail "MANIFEST yok"
  (cd "$D" && sha256sum -c --quiet SHA256SUMS) || fail "saglama toplami tutmuyor"
  IMAGE="$(docker compose config --format json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["services"]["postgres"]["image"])' 2>/dev/null || echo postgres:16-alpine)"
  # Uretim veritabanina dokunulmaz: ayri, gecici, aga bagli olmayan bir konteyner.
  CID="$(docker run -d --network none -e POSTGRES_PASSWORD=verify -e POSTGRES_USER=hr360admin "$IMAGE")" || fail "gecici veritabani baslatilamadi"
  ok=0
  for _ in $(seq 1 60); do docker exec "$CID" pg_isready -U hr360admin >/dev/null 2>&1 && { ok=1; break; }; sleep 1; done
  [ "$ok" = 1 ] || fail "gecici veritabani hazir olmadi"
  for f in "$D"/*.dump; do
    [ -e "$f" ] || continue
    db="$(basename "$f" .dump)"
    docker exec "$CID" psql -U hr360admin -d postgres -q -c "CREATE DATABASE \"$db\"" >/dev/null || fail "$db olusturulamadi"
    docker exec -i "$CID" pg_restore -U hr360admin -d "$db" --no-owner --no-privileges --exit-on-error < "$f" || fail "$db geri yuklenemedi"
    n="$(docker exec "$CID" psql -U hr360admin -d "$db" -Atc "select count(*) from information_schema.tables where table_schema='public'" | tr -d '\r')"
    [ "${n:-0}" -gt 0 ] || fail "$db bos (tablo yok)"
    echo "  - $db: $n tablo"
  done
  if [ -f "$D/hr360_operational.dump" ]; then
    emp="$(docker exec "$CID" psql -U hr360admin -d hr360_operational -Atc "select count(*) from employee_employees" 2>/dev/null | tr -d '\r')"
    echo "  - calisan kaydi: ${emp:-?}"
  fi
  echo "DOGRULANDI $(date -u +%FT%TZ) $(basename "$ARCHIVE")"
  exit 0
fi

# ---------------------------------------------------------------- yedek
PROJECT="$(docker compose config --format json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["name"])' 2>/dev/null || echo hr360)"
docker compose ps --status running --services 2>/dev/null | grep -qx postgres || die "postgres konteyneri calismiyor (docker compose up -d postgres)."

[ "$ENCRYPT" = auto ] && { [ -n "$KEY" ] && ENCRYPT=1 || ENCRYPT=0; }
[ "$ENCRYPT" = 1 ] && [ -z "$KEY" ] && die "sifreleme icin .env'de BACKUP_ENCRYPTION_KEY gerekli"
S3_BUCKET="$(envval BACKUP_S3_BUCKET)"
[ "$S3" = auto ] && { [ -n "$S3_BUCKET" ] && S3=1 || S3=0; }

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
  echo "encrypted=$ENCRYPT"
} > "$D/MANIFEST"
(cd "$D" && sha256sum -- * > SHA256SUMS)

FILE="$OUT/$NAME.tar.gz"
tar czf "$FILE" -C "$WORK" "$NAME"
if [ "$ENCRYPT" = 1 ]; then
  HR360_BK="$KEY" openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$FILE" -out "$FILE.enc" -pass env:HR360_BK
  rm -f "$FILE"; FILE="$FILE.enc"
fi
chmod 600 "$FILE"
echo "Tamam: $FILE ($(du -h "$FILE" | cut -f1))$([ "$ENCRYPT" = 1 ] && echo ' — sifreli')"

if [ "$S3" = 1 ]; then
  EP="$(envval BACKUP_S3_ENDPOINT)"; AK="$(envval BACKUP_S3_ACCESS_KEY)"; SK="$(envval BACKUP_S3_SECRET_KEY)"; PFX="$(envval BACKUP_S3_PREFIX)"
  [ -n "$S3_BUCKET" ] && [ -n "$EP" ] && [ -n "$AK" ] && [ -n "$SK" ] || die "dis depo icin BACKUP_S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY gerekli"
  [ "$ENCRYPT" = 1 ] || die "dis depoya yalnizca sifreli yedek gonderilir (BACKUP_ENCRYPTION_KEY tanimlayin)"
  host="$(printf '%s' "$EP" | sed -E 's#^[a-z]+://##; s#[/:].*##')"
  if printf '%s' "$host" | grep -Eqi '(amazonaws\.com|googleapis\.com|windows\.net|backblazeb2\.com|wasabisys\.com|digitaloceanspaces\.com|r2\.cloudflarestorage\.com|linodeobjects\.com)$' \
     && [ "$(envval BACKUP_S3_ABROAD_OK)" != 1 ]; then
    die "dis depo ($host) yurt disinda; KVKK m.9 dayanagi (ornek standart sozlesme) olmadan gonderilmez. Dayanak varsa .env'e BACKUP_S3_ABROAD_OK=1 ekleyin."
  fi
  scheme="${EP%%://*}"; [ "$scheme" = "$EP" ] && scheme=https
  printf '  - dis depo (%s/%s) ... ' "$host" "$S3_BUCKET"
  docker run --rm --network host -e "MC_HOST_dst=${scheme}://${AK}:${SK}@${EP#*://}" -v "$(cd "$OUT" && pwd):/b:ro" minio/mc:latest \
    cp --quiet "/b/$(basename "$FILE")" "dst/${S3_BUCKET}/${PFX:+$PFX/}$(basename "$FILE")" >/dev/null
  echo tamam
fi

if [ "$KEEP" -gt 0 ]; then
  # shellcheck disable=SC2012
  { ls -1t "$OUT"/hr360-*.tar.gz "$OUT"/hr360-*.tar.gz.enc 2>/dev/null || true; } | tail -n +"$((KEEP + 1))" | while read -r old; do
    rm -f -- "$old" && echo "Eski yedek silindi: $old"
  done
fi
