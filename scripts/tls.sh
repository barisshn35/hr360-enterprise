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
unset PUBLIC_URL PUBLIC_ORIGIN GATEWAY_TLS_BIND GATEWAY_TLS_PORT GATEWAY_PORT KEYCLOAK_ADMIN_MODE KEYCLOAK_ADMIN_ALLOWED_IPS KEYCLOAK_ADMIN_BIND KEYCLOAK_ADMIN_PORT KEYCLOAK_ADMIN_URL

ENV_FILE=.env
DIR=deploy/nginx/tls
die() { echo "HATA: $*" >&2; exit 1; }
[ -f "$ENV_FILE" ] || die ".env bulunamadi; once install.sh calistirin."
mkdir -p "$DIR"

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

cmd="${1:-status}"; shift || true
case "$cmd" in
  enable)
    cert=""; key=""; host=""; port=443; self=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --cert) cert="$2"; shift 2 ;;
        --key) key="$2"; shift 2 ;;
        --host) host="$2"; shift 2 ;;
        --port) port="$2"; shift 2 ;;
        --self-signed) self=1; shift ;;
        *) die "bilinmeyen secenek: $1" ;;
      esac
    done
    [ -n "$host" ] || die "--host zorunlu (tarayicida kullanilacak alan adi)"
    [[ "$host" =~ ^[A-Za-z0-9.-]+$ ]] || die "gecersiz alan adi: $host"
    [[ "$port" =~ ^[0-9]+$ ]] || die "gecersiz port: $port"
    if [ "$self" = 1 ]; then
      openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=$host" \
        -addext "subjectAltName=DNS:$host" \
        -keyout "$DIR/privkey.pem" -out "$DIR/fullchain.pem" >/dev/null 2>&1 \
        || die "sertifika uretilemedi"
      echo "Kendinden imzali sertifika uretildi ($host, 365 gun)."
    else
      [ -f "$cert" ] && [ -f "$key" ] || die "--cert ve --key dosyalari bulunamadi"
      cp "$cert" "$DIR/fullchain.pem"; cp "$key" "$DIR/privkey.pem"
    fi
    chmod 600 "$DIR/privkey.pem"
    openssl x509 -in "$DIR/fullchain.pem" -noout >/dev/null 2>&1 || die "sertifika okunamadi"

    cat > "$DIR/listen.conf" <<'EOF'
# scripts/tls.sh tarafindan uretildi.
listen 443 ssl;
ssl_certificate     /etc/nginx/tls/fullchain.pem;
ssl_certificate_key /etc/nginx/tls/privkey.pem;
ssl_protocols       TLSv1.2 TLSv1.3;
ssl_session_cache   shared:tls:10m;
EOF
    cat > "$DIR/redirect.conf" <<'EOF'
# scripts/tls.sh tarafindan uretildi: duz HTTP istekleri HTTPS'e yonlendirilir.
if ($scheme = http) {
    return 301 https://$host$request_uri;
}
EOF
    if [ "$port" = "443" ]; then origin="https://$host"; else origin="https://$host:$port"; fi
    set_env GATEWAY_TLS_BIND 0.0.0.0
    set_env GATEWAY_TLS_PORT "$port"
    set_env PUBLIC_URL "https://$host"
    set_env PUBLIC_ORIGIN "$origin"
    apply_all
    configure_keycloak "$origin" external
    refresh_admin_access
    echo "HTTPS acik: $origin"
    ;;
  disable)
    rm -f "$DIR/listen.conf" "$DIR/redirect.conf"
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
      echo "HTTPS: acik ($(get_env PUBLIC_ORIGIN))"
      openssl x509 -in "$DIR/fullchain.pem" -noout -subject -enddate 2>/dev/null | sed 's/^/  /'
    else
      echo "HTTPS: kapali ($(get_env PUBLIC_ORIGIN))"
    fi
    ;;
  *) die "kullanim: $0 enable|disable|status" ;;
esac
