# HR360 Enterprise

Olay güdümlü, çok kiracılı, mikroservis tabanlı kurumsal İnsan Kaynakları
yönetim platformu. Bir bitirme projesi kapsamında geliştirilmiş, gerçek bir
7 sunuculu prodüksiyon ortamında çalışacak şekilde tasarlanmıştır.

Bu repo, aynı sistemi **tek bir sunucuda**, tek komutla (`./install.sh`)
ayağa kaldırabileceğiniz, taşınabilir bir sürümünü içerir — inceleme,
demo ve portföy amaçlı.

## Hızlı başlangıç

Gereksinimler: Docker Engine + Docker Compose v2 plugin.

```bash
git clone <bu-repo>
cd hr360-enterprise
./install.sh
```

Script sizden birkaç parola/anahtar isteyecek — boş bırakırsanız güvenli,
rastgele değerler otomatik üretir. Sonunda erişim adreslerini ve demo giriş
bilgilerini ekrana basar. Repo içinde **hiçbir gerçek şifre veya anahtar
bulunmaz**; hepsi kurulum sırasında sizin makinenizde üretilir ve yalnızca
yerel `.env` dosyanızda (git'e dahil değil) saklanır.

İlk çalıştırma birkaç dakika sürebilir (13 .NET servisi + Keycloak + MLflow
vb. build edilir). Durdurmak için `docker compose down`, logları izlemek
için `docker compose logs -f`.

## Mimari

- **Kimlik doğrulama:** Keycloak (Organizations özelliği ile çok
  kiracılılık — her kiracı kendi Keycloak organizasyonuna karşılık gelir)
- **Mesajlaşma:** Apache Kafka (KRaft, tek node), Outbox (yayınlayan
  tarafta) + Inbox (`messaging_processed_events`, tüketen tarafta
  idempotency) desenleriyle
- **Veritabanı:** PostgreSQL — tüm servisler `hr360_operational`
  veritabanını, kendi tablo kümeleriyle ve ortak tenant filtreleme
  altyapısıyla izole şekilde paylaşır; MLflow için ayrı `hr360_mlflow`
  veritabanı
- **Depolama:** MinIO (S3 uyumlu nesne depolama — logo ve ML artefact'ları)
- **E-posta:** Mailpit (yerel SMTP yakalayıcı, demo/dev için — gerçek bir
  SMTP sağlayıcısına geçmek için `.env` içindeki `SMTP_*` değişkenlerini
  değiştirin)
- **ML:** MLflow tracking + Registry, FastAPI tabanlı inference servisi
  (işten ayrılma riski tahmini), Postgres backend store + MinIO artifact
  store
- **Gateway:** Nginx — path tabanlı routing (`/api/<servis>/`), `/auth/`
  üzerinden Keycloak'a, `/ml/` üzerinden inference servisine, `/logos/`
  üzerinden MinIO'ya passthrough

Servisler birbirini Docker'ın dahili servis-adı DNS'i üzerinden bulur
(örn. `http://employee-service:8080`) — IP adresi hardcode edilmemiştir.

## Repo yapısı

```
apps/
  web/                  React 19 + Vite tabanlı web istemcisi
  ml-inference/         FastAPI attrition/turnover risk inference servisi
  ml-platform/          MLflow tracking sunucusu (Dockerfile)
  services/             13 mikroservis, her biri kendi Dockerfile'ıyla
    tenant-service/           Kiracı kaydı, provisioning, Keycloak organizasyon yönetimi
    organization-service/     Şirket, departman, ekip
    employee-service/         Çalışan ana verisi, atamalar
    workflow-service/         Onay zinciri, SLA
    leave-service/            İzin talebi ve bakiye
    timeshift-service/        Vardiya ve puantaj
    performance-service/      Hedef, değerlendirme, puanlama, ML destekli öneri
    learning-service/         Eğitim ve sertifika
    compensation-service/     Ücret bandı ve simülasyon
    expense-service/          Masraf ve seyahat
    recruitment-service/      İlan, aday, mülakat
    onboarding-service/       İşe giriş görevleri, zimmet
    notification-service/     Kafka olay tüketimi, bildirim üretimi
data/
  migrations/            Tüm servislerin birleşik SQL şeması
deploy/
  nginx/                 Tek-sunucu gateway yapılandırması
  postgres/              İkinci veritabanının (mlflow) init script'i
  keycloak/              Realm şablonu (sırlar kurulumda dolduruluyor)
platform/
  ansible/               Orijinal 7-VM dağıtımının Ansible playbook'ları (referans)
  monitoring/             Orijinal Prometheus scrape target tanımları (referans)
  nginx/                  Orijinal gateway nginx snippet'i (referans)
  keycloak-themes/        Özel Keycloak giriş teması
docs/
  architecture/           Mimari dokümanlar
docker-compose.yml         Tek-sunucu servis tanımı
install.sh                 Kurulum script'i
.env.example                Kullanılan ortam değişkenlerinin referans listesi
```

## Orijinal prodüksiyon mimarisi hakkında not

Bu proje aslında 7 ayrı sanal sunucuya dağıtılmış bir prodüksiyon ortamı
için tasarlandı (uygulama x2, DB primary+standby, veri servisleri, ops,
ML — `172.33.55.0/24` iç ağı, GitLab CI/CD ile Ansible tabanlı rolling
deployment). `platform/ansible/`, `platform/monitoring/` ve
`platform/nginx/gateway-nginx-snippet.conf` o ortamın referans dosyalarıdır
ve bu repodaki tek-sunucu kurulumu için **gerekli değildir** — sadece
orijinal DevOps tasarımını göstermek amacıyla saklanmaktadır. `.gitlab-ci.yml`
de aynı şekilde orijinal CI/CD pipeline'ının bir referansıdır.

Tek-sunucu sürümü, aynı servislerin tamamını Docker Compose ile tek
makinede, servis adı üzerinden birbirini bulacak şekilde çalıştırır —
mimari olarak birebir aynı, sadece dağıtım topolojisi farklıdır.

## Markalama doğrulaması

Repo, orijinal "Staffware" marka adından "HR360"a taşındı: ayrı bir
tanıtım/ana sayfası kaldırıldı, logo/başlık/giriş ekranı ve e-posta
bildirim şablonları (`notification-service/Email/*`) dahil tüm
kullanıcıya görünen metinler HR360 kimliğiyle güncellendi. Repo genelinde
periyodik olarak `grep -rniI "staffware" .` ile tekrar tarama yapılıyor.

## Güvenlik notu

- Repo'da hiçbir gerçek sır (parola, API anahtarı, sertifika) bulunmaz.
  Tüm sırlar `install.sh` tarafından kurulum anında üretilir/sorulur ve
  yalnızca `.gitignore`'da hariç tutulan `.env` ve
  `deploy/keycloak/realm-export.json` dosyalarında saklanır.
- Varsayılan olarak tüm veri servisi portları (`postgres`, `minio` konsolu,
  `keycloak` admin, `mlflow`, `mailpit`) yalnızca `127.0.0.1`'e bağlanır;
  dışarıya yalnızca gateway (80/`GATEWAY_PORT`) açılır. Gerçek bir sunucuya
  kurarken bu servislere uzaktan erişmek isterseniz bir SSH tüneli veya
  VPN kullanmanız önerilir.
