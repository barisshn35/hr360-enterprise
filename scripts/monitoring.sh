#!/usr/bin/env bash
# Izleme yiginini (Prometheus + Grafana + Loki/Promtail + exporter'lar) yonetir.
#
# Kullanim:
#   scripts/monitoring.sh enable     Yigini kurar ve baslatir; Grafana sifresini uretir.
#   scripts/monitoring.sh disable    Konteynerleri durdurur (veriler volume'larda kalir).
#   scripts/monitoring.sh status     Hedeflerin ve alarmlarin ozetini gosterir.
#   scripts/monitoring.sh password   Grafana yonetici sifresini gosterir.
#   scripts/monitoring.sh purge      Durdurur ve metrik/log verilerini siler.
#
# Erisim:
#   Grafana     PUBLIC_ORIGIN/grafana/  (gateway uzerinden, Grafana girisi ister)
#               ya da sunucunun kendisinden http://127.0.0.1:3000/grafana/
#   Prometheus  yalnizca sunucunun kendisinden: http://127.0.0.1:9090
#               (disariya acmak icin SSH tuneli: ssh -L 9090:127.0.0.1:9090 sunucu)
#
# "monitoring" profili .env'deki COMPOSE_PROFILES listesine eklenir; boylece
# sonraki "docker compose up -d" cagrilari da yigini ayakta tutar.
set -euo pipefail

cd "$(dirname "$0")/.."
unset COMPOSE_PROFILES GRAFANA_ADMIN_PASSWORD
ENV_FILE=.env
SERVICES=(prometheus postgres-exporter node-exporter loki promtail grafana)

sed_i() { if sed --version >/dev/null 2>&1; then sed -i "$@"; else sed -i '' "$@"; fi; }
die() { echo "HATA: $*" >&2; exit 1; }
[ -f "$ENV_FILE" ] || die ".env bulunamadi; once install.sh calistirin."

if ! declare -F docker >/dev/null && ! docker info >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
  docker() { command sudo docker "$@"; }
fi

set_env() {
  if grep -q "^$1=" "$ENV_FILE"; then sed_i "s#^$1=.*#$1=$2#" "$ENV_FILE"
  else printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; fi
}
get_env() { grep "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
profile_set() { # profile_set NAME on|off  (diger profiller korunur)
  local cur out=""
  cur="$(get_env COMPOSE_PROFILES)"
  for p in ${cur//,/ }; do [ "$p" = "$1" ] || out="${out:+$out,}$p"; done
  [ "$2" = on ] && out="${out:+$out,}$1"
  set_env COMPOSE_PROFILES "$out"
}
gen_password() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24 || true; }
origin() { local o; o="$(get_env PUBLIC_ORIGIN)"; [ -n "$o" ] || o="$(get_env PUBLIC_URL)"; echo "${o:-http://localhost}"; }

wait_http() { # wait_http SERVICE PATH PORT
  local i
  for i in $(seq 1 60); do
    if docker compose exec -T "$1" wget -qO- "http://127.0.0.1:$3$2" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

cmd="${1:-status}"
case "$cmd" in
  enable)
    if [ -z "$(get_env GRAFANA_ADMIN_PASSWORD)" ]; then
      set_env GRAFANA_ADMIN_PASSWORD "$(gen_password)"
    fi
    profile_set monitoring on
    docker compose --profile monitoring up -d "${SERVICES[@]}"
    # Gateway'in /grafana/ yolu yeni konteyneri hemen bulsun.
    docker compose exec -T gateway nginx -s reload >/dev/null 2>&1 || true
    printf 'Grafana bekleniyor'
    if wait_http grafana /api/health 3000; then echo " hazir."; else echo " (zaman asimi; 'docker compose logs grafana' ile bakin)"; fi
    # Grafana sifresi yalnizca ilk acilista ortam degiskeninden alinir; .env'deki
    # sifre sonradan degistiyse veritabanindakiyle esitlenir.
    docker compose exec -T grafana grafana cli --homepath /usr/share/grafana admin reset-admin-password "$(get_env GRAFANA_ADMIN_PASSWORD)" >/dev/null 2>&1 || true
    echo
    echo "Grafana:    $(origin)/grafana/   (kullanici: admin, sifre: scripts/monitoring.sh password)"
    echo "Prometheus: http://127.0.0.1:9090 (yalnizca sunucudan)"
    echo "Pano:       HR360 > HR360 — Servis sagligi"
    ;;
  disable)
    profile_set monitoring off
    docker compose --profile monitoring stop "${SERVICES[@]}" >/dev/null
    docker compose --profile monitoring rm -f "${SERVICES[@]}" >/dev/null
    echo "Izleme durduruldu. Veriler korunuyor (silmek icin: scripts/monitoring.sh purge)."
    ;;
  purge)
    "$0" disable
    for v in prometheus-data grafana-data loki-data; do
      docker volume rm "hr360_$v" >/dev/null 2>&1 && echo "silindi: hr360_$v" || true
    done
    ;;
  password)
    p="$(get_env GRAFANA_ADMIN_PASSWORD)"
    [ -n "$p" ] || die "Izleme henuz etkinlestirilmedi (scripts/monitoring.sh enable)."
    echo "$p"
    ;;
  status)
    case ",$(get_env COMPOSE_PROFILES)," in
      *,monitoring,*) echo "Profil: etkin" ;;
      *) echo "Profil: kapali (scripts/monitoring.sh enable)"; exit 0 ;;
    esac
    docker compose --profile monitoring ps --format '{{.Service}}\t{{.State}}\t{{.Status}}' "${SERVICES[@]}" 2>/dev/null || true
    echo
    if out="$(docker compose exec -T prometheus wget -qO- 'http://127.0.0.1:9090/api/v1/targets?state=active' 2>/dev/null)"; then
      echo "$out" | python3 -c '
import json,sys
t=json.load(sys.stdin)["data"]["activeTargets"]
up=[x for x in t if x["health"]=="up"]
print(f"Hedefler: {len(up)}/{len(t)} ayakta")
for x in t:
    if x["health"]!="up": print("  KAPALI:", x["labels"].get("service", x["scrapeUrl"]), "-", x.get("lastError",""))
' 2>/dev/null || echo "(hedef ozeti icin python3 gerekli)"
      docker compose exec -T prometheus wget -qO- 'http://127.0.0.1:9090/api/v1/alerts' 2>/dev/null | python3 -c '
import json,sys
a=[x for x in json.load(sys.stdin)["data"]["alerts"] if x["state"]=="firing"]
print(f"Aktif alarm: {len(a)}")
for x in a: print("  -", x["labels"]["alertname"], x["labels"].get("service",""), "-", x["annotations"].get("summary",""))
' 2>/dev/null || true
    fi
    ;;
  *)
    die "bilinmeyen komut: $cmd (enable | disable | status | password | purge)"
    ;;
esac
