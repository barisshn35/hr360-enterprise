#!/usr/bin/env bash
# HR360 Enterprise — tek sunucu kurulum scripti
#
# Ne yapar:
#   1. Docker / Docker Compose var mi kontrol eder; yoksa (apt/dnf/yum
#      tabanli sistemlerde) sizden onay alarak otomatik kurar
#   2. Adresi, Keycloak yonetim paneli erisimini, HTTPS yontemini ve SMTP
#      sunucusunu sorar
#   3. Sirlari (parola, anahtar) sorar — bos birakirsaniz guvenli, rastgele
#      bir deger uretir
#   4. .env dosyasini yazar, Keycloak realm sablonunu doldurur
#   5. Tum servisleri build edip ayaga kaldirir
#   6. Yonetim paneli erisimini ve HTTPS'i (scripts/tls.sh) ayarlar
#   7. Erisim adreslerini ve demo giris bilgilerini ekrana basar
#
# Mevcut bir kurulumda (.env varsa) tekrar calistirildiginda varsayilan yol
# GUNCELLEMEDIR: sirlar korunur, veritabani gocleri uygulanir, imajlar yeniden
# build edilir.
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

# Gecerli bir AES-256 anahtari mi: base64, cozulunce tam 32 byte.
is_aes_key() {
  [ "$(printf '%s' "$1" | base64 -d 2>/dev/null | wc -c)" = "32" ]
}

ask_secret_aes_key() {
  # ask_secret ile ayni akis, ama otomatik uretimde random_aes_key() kullanir
  # (tam 32 ham byte garantisi icin). Elle girilen deger de dogrulanir: servisler
  # gecersiz anahtarla (SmtpCredentialProtector) acilista hata veriyordu.
  local var_name="$1"; local prompt="$2"
  local input=""
  while :; do
    input=""
    read -r -p "$prompt [bos birakin, otomatik guclu bir deger uretilsin]: " input || true
    if [ -z "$input" ]; then
      input="$(random_aes_key)"
      echo "   -> otomatik uretildi: $input"
      break
    fi
    is_aes_key "$input" && break
    warn "Gecersiz anahtar: base64 kodlu tam 32 byte olmali (ornek: openssl rand -base64 32)."
  done
  printf -v "$var_name" '%s' "$input"
}

ask_secret() {
  # ask_secret <degisken_adi> <soru_metni>
  # Elle girilen sirlar .env'e tirnaksiz yazilir ve baglanti dizelerinde/URI'lerde
  # kullanilir ($, ;, @, /, :, bosluk, # gibi karakterler bunlari bozar). Bu yuzden
  # yalnizca guvenli karakterlere izin verilir.
  local var_name="$1"; local prompt="$2"
  local input=""
  while :; do
    input=""
    read -r -p "$prompt [bos birakin, otomatik guclu bir deger uretilsin]: " input || true
    if [ -z "$input" ]; then
      input="$(random_secret)"
      echo "   -> otomatik uretildi: $input"
      break
    fi
    [[ "$input" =~ ^[A-Za-z0-9._~+=-]{8,}$ ]] && break
    warn "En az 8 karakter; yalnizca harf, rakam ve . _ ~ + = - kullanin."
  done
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
# Yardimci betikler (scripts/tls.sh, scripts/keycloak-admin-access.sh) ayri
# surec olarak calisir; sarmalayici onlara da gecsin diye disari aktarilir.
export USE_SUDO_DOCKER
export -f docker

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose (v2 plugin) bulunamadi. 'docker compose' calisir hale getirin."
  exit 1
fi

if [ -f .env ]; then
  warn ".env dosyasi zaten var."
  read -r -p "Uzerine yazip sirlari yeniden mi uretelim? [e/H]: " overwrite || true
  if [[ "$overwrite" =~ ^[eEyY]$ ]]; then
    # Mevcut veriler (volume'ler) eski sirlarla olusturuldu: Postgres eski parolayi,
    # Keycloak eski realm ve yonetici parolasini, kiracilarin sifreli SMTP parolalari
    # eski anahtari kullanir. Yeni sirlarla bu verilere erisilemez; yeniden uretmek
    # ancak TUM verileri silerek mumkundur.
    project="$(docker compose config 2>/dev/null | sed -n 's/^name: //p' | head -1)"
    if [ -n "$project" ] && docker volume ls -q --filter "label=com.docker.compose.project=${project}" | grep -q .; then
      warn "Bu kurulumun verileri var (veritabani, Keycloak kullanicilari, logolar)."
      warn "Sirlari yeniden uretmek icin BUTUN veriler silinecek; bu geri alinamaz."
      read -r -p "Tum verileri silip sifirdan kurmak icin SIL yazin (vazgecmek icin Enter): " wipe || true
      if [ "$wipe" != "SIL" ]; then
        echo "Vazgecildi. Guncelleme icin scripti tekrar calistirip bu soruya 'H' deyin."
        exit 1
      fi
      docker compose --profile letsencrypt down -v --remove-orphans
      rm -f deploy/nginx/tls/*.conf deploy/nginx/tls/*.pem
    fi
  else
    info "Mevcut .env korunuyor (guncelleme): once veritabani goclerini uyguluyorum."
    set -a; . ./.env; set +a
    if ! is_aes_key "${TENANT_SECRET_KEY:-}"; then
      warn "TENANT_SECRET_KEY gecerli bir AES-256 anahtari degil (base64, 32 byte olmali)."
      warn "Kiracilarin SMTP parolalari bu anahtarla sifrelendigi icin otomatik degistirilmiyor;"
      warn "ozel SMTP kullanan kiraci yoksa .env'de 'openssl rand -base64 32' ile yenileyin."
    fi

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
    pg_ok=0
    for _ in $(seq 1 60); do
      docker compose exec -T postgres pg_isready -U hr360admin >/dev/null 2>&1 && { pg_ok=1; break; }
      sleep 2
    done
    [ "$pg_ok" = 1 ] || { echo "PostgreSQL 2 dakikada hazir olmadi; 'docker compose logs postgres' ile kontrol edin."; exit 1; }
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
    info "Guncelleme tamamlandi: $(grep '^PUBLIC_ORIGIN=' .env | tail -1 | cut -d= -f2-)"
    info "HTTPS: $(scripts/tls.sh status | head -1 | sed 's/^HTTPS: //')"
    exit 0
  fi
fi

# --- 2) Sirlari sor ------------------------------------------------------
echo ""
echo "Asagidaki sirlar icin Enter'a basarsaniz guclu, rastgele degerler"
echo "otomatik uretilir — cogu kullanim icin bu yeterli ve onerilir."
echo ""

while :; do
  PUBLIC_URL=""
  read -r -p "Public URL (gatewayin disaridan erisilecegi adres) [http://localhost]: " PUBLIC_URL || true
  PUBLIC_URL=${PUBLIC_URL:-http://localhost}
  PUBLIC_URL="${PUBLIC_URL%/}"
  # Sema yazilmadiysa http varsayilir (Keycloak adresi ve jeton ureticisi sema ister).
  [[ "$PUBLIC_URL" =~ ^https?:// ]] || PUBLIC_URL="http://${PUBLIC_URL}"
  [[ "$PUBLIC_URL" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] && break
  warn "Gecersiz adres: ${PUBLIC_URL} (ornek: https://hr.sirket.com ya da http://10.0.0.5 - yol icermemeli)"
done

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

# HTTPS kurulumun sonunda scripts/tls.sh ile otomatik acilir.
PUBLIC_HOST="$(printf '%s' "${PUBLIC_URL}" | sed -E 's#^[a-zA-Z]+://([^/:]+).*#\1#')"
if [[ "$PUBLIC_HOST" =~ [A-Za-z] ]] && [[ "$PUBLIC_HOST" == *.* ]] && [ "$PUBLIC_HOST" != localhost ]; then
  TLS_DEFAULT=1   # gercek alan adi -> Let's Encrypt
else
  TLS_DEFAULT=4   # localhost / IP -> HTTPS yok
fi
echo ""
echo "HTTPS (adres: ${PUBLIC_HOST}):"
echo "  1) Let's Encrypt ile otomatik, ucretsiz sertifika + otomatik yenileme"
echo "     (alan adinin DNS kaydi bu sunucuyu gostermeli, 80 ve 443 internete acik olmali)"
echo "  2) Kendi sertifikam var (fullchain + private key dosya yollari)"
echo "  3) Kendinden imzali sertifika (yalnizca test - tarayici uyari verir)"
echo "  4) HTTPS yok (yalnizca HTTP; yerel/deneme kurulumu)"
read -r -p "Seciminiz [${TLS_DEFAULT}]: " TLS_CHOICE || true
TLS_CHOICE=${TLS_CHOICE:-$TLS_DEFAULT}
TLS_MODE=none; TLS_EMAIL=""; TLS_CERT=""; TLS_KEY=""
case "$TLS_CHOICE" in
  1)
    if [ "$TLS_DEFAULT" != 1 ]; then
      warn "Let's Encrypt gercek bir alan adi ister (${PUBLIC_HOST} olmaz); HTTPS kapali birakiliyor."
    elif [ "${GATEWAY_PORT}" != 80 ]; then
      warn "Let's Encrypt dogrulamasi 80. porttan yapilir (gateway portu: ${GATEWAY_PORT}); HTTPS kapali birakiliyor."
    else
      TLS_MODE=letsencrypt
      read -r -p "Sertifika bildirimleri icin e-posta (bos birakilabilir): " TLS_EMAIL || true
    fi ;;
  2)
    read -r -p "Sertifika zinciri dosyasi (fullchain.pem) yolu: " TLS_CERT || true
    read -r -p "Ozel anahtar dosyasi (privkey.pem) yolu: " TLS_KEY || true
    if [ -f "$TLS_CERT" ] && [ -f "$TLS_KEY" ]; then
      TLS_MODE=certificate; TLS_CERT="$(cd "$(dirname "$TLS_CERT")" && pwd)/$(basename "$TLS_CERT")"
      TLS_KEY="$(cd "$(dirname "$TLS_KEY")" && pwd)/$(basename "$TLS_KEY")"
    else
      warn "Sertifika/anahtar dosyasi bulunamadi; HTTPS kapali birakiliyor (sonra: scripts/tls.sh enable --cert ... --key ...)."
    fi ;;
  3) TLS_MODE=self-signed ;;
  *) TLS_MODE=none ;;
esac
if [ "$TLS_MODE" = none ] && [[ "${PUBLIC_URL}" == https://* ]]; then
  # HTTPS acilmayacaksa adres http olmali; aksi halde giris yonlendirmeleri kirilir.
  PUBLIC_URL="http://${PUBLIC_URL#https://}"
  warn "HTTPS acilmayacagi icin adres ${PUBLIC_URL} olarak kullanilacak."
fi

echo ""
echo "E-posta (SMTP) sunucusu: davet, parola belirleme ve bildirim e-postalari bununla gider."
echo "Bos birakirsaniz paketteki Mailpit kullanilir - e-postalar GERCEKTEN GONDERILMEZ, yalnizca"
echo "sunucudaki test kutusunda (http://localhost:8025) gorunur. Gercek kullanim icin sunucu girin."
read -r -p "SMTP sunucusu [mailpit]: " SMTP_HOST || true
if [ -z "${SMTP_HOST}" ] || [ "${SMTP_HOST}" = "mailpit" ]; then
  SMTP_HOST=mailpit; SMTP_PORT=1025; SMTP_USER=hr360; SMTP_PASSWORD=hr360
  SMTP_FROM_ADDRESS=noreply@hr360.local; SMTP_FROM_NAME=HR360
  SMTP_AUTH=false; SMTP_SSL=false; SMTP_STARTTLS=false
  warn "Mailpit secildi: kullanicilara e-posta ulasmayacak (test modu)."
else
  read -r -p "SMTP portu (587 = STARTTLS, 465 = SSL) [587]: " SMTP_PORT || true
  SMTP_PORT=${SMTP_PORT:-587}
  read -r -p "SMTP kullanici adi (kimlik dogrulama yoksa bos): " SMTP_USER || true
  SMTP_PASSWORD=""
  if [ -n "${SMTP_USER}" ]; then
    read -r -s -p "SMTP parolasi: " SMTP_PASSWORD || true; echo ""
  fi
  read -r -p "Gonderen adres (orn. noreply@sirket.com): " SMTP_FROM_ADDRESS || true
  [ -n "${SMTP_FROM_ADDRESS}" ] || { echo "Gonderen adres zorunlu."; exit 1; }
  read -r -p "Gonderen adi [HR360]: " SMTP_FROM_NAME || true
  SMTP_FROM_NAME=${SMTP_FROM_NAME:-HR360}
  SMTP_AUTH=$([ -n "${SMTP_USER}" ] && echo true || echo false)
  if [ "${SMTP_PORT}" = "465" ]; then SMTP_SSL=true; SMTP_STARTTLS=false; else SMTP_SSL=false; SMTP_STARTTLS=true; fi
  for v in "${SMTP_HOST}" "${SMTP_USER}" "${SMTP_PASSWORD}" "${SMTP_FROM_ADDRESS}" "${SMTP_FROM_NAME}"; do
    case "$v" in *"'"*|*'$'*|*$'\n'*) echo "SMTP bilgilerinde tek tirnak ('), \$ ve satir sonu kullanilamaz."; exit 1 ;; esac
  done
fi

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

# E-posta sunucusu (uygulama bildirimleri + Keycloak davet/parola e-postalari).
# SMTP_HOST=mailpit = paketteki test kutusu, gercek gonderim yapmaz.
SMTP_HOST='${SMTP_HOST}'
SMTP_PORT=${SMTP_PORT}
SMTP_USER='${SMTP_USER}'
SMTP_PASSWORD='${SMTP_PASSWORD}'
SMTP_FROM_ADDRESS='${SMTP_FROM_ADDRESS}'
SMTP_FROM_NAME='${SMTP_FROM_NAME}'
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
# Yer tutucular sed yerine bash ile, degerler JSON'a kacirilarak doldurulur: kullanicinin
# girdigi SMTP parolasindaki / & " \ gibi karakterler sablonu bozmasin.
json_escape() { local v="$1"; v="${v//\\/\\\\}"; v="${v//\"/\\\"}"; printf '%s' "$v"; }
shopt -u patsub_replacement 2>/dev/null || true
realm="$(<deploy/keycloak/realm-export.template.json)"
for pair in \
  "__ML_KEYCLOAK_CLIENT_SECRET__=${ML_KEYCLOAK_CLIENT_SECRET}" \
  "__DEMO_ADMIN_PASSWORD__=${DEMO_ADMIN_PASSWORD}" \
  "__PLATFORM_ADMIN_PASSWORD__=${PLATFORM_ADMIN_PASSWORD}" \
  "__PUBLIC_ORIGIN__=${PUBLIC_ORIGIN}" \
  "__SMTP_HOST__=${SMTP_HOST}" \
  "__SMTP_PORT__=${SMTP_PORT}" \
  "__SMTP_FROM_ADDRESS__=${SMTP_FROM_ADDRESS}" \
  "__SMTP_FROM_NAME__=${SMTP_FROM_NAME}" \
  "__SMTP_AUTH__=${SMTP_AUTH}" \
  "__SMTP_USER__=${SMTP_USER}" \
  "__SMTP_PASSWORD__=${SMTP_PASSWORD}" \
  "__SMTP_SSL__=${SMTP_SSL}" \
  "__SMTP_STARTTLS__=${SMTP_STARTTLS}"; do
  key="${pair%%=*}"; val="$(json_escape "${pair#*=}")"
  realm="${realm//"$key"/$val}"
done
printf '%s\n' "$realm" > deploy/keycloak/realm-export.json
if grep -q "__[A-Z_]*__" deploy/keycloak/realm-export.json; then
  echo "Realm sablonunda doldurulmamis alan kaldi."; exit 1
fi
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
pg_tries=0
until docker compose exec -T postgres pg_isready -U hr360admin -d hr360_operational >/dev/null 2>&1; do
  pg_tries=$((pg_tries+1))
  if [ "$pg_tries" -gt 90 ]; then
    echo "PostgreSQL 3 dakikada hazir olmadi; 'docker compose logs postgres' ile kontrol edin."
    exit 1
  fi
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

if [ "$TLS_MODE" != none ]; then
  info "HTTPS aciliyor (${TLS_MODE})..."
  case "$TLS_MODE" in
    letsencrypt)
      tls_args=(--letsencrypt --host "$PUBLIC_HOST")
      [ -n "$TLS_EMAIL" ] && tls_args+=(--email "$TLS_EMAIL") ;;
    certificate) tls_args=(--cert "$TLS_CERT" --key "$TLS_KEY" --host "$PUBLIC_HOST") ;;
    self-signed) tls_args=(--self-signed --host "$PUBLIC_HOST") ;;
  esac
  if ! scripts/tls.sh enable "${tls_args[@]}"; then
    warn "HTTPS acilamadi; uygulama HTTP ile calisacak sekilde ayarlaniyor."
    # tls.sh kendi degisikliklerini geri alir; yine de durum tutarli olsun diye
    # adres ve Keycloak ayarlari acikca HTTP'ye cekilir.
    scripts/tls.sh disable >/dev/null 2>&1 || warn "HTTP'ye donus de basarisiz; 'scripts/tls.sh status' ile kontrol edin."
    warn "Sorunu giderdikten sonra tekrar deneyin: scripts/tls.sh enable ${tls_args[*]}"
  fi
else
  # HTTPS yok: onceki bir kurulumdan kalmis TLS ayarlari temizlenir ve Keycloak'in
  # yonetim realm'i de duz HTTP'ye izin verecek sekilde ayarlanir (aksi halde
  # genel IP'den yonetim paneli "HTTPS required" der).
  info "HTTPS kapali; adres ve Keycloak ayarlari HTTP icin duzenleniyor..."
  scripts/tls.sh disable >/dev/null 2>&1 || warn "Ayar yapilamadi; 'scripts/tls.sh disable' ile tekrar deneyin."
fi
PUBLIC_ORIGIN="$(grep '^PUBLIC_ORIGIN=' .env | tail -1 | cut -d= -f2-)"

echo ""
echo "${GREEN}${BOLD}Kurulum tamamlandi.${RESET}"
echo "----------------------------------------------"
echo "Uygulama:         ${PUBLIC_ORIGIN}"
echo "Keycloak admin:   $(scripts/keycloak-admin-access.sh status | grep 'Konsol adresi' | awk '{print $3}' | grep . || echo "${PUBLIC_ORIGIN}/auth")/admin/  (kullanici: ${KEYCLOAK_ADMIN_USER})"
echo "                  Erisimi degistirmek icin: scripts/keycloak-admin-access.sh open|ip|port"
echo "HTTPS:            $(scripts/tls.sh status | head -1 | sed "s/^HTTPS: //")"
echo "MinIO konsolu:    http://localhost:9001   (yalnizca sunucunun kendisinden / SSH tuneliyle)"
echo "Mailpit (e-posta):http://localhost:8025   (yalnizca sunucunun kendisinden / SSH tuneliyle)"
echo "MLflow:           http://localhost:5000   (yalnizca sunucunun kendisinden / SSH tuneliyle)"
echo ""
echo "Demo giris:       demo.admin / (yukarida belirlediginiz/uretilen DEMO_ADMIN_PASSWORD)  - yalnizca demo sirketinin yoneticisi"
echo "Platform yonetimi: platform.admin / (.env icindeki PLATFORM_ADMIN_PASSWORD)  - tum kiracilar; paylasmayin"
echo ""
echo "Tum sirlar .env dosyasinda — bu dosyayi asla commit etmeyin (.gitignore'da zaten haric)."
echo "Loglari izlemek icin: docker compose logs -f"
echo "Durdurmak icin:       docker compose down"
