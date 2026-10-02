# HR360 Enterprise

Olay güdümlü, çok kiracılı, mikroservis tabanlı kurumsal İnsan Kaynakları
yönetim platformu. Bir bitirme projesi kapsamında geliştirilmiş, gerçek bir
7 sunuculu prodüksiyon ortamında çalışacak şekilde tasarlanmıştır.

Bu repo, aynı sistemi **tek bir sunucuda**, tek komutla (`./install.sh`)
ayağa kaldırabileceğiniz, taşınabilir bir sürümünü içerir — inceleme,
demo ve portföy amaçlı.

## Hızlı başlangıç

Gereksinimler: Docker Engine + Docker Compose v2 plugin (yoksa `install.sh` kurmayı
teklif eder), `curl` ve `openssl`.

```bash
git clone https://github.com/barisshn35/hr360-enterprise.git
cd hr360-enterprise
./install.sh
```

Script sizden birkaç parola/anahtar isteyecek — boş bırakırsanız güvenli,
rastgele değerler otomatik üretir. Sonunda erişim adreslerini ve demo giriş
bilgilerini ekrana basar. Repo içinde **hiçbir gerçek şifre veya anahtar
bulunmaz**; hepsi kurulum sırasında sizin makinenizde üretilir ve yalnızca
yerel `.env` dosyanızda (git'e dahil değil) saklanır.

İlk çalıştırma birkaç dakika sürebilir (13 .NET servisi, web arayüzü, MLflow ve
ML inference imajları build edilir; Keycloak, Kafka, PostgreSQL gibi bileşenler hazır
imajlardan çekilir). Durdurmak için `docker compose down`, logları izlemek
için `docker compose logs -f`.

Kendi bilgisayarınızda denemek için bütün soruları boş geçmeniz yeterli:
uygulama `http://localhost` adresinde açılır, e-postalar Mailpit'e düşer.

## Gerçek sunucuya kurulum

### 1. Sunucuyu hazırlayın

| | |
|---|---|
| İşletim sistemi | Ubuntu, Debian, RHEL, Rocky, AlmaLinux, Oracle Linux, Fedora, Amazon Linux, openSUSE/SLES, Arch, Alpine (Windows'ta WSL2, macOS'ta Docker Desktop). Docker yoksa `install.sh` kurmayı teklif eder. Sisteme özel adımlar: [docs/kurulum/isletim-sistemleri.md](docs/kurulum/isletim-sistemleri.md) |
| Disk | En az **40 GB** boş alan (imajlar ve derleme ~20 GB tutar). |
| Bellek | En az **8 GB**, önerilen **16 GB** RAM (container bellek limitlerinin toplamı ~10,5 GB; hepsi aynı anda dolmaz). |
| DNS | Alan adının (ör. `hr.sirket.com`) A kaydı sunucunun genel IP'sini göstermeli. |
| Firewall | Dışarıya yalnızca **80** ve **443** açık. SSH (22) yalnızca yönetim IP'lerine. |

Veritabanı, MinIO, Mailpit ve MLflow yalnızca sunucunun kendisine açılır
(`127.0.0.1`); dışarıdan erişmek için SSH tüneli kullanın.

### 2. Kurun

```bash
git clone https://github.com/barisshn35/hr360-enterprise.git hr360-enterprise
cd hr360-enterprise
./install.sh
```

Kurulumun sorduğu sorular:

| Soru | Gerçek sunucu için cevap |
|---|---|
| Public URL | `https://hr.sirket.com` (tarayıcıda kullanılacak adres, birebir) |
| Gateway portu | `80` (varsayılan; Let's Encrypt bunu gerektirir) |
| Keycloak yönetim paneli | Yönetim IP'niz sabitse `2` ve o IP; değilse `3` (ayrı port 8090'ı firewall'da kısıtlarsınız). Ayrıntı: [docs/runbooks/keycloak-yonetim-paneli-erisimi.md](docs/runbooks/keycloak-yonetim-paneli-erisimi.md) |
| HTTPS | `1`: Let's Encrypt, ücretsiz sertifika ve otomatik yenileme. Kendi sertifikanız varsa `2`. Ayrıntı: [docs/runbooks/https.md](docs/runbooks/https.md) |
| SMTP sunucusu | Gerçek e-posta sağlayıcınız (host, port, kullanıcı, parola, gönderen adres). Boş bırakılırsa Mailpit kullanılır ve **e-postalar kimseye ulaşmaz**. |
| Parolalar ve anahtarlar | Boş bırakın; güçlü değerler otomatik üretilir. |

Let's Encrypt başarısız olursa (DNS henüz yayılmadı, port kapalı) kurulum durmaz.
Uygulama HTTP ile açılır ve tekrar deneme komutu ekrana basılır.

### 3. Kontrol edin

- `https://hr.sirket.com` açılıyor ve `demo.admin` ile giriş yapılabiliyor mu?
- Kendinize bir çalışan kaydı açıp davet gönderin; e-posta geliyor mu?
- `scripts/tls.sh status` sertifikanın bitiş tarihini ve
  "Otomatik yenileme: calisiyor" satırını gösteriyor mu?
- `.env` dosyasını güvenli bir yere yedekleyin. Bütün parolalar bu dosyada ve git'e girmiyor.

Kurulum yalnızca örnek bir **demo** şirketiyle gelir. Gerçek şirketler uygulamadaki
kayıt ekranından açılır. Demo şirketini `platform.admin` hesabıyla askıya alabilirsiniz.

### Sonradan değiştirme ve güncelleme

| İş | Komut |
|---|---|
| HTTPS'i aç/kapat, sertifika değiştir | `scripts/tls.sh enable ... / disable / status` |
| TLS'i öndeki bir yük dengeleyici sonlandırıyorsa | `scripts/tls.sh external --host hr.sirket.com` |
| Keycloak paneli erişimi | `scripts/keycloak-admin-access.sh open / ip <IP,...> / port [IP,...] / status` |
| Yeni sürüme güncelleme | `git pull && ./install.sh` ("sırları yeniden üretelim mi?" sorusuna **Hayır**; veritabanı göçleri otomatik uygulanır) |

Yedeklenmesi gerekenler:
- PostgreSQL: `hr360_operational`, `keycloak` ve `hr360_mlflow` veritabanları
- MinIO verisi: logolar ve ML model dosyaları
- `.env` (bütün parolalar ve anahtarlar)
- `deploy/keycloak/realm-export.json`
- Sertifikalar: `deploy/letsencrypt/` ve kendi sertifikanızı kullanıyorsanız `deploy/nginx/tls/`

## Mimari

- **Kimlik doğrulama:** Keycloak (Organizations özelliği ile çok
  kiracılılık — her kiracı kendi Keycloak organizasyonuna karşılık gelir)
- **Mesajlaşma:** Apache Kafka (KRaft, tek node), Outbox (yayınlayan
  tarafta) + Inbox (`messaging_processed_events`, tüketen tarafta
  idempotency) desenleriyle
- **Veritabanı:** PostgreSQL — tüm servisler `hr360_operational`
  veritabanını, kendi tablo kümeleriyle ve ortak tenant filtreleme
  altyapısıyla izole şekilde paylaşır; Keycloak (`keycloak`) ve MLflow
  (`hr360_mlflow`) için aynı PostgreSQL'de ayrı veritabanları
- **Depolama:** MinIO (S3 uyumlu nesne depolama — logo ve ML artefact'ları)
- **Redis:** Compose'da çalışır, ancak servisler şu an kullanmıyor (önbellek için ayrılmış)
- **E-posta:** `install.sh` kurulumda SMTP sunucusunu sorar; boş
  bırakılırsa Mailpit (yerel SMTP yakalayıcı, demo/dev için — e-postalar
  gerçekten gönderilmez) kullanılır. Girilen ayar hem bildirim servisine
  (`.env` → `SMTP_*`) hem Keycloak'a (davet/şifre sıfırlama e-postaları,
  realm'in "Email" ayarı) yazılır. Kurulumdan sonra değiştirmek için ikisini
  birlikte güncelleyin.
- **ML:** MLflow tracking + Registry, FastAPI tabanlı inference servisi
  (işten ayrılma riski tahmini), Postgres backend store + MinIO artifact
  store
- **Gateway:** Nginx — path tabanlı routing (`/api/<servis>/`), `/auth/`
  üzerinden Keycloak'a, `/ml/` üzerinden inference servisine, `/logos/`
  üzerinden MinIO'ya passthrough. HTTPS (Let's Encrypt dahil) ve Keycloak
  yönetim paneli erişim kısıtı da burada yapılır. Her servisin tek kopyası
  çalışır; yük dengeleme yoktur.

Servisler birbirini Docker'ın dahili servis-adı DNS'i üzerinden bulur
(örn. `http://employee-service:8080`). Adresler `docker-compose.yml` içindeki ortam
değişkenlerinden gelir; koddaki varsayılanlar da aynı servis adlarıdır.

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
  nginx/                 Tek-sunucu gateway yapılandırması (tls/, acme/, keycloak-admin/ betiklerle doldurulur)
  postgres/              Ek veritabanlarının (keycloak, mlflow) init script'i
  keycloak/              Realm şablonu (sırlar kurulumda dolduruluyor)
  letsencrypt/           Let's Encrypt sertifikaları (git'e girmez)
scripts/
  tls.sh                 HTTPS aç/kapat (Let's Encrypt, kendi sertifika, kendinden imzalı)
  keycloak-admin-access.sh  Keycloak yönetim paneli erişimi (açık / IP kısıtı / ayrı port)
  sql/                   Mevcut kurulumlar için veritabanı göçleri (güncellemede otomatik)
platform/
  ansible/               Orijinal 7-VM dağıtımının Ansible playbook'ları (referans)
  monitoring/             Orijinal Prometheus scrape target tanımları (referans)
  nginx/                  Orijinal gateway nginx snippet'i (referans)
  keycloak-themes/        Keycloak giriş teması (tek sunucu kurulumu şu an yüklemiyor)
docs/
  architecture/           Mimari dokümanlar
  kurulum/                İşletim sistemlerine göre kurulum adımları
  runbooks/               HTTPS, Keycloak paneli erişimi, Keycloak veritabanı geçişi
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

Bu referans dosyalar olduğu gibi çalıştırılamaz: servis bazlı compose dosyaları ve
5001–5013 portları bu repoda yoktur, izleme ve gateway parçaları 13 servisin yalnızca
9'unu kapsar ve bazı servis–sunucu yerleşimleri birbirini tutmaz. Ayrıntılar dosyaların
başındaki notlarda.

Tek-sunucu sürümü, aynı servislerin tamamını Docker Compose ile tek
makinede, servis adı üzerinden birbirini bulacak şekilde çalıştırır. Uygulama
ve iş mantığı aynıdır; 7-VM tasarımındaki altyapı katmanları ise bu sürümde
yoktur: iki uygulama sunucusu arasında yedeklilik, PostgreSQL standby,
Prometheus/Grafana izleme ve NSX-V Edge yük dengeleyicisi. Not: referans
Ansible envanteri de servisleri iki uygulama sunucusuna **bölerek** dağıtır,
kopyalamaz.

## Beyaz etiketleme (şirkete özel marka)

Sistem çok kiracılıdır. Platformu kuran kişi (siz) platform sahibidir; platformu
kullanan her şirket (kiracı) kendi logosunu, ana rengini ve e-posta sunucusunu
tanımlayarak HR360'ın varsayılan markasının **yerine** kendi markasını gösterebilir.
Kod değiştirmeye gerek yoktur ve özellik, repoyu kuran herkes için hazır gelir.
Ancak her şirket için **plan** ile açılır.

### Kimler kullanabilir

| Koşul | Ayrıntı |
|---|---|
| Şirketin planı **Enterprise** olmalı | Uygulamadan kayıt olan her yeni şirket **Deneme (Trial)** planıyla başlar. Ödeme akışı olmadığı için planı platform yöneticisi yükseltir: `platform.admin` → **Kiracılar** → şirket → **Planı değiştir**. Kurulumla gelen **demo** şirketi Enterprise'dır. |
| Ayarı yapan kişi şirket yöneticisi olmalı | `tenant-admin` rolü ya da **Roller** sayfasından "şirket ayarlarını yönetme" (`tenant:manage`) ek izni verilmiş biri. Platform yöneticisi (`platform.admin`) bir şirkete üye olmadığı için bu ayarları yapamaz; planı değiştirir. |

Plan Enterprise değilse marka ayarları **Ayarlar** sayfasında hiç görünmez, API de reddeder.
Şirket adı ise bütün planlarda değiştirilebilir.

### Neler değiştirilebilir

Hepsi uygulamada **Ayarlar** sayfasındadır (`apps/web/src/features/settings/BrandingPanel.tsx`).

| Ayar | Nerede etkili olur |
|---|---|
| **Logo** | Panelde sol menünün üstü ve şirketin çalışanlarına giden bildirim e-postalarının başlığı. |
| **Ana renk** | Panelin ana rengi: butonlar, vurgular. Yazı rengi okunur kalacak şekilde otomatik seçilir. E-posta şablonları HR360 renginde kalır. |
| **Kendi SMTP sunucusu** | Uygulamanın bildirim e-postaları (izin, onay, hoş geldiniz vb.) şirketin kendi sunucusundan, kendi gönderen adresiyle gider. Parola şifrelenerek saklanır. **Davet ve parola sıfırlama e-postaları** Keycloak'tan, platformun kurulumda girilen SMTP'si üzerinden gitmeye devam eder. |

### Logo dosyası

- **Format:** PNG, JPEG veya WebP; en fazla **2 MB** (`LogoStorageService.cs`).
  **SVG kabul edilmez**: SVG içinde betik taşınabildiği ve logolar uygulamanın kendi
  alan adından sunulduğu için güvenlik nedeniyle kapatıldı. Dosya türü, dosya adına
  değil içeriğine bakılarak belirlenir.
- **Saklama:** MinIO'daki `tenant-logos` bucket'ı; gateway üzerinden `/logos/` yolundan sunulur.
- **Önerilen ebat:** Şeffaf arka planlı PNG ya da WebP. Kare logo için en az
  **256×256 px**, yatay (wordmark) logo için en az **512×160 px**. Sistem tek dosyayı
  her yerde otomatik küçültür.

| Kullanıldığı yer | Görüntülenen boyut | Kaynak |
|---|---|---|
| Sol menü | 36 px yükseklik, en fazla 64 px genişlik | `SidebarNav.tsx` |
| E-posta başlığı | en fazla 36 px yükseklik, 220 px genişlik | `EmailTemplateRenderer.cs` |

Bildirim servisi şirketin logosunu, adını ve SMTP ayarını `tenant-service`'ten çeker
ve 5 dakika önbellekte tutar. Değişiklikler e-postalara en geç 5 dakikada yansır.

### Markanın görünmediği yerler

- **Giriş ekranı** (`/giris` ve Keycloak giriş sayfası): Kullanıcı henüz giriş
  yapmadığı için hangi şirkete ait olduğu bilinmez; bu ekranlar platform markasıyla
  (HR360) kalır.
- **Platformun kendi markası** (HR360 adı, varsayılan logo ve renk) ayarlardan
  değiştirilemez; bunun için kod değişikliği gerekir. `platform/keycloak-themes/hr360`
  klasöründe Keycloak giriş sayfası için hazırlanmış bir tema var, ama tek sunucu
  kurulumu bu temayı şu an yüklemiyor.

## Güvenlik notu

- Repo'da hiçbir gerçek sır (parola, API anahtarı, sertifika) bulunmaz.
  Tüm sırlar `install.sh` tarafından kurulum anında üretilir/sorulur ve
  yalnızca `.gitignore`'da hariç tutulan dosyalarda saklanır: `.env`,
  `deploy/keycloak/realm-export.json` ve TLS özel anahtarları
  (`deploy/nginx/tls/`, `deploy/letsencrypt/`).
- Varsayılan olarak tüm veri servisi portları (`postgres`, `minio` konsolu,
  `keycloak` (8080), `mlflow`, `mailpit`) yalnızca `127.0.0.1`'e bağlanır;
  dışarıya yalnızca gateway açılır: 80 (`GATEWAY_PORT`), HTTPS açıkken 443 ve
  Keycloak paneli "ayrı port" modundaysa 8090. Bu servislere uzaktan erişmek
  için SSH tüneli veya VPN kullanın.
