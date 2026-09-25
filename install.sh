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

random_aes_key() {
  # TAM 32 ham byte'lik, gecerli base64 kodlu bir anahtar uretir (AES-256 icin).
  # NOT: random_secret() ozel karakterleri (+ / =) siler ve 24 karaktere keser
  # - bu, gecerli bir base64(32 byte) DEGILDIR ve Convert.FromBase64String()
  # ile acilinca ~18 byte'a dusup SmtpCredentialProtector'in "32 byte
  # (base64) olmali" hatasini atmasina sebep olur (hardcore test sirasinda
  # bulundu: TENANT_SECRET_KEY icin bu fonksiyon kullanilmali, random_secret()
  # DEGIL). Ozel karakterler KORUNUR, kesinlikle strip/kirpma yapilmaz.
  openssl rand -base64 32 2>/dev/null \
    || head -c 32 /dev/urandom | base64
}

ask_secret_aes_key() {
  # ask_secret ile ayni akis, ama otomatik uretimde random_aes_key() kullanir
  # (tam 32 ham byte garantisi icin). Kullanici kendi degerini girerse,
  # gecerliligini kontrol etmek kullanicinin sorumlulugundadir (ayni ask_secret
  # gibi serbest metin kabul eder).
  local var_name="$1"; local prompt="$2"
  local input=""
  read -r -p "$prompt [bos birakin, otomatik guclu bir deger uretilsin]: " input || true
  if [ -z "$input" ]; then
    input="$(random_aes_key)"
    echo "   -> otomatik uretildi: $input"
  fi
  printf -v "$var_name" '%s' "$input"
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
    info "Mevcut .env korunuyor (guncelleme): once veritabani goclerini uyguluyorum."
    set -a; . ./.env; set +a

    # Keycloak artik sabit genel adresle (KC_HOSTNAME) calisiyor; eski .env'lerde
    # PUBLIC_ORIGIN yok - PUBLIC_URL ve GATEWAY_PORT'tan uretilir.
    if [ -z "${PUBLIC_ORIGIN:-}" ]; then
      if [[ "${PUBLIC_URL%/}" =~ ://[^/]+:[0-9]+$ ]] || [ -z "${GATEWAY_PORT:-}" ] \
         || [ "${GATEWAY_PORT}" = "80" ] || [ "${GATEWAY_PORT}" = "443" ]; then
        PUBLIC_ORIGIN="${PUBLIC_URL%/}"
      else
        PUBLIC_ORIGIN="${PUBLIC_URL%/}:${GATEWAY_PORT}"
      fi
      echo "PUBLIC_ORIGIN=${PUBLIC_ORIGIN}" >> .env
      info "PUBLIC_ORIGIN=${PUBLIC_ORIGIN} .env'e eklendi (Keycloak genel adresi)."
    fi

    # NOT: Onceden bu yol yalnizca "docker compose up --build" calistiriyordu -
    # scripts/sql altindaki goc betikleri hic uygulanmiyordu (yeni kolon eksik
    # kalinca ilgili servis tum sorgularda 500 veriyordu).
    docker compose up -d postgres
    for _ in $(seq 1 60); do
      docker compose exec -T postgres pg_isready -U hr360admin >/dev/null 2>&1 && break
      sleep 2
    done
    for f in scripts/sql/*.sql; do
      [ -f "$f" ] || continue
      info "Goc uygulaniyor: $f"
      docker compose exec -T postgres psql -U hr360admin -d hr360_operational -v ON_ERROR_STOP=1 -q -f - < "$f"
    done

    # Keycloak artik Postgres'teki "keycloak" veritabanini kullaniyor. Veritabani yoksa
    # iki durum var: (a) Keycloak hic kurulmamis -> olustur; (b) eski kurulum, veriler
    # hala Keycloak konteynerinin ICINDE -> dogrudan baslatmak tum kullanicilari
    # "kaybettirir" (bos veritabaniyla acilir). (b)'de durup runbook'u gosteriyoruz.
    if ! docker compose exec -T postgres psql -U hr360admin -d postgres -tAc \
         "SELECT 1 FROM pg_database WHERE datname='keycloak'" | grep -q 1; then
      if [ -n "$(docker compose ps -a -q keycloak 2>/dev/null)" ]; then
        warn "Keycloak kullanicilari hala eski konteynerin icinde (dosya veritabani)."
        warn "Postgres'e gecis icin once su adimlari uygulayin: docs/runbooks/keycloak-postgres-gecisi.md"
        warn "Diger servisleri baslatmadan cikiliyor; Keycloak'a dokunulmadi."
        exit 1
      fi
      docker compose exec -T postgres psql -U hr360admin -d postgres -c "CREATE DATABASE keycloak OWNER hr360admin;"
    fi

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

echo ""
echo "Keycloak yonetim paneline erisim:"
echo "  1) Herkese acik (varsayilan)"
echo "  2) Yalnizca belirli IP/CIDR'ler (nginx ile)"
echo "  3) Ayri port (8090) - erisimi firewall ile siz kisitlarsiniz"
read -r -p "Seciminiz [1]: " KC_ADMIN_CHOICE || true
KEYCLOAK_ADMIN_ALLOWED_IPS=""
case "${KC_ADMIN_CHOICE:-1}" in
  2) KEYCLOAK_ADMIN_MODE=ip
     read -r -p "Izinli IP/CIDR'ler (virgulle, orn. 203.0.113.10,10.0.0.0/8): " KEYCLOAK_ADMIN_ALLOWED_IPS || true
     [ -n "$KEYCLOAK_ADMIN_ALLOWED_IPS" ] || { warn "IP verilmedi; panel herkese acik birakiliyor."; KEYCLOAK_ADMIN_MODE=open; } ;;
  3) KEYCLOAK_ADMIN_MODE=port
     read -r -p "Ek olarak nginx'te izinli IP/CIDR'ler (bos = yalnizca firewall): " KEYCLOAK_ADMIN_ALLOWED_IPS || true ;;
  *) KEYCLOAK_ADMIN_MODE=open ;;
esac

ask_secret HR360_DB_PASSWORD          "PostgreSQL (hr360admin) parolasi"
ask_secret KEYCLOAK_ADMIN_PASSWORD    "Keycloak master admin parolasi"
ask_secret_aes_key TENANT_SECRET_KEY  "tenant-service imza anahtari"
ask_secret MINIO_ROOT_PASSWORD        "MinIO root parolasi"
ask_secret ML_KEYCLOAK_CLIENT_SECRET  "ml-inference Keycloak client secret'i"
ask_secret DEMO_ADMIN_PASSWORD        "Demo giris kullanicisi (demo.admin) parolasi"
ask_secret PLATFORM_ADMIN_PASSWORD    "Platform yoneticisi (platform.admin) parolasi"

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

# NOT: DEMO_ADMIN_PASSWORD daha once bu dosyaya hic yazilmiyordu (script
# "Tum sirlar .env dosyasinda" diyordu ama bu degisken sadece Keycloak
# realm sablonuna gomuluyordu) - hardcore test sirasinda bulundu.
DEMO_ADMIN_PASSWORD=${DEMO_ADMIN_PASSWORD}
# GUVENLIK: demo.admin onceden platform-admin'di - demo parolasini bilen herkes TUM
# kiracilarin verisini (kiraci filtresi platform-admin icin kapali) okuyabiliyordu.
# Platform yonetimi artik ayri, kiraciya bagli olmayan bir hesapta.
PLATFORM_ADMIN_PASSWORD=${PLATFORM_ADMIN_PASSWORD}

SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_USER=hr360
SMTP_PASSWORD=hr360
SMTP_FROM_ADDRESS=noreply@hr360.local
SMTP_FROM_NAME=HR360
EOF
info ".env yazildi."

# --- 4) Keycloak realm sablonunu doldur ------------------------------------
# GUVENLIK: hr360-web istemcisinin yonlendirme adresleri onceden "*" idi - Keycloak
# giris kodunu HERHANGI bir siteye (orn. https://evil.example/cb) gonderiyordu
# (canli dogrulandi). Artik yalnizca uygulamanin kendi kokeni kabul edilir.
if [[ "${PUBLIC_URL%/}" =~ ://[^/]+:[0-9]+$ ]] || [ -z "${GATEWAY_PORT}" ] \
   || [ "${GATEWAY_PORT}" = "80" ] || [ "${GATEWAY_PORT}" = "443" ]; then
  # PUBLIC_URL zaten port iceriyorsa (orn. http://sunucu:8080) tekrar eklenmez.
  PUBLIC_ORIGIN="${PUBLIC_URL%/}"
else
  PUBLIC_ORIGIN="${PUBLIC_URL%/}:${GATEWAY_PORT}"
fi
warn "Giris yalnizca su adresten calisir: ${PUBLIC_ORIGIN}  (tarayicida TAM olarak bu adresi kullanin;"
warn "baska bir ad/IP ile erisilecekse PUBLIC_URL'i ona gore verin - Keycloak diger adreslere yonlendirmez)."
# NOT: Realm'de e-posta sunucusu tanimli degildi - yeni sirket kaydinda ve davette
# "parola belirleme baglantisi gonderildi" deniyor ama e-posta HIC gitmiyordu
# (Keycloak: "Failed to send execute actions email"). Uygulamanin kendi SMTP
# ayarlariyla (varsayilan: paketteki Mailpit) ayni sunucu kullanilir.
sed \
  -e "s/__ML_KEYCLOAK_CLIENT_SECRET__/${ML_KEYCLOAK_CLIENT_SECRET}/" \
  -e "s/__DEMO_ADMIN_PASSWORD__/${DEMO_ADMIN_PASSWORD}/" \
  -e "s/__PLATFORM_ADMIN_PASSWORD__/${PLATFORM_ADMIN_PASSWORD}/" \
  -e "s#__PUBLIC_ORIGIN__#${PUBLIC_ORIGIN}#g" \
  -e "s/__SMTP_HOST__/mailpit/" \
  -e "s/__SMTP_PORT__/1025/" \
  -e "s/__SMTP_FROM_ADDRESS__/noreply@hr360.local/" \
  deploy/keycloak/realm-export.template.json > deploy/keycloak/realm-export.json
info "Keycloak realm sablonu dolduruldu."

# Keycloak'in genel adresi (KC_HOSTNAME) bu kokenden uretilir.
if grep -q "^PUBLIC_ORIGIN=" .env; then
  sed -i "s#^PUBLIC_ORIGIN=.*#PUBLIC_ORIGIN=${PUBLIC_ORIGIN}#" .env
else
  echo "PUBLIC_ORIGIN=${PUBLIC_ORIGIN}" >> .env
fi

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

info "Keycloak yonetim paneli erisimi ayarlaniyor (${KEYCLOAK_ADMIN_MODE})..."
if [ "$KEYCLOAK_ADMIN_MODE" = "open" ]; then
  scripts/keycloak-admin-access.sh open || warn "Panel erisimi ayarlanamadi; sonra scripts/keycloak-admin-access.sh ile deneyin."
else
  scripts/keycloak-admin-access.sh "$KEYCLOAK_ADMIN_MODE" "$KEYCLOAK_ADMIN_ALLOWED_IPS" \
    || warn "Panel erisimi ayarlanamadi; sonra scripts/keycloak-admin-access.sh ile deneyin."
fi

echo ""
echo "${GREEN}${BOLD}Kurulum tamamlandi.${RESET}"
echo "----------------------------------------------"
echo "Uygulama:         ${PUBLIC_ORIGIN}"
echo "Keycloak admin:   $(scripts/keycloak-admin-access.sh status | grep 'Konsol adresi' | awk '{print $3}' | grep . || echo "${PUBLIC_ORIGIN}/auth")/admin/  (kullanici: ${KEYCLOAK_ADMIN_USER})"
echo "                  Erisimi degistirmek icin: scripts/keycloak-admin-access.sh open|ip|port"
echo "MinIO konsolu:    http://localhost:9001"
echo "Mailpit (e-posta):http://localhost:8025"
echo "MLflow:           http://localhost:5000"
echo ""
echo "Demo giris:       demo.admin / (yukarida belirlediginiz/uretilen DEMO_ADMIN_PASSWORD)  - yalnizca demo sirketinin yoneticisi"
echo "Platform yonetimi: platform.admin / (.env icindeki PLATFORM_ADMIN_PASSWORD)  - tum kiracilar; paylasmayin"
echo ""
echo "Tum sirlar .env dosyasinda — bu dosyayi asla commit etmeyin (.gitignore'da zaten haric)."
echo "Loglari izlemek icin: docker compose logs -f"
echo "Durdurmak icin:       docker compose down"
