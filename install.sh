#!/usr/bin/env bash
# HR360 Enterprise — tek sunucu kurulum scripti
#
# Ne yapar:
#   1. Docker / Docker Compose var mi kontrol eder; yoksa (apt/dnf/yum
#      tabanli sistemlerde) sizden onay alarak otomatik kurar
#   2. Sirlari (parola, anahtar) sizden sorar — bos birakirsaniz guvenli,
#      rastgele bir deger uretir
#   3. .env dosyasini yazar
#   4. Keycloak realm sablonunu bu sirlarla doldurur
#   5. Tum servisleri build edip ayaga kaldirir
#   6. Erisim adreslerini ve demo giris bilgilerini ekrana basar
#
# Kullanim: ./install.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

BOLD=$(tput bold 2>/dev/null || echo "")
RESET=$(tput sgr0 2>/dev/null || echo "")
GREEN=$(tput setaf 2 2>/dev/null || echo "")
YELLOW=$(tput setaf 3 2>/dev/null || echo "")

info()  { echo "${BOLD}==>${RESET} $*"; }
warn()  { echo "${YELLOW}${BOLD}!!${RESET} $*"; }

random_secret() {
  # URL-safe, 24 karakter
  openssl rand -base64 24 2>/dev/null | tr -dc 'A-Za-z0-9' | head -c 24 \
    || head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24
}

ask_secret() {
  # ask_secret <degisken_adi> <soru_metni> <varsayilan_kullanici_adi_mi(bos ise rastgele uretilir)>
  local var_name="$1"; local prompt="$2"
  local input=""
  read -r -p "$prompt [bos birakin, otomatik guclu bir deger uretilsin]: " input || true
  if [ -z "$input" ]; then
    input="$(random_secret)"
    echo "   -> otomatik uretildi: $input"
  fi
  printf -v "$var_name" '%s' "$input"
}

echo ""
echo "${BOLD}HR360 Enterprise — tek sunucu kurulumu${RESET}"
echo "----------------------------------------------"

# --- 1) On kosullar -----------------------------------------------------
USE_SUDO_DOCKER=0

install_docker() {
  # Otomatik kurulum, get.docker.com scriptinin desteklendigi paket
  # yoneticilerinde calisir: apt (Ubuntu/Debian) veya dnf/yum
  # (Rocky/RHEL/CentOS/AlmaLinux/Fedora). Diger dagitimlarda elle kurulum
  # gerekir.
  if ! command -v apt-get >/dev/null 2>&1 \
    && ! command -v dnf >/dev/null 2>&1 \
    && ! command -v yum >/dev/null 2>&1; then
    echo "Docker otomatik kurulumu bu dagitimda desteklenmiyor (apt/dnf/yum bulunamadi)."
    echo "Once Docker Engine'i kurun: https://docs.docker.com/engine/install/"
    exit 1
  fi

  warn "Docker Engine bulunamadi."
  echo "Docker'i resmi kurulum scripti (get.docker.com) ile 'sudo' yetkisiyle sisteminize kurmami ister misiniz?"
  echo "Bu islem: paket listelerini gunceller, Docker Engine + Compose plugin'ini kurar ve"
  echo "mevcut kullaniciyi (${USER:-$(whoami)}) 'docker' grubuna ekler."
  read -r -p "Devam edilsin mi? [e/H]: " reply || true
  if [[ ! "$reply" =~ ^[eEyY]$ ]]; then
    echo "Kurulum iptal edildi. Docker'i elle kurup scripti tekrar calistirabilirsiniz: https://docs.docker.com/engine/install/"
    exit 1
  fi

  info "Docker Engine kuruluyor (sudo sifresi istenebilir)..."
  curl -fsSL https://get.docker.com | sudo sh

  sudo systemctl enable --now docker >/dev/null 2>&1 \
    || warn "docker servisi systemctl ile baslatilamadi, devam ediliyor (farkli bir init sistemi olabilir)."

  if ! id -nG "${USER:-$(whoami)}" 2>/dev/null | grep -qw docker; then
    sudo usermod -aG docker "${USER:-$(whoami)}"
    warn "Kullaniciniz 'docker' grubuna eklendi; bu ancak yeni bir oturumda (yeniden giris/SSH) etkin olur."
    warn "Bu kurulumun geri kalaninda gecici olarak 'sudo docker' kullanilacak."
    USE_SUDO_DOCKER=1
  fi

  info "Docker Engine kuruldu: $(sudo docker --version 2>/dev/null || docker --version)"
}

if ! command -v docker >/dev/null 2>&1; then
  install_docker
elif ! docker info >/dev/null 2>&1; then
  # Docker kurulu ama mevcut kullanicinin 'docker' grup yetkisi henuz aktif
  # olmayabilir (yeni eklenmis olabilir) - sudo ile devam edelim.
  if sudo docker info >/dev/null 2>&1; then
    warn "Docker kurulu ama mevcut oturumda 'docker' grubu yetkiniz henuz aktif degil, 'sudo docker' kullanilacak."
    USE_SUDO_DOCKER=1
  else
    echo "Docker kurulu gorunuyor ama calismiyor. 'sudo systemctl status docker' ile kontrol edin."
    exit 1
  fi
fi

# Bu noktadan itibaren tum docker cagrilari (docker compose dahil) bu
# sarmalayicidan gecer - USE_SUDO_DOCKER=1 ise otomatik 'sudo docker' olur.
docker() {
  if [ "$USE_SUDO_DOCKER" = "1" ]; then
    command sudo docker "$@"
  else
    command docker "$@"
  fi
}

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose (v2 plugin) bulunamadi. 'docker compose' calisir hale getirin."
  exit 1
fi

if [ -f .env ]; then
  warn ".env dosyasi zaten var."
  read -r -p "Uzerine yazip sirlari yeniden mi uretelim? [e/H]: " overwrite || true
  if [[ ! "$overwrite" =~ ^[eEyY]$ ]]; then
    info "Mevcut .env korunuyor, dogrudan servisleri ayaga kaldiriyorum."
    docker compose up -d --build
    info "Tamamlandi. Asagidaki 'Erisim' bolumune bakin (adresler .env icindeki PUBLIC_URL/GATEWAY_PORT'a gore degisir)."
    exit 0
  fi
fi

# --- 2) Sirlari sor ------------------------------------------------------
echo ""
echo "Asagidaki sirlar icin Enter'a basarsaniz guclu, rastgele degerler"
echo "otomatik uretilir — cogu kullanim icin bu yeterli ve onerilir."
echo ""

read -r -p "Public URL (gatewayin disaridan erisilecegi adres) [http://localhost]: " PUBLIC_URL || true
PUBLIC_URL=${PUBLIC_URL:-http://localhost}

read -r -p "Gateway'in disariya acacagi port [80]: " GATEWAY_PORT || true
GATEWAY_PORT=${GATEWAY_PORT:-80}

ask_secret HR360_DB_PASSWORD          "PostgreSQL (hr360admin) parolasi"
ask_secret KEYCLOAK_ADMIN_PASSWORD    "Keycloak master admin parolasi"
ask_secret TENANT_SECRET_KEY          "tenant-service imza anahtari"
ask_secret MINIO_ROOT_PASSWORD        "MinIO root parolasi"
ask_secret ML_KEYCLOAK_CLIENT_SECRET  "ml-inference Keycloak client secret'i"
ask_secret DEMO_ADMIN_PASSWORD        "Demo giris kullanicisi (demo.admin) parolasi"

KEYCLOAK_ADMIN_USER=admin
MINIO_ROOT_USER=hr360minio

# --- 3) .env yaz ----------------------------------------------------------
cat > .env <<EOF
GATEWAY_PORT=${GATEWAY_PORT}
PUBLIC_URL=${PUBLIC_URL}

HR360_DB_PASSWORD=${HR360_DB_PASSWORD}

KEYCLOAK_ADMIN_USER=${KEYCLOAK_ADMIN_USER}
KEYCLOAK_ADMIN_PASSWORD=${KEYCLOAK_ADMIN_PASSWORD}

TENANT_SECRET_KEY=${TENANT_SECRET_KEY}

MINIO_ROOT_USER=${MINIO_ROOT_USER}
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}

ML_KEYCLOAK_CLIENT_SECRET=${ML_KEYCLOAK_CLIENT_SECRET}

SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_USER=hr360
SMTP_PASSWORD=hr360
SMTP_FROM_ADDRESS=noreply@hr360.local
SMTP_FROM_NAME=HR360
EOF
info ".env yazildi."

# --- 4) Keycloak realm sablonunu doldur ------------------------------------
sed \
  -e "s/__ML_KEYCLOAK_CLIENT_SECRET__/${ML_KEYCLOAK_CLIENT_SECRET}/" \
  -e "s/__DEMO_ADMIN_PASSWORD__/${DEMO_ADMIN_PASSWORD}/" \
  deploy/keycloak/realm-export.template.json > deploy/keycloak/realm-export.json
info "Keycloak realm sablonu dolduruldu."

# --- 5) Ayaga kaldir --------------------------------------------------------
info "Imajlar build ediliyor ve servisler baslatiliyor (ilk calistirmada birkac dakika surebilir)..."
docker compose up -d --build

info "PostgreSQL'in hazir olmasi bekleniyor..."
until docker compose exec -T postgres pg_isready -U hr360admin -d hr360_operational >/dev/null 2>&1; do
  sleep 2
done

info "Keycloak'in hazir olmasi bekleniyor..."
tries=0
until curl -sf "http://localhost:${GATEWAY_PORT}/auth/realms/hr360" >/dev/null 2>&1; do
  tries=$((tries+1))
  if [ "$tries" -gt 60 ]; then
    warn "Keycloak beklenen surede ayaga kalkmadi. 'docker compose logs keycloak' ile kontrol edin."
    break
  fi
  sleep 3
done

echo ""
echo "${GREEN}${BOLD}Kurulum tamamlandi.${RESET}"
echo "----------------------------------------------"
echo "Uygulama:         ${PUBLIC_URL}:${GATEWAY_PORT}"
echo "Keycloak admin:   ${PUBLIC_URL}:${GATEWAY_PORT}/auth  (kullanici: ${KEYCLOAK_ADMIN_USER})"
echo "MinIO konsolu:    http://localhost:9001"
echo "Mailpit (e-posta):http://localhost:8025"
echo "MLflow:           http://localhost:5000"
echo ""
echo "Demo giris:       demo.admin / (yukarida belirlediginiz/uretilen DEMO_ADMIN_PASSWORD)"
echo ""
echo "Tum sirlar .env dosyasinda — bu dosyayi asla commit etmeyin (.gitignore'da zaten haric)."
echo "Loglari izlemek icin: docker compose logs -f"
echo "Durdurmak icin:       docker compose down"
