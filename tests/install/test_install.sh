#!/usr/bin/env bash
# install.sh ve scripts/tls.sh otomasyonunun davranis testi (Docker gerektirmez).
#
# Depo kopyasinda, docker / curl / crontab / ufw / ss / sudo yerine kayit tutan sahte
# komutlarla calisir. Denetlenenler: komut satiri secenekleri, soru sormadan (--yes) kurulum,
# alan adindan Let's Encrypt, DNS hazir degilse gecici sertifika + saatlik yeniden deneme ve
# DNS duzelince gercek sertifikaya gecis, sunucu guvenlik duvarina dokunulmamasi, gonderen adresten SMTP sunucusu
# bulma, deneme e-postasi, hatali parolada yeniden sorma, yonetici e-postasinin uyari alicisi
# olmasi.
#
# Kullanim: tests/install/test_install.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAILS=0
pass() { echo "  ok   $*"; }
fail() { echo "  FAIL $*"; FAILS=$((FAILS + 1)); }
check() { local desc="$1"; shift; if "$@"; then pass "$desc"; else fail "$desc"; fi; }

# --- Sahte komutlar ----------------------------------------------------------
BIN="$WORK/bin"; mkdir -p "$BIN"
cat > "$BIN/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$HR360_TEST_LOG"
case "$*" in
  "info --format {{.MemTotal}}") echo 17179869184 ;;
  *"compose config"*) echo "name: hr360test" ;;
  *certonly*)
    [ "${FAKE_LE:-fail}" = ok ] || { echo "certbot: dogrulama basarisiz (sahte)" >&2; exit 1; }
    host=""; prev=""
    for a in "$@"; do [ "$prev" = -d ] && host="$a"; prev="$a"; done
    mkdir -p "deploy/letsencrypt/live/$host"
    openssl req -x509 -newkey rsa:2048 -nodes -days 90 -subj "/CN=$host" \
      -keyout "deploy/letsencrypt/live/$host/privkey.pem" -out "deploy/letsencrypt/live/$host/fullchain.pem" >/dev/null 2>&1 ;;
esac
exit 0
EOF
cat > "$BIN/curl" <<'EOF'
#!/usr/bin/env bash
args="$*"
echo "curl $args" >> "$HR360_TEST_LOG"
url=""; for a in "$@"; do case "$a" in http://*|https://*|smtp://*|smtps://*) url="$a" ;; esac; done
case "$args" in
  *--mail-rcpt*)
    case "$args" in *":${FAKE_SMTP_BAD_PASSWORD:-__yok__}"*) echo "curl: (67) Login denied" >&2; exit 67 ;; esac
    [ "${FAKE_SMTP:-ok}" = ok ] || { echo "curl: (67) Login denied" >&2; exit 67; }
    exit 0 ;;
esac
case "$url" in
  *ipify*|*icanhazip*|*ifconfig.me*) echo "$FAKE_PUBLIC_IP" ;;
  *dns-query*|*dns.google/resolve*)
    name="$(printf '%s' "$url" | sed -E 's/.*name=([^&]*).*/\1/')"; type="${url##*type=}"
    if [ "$type" = A ]; then
      [ -n "${FAKE_DNS_A:-}" ] && printf '{"Status":0,"Answer":[{"name":"%s","type":1,"TTL":60,"data":"%s"}]}' "$name" "$FAKE_DNS_A" || echo '{"Status":3}'
    else
      [ -n "${FAKE_MX:-}" ] && printf '{"Status":0,"Answer":[{"name":"%s","type":15,"TTL":60,"data":"10 %s."}]}' "$name" "$FAKE_MX" || echo '{"Status":0}'
    fi ;;
  *acme-challenge*) echo ok ;;
  *openid-configuration)
    origin="$(grep '^PUBLIC_ORIGIN=' .env | tail -1 | cut -d= -f2-)"
    printf '{"issuer":"%s/auth/realms/hr360"}' "$origin" ;;
  *)
    case "$args" in
      *"%{http_code} %{redirect_url}"*)
        host="$(printf '%s' "$args" | sed -nE 's/.*Host: ([^ ]+).*/\1/p')"; printf '301 https://%s/' "$host" ;;
      *"%{http_code}"*) printf 200 ;;
    esac ;;
esac
exit 0
EOF
cat > "$BIN/crontab" <<'EOF'
#!/usr/bin/env bash
f="$HR360_TEST_CRON"
case "${1:-}" in -l) [ -s "$f" ] && cat "$f" || exit 1 ;; -) cat > "$f" ;; esac
EOF
cat > "$BIN/ufw" <<'EOF'
#!/usr/bin/env bash
echo "ufw $*" >> "$HR360_TEST_LOG"
if [ "${1:-}" = status ]; then
  echo "Status: active"; echo; echo "To                         Action      From"
  echo "22/tcp                     ALLOW       Anywhere"
  [ -n "${FAKE_UFW_WEB:-}" ] && { echo "80/tcp                     ALLOW       Anywhere"; echo "443                        ALLOW       Anywhere"; }
fi
exit 0
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/ss"
# Parolasiz sudo: komutu dogrudan calistirir (CI'da sudo kendi PATH'ini kullanmasin).
printf '#!/usr/bin/env bash\n[ "${1:-}" = -n ] && shift\nexec "$@"\n' > "$BIN/sudo"
# Zamanlayici cron'a dussun diye systemctl hep basarisiz.
printf '#!/usr/bin/env bash\nexit 1\n' > "$BIN/systemctl"
chmod +x "$BIN"/*

# Her senaryo temiz bir depo kopyasinda calisir.
new_copy() {
  local d="$WORK/repo-$1"; rm -rf "$d"; mkdir -p "$d"
  cp "$ROOT/install.sh" "$d/"
  cp -r "$ROOT/scripts" "$d/"
  mkdir -p "$d/deploy/keycloak" "$d/deploy/nginx/tls"
  cp "$ROOT/deploy/keycloak/realm-export.template.json" "$d/deploy/keycloak/"
  : > "$WORK/log-$1"; : > "$WORK/cron-$1"
  echo "$d"
}
run_in() { # run_in AD DIZIN [env...] -- komut...
  local name="$1" dir="$2"; shift 2
  (cd "$dir" && env PATH="$BIN:$PATH" HR360_TEST_LOG="$WORK/log-$name" HR360_TEST_CRON="$WORK/cron-$name" \
     HR360_SYSTEMD_DIR="$WORK/systemd" FAKE_PUBLIC_IP=203.0.113.10 "$@")
}
envv() { grep "^$2=" "$1/.env" | tail -1 | cut -d= -f2-; }
mkdir -p "$WORK/systemd"

echo "1) Komut satiri secenekleri"
d="$(new_copy opts)"
out="$(run_in opts "$d" ./install.sh --help 2>&1)"; rc=$?
check "--help calisir ve secenekleri listeler" eval '[ "$rc" = 0 ] && grep -q -- "--domain" <<< "$out" && grep -q -- "--smtp-from" <<< "$out"'
run_in opts "$d" ./install.sh --domain "kotu alan" --yes >/dev/null 2>&1; check "gecersiz alan adi reddedilir (2)" [ $? = 2 ]
run_in opts "$d" ./install.sh --domain hr.example.com --http-port 8080 --yes >/dev/null 2>&1; check "--domain ile 80 disi port reddedilir" [ $? = 2 ]
run_in opts "$d" ./install.sh --smtp-from ik@example.com --yes >/dev/null 2>&1; check "--yes ile parolasiz SMTP reddedilir" [ $? = 2 ]
run_in opts "$d" ./install.sh --bilinmeyen >/dev/null 2>&1; check "bilinmeyen secenek reddedilir" [ $? = 2 ]
check "secenek hatasinda .env yazilmaz" [ ! -f "$d/.env" ]

echo "2) Alan adi + Let's Encrypt + Google Workspace SMTP (soru sormadan)"
d="$(new_copy le)"
out="$(run_in le "$d" FAKE_DNS_A=203.0.113.10 FAKE_MX=aspmx.l.google.com FAKE_LE=ok \
        ./install.sh --domain hr.example.com --email admin@example.com --smtp-from ik@example.com \
        --smtp-password 'uygulama-sifresi' --yes 2>&1)"; rc=$?
check "kurulum basarili" [ "$rc" = 0 ]
check "adres https://hr.example.com" [ "$(envv "$d" PUBLIC_ORIGIN)" = https://hr.example.com ]
check "HTTP portu 80" [ "$(envv "$d" GATEWAY_PORT)" = 80 ]
check "TLS_MODE=letsencrypt" [ "$(envv "$d" TLS_MODE)" = letsencrypt ]
check "certbot yonetici e-postasiyla cagrildi" grep -q "certonly.*-d hr.example.com.*--email admin@example.com" "$WORK/log-le"
check "ufw'ye hicbir kural eklenmedi / devreye alinmadi" eval '! grep -Eq "ufw (allow|enable|deny|reject|delete|reset|disable)" "$WORK/log-le"'
check "ufw 80/443'u engelliyor: yalnizca uyari" grep -q "ufw calisiyor ve su portlara izin yok: 80 443/tcp" <<< "$out"
check "HSTS acik (guvenilir sertifika)" grep -q Strict-Transport-Security "$d/deploy/nginx/tls/listen.conf"
check "MX'ten Google bulundu: smtp.gmail.com:587" eval '[ "$(envv "$d" SMTP_HOST)" = "'\''smtp.gmail.com'\''" ] && [ "$(envv "$d" SMTP_PORT)" = 587 ]'
check "kullanici adi = gonderen adres" [ "$(envv "$d" SMTP_USER)" = "'ik@example.com'" ]
check "deneme e-postasi STARTTLS ile yoneticiye gitti" grep -q "smtp://smtp.gmail.com:587 --ssl-reqd --user ik@example.com:uygulama-sifresi --mail-from ik@example.com --mail-rcpt admin@example.com" "$WORK/log-le"
check "uyari alicisi = yonetici e-postasi" [ "$(envv "$d" ALERT_EMAIL_TO)" = admin@example.com ]
check "realm SMTP ayari dolduruldu" grep -q '"host" *: *"smtp.gmail.com"' "$d/deploy/keycloak/realm-export.json"
sa_secret="$(envv "$d" KEYCLOAK_TENANT_ADMIN_CLIENT_SECRET)"
check "Keycloak servis hesabi anahtari uretildi" [ "${#sa_secret}" -ge 32 ]
check "realm sablonunda servis hesabi anahtari dolduruldu" grep -q "\"secret\": \"${sa_secret}\"" "$d/deploy/keycloak/realm-export.json"
check "tenant-service'e master parola verilmez" eval 'grep -q "^KEYCLOAK_TENANT_ADMIN_LEGACY_PASSWORD=$" "$d/.env"'
check "servis hesabi ve parola politikasi Keycloak'a uygulandi" eval 'grep -q "hr360-tenant-admin" "$WORK/log-le" && grep -q "passwordPolicy" "$WORK/log-le"'
check "bekleyen yeniden deneme yok" eval '[ -z "$(envv "$d" TLS_LE_PENDING)" ] && [ ! -s "$WORK/cron-le" ]'
check "ozet: dogrulama tamam" eval 'grep -q "HTTPS:    calisiyor, sertifika gecerli" <<< "$out" && grep -q "Giris:    tamam" <<< "$out"'
check "ozet: deneme e-postasi gonderildi" grep -q "deneme e-postasi gonderildi: admin@example.com" <<< "$out"

echo "3) DNS hazir degil: gecici sertifika + saatlik yeniden deneme, DNS duzelince gecis"
d="$(new_copy dns)"
out="$(run_in dns "$d" FAKE_DNS_A=198.51.100.7 FAKE_LE=ok FAKE_UFW_WEB=1 \
        ./install.sh --domain hr.example.com --email admin@example.com --yes 2>&1)"; rc=$?
check "kurulum yine de tamamlandi" [ "$rc" = 0 ]
check "ufw 80/443'e izin veriyorsa uyari yok" eval '! grep -q "portlara izin yok" <<< "$out"'
check "DNS uyarisi dogru IP'yi soyluyor" grep -q "198.51.100.7; bu sunucu: 203.0.113.10" <<< "$out"
check "certbot hic cagrilmadi (limit korunur)" bash -c "! grep -q certonly '$WORK/log-dns'"
check "gecici kendinden imzali sertifikayla HTTPS acik" eval '[ "$(envv "$d" TLS_MODE)" = self-signed ] && [ -f "$d/deploy/nginx/tls/fullchain.pem" ]'
check "gecici sertifikada HSTS yok" bash -c "! grep -q Strict-Transport-Security '$d/deploy/nginx/tls/listen.conf'"
check "adres yine https" [ "$(envv "$d" PUBLIC_ORIGIN)" = https://hr.example.com ]
check "bekleyen Let's Encrypt kaydi" eval '[ "$(envv "$d" TLS_LE_PENDING)" = hr.example.com ] && [ "$(envv "$d" TLS_LE_EMAIL)" = admin@example.com ]'
check "saatlik cron gorevi kuruldu" grep -q "scripts/tls.sh retry .*# hr360-tls-retry$" "$WORK/cron-dns"
check "SMTP verilmedi -> Mailpit" [ "$(envv "$d" SMTP_HOST)" = "'mailpit'" ]
out="$(run_in dns "$d" FAKE_DNS_A=198.51.100.7 FAKE_LE=ok scripts/tls.sh retry 2>&1)"
check "DNS hala yanlis: retry certbot'u cagirmaz" grep -q "Henuz degil" <<< "$out"
out="$(run_in dns "$d" FAKE_DNS_A=203.0.113.10 FAKE_LE=fail scripts/tls.sh retry 2>&1)"
check "certbot basarisiz: gecici sertifika korunur" eval '[ "$(envv "$d" TLS_MODE)" = self-signed ] && [ -f "$d/deploy/nginx/tls/fullchain.pem" ] && [ -n "$(envv "$d" TLS_LE_PENDING)" ]'
out="$(run_in dns "$d" FAKE_DNS_A=203.0.113.10 FAKE_LE=ok scripts/tls.sh retry 2>&1)"
check "DNS duzeldi: Let's Encrypt'e gecildi" eval '[ "$(envv "$d" TLS_MODE)" = letsencrypt ] && grep -q "Let'\''s Encrypt sertifikasi alindi" <<< "$out"'
check "gecici sertifika dosyalari kaldirildi" [ ! -f "$d/deploy/nginx/tls/fullchain.pem" ]
check "bekleyen kayit ve cron gorevi temizlendi" eval '[ -z "$(envv "$d" TLS_LE_PENDING)" ] && ! grep -q hr360-tls-retry "$WORK/cron-dns"'
out="$(run_in dns "$d" scripts/tls.sh retry 2>&1)"
check "bekleyen yokken retry bir sey yapmaz" grep -q "Bekleyen Let's Encrypt denemesi yok" <<< "$out"

echo "4) SMTP denemesi basarisiz (--yes): ayar kaydedilir, ozette uyari"
d="$(new_copy smtpfail)"
out="$(run_in smtpfail "$d" FAKE_SMTP=fail ./install.sh --url http://10.0.0.5 --smtp-from ik@outlook.com \
        --smtp-password x --yes 2>&1)"; rc=$?
check "kurulum tamamlandi" [ "$rc" = 0 ]
check "Outlook sunucusu bulundu" [ "$(envv "$d" SMTP_HOST)" = "'smtp-mail.outlook.com'" ]
check "hata nedeni gosterildi" grep -q "kullanici adi / parola" <<< "$out"
check "ozette DENEME BASARISIZ" grep -q "E-posta (SMTP):   smtp-mail.outlook.com:587 (DENEME BASARISIZ" <<< "$out"
check "IP adresiyle HTTPS kapali, adres http" eval '[ "$(envv "$d" PUBLIC_ORIGIN)" = http://10.0.0.5 ] && [ -z "$(envv "$d" TLS_MODE)" ]'
check "yonetici e-postasi verilmedi -> uyari alicisi bos" [ -z "$(envv "$d" ALERT_EMAIL_TO)" ]

echo "5) Sorulu kurulum: yanlis parola -> yeniden sorulur -> dogru parola"
d="$(new_copy ask)"
answers=$'hr.example.com\n\nadmin@example.com\n\nik@sirket.com.tr\n\n\n\nyanlis\n\n1\n\n\n\ndogru\nIK Ekibi\n\n\n\n\n\n\n\n'
out="$(printf '%s' "$answers" | run_in ask "$d" FAKE_DNS_A=203.0.113.10 FAKE_LE=ok FAKE_MX=sirket-com-tr.mail.protection.outlook.com \
        FAKE_SMTP_BAD_PASSWORD=yanlis ./install.sh 2>&1)"; rc=$?
check "kurulum basarili" [ "$rc" = 0 ]
check "alan adi girilince port sorulmadi, Let's Encrypt secildi" eval '[ "$(envv "$d" GATEWAY_PORT)" = 80 ] && [ "$(envv "$d" TLS_MODE)" = letsencrypt ]'
check "MX'ten Microsoft 365 bulundu" grep -q "smtp.office365.com:587 (microsoft365)" <<< "$out"
check "Microsoft 365 ipucu gosterildi" grep -q "SMTP AUTH" <<< "$out"
check "ilk deneme hatali parolayla basarisiz" grep -q "SMTP denemesi basarisiz" <<< "$out"
check "ikinci denemede dogru parola kaydedildi" eval '[ "$(envv "$d" SMTP_PASSWORD)" = "'\''dogru'\''" ] && [ "$(envv "$d" SMTP_FROM_NAME)" = "'\''IK Ekibi'\''" ]'
check "iki deneme e-postasi denendi" [ "$(grep -c -- '--mail-rcpt admin@example.com' "$WORK/log-ask")" = 2 ]

echo "6) Gonderen adresten sunucu tahmini"
guess() { (cd "$ROOT" && PATH="$BIN:$PATH" HR360_TEST_LOG=/dev/null FAKE_MX="${2:-}" bash -c '. scripts/lib/net.sh; smtp_guess "$1"' _ "$1"); }
check "gmail.com" [ "$(guess a@gmail.com)" = "smtp.gmail.com 587 google" ]
check "hotmail.com" [ "$(guess a@hotmail.com)" = "smtp-mail.outlook.com 587 outlook" ]
check "yandex.com.tr" [ "$(guess a@yandex.com.tr)" = "smtp.yandex.com 465 yandex" ]
check "ozel alan + Yandex MX" [ "$(guess a@firma.com mx.yandex.net)" = "smtp.yandex.com 465 yandex" ]
check "ozel alan + Zoho MX" [ "$(guess a@firma.com mx.zoho.eu)" = "smtp.zoho.com 465 zoho" ]
check "ozel alan, bilinmeyen MX" [ "$(guess a@firma.com mail.firma.com)" = "smtp.firma.com 587 bilinmiyor" ]

echo "7) Kurulumdan sonra: scripts/smtp.sh set --from (sunucu adresten bulunur)"
d="$(new_copy smtpset)"
printf "SMTP_HOST='mailpit'\nSMTP_PORT=1025\n" > "$d/.env"
out="$(run_in smtpset "$d" FAKE_MX=aspmx.l.google.com scripts/smtp.sh set --from ik@firma.com --password 'abc' 2>&1)"; rc=$?
check "ayar uygulandi" [ "$rc" = 0 ]
check "Google Workspace sunucusu ve kullanici adi" eval '[ "$(envv "$d" SMTP_HOST)" = "'\''smtp.gmail.com'\''" ] && [ "$(envv "$d" SMTP_USER)" = "'\''ik@firma.com'\''" ]'

echo "8) Guncelleme yolu: mevcut .env korunur, --domain ve --keycloak-admin uygulanir"
d="$(new_copy upd)"
cp "$WORK/repo-smtpfail/.env" "$d/.env"
# Eski kurulum: servis hesabi anahtari yok (Guvenlik dalgasi 2A oncesi).
sed -i '/^KEYCLOAK_TENANT_ADMIN_/d' "$d/.env"
secret_before="$(envv "$d" TENANT_SECRET_KEY)"
out="$(run_in upd "$d" FAKE_DNS_A=203.0.113.10 FAKE_LE=ok ./install.sh --domain hr.example.com --email admin@example.com \
        --tls letsencrypt --keycloak-admin ip:198.51.100.0/24 --yes 2>&1)"; rc=$?
check "guncelleme basarili" [ "$rc" = 0 ]
check "guncelleme yolu secildi, sirlar korundu" eval 'grep -q "Mevcut .env korunuyor" <<< "$out" && [ "$(envv "$d" TENANT_SECRET_KEY)" = "$secret_before" ]'
check "adres https://hr.example.com oldu" [ "$(envv "$d" PUBLIC_ORIGIN)" = https://hr.example.com ]
check "Let's Encrypt yonetici e-postasiyla istendi" grep -q "certonly.*-d hr.example.com.*--email admin@example.com" "$WORK/log-upd"
check "Keycloak paneli IP listesine kisitlandi" eval '[ "$(envv "$d" KEYCLOAK_ADMIN_MODE)" = ip ] && [ "$(envv "$d" KEYCLOAK_ADMIN_ALLOWED_IPS)" = 198.51.100.0/24 ]'
check "ufw'ye dokunulmadi" eval '! grep -Eq "ufw (allow|enable|deny|reject|delete|reset|disable)" "$WORK/log-upd"'
check "eski kurulumda servis hesabi olusturuldu, master parola geri donusu kapandi" eval '[ "$(envv "$d" KEYCLOAK_TENANT_ADMIN_CLIENT_SECRET | wc -c)" -ge 33 ] && grep -q "^KEYCLOAK_TENANT_ADMIN_LEGACY_USER=$" "$d/.env" && grep -q "hr360-tenant-admin" "$WORK/log-upd"'
check "servis hesabiyla master kaba kuvvet korumasi acilir" grep -q 'BF=true' "$WORK/log-upd"

echo ""
if [ "$FAILS" = 0 ]; then echo "Tum kurulum testleri gecti."; else echo "$FAILS test basarisiz."; fi
[ "$FAILS" = 0 ]
