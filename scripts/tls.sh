#!/usr/bin/env bash
# Gateway'de HTTPS (TLS) acar/kapatir.
#
# Kullanim:
#   scripts/tls.sh enable --cert fullchain.pem --key privkey.pem --host hr.sirket.com [--port 443]
#       Verilen sertifikayla 443'te HTTPS acar, HTTP istekleri HTTPS'e yonlendirilir.
#       Uygulamanin adresi (PUBLIC_URL/PUBLIC_ORIGIN) https://<host> olur; Keycloak'in
#       genel adresi, uygulama istemcisinin yonlendirme adresleri ve servislerin
#       beklenen jeton ureticisi (issuer) buna gore guncellenir. Realm'de "SSL gerekli:
#       dis istekler" (sslRequired=external) acilir.
#
#   scripts/tls.sh enable --letsencrypt --host hr.sirket.com [--email it@sirket.com] [--staging]
#       Let's Encrypt'ten ucretsiz sertifika alir (HTTP-01, gateway uzerinden) ve
#       otomatik yenilemeyi acar (certbot servisi, 12 saatte bir kontrol; gateway
#       yeni sertifikayi en gec 6 saatte okur). Kosullar: alan adinin DNS kaydi bu
#       sunucuyu gostermeli, 80/tcp internetten erisilebilir olmali, GATEWAY_PORT=80.
#       --staging: Let's Encrypt test ortami (tarayici guvenmez; limitlere takilmadan deneme).
#
#   scripts/tls.sh enable --self-signed --host hr.sirket.local
#       Test icin kendinden imzali sertifika uretir (tarayici uyari verir).
#
#   scripts/tls.sh disable
#       HTTPS'i kapatir, adres http://<host>[:GATEWAY_PORT] olur.
#
#   scripts/tls.sh status
#
# NOT: Gateway'in onunde TLS'i zaten sonlandiran bir yuk dengeleyici varsa bu betigi
# KULLANMAYIN (HTTP->HTTPS yonlendirmesi donguye girer); bunun yerine .env'de
# PUBLIC_ORIGIN'i https://... yapip "docker compose up -d" calistirin.
set -euo pipefail
cd "$(dirname "$0")/.."
# Docker Compose kabuktaki degiskenleri .env'e tercih eder; kabukta eski degerler
# (orn. "set -a; . ./.env") kalmissa yeni ayar uygulanmaz. Yonetilen degiskenler temizlenir.
unset PUBLIC_URL PUBLIC_ORIGIN GATEWAY_TLS_BIND GATEWAY_TLS_PORT GATEWAY_PORT KEYCLOAK_ADMIN_MODE KEYCLOAK_ADMIN_ALLOWED_IPS KEYCLOAK_ADMIN_BIND KEYCLOAK_ADMIN_PORT KEYCLOAK_ADMIN_URL COMPOSE_PROFILES TLS_MODE

ENV_FILE=.env
DIR=deploy/nginx/tls
LE_DIR=deploy/letsencrypt
ACME_DIR=deploy/nginx/acme
die() { echo "HATA: $*" >&2; exit 1; }
[ -f "$ENV_FILE" ] || die ".env bulunamadi; once install.sh calistirin."
mkdir -p "$DIR" "$LE_DIR" "$ACME_DIR"

set_env() {
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s#^$1=.*#$1=$2#" "$ENV_FILE"
  else printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; fi
}
get_env() { grep "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }

wait_keycloak() {
  echo "Keycloak hazir olana kadar bekleniyor..."
  for _ in $(seq 1 80); do
    docker compose exec -T keycloak sh -c 'exec 3<>/dev/tcp/127.0.0.1/8080' >/dev/null 2>&1 && return 0
    sleep 3
  done
  die "Keycloak ayaga kalkmadi"
}

# Keycloak realm ayarlari: istemci adresleri ve sslRequired.
configure_keycloak() {
  local origin="$1" ssl="$2"
  docker compose exec -T -e ORIGIN="$origin" -e SSL="$ssl" keycloak sh -c '
    K=/opt/keycloak/bin/kcadm.sh; C=/tmp/kcadm-tls.config
    for i in $(seq 1 30); do
      $K config credentials --config $C --server http://127.0.0.1:8080/auth --realm master \
        --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null 2>&1 && break
      sleep 3
    done
    CID=$($K get clients -r hr360 -q clientId=hr360-web --fields id --format csv --noquotes --config $C)
    $K update clients/$CID -r hr360 --config $C \
      -s "redirectUris=[\"$ORIGIN/*\"]" -s "webOrigins=[\"$ORIGIN\"]" \
      -s "attributes.\"post.logout.redirect.uris\"=$ORIGIN/*"
    $K update realms/hr360 --config $C -s "sslRequired=$SSL"
    rm -f $C
  ' || die "Keycloak ayarlari guncellenemedi"
}

apply_all() {
  echo "Servisler yeni adresle guncelleniyor..."
  docker compose up -d >/dev/null 2>&1
  docker compose exec -T gateway nginx -t >/dev/null 2>&1 || die "nginx yapilandirmasi gecersiz"
  docker compose exec -T gateway nginx -s reload >/dev/null 2>&1
  wait_keycloak
}

# Yonetim paneli ayri porttaysa (port modu) onun adresi de yeni kokene gore uretilir.
refresh_admin_access() {
  local mode; mode="$(get_env KEYCLOAK_ADMIN_MODE)"
  if [ "$mode" = "port" ]; then
    scripts/keycloak-admin-access.sh port "$(get_env KEYCLOAK_ADMIN_ALLOWED_IPS)"
  fi
}

# Duz HTTP istekleri HTTPS'e yonlendirilir; Let's Encrypt dogrulama yolu haric
# (yenileme sirasinda da HTTP'den sunulabilsin).
write_redirect() {
  cat > "$DIR/redirect.conf" <<'EOF'
# scripts/tls.sh tarafindan uretildi: duz HTTP istekleri HTTPS'e yonlendirilir.
set $hr360_to_https "";
if ($scheme = http) { set $hr360_to_https 1; }
if ($uri ~ ^/\.well-known/acme-challenge/) { set $hr360_to_https ""; }
if ($hr360_to_https = 1) {
    return 301 https://$host$request_uri;
}
EOF
}

# Let's Encrypt: gateway 80'de dogrulama yolunu sunarken certbot ile sertifika alir.
# Sertifika deploy/letsencrypt/live/<host>/ altina yazilir.
letsencrypt_issue() {
  local host="$1" email="$2" staging="$3"
  if [[ ! "$host" =~ [A-Za-z] ]] || [[ "$host" != *.* ]] || [ "$host" = localhost ]; then
    die "Let's Encrypt icin gercek bir alan adi gerekli (IP/localhost olmaz): $host"
  fi
  local gport; gport="$(get_env GATEWAY_PORT)"
  if [ -n "$gport" ] && [ "$gport" != 80 ]; then
    die "Let's Encrypt dogrulamasi 80. porttan yapilir; GATEWAY_PORT=$gport. .env'de GATEWAY_PORT=80 yapin."
  fi

  echo "Gateway dogrulama yolu hazirlaniyor..."
  docker compose up -d gateway >/dev/null 2>&1
  docker compose exec -T gateway nginx -s reload >/dev/null 2>&1 || true
  local probe="hr360-probe-$$"
  mkdir -p "$ACME_DIR/.well-known/acme-challenge"
  echo ok > "$ACME_DIR/.well-known/acme-challenge/$probe"
  local got=""
  for _ in $(seq 1 10); do
    got="$(curl -s "http://127.0.0.1/.well-known/acme-challenge/$probe" || true)"
    [ "$got" = ok ] && break
    sleep 2
  done
  rm -f "$ACME_DIR/.well-known/acme-challenge/$probe"
  [ "$got" = ok ] || die "gateway dogrulama dosyasini sunamiyor (http://127.0.0.1/.well-known/acme-challenge/)"

  local args=(certonly --webroot -w /var/www/certbot -d "$host" --agree-tos --non-interactive
              --keep-until-expiring --cert-name "$host")
  if [ -n "$email" ]; then args+=(--email "$email"); else args+=(--register-unsafely-without-email); fi
  if [ "$staging" = 1 ]; then args+=(--test-cert); fi
  # Ozel/kurumsal ACME sunucusu veya test icin ek certbot argumanlari
  # (orn. CERTBOT_EXTRA_ARGS="--server https://acme.sirket.local/directory").
  if [ -n "${CERTBOT_EXTRA_ARGS:-}" ]; then read -ra extra <<< "$CERTBOT_EXTRA_ARGS"; args+=("${extra[@]}"); fi
  echo "Let's Encrypt'ten sertifika isteniyor ($host)..."
  if ! docker compose --profile letsencrypt run --rm --no-deps --entrypoint certbot certbot "${args[@]}"; then
    die "Let's Encrypt sertifikasi alinamadi. Kontrol edin: $host DNS kaydi bu sunucunun genel IP'sini gosteriyor mu, 80/tcp internetten (firewall/guvenlik grubu) acik mi?"
  fi
  [ -f "$LE_DIR/live/$host/fullchain.pem" ] || die "sertifika dosyasi bulunamadi: $LE_DIR/live/$host/"
}

cmd="${1:-status}"; shift || true
case "$cmd" in
  enable)
    cert=""; key=""; host=""; port=443; self=0; le=0; email=""; staging=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --cert) cert="$2"; shift 2 ;;
        --key) key="$2"; shift 2 ;;
        --host) host="$2"; shift 2 ;;
        --port) port="$2"; shift 2 ;;
        --self-signed) self=1; shift ;;
        --letsencrypt) le=1; shift ;;
        --email) email="$2"; shift 2 ;;
        --staging) staging=1; shift ;;
        *) die "bilinmeyen secenek: $1" ;;
      esac
    done
    [ -n "$host" ] || die "--host zorunlu (tarayicida kullanilacak alan adi)"
    [[ "$host" =~ ^[A-Za-z0-9.-]+$ ]] || die "gecersiz alan adi: $host"
    [[ "$port" =~ ^[0-9]+$ ]] || die "gecersiz port: $port"
    if [ -n "$email" ] && [[ ! "$email" =~ ^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$ ]]; then
      die "gecersiz e-posta: $email"
    fi
    if [ "$le" = 1 ]; then
      letsencrypt_issue "$host" "$email" "$staging"
      certfile="/etc/letsencrypt/live/$host/fullchain.pem"; keyfile="/etc/letsencrypt/live/$host/privkey.pem"
      # Kendi/kendinden imzali sertifikadan kalan dosyalar kullanilmaz.
      rm -f "$DIR/fullchain.pem" "$DIR/privkey.pem"
    elif [ "$self" = 1 ]; then
      openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=$host" \
        -addext "subjectAltName=DNS:$host" \
        -keyout "$DIR/privkey.pem" -out "$DIR/fullchain.pem" >/dev/null 2>&1 \
        || die "sertifika uretilemedi"
      echo "Kendinden imzali sertifika uretildi ($host, 365 gun)."
    else
      [ -f "$cert" ] && [ -f "$key" ] || die "--cert ve --key dosyalari bulunamadi"
      cp "$cert" "$DIR/fullchain.pem"; cp "$key" "$DIR/privkey.pem"
    fi
    if [ "$le" != 1 ]; then
      chmod 600 "$DIR/privkey.pem"
      openssl x509 -in "$DIR/fullchain.pem" -noout >/dev/null 2>&1 || die "sertifika okunamadi"
      certfile=/etc/nginx/tls/fullchain.pem; keyfile=/etc/nginx/tls/privkey.pem
    fi

    cat > "$DIR/listen.conf" <<EOF
# scripts/tls.sh tarafindan uretildi.
listen 443 ssl;
ssl_certificate     ${certfile};
ssl_certificate_key ${keyfile};
ssl_protocols       TLSv1.2 TLSv1.3;
ssl_session_cache   shared:tls:10m;
EOF
    write_redirect
    if [ "$port" = "443" ]; then origin="https://$host"; else origin="https://$host:$port"; fi
    set_env GATEWAY_TLS_BIND 0.0.0.0
    set_env GATEWAY_TLS_PORT "$port"
    set_env PUBLIC_URL "https://$host"
    set_env PUBLIC_ORIGIN "$origin"
    if [ "$le" = 1 ]; then
      # Otomatik yenileme servisi (certbot) "docker compose up -d" ile birlikte kalkar.
      set_env COMPOSE_PROFILES letsencrypt
      set_env TLS_MODE letsencrypt
    else
      set_env COMPOSE_PROFILES ""
      set_env TLS_MODE "$([ "$self" = 1 ] && echo self-signed || echo certificate)"
      docker compose --profile letsencrypt rm -sf certbot >/dev/null 2>&1 || true
    fi
    apply_all
    configure_keycloak "$origin" external
    refresh_admin_access
    echo "HTTPS acik: $origin"
    ;;
  disable)
    rm -f "$DIR/listen.conf" "$DIR/redirect.conf"
    set_env COMPOSE_PROFILES ""
    set_env TLS_MODE ""
    docker compose --profile letsencrypt rm -sf certbot >/dev/null 2>&1 || true
    host="$(get_env PUBLIC_URL | sed -E 's#^https?://([^/:]+).*#\1#')"; [ -n "$host" ] || host=localhost
    gport="$(get_env GATEWAY_PORT)"
    if [ -z "$gport" ] || [ "$gport" = 80 ]; then origin="http://$host"; else origin="http://$host:$gport"; fi
    set_env GATEWAY_TLS_BIND 127.0.0.1
    set_env PUBLIC_URL "http://$host"
    set_env PUBLIC_ORIGIN "$origin"
    apply_all
    # Duz HTTP'de disaridan (genel IP) giris icin sslRequired=none gerekir; yerel/ozel
    # ag adresleri "external" ile de calisir. Uretimde HTTPS kullanin.
    configure_keycloak "$origin" none
    refresh_admin_access
    echo "HTTPS kapali: $origin"
    ;;
  status)
    if [ -f "$DIR/listen.conf" ]; then
      echo "HTTPS: acik ($(get_env PUBLIC_ORIGIN)) - $(get_env TLS_MODE)"
      crt="$DIR/fullchain.pem"
      if [ "$(get_env TLS_MODE)" = letsencrypt ]; then
        h="$(get_env PUBLIC_URL | sed -E 's#^https?://([^/:]+).*#\1#')"
        crt="$LE_DIR/live/$h/fullchain.pem"
        if docker compose ps --status running -q certbot 2>/dev/null | grep -q .; then
          echo "  Otomatik yenileme: calisiyor"
        else
          echo "  Otomatik yenileme: CALISMIYOR (docker compose up -d)"
        fi
      fi
      openssl x509 -in "$crt" -noout -subject -enddate 2>/dev/null | sed 's/^/  /'
    else
      echo "HTTPS: kapali ($(get_env PUBLIC_ORIGIN))"
    fi
    ;;
  *) die "kullanim: $0 enable|disable|status" ;;
esac
