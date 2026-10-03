#!/usr/bin/env bash
# scripts/backup.sh (sifreleme, dis depo, zamanlama, geri yukleme testi), scripts/restore.sh
# (sifreli arsiv, KVKK yeniden imha) ve scripts/update.sh (guncelleme, otomatik geri donus)
# davranis testi. Docker gerektirmez: docker ve crontab yerine kayit tutan sahte komutlar.
#
# Kullanim: tests/install/test_backup_update.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAILS=0
pass() { echo "  ok   $*"; }
fail() { echo "  FAIL $*"; FAILS=$((FAILS + 1)); }
check() { local desc="$1"; shift; if "$@"; then pass "$desc"; else fail "$desc"; fi; }

BIN="$WORK/bin"; mkdir -p "$BIN"
export HR360_TEST_LOG="$WORK/calls.log" FAKE_CRON="$WORK/crontab"
: > "$HR360_TEST_LOG"

cat > "$BIN/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$HR360_TEST_LOG"
a="$*"
case "$a" in
  "info"*) exit 0 ;;
  *"compose config --format json"*) echo '{"name":"hr360test","services":{"postgres":{"image":"postgres:16-alpine"}}}' ;;
  *"compose config --services"*) printf 'employee-service\nleave-service\ngateway\npostgres\n' ;;
  *"compose ps --status running --services"*) echo postgres ;;
  *"select 1 from pg_database where datname='hr360_operational'"*) echo 1 ;;
  *"select 1 from pg_database"*) : ;;
  *"pg_dump"*) echo "DUMP-DATA" ;;
  *"postgres --version"*) echo "postgres (PostgreSQL) 16.4" ;;
  *"run -d --network none"*) echo cid123 ;;
  *"exec -i cid123 pg_restore"*) cat >/dev/null; [ "${FAKE_RESTORE_FAIL:-0}" = 1 ] && exit 1; exit 0 ;;
  *"exec cid123"*"information_schema.tables"*) echo 42 ;;
  *"exec cid123"*"employee_employees"*) echo 7 ;;
  *"exec cid123"*) exit 0 ;;
  *"gateway wget"*"retention/run"*) echo '{"policies":2,"affected":1}' ;;
  *"gateway wget"*)
    # Saglik: calisma dizininde BROKEN dosyasi varsa (bozuk surum) servisler ayaga kalkmaz.
    [ -f BROKEN ] && exit 1; exit 0 ;;
  *"psql"*"-f -"*|*"pg_restore"*) cat >/dev/null ;;
esac
exit 0
EOF
cat > "$BIN/crontab" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  -l) [ -f "$FAKE_CRON" ] && cat "$FAKE_CRON" || exit 1 ;;
  -) cat > "$FAKE_CRON" ;;
esac
EOF
chmod +x "$BIN"/*
export PATH="$BIN:$PATH"

# ============================================================== yedek
echo "== yedek"
B="$WORK/repo"; mkdir -p "$B/scripts"
cp "$ROOT/scripts/backup.sh" "$ROOT/scripts/restore.sh" "$B/scripts/"
KEY="test-anahtar-$(openssl rand -hex 8)"
printf 'HR360_DB_PASSWORD=x\nINTERNAL_SERVICE_TOKEN=tok\nBACKUP_ENCRYPTION_KEY=%s\n' "$KEY" > "$B/.env"
cd "$B" || exit 1

out="$(scripts/backup.sh --no-minio 2>&1)"; rc=$?
check "yedek alindi" test "$rc" = 0
f="$(ls backups/hr360-*.tar.gz.enc 2>/dev/null | head -1)"
check "arsiv sifreli (.enc), duz arsiv birakilmadi" eval '[ -n "$f" ] && [ -z "$(ls backups/*.tar.gz 2>/dev/null)" ]'
check "arsiv izni 600" test "$(stat -c %a "$f" 2>/dev/null)" = 600
check "sifreli arsiv anahtarsiz acilamaz" eval '! tar tzf "$f" >/dev/null 2>&1'
HR360_BK="$KEY" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$f" -out "$WORK/plain.tgz" -pass env:HR360_BK 2>/dev/null
check "anahtarla cozulur, MANIFEST encrypted=1" eval 'tar xzf "$WORK/plain.tgz" -O --wildcards "*/MANIFEST" | grep -q "^encrypted=1"'

out="$(scripts/backup.sh verify 2>&1)"; rc=$?
check "geri yukleme testi: gecici veritabaninda dogrulandi" eval '[ $rc = 0 ] && grep -q "^DOGRULANDI" <<< "$out"'
check "  uretim veritabanina dokunmadi (ag kapali gecici konteyner)" grep -q "run -d --network none" "$HR360_TEST_LOG"
check "  gecici konteyner silindi" grep -q "rm -f cid123" "$HR360_TEST_LOG"
out="$(FAKE_RESTORE_FAIL=1 scripts/backup.sh verify 2>&1)"; rc=$?
check "bozuk dokumde dogrulama basarisiz" eval '[ $rc != 0 ] && grep -q "^DOGRULANAMADI" <<< "$out"'
cp .env .env.ok; sed -i "s/^BACKUP_ENCRYPTION_KEY=.*/BACKUP_ENCRYPTION_KEY=yanlis/" .env
out="$(scripts/backup.sh verify 2>&1)"; rc=$?
check "yanlis anahtarla dogrulama basarisiz" eval '[ $rc != 0 ] && grep -q "sifre cozulemedi" <<< "$out"'
mv .env.ok .env

# dis depo
printf 'BACKUP_S3_ENDPOINT=https://s3.eu-central-1.amazonaws.com\nBACKUP_S3_BUCKET=b\nBACKUP_S3_ACCESS_KEY=ak\nBACKUP_S3_SECRET_KEY=sk\n' >> .env
out="$(scripts/backup.sh --no-minio 2>&1)"; rc=$?
check "KVKK m.9: yurt disi depoya dayanaksiz gonderilmez" eval '[ $rc != 0 ] && grep -q "KVKK m.9" <<< "$out"'
sed -i 's#^BACKUP_S3_ENDPOINT=.*#BACKUP_S3_ENDPOINT=https://depo.ornek.com.tr:9000#' .env
: > "$HR360_TEST_LOG"
out="$(scripts/backup.sh --no-minio 2>&1)"; rc=$?
check "yurt ici S3 uyumlu depoya gonderildi" eval '[ $rc = 0 ] && grep -q "MC_HOST_dst=https://ak:sk@depo.ornek.com.tr:9000" "$HR360_TEST_LOG"'
check "  gonderilen sifreli arsiv" grep -Eq "cp --quiet /b/hr360-.*\.tar\.gz\.enc dst/b/" "$HR360_TEST_LOG"
out="$(scripts/backup.sh --no-minio --no-encrypt 2>&1)"; rc=$?
check "sifresiz yedek dis depoya gonderilmez" eval '[ $rc != 0 ] && grep -q "yalnizca sifreli" <<< "$out"'
sed -i '/^BACKUP_S3_/d' .env

# zamanlama
scripts/backup.sh schedule --at 02:30 --keep 30 --verify-weekly >/dev/null 2>&1
check "zamanlama: her gece 02:30 yedek" grep -q "^30 2 \* \* \* cd .* && scripts/backup.sh --keep 30 .*# hr360-backup" "$FAKE_CRON"
check "zamanlama: Pazar geri yukleme testi" grep -q "^30 3 \* \* 0 .*backup.sh verify.*# hr360-backup" "$FAKE_CRON"
echo "0 1 * * * baska-is" >> "$FAKE_CRON"
scripts/backup.sh schedule --at 04:00 >/dev/null 2>&1
check "yeniden zamanlama tek kayit birakir, diger isler korunur" eval '[ "$(grep -c "backup.sh --keep" "$FAKE_CRON")" = 1 ] && grep -q baska-is "$FAKE_CRON"'
scripts/backup.sh unschedule >/dev/null 2>&1
check "zamanlama kaldirildi" eval '! grep -q hr360-backup "$FAKE_CRON" && grep -q baska-is "$FAKE_CRON"'
out="$(scripts/backup.sh schedule --at 25:00 2>&1)"; rc=$?
check "gecersiz saat reddedilir" test "$rc" != 0

# geri yukleme: sifreli arsiv + KVKK yeniden imha
: > "$HR360_TEST_LOG"
out="$(scripts/restore.sh "$f" --yes --only-db 2>&1)"; rc=$?
check "sifreli arsiv geri yuklendi" test "$rc" = 0
check "KVKK: saklama politikalari geri yukleme sonrasi yeniden calisti" eval 'grep -q "X-Internal-Token: tok.*retention/run" "$HR360_TEST_LOG" && grep -q "policies" <<< "$out"'

# ============================================================== guncelleme
echo "== guncelleme"
O="$WORK/origin.git"; U="$WORK/kurulum"
git init -q --bare -b main "$O"
git clone -q "$O" "$U" 2>/dev/null
cd "$U" || exit 1
git config user.email t@t; git config user.name t
mkdir -p scripts/sql
cp "$ROOT/scripts/update.sh" scripts/
cat > scripts/backup.sh <<'EOF'
#!/usr/bin/env bash
mkdir -p backups && touch backups/hr360-test.tar.gz.enc
echo "Yedek: x"; echo "Tamam: backups/hr360-test.tar.gz.enc (1K) — sifreli"
EOF
cat > scripts/restore.sh <<'EOF'
#!/usr/bin/env bash
echo "restore $*" >> "$HR360_TEST_LOG"
EOF
chmod +x scripts/*.sh
echo "SELECT 1;" > scripts/sql/a.sql
printf '.env\n.update-state\nbackups/\n' > .gitignore
git add -A; git commit -qm v1; git push -q origin HEAD:main 2>/dev/null
git branch -q --set-upstream-to=origin/main 2>/dev/null || git branch -q -u origin/main
V1="$(git rev-parse HEAD)"
printf 'X=1\n' > .env
# uzak depoda yeni surumler: v2 (saglam), v3 (bozuk)
T="$WORK/t"; git clone -q "$O" "$T" 2>/dev/null
( cd "$T" && git config user.email t@t && git config user.name t && echo v2 > SURUM && git add -A && git commit -qm v2 && git push -q origin HEAD:main 2>/dev/null )
V2="$(cd "$T" && git rev-parse HEAD)"
( cd "$T" && touch BROKEN && git add -A && git commit -qm v3 && git tag v3 && git push -q origin HEAD:refs/heads/bozuk 2>/dev/null && git push -q origin v3 2>/dev/null )

: > "$HR360_TEST_LOG"
out="$(scripts/update.sh --yes --timeout 1 2>&1)"; rc=$?
check "guncelleme basarili (v1 → v2)" eval '[ $rc = 0 ] && [ "$(git rev-parse HEAD)" = "$V2" ]'
check "  once yedek alindi, durum kaydedildi" eval 'grep -q "^backup=backups/hr360-test.tar.gz.enc" .update-state && grep -q "^result=basarili" .update-state'
check "  goc betikleri uygulandi, imajlar yeniden kuruldu" eval 'grep -q "psql -U hr360admin -d hr360_operational -v ON_ERROR_STOP=1 -q -f -" "$HR360_TEST_LOG" && grep -q "compose build" "$HR360_TEST_LOG"'
check "  tum servislerin saglik ucu denetlendi" eval 'grep -q "wget -qO- -T 5 http://employee-service:8080/health" "$HR360_TEST_LOG" && grep -q "leave-service:8080/health" "$HR360_TEST_LOG"'
out="$(scripts/update.sh --yes --timeout 1 2>&1)"; rc=$?
check "zaten guncel" eval '[ $rc = 0 ] && grep -q "Zaten guncel" <<< "$out"'

: > "$HR360_TEST_LOG"
out="$(scripts/update.sh --yes --ref v3 --timeout 1 2>&1)"; rc=$?
check "bozuk surumde otomatik geri donus (cikis 2)" eval '[ $rc = 2 ] && [ "$(git rev-parse HEAD)" = "$V2" ] && [ ! -f BROKEN ]'
check "  durum: basarisiz, geri donuldu" grep -q "^result=basarisiz, geri donuldu" .update-state
check "  veritabani varsayilan olarak geri yuklenmedi" eval '! grep -q "^restore" "$HR360_TEST_LOG"'

: > "$HR360_TEST_LOG"
out="$(scripts/update.sh --yes --ref v3 --timeout 1 --restore-db 2>&1)"; rc=$?
check "--restore-db: geri donuste guncelleme oncesi yedek geri yuklenir" eval '[ $rc = 2 ] && grep -q "restore backups/hr360-test.tar.gz.enc --yes --only-db" "$HR360_TEST_LOG"'

echo degisti >> scripts/sql/a.sql
out="$(scripts/update.sh --yes --timeout 1 2>&1)"; rc=$?
check "kaydedilmemis degisiklik varken guncelleme yapilmaz" eval '[ $rc != 0 ] && grep -q "kaydedilmemis" <<< "$out"'
git checkout -q -- scripts/sql/a.sql

git reset -q --hard "$V1"; rm -f .update-state
scripts/update.sh --yes --timeout 1 >/dev/null 2>&1
out="$(scripts/update.sh rollback --yes --timeout 1 2>&1)"; rc=$?
check "elle geri donus (rollback) onceki surume" eval '[ $rc = 0 ] && [ "$(git rev-parse HEAD)" = "$V1" ]'
out="$(scripts/update.sh status 2>&1)"
check "durum komutu" grep -q "Son guncelleme" <<< "$out"

echo
if [ "$FAILS" -gt 0 ]; then echo "BASARISIZ: $FAILS"; exit 1; fi
echo "Tum denetimler gecti."
