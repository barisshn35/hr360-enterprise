#!/usr/bin/env bash
# Keycloak yonetim paneline (ve master realm'e) erisimi ayarlar.
#
# Kullanim:
#   scripts/keycloak-admin-access.sh open
#       Varsayilan. Panel ana adreste herkese acik (PUBLIC_URL/auth/admin).
#
#   scripts/keycloak-admin-access.sh ip 203.0.113.10,10.20.0.0/16
#       Panel ana adreste yalnizca verilen IP/CIDR'lere acik (nginx allow/deny).
#       Digerleri 403 alir. Uygulama girisi (hr360 realm) etkilenmez.
#
#   scripts/keycloak-admin-access.sh port [IP/CIDR,...]
#       Panel ana adreste TAMAMEN kapali; yalnizca ayri porttan
#       (KEYCLOAK_ADMIN_PORT, varsayilan 8090) yayinlanir. Bu portu firewall ile
#       yonetim IP'lerine acin (ornekler: docs/runbooks/keycloak-yonetim-paneli-erisimi.md).
#       IP listesi verilirse nginx ayrica o portta da kisitlar (iki katman).
#
#   scripts/keycloak-admin-access.sh status
#       Gecerli ayari gosterir.
#
# Ayar .env'e (KEYCLOAK_ADMIN_MODE, KEYCLOAK_ADMIN_ALLOWED_IPS, KEYCLOAK_ADMIN_BIND,
# KEYCLOAK_ADMIN_URL) yazilir; nginx kurali deploy/nginx/keycloak-admin/ altina
# uretilir ve gerekli konteynerler guncellenir.
#
# NOT: nginx istemci IP'sini dogrudan baglantidan ($remote_addr) alir. Gateway'in
# onunde baska bir yuk dengeleyici/ters vekil varsa kisit o cihazda yapilmali ya da
# nginx'te real_ip modulu yapilandirilmalidir; aksi halde herkes dengeleyicinin IP'si
# gibi gorunur.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=.env
DIR=deploy/nginx/keycloak-admin
MAIN="$DIR/main-access.conf"
PORT_FILE="$DIR/port-access.conf"

die() { echo "HATA: $*" >&2; exit 1; }
[ -f "$ENV_FILE" ] || die ".env bulunamadi; once install.sh calistirin."
mkdir -p "$DIR"

set_env() { # set_env KEY VALUE
  local k="$1" v="$2"
  if grep -q "^${k}=" "$ENV_FILE"; then
    sed -i "s#^${k}=.*#${k}=${v}#" "$ENV_FILE"
  else
    printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"
  fi
}
get_env() { grep "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }

# IP/CIDR listesini dogrula ve nginx allow satirlarina cevir.
allow_lines() {
  local list="$1" out="" item
  IFS=',' read -ra items <<< "$list"
  for item in "${items[@]}"; do
    item="$(echo "$item" | tr -d '[:space:]')"
    [ -z "$item" ] && continue
    if [[ ! "$item" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?$ ]] \
       && [[ ! "$item" =~ ^[0-9a-fA-F:]+(/[0-9]{1,3})?$ ]]; then
      die "gecersiz IP/CIDR: '$item'"
    fi
    out+="allow ${item};"$'\n'
  done
  [ -n "$out" ] || die "en az bir IP/CIDR verin"
  printf '%s' "$out"
}

header="# scripts/keycloak-admin-access.sh tarafindan uretildi - elle degistirmeyin."

public_origin() {
  local o; o="$(get_env PUBLIC_ORIGIN)"
  [ -n "$o" ] || o="$(get_env PUBLIC_URL)"
  [ -n "$o" ] || o="http://localhost"
  echo "${o%/}"
}

apply() {
  echo "Gateway ve Keycloak guncelleniyor..."
  docker compose up -d keycloak gateway >/dev/null 2>&1
  # Kural dosyasi degistiginde gateway konteyneri yeniden olusmayabilir; nginx'e
  # yeni kurali okutmak icin once dogrula, sonra yeniden yukle.
  docker compose exec -T gateway nginx -t >/dev/null 2>&1 || die "nginx kurali gecersiz; degisiklik uygulanmadi"
  docker compose exec -T gateway nginx -s reload >/dev/null 2>&1
  echo "Tamam. Keycloak yeniden basladiktan sonra (yaklasik 30 sn) gecerli olur."
}

# master realm (yonetici girisi) hangi adresten sunulsun. Port modunda yonetim
# portuna cevrilir; aksi halde yonetim konsolu girisi ana adresteki master realm'e
# gider ve orasi kapali oldugu icin giris ekrani hic acilmaz. Bos = ana adres.
set_master_frontend() {
  local url="$1"
  echo "Keycloak hazir olana kadar bekleniyor..."
  for _ in $(seq 1 60); do
    docker compose exec -T keycloak sh -c 'exec 3<>/dev/tcp/127.0.0.1/8080' >/dev/null 2>&1 && break
    sleep 3
  done
  docker compose exec -T -e URL="$url" keycloak sh -c '
    K=/opt/keycloak/bin/kcadm.sh; C=/tmp/kcadm-access.config
    for i in $(seq 1 30); do
      $K config credentials --config $C --server http://127.0.0.1:8080/auth --realm master \
        --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null 2>&1 && break
      sleep 3
    done
    $K update realms/master --config $C -s "attributes.frontendUrl=$URL" && rm -f $C
  ' || die "master realm adresi guncellenemedi"
}

mode="${1:-status}"
case "$mode" in
  open)
    rm -f "$MAIN"
    printf '%s\ndeny all;\n' "$header" > "$PORT_FILE"
    set_env KEYCLOAK_ADMIN_MODE open
    set_env KEYCLOAK_ADMIN_ALLOWED_IPS ""
    set_env KEYCLOAK_ADMIN_BIND 127.0.0.1
    set_env KEYCLOAK_ADMIN_URL ""
    apply
    set_master_frontend ""
    echo "Yonetim paneli: $(public_origin)/auth/admin/ (herkese acik)"
    ;;
  ip)
    ips="${2:-}"; [ -n "$ips" ] || die "kullanim: $0 ip <IP/CIDR,...>"
    lines="$(allow_lines "$ips")"
    printf '%s\n%sdeny all;\n' "$header" "$lines" > "$MAIN"
    printf '%s\ndeny all;\n' "$header" > "$PORT_FILE"
    set_env KEYCLOAK_ADMIN_MODE ip
    set_env KEYCLOAK_ADMIN_ALLOWED_IPS "$ips"
    set_env KEYCLOAK_ADMIN_BIND 127.0.0.1
    set_env KEYCLOAK_ADMIN_URL ""
    apply
    set_master_frontend ""
    echo "Yonetim paneli: $(public_origin)/auth/admin/ (yalnizca: $ips)"
    ;;
  port)
    ips="${2:-}"
    printf '%s\ndeny all;\n' "$header" > "$MAIN"
    if [ -n "$ips" ]; then
      lines="$(allow_lines "$ips")"
      printf '%s\n%sdeny all;\n' "$header" "$lines" > "$PORT_FILE"
    else
      printf '%s\n# IP kisiti firewall ile yapiliyor.\n' "$header" > "$PORT_FILE"
    fi
    port="$(get_env KEYCLOAK_ADMIN_PORT)"; [ -n "$port" ] || port=8090
    origin="$(public_origin)"
    # Yonetim konsolunun adresi: ana kokenin port'suz hali + yonetim portu.
    admin_origin="$(echo "$origin" | sed -E 's#^(https?://[^/:]+)(:[0-9]+)?.*$#\1#'):${port}"
    set_env KEYCLOAK_ADMIN_MODE port
    set_env KEYCLOAK_ADMIN_ALLOWED_IPS "$ips"
    set_env KEYCLOAK_ADMIN_PORT "$port"
    set_env KEYCLOAK_ADMIN_BIND 0.0.0.0
    set_env KEYCLOAK_ADMIN_URL "${admin_origin}/auth"
    apply
    set_master_frontend "${admin_origin}/auth"
    echo "Yonetim paneli: ${admin_origin}/auth/admin/  (ana adreste kapali)"
    echo "Simdi ${port}/tcp portunu firewall'da yalnizca yonetim IP'lerine acin."
    ;;
  status)
    echo "Mod:        $(get_env KEYCLOAK_ADMIN_MODE || true) (bos = open)"
    echo "Izinli IP:  $(get_env KEYCLOAK_ADMIN_ALLOWED_IPS || true)"
    p="$(get_env KEYCLOAK_ADMIN_PORT)"; b="$(get_env KEYCLOAK_ADMIN_BIND)"
    echo "Yonetim portu: ${b:-127.0.0.1}:${p:-8090}"
    echo "Konsol adresi: $(get_env KEYCLOAK_ADMIN_URL || true)"
    ;;
  *)
    die "bilinmeyen mod '$mode' (open | ip | port | status)"
    ;;
esac
