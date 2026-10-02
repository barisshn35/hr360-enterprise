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

İlk çalıştırma birkaç dakika sürebilir (15 .NET servisi, web arayüzü, MLflow ve
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
| E-posta (SMTP) sunucusu | `scripts/smtp.sh set` (soru sorar), `scripts/smtp.sh test adres@sirket.com`, `scripts/smtp.sh status`, `scripts/smtp.sh mailpit` |
| Keycloak giriş ekranı teması (HR360 görünümü + Türkçe) | Kurulum ve güncelleme (`./install.sh`) sırasında otomatik uygulanır. Elle: `scripts/keycloak-theme.sh`; Keycloak'ın kendi temasına dönmek için `scripts/keycloak-theme.sh default` |
| Yeni sürüme güncelleme | `git pull && ./install.sh` ("sırları yeniden üretelim mi?" sorusuna **Hayır**; veritabanı göçleri otomatik uygulanır) |
| İzleme (Prometheus + Grafana + Loki) | `scripts/monitoring.sh enable / status / password / disable / purge` |
| Yedek al | `scripts/backup.sh [--keep 14] [--with-env] [--no-minio] [--out DİZİN]` |
| Yedekten dön | `scripts/restore.sh backups/hr360-….tar.gz [--with-env] [--only-db] [--yes]` |

### Yedekleme

`scripts/backup.sh` üç veritabanını (`hr360_operational`, `keycloak`,
`hr360_mlflow`) `pg_dump -Fc` ile, MinIO verisini (logolar, ML modelleri) dosya
düzeyinde tek bir `backups/hr360-YYYYmmdd-HHMMSS.tar.gz` arşivine yazar. Arşivde
`MANIFEST` ve `SHA256SUMS` bulunur; `--keep N` en yeni N yedeği tutar. Servisler
çalışırken alınabilir. `--with-env` `.env`'i de ekler: bütün parolalar ve
anahtarlar bu dosyadadır, arşivi buna göre saklayın.

`scripts/restore.sh` arşivi doğrular, uygulama konteynerlerini durdurur,
veritabanlarını **silip** arşivdekiyle yeniden oluşturur, MinIO'yu geri yükler ve
servisleri başlatır. Boş bir sunucuya taşırken önce `./install.sh`, sonra
`scripts/restore.sh <arşiv> --with-env` çalıştırın; veritabanı rol parolası
geri yüklenen `.env` ile eşitlenir.

Gece yedeği için cron örneği:

```
15 3 * * * cd /opt/hr360-enterprise && scripts/backup.sh --keep 30 >> backups/backup.log 2>&1
```

Arşive girmeyen ama ayrıca saklanması gerekenler: `deploy/keycloak/realm-export.json`
ve sertifikalar (`deploy/letsencrypt/`, kendi sertifikanızı kullanıyorsanız
`deploy/nginx/tls/`). Arşivleri sunucunun dışına da kopyalayın.

### İzleme

`scripts/monitoring.sh enable` isteğe bağlı `monitoring` profilini açar:
Prometheus (15 .NET servisi, ML servisi, PostgreSQL ve sunucu metrikleri),
Loki + Promtail (tüm konteyner logları, 7 gün) ve Grafana. Grafana
`<adres>/grafana/` altında açılır (kullanıcı `admin`, parola
`scripts/monitoring.sh password`). "HR360 — Servis sağlığı" panosu hazır gelir:
ayakta olan servisler, istek hızı, 5xx oranı, p95 süre, en yavaş uçlar,
bellek/CPU, PostgreSQL bağlantı ve boyutu, hata logları ve log araması. Temel
alarmlar (`deploy/monitoring/alerts.yml`) Prometheus'ta ve panoda görünür;
e-posta/Slack'e iletmek için Alertmanager eklenmedi. Yığın yaklaşık 1,4 GB bellek
sınırı ekler. Prometheus yalnızca sunucunun kendisinden (`127.0.0.1:9090`)
erişilebilir.

## Modüller

Ana İK süreçleri (çalışan, organizasyon, izin, onay akışı, vardiya/puantaj,
performans, eğitim, ücret, masraf, işe alım, işe giriş, bildirimler) dışında:

| Alan | Neler var |
|---|---|
| Çalışan deneyimi | Takdir duvarı (rozet, beğeni, liderlik tablosu), doğum günü ve iş yıl dönümü kutlamaları, self-servis profil (IBAN/TCKN doğrulama ve maskeleme, acil durum kişisi), yetenek dizini, ofis/masa rezervasyonu ve "kim nerede", mentorluk eşleştirme, iç ilan panosu, anket ve eNPS (3 yanıttan az grupta sonuç gösterilmez), ekran paylaşım modu (hassas alanlar bulanıklaşır), PWA olarak kurulum |
| Yönetici | Ekip sağlığı paneli (uzun süre izin kullanmama, fazla mesai, performans düşüşü, 1:1 aralığı ve ruh hâli işaretleri), 1:1 defteri (yöneticiye özel notlar, takvime ekleme), org senaryo planlama (taşıma/ekleme/çıkarma ve maliyet etkisi), ardıl planlama |
| İK ve uyum | Denetim kaydı ekranı (filtre, aynı istekte yapılanlar, CSV), KVKK (açık rıza, veri sahibi talepleri, JSON dışa aktarım, anonimleştirme, saklama süreleri), offboarding (kontrol listesi, zimmet iadesi, çıkış görüşmesi, kıdem/ihbar/izin hesabı), belge şablonları ve toplu yazdırma, kural motoru (olay → koşul → bildirim/webhook/Slack), toplu içe/dışa aktarım (Excel/CSV), bordro simülasyonu (2026 parametreleriyle brütten nete/netten brüte), işe alım saga'sı (teklif → çalışan kaydı → işe giriş planı) |
| İçgörü | Analitik (veritabanındaki `analytics_*` görünümlerinden), doğal dilde rapor ("son 6 ayda departmanlara göre izin günleri"), zaman makinesi (geçmiş bir tarihteki org yapısı), canlı olay radarı, İK asistanı (bilgi bankası + kendi verileriniz) |
| Entegrasyon | Webhook (HMAC imzalı, teslim geçmişi), API anahtarları ve açık REST API (`/api/governance/public/v1`, OpenAPI tanımı, dakikada 120 istek), Slack/Teams gelen webhook ve Slack slash komutu, kişisel takvim aboneliği (.ics), Google/Microsoft ile SSO (Keycloak Organizations), TOTP ile iki adımlı doğrulama zorunluluğu |
| Sunum | Org şeması sunum modu (tam ekran, klavye ile gezinme) |

### AI araçları hakkında

"AI" etiketli özelliklerin hiçbiri büyük dil modeli (LLM) kullanmaz ve dışarıya
veri göndermez. Hepsi `ml-inference` içinde kural tabanlı ve istatistiksel
yöntemlerle çalışır:

- **CV ayrıştırma:** PDF/DOCX/TXT'den metin çıkarma; e-posta, telefon, beceri,
  dil, eğitim ve deneyim yılı düzenli ifadeler ve sözlükle bulunur.
- **İlan yazıcı ve ayrımcı ifade uyarısı:** Şablonlu metin üretimi; yaş, cinsiyet,
  medeni durum, askerlik vb. ifadeler kural listesiyle işaretlenir.
- **Performans özeti, aday–ilan eşleşmesi, eğitim önerisi:** TF-IDF benzerliği ve
  ağırlıklı puanlama.
- **İzin tahmini:** Trend + mevsimsellik ile basit zaman serisi tahmini.
- **Doğal dilde rapor ve İK asistanı:** Türkçe anahtar kelime ayrıştırıcısı; tanınan
  kalıpları önceden yazılmış, kiracıya filtreli SQL şablonlarına çevirir. Serbest
  SQL üretilmez.

Bir LLM bağlamak bu uçların arkasına eklenebilir; şu an yapılandırılmış bir LLM
sağlayıcısı yoktur.

### Yapılandırma gerektirenler

| Özellik | Durum |
|---|---|
| Slack/Teams | Gelen webhook URL'si Entegrasyonlar ekranından girilir. Slack slash komutu için Slack'te bir uygulama açıp imzalama anahtarını girmeniz gerekir. Etkileşimli butonlar yok. |
| SSO | Google veya Microsoft (Azure AD) OAuth istemci kimliği ve sırrı Güvenlik ekranından girilir; e-posta alan adı organizasyona bağlanır. |
| E-posta | Bildirimler için SMTP (`scripts/smtp.sh set`). |

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
  realm'in "Email" ayarı) yazılır. Kurulumda boş bırakıldıysa ya da sonradan
  değişecekse `scripts/smtp.sh set` ikisini birlikte günceller.
- **ML:** MLflow tracking + Registry, FastAPI tabanlı inference servisi
  (işten ayrılma riski tahmini), Postgres backend store + MinIO artifact
  store. Aynı serviste `/ml/ai/*` altında AI araçları (bkz. aşağıda
  "AI araçları hakkında")
- **Denetim kaydı:** Bütün servislerde EF Core `SaveChanges` kesicisi her
  ekleme/güncelleme/silmeyi `audit_log` tablosuna yazar (kim, ne zaman, hangi
  alan eski → yeni). IBAN, TCKN, maaş gibi hassas alanlar `***` olarak
  maskelenir; anket yanıtları anonimlik için hiç kaydedilmez. Gateway her isteğe
  `X-Correlation-Id` verir, aynı istekte yapılan değişiklikler bu kimlikle
  gruplanır
- **Olaylar:** governance-service tüm `hr360.*` Kafka konularını dinler; olay
  radarı (SSE ile canlı akış), kural motoru, webhook'lar ve Slack/Teams
  bildirimleri bu akıştan beslenir
- **Açık kaynak varsayılanı:** Her kiracı bütün modülleri kullanır; plan
  kısıtı ve faturalandırma kapalıdır. SaaS olarak işletmek isteyen
  `.env`'de `PLAN_ENFORCEMENT=true` (modüller Trial / Standard / Enterprise
  planına göre açılır; sunucu `402` döner, arayüz menüden gizler) ve
  `BILLING_ENABLED=true` (abonelik ekranı ve aylık fatura üretimi; ödeme
  sağlayıcısı entegrasyonu yoktur) ayarlarını açabilir
- **Gateway:** Nginx — path tabanlı routing (`/api/<servis>/`), `/auth/`
  üzerinden Keycloak'a, `/ml/` üzerinden inference servisine, `/logos/`
  üzerinden MinIO'ya passthrough, `/grafana/` üzerinden Grafana'ya (izleme açıksa). HTTPS (Let's Encrypt dahil) ve Keycloak
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
  services/             15 mikroservis, her biri kendi Dockerfile'ıyla
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
    engagement-service/       Takdir, kutlamalar, profil/dizin, ofis ve masa, mentorluk,
                              iç ilanlar, 1:1, ardıl planlama, ekip sağlığı, org senaryoları,
                              anket/eNPS, offboarding
    governance-service/       Denetim kaydı, KVKK, belge şablonları, kural motoru, webhook,
                              API anahtarı ve açık API, Slack/Teams, faturalandırma,
                              takvim (.ics), analitik, zaman makinesi, olay radarı,
                              doğal dilde rapor, İK asistanı, işe alım saga'sı
data/
  migrations/            Tüm servislerin birleşik SQL şeması
deploy/
  nginx/                 Tek-sunucu gateway yapılandırması (tls/, acme/, keycloak-admin/ betiklerle doldurulur)
  postgres/              Ek veritabanlarının (keycloak, mlflow) init script'i
  keycloak/              Realm şablonu (sırlar kurulumda dolduruluyor) ve themes/hr360 giriş ekranı teması
  letsencrypt/           Let's Encrypt sertifikaları (git'e girmez)
  monitoring/            Prometheus, alarm kuralları, Loki/Promtail ve Grafana (pano + veri kaynakları)
scripts/
  tls.sh                 HTTPS aç/kapat (Let's Encrypt, kendi sertifika, kendinden imzalı)
  keycloak-admin-access.sh  Keycloak yönetim paneli erişimi (açık / IP kısıtı / ayrı port)
  smtp.sh                E-posta (SMTP) sunucusunu sonradan ayarlama/deneme
  keycloak-theme.sh      Keycloak giriş ekranını HR360 temasına ve Türkçeye alma
  monitoring.sh          İzleme yığınını aç/kapat, durum, Grafana parolası
  backup.sh, restore.sh  Yedek alma ve yedekten dönme
  sql/                   Mevcut kurulumlar için veritabanı göçleri (güncellemede otomatik)
platform/
  ansible/               Orijinal 7-VM dağıtımının Ansible playbook'ları (referans)
  monitoring/             Orijinal Prometheus scrape target tanımları (referans)
  nginx/                  Orijinal gateway nginx snippet'i (referans)
docs/
  architecture/           Mimari dokümanlar
  kurulum/                İşletim sistemlerine göre kurulum adımları
  runbooks/               HTTPS, Keycloak paneli erişimi, Keycloak veritabanı geçişi
.github/workflows/ci.yml   CI: arayüz derlemesi, 15 .NET servisi, ML testleri, compose/nginx/Prometheus/
                           shellcheck/SQL doğrulaması; main'de Docker imajı derlemesi
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
yoktur: iki uygulama sunucusu arasında yedeklilik, PostgreSQL standby ve
NSX-V Edge yük dengeleyicisi. Prometheus/Grafana izleme bu sürümde isteğe bağlı
`monitoring` profiliyle gelir (`scripts/monitoring.sh enable`). Not: referans
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
  değiştirilemez; bunun için kod değişikliği gerekir: panel renkleri
  `apps/web/src/styles/index.css`, Keycloak giriş sayfası
  `deploy/keycloak/themes/hr360` klasöründedir.

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
