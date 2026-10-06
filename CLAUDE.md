# HR360 — Claude Code çalışma notu

Bu dosya, bu repoda çalışan Claude Code oturumları içindir (geliştirme VM'i dahil). Proje sahibiyle
iletişim **Türkçe**. Ürün belgeleri: `README.md`, `docs/` (mimari, güvenlik, KVKK, dil, runbook'lar).

## Kesin kurallar
- **Güvenlik duvarı:** Sunucunun kendi güvenlik duvarına (ufw/firewalld) ASLA dokunma — etkinleştirme,
  kural ekleme yok. İzin gerekiyorsa dış güvenlik duvarından (bulut güvenlik grubu, vCloud Edge) verilir;
  betikler yalnızca uyarır.
- **Gizli dosyalar commit'lenmez:** `.env`, `tests/credentials.json` (gitignore'da). Token/parola
  çıktıya basılmaz. Repo herkese açık olabilir; dökümleri (pg_dump vb.) repoya koyma.
- **Dış entegrasyonlar** (Slack, Teams, Google, Microsoft, Zoom, LLM, SMTP, Web Push, SCIM, AD...) gerçek
  hesaplarla denenmedi; sahte sunucuyla (`tests/integration/chatmock.py`) test edilir. Raporlarda böyle belirt.
- **KVKK birinci sınıf gereksinim:** veri en aza indirme, özel nitelikli veri yok (gerekmedikçe),
  5'ten küçük gruplar gösterilmez, otomatik karar yok (insan onayı), hassas alanlar `enc1:` AES-256-GCM
  (`TENANT_SECRET_KEY`), hassas görüntüleme/dışa aktarma `audit_log`'a yazılır, `audit_log` UPDATE edilemez.
- **Commit:** her mantıklı adımda `main`'e commit + push; mesaj Türkçe. Sonra CI kontrol:
  `gh api "repos/barisshn35/hr360-enterprise/actions/runs?per_page=3" --jq '.workflow_runs[] | "\(.head_sha[0:7]) \(.status) \(.conclusion)"'`

## Mimari özeti
- .NET 9 mikroservisler (`apps/services/*`), tek PostgreSQL (`hr360_operational`; ayrıca `keycloak`,
  `hr360_mlflow`), Kafka outbox, Keycloak 25 (organizasyon = kiracı), Redis/Valkey, MinIO.
- nginx gateway: dışarıdan `/api/<servis>/X` → serviste `/api/X` (compensation çift:
  `/api/compensation/compensation/...`). `/api/<servis>/internal/` dışarıya kapalı.
- Servisler arası iç uçlar: `/api/internal/...`, başlık `X-Internal-Token` (= `INTERNAL_SERVICE_TOKEN`,
  `CryptographicOperations.FixedTimeEquals`, yanlışsa 404). Bot (governance `Infrastructure/Chat/`)
  başka servislerin tablolarına YAZMAZ; `ChatInternal.PostAsync` ile sahibi servisin iç ucunu çağırır.
- E-imza: tek motor governance `Infrastructure/SignatureEngine.cs`; expense iç uçlarla kullanır.
- Web: React + Vite (`apps/web`), her Türkçe metin `tx()` ile; İngilizce `src/locales/en.json`.
- ML: FastAPI `apps/ml-inference` (scikit-learn, SHAP, MLflow; LLM yok). Devir modeli şimdilik sentetik veriyle.
- Tenancy: varlıklar `ITenantOwned` + `.ConfigureTenantColumn()`; EF tablo OLUŞTURMAZ.

## Veritabanı değişikliği
1. `scripts/sql/YYYY-MM-DD_<konu>.sql` — idempotent (`IF NOT EXISTS`), tırnaklı PascalCase sütunlar,
   `"TenantSlug" varchar(64) NOT NULL`, uuid PK, timestamptz. Canlıya uygula:
   `docker exec -i hr360-postgres-1 psql -v ON_ERROR_STOP=1 -q -U hr360admin -d hr360_operational < dosya`
2. Aynı içeriği `data/migrations/sql-all-schemas.sql` sonuna `-- ===== YYYY-MM-DD_<konu>` başlığıyla ekle.
3. Boş veritabanında doğrula (postgres:18-alpine geçici konteynerde tüm dosyayı ON_ERROR_STOP ile uygula).

## Derleme, dağıtım, test
- Servis derle/dağıt: `docker compose build -q <svc> && docker image prune -f && docker compose -f docker-compose.yml -f deploy/testing/chat-mock.yml --profile ldaptest up -d <svc>`
- Testler: `scripts/test.sh unit | integration | e2e | all`
  - unit: .NET xUnit (`tests/dotnet/*`), Vitest (`apps/web`), ML pytest.
  - integration: 24 Python betiği (`tests/integration/test_*.py`), chatmock ve OpenLDAP'ı kendisi başlatır.
    Her betik `FAILS: n` yazar. Kullanıcılar `tests/credentials.json` (ayse=çalışan, mehmet=yönetici,
    admin=İK+şirket yöneticisi, platform=platform yöneticisi, ik=Elif Şahin: çalışan kaydı olan İK yöneticisi ve
    üst onaycısı olmayan taleplerin İK onaycısı). Testler sabit demo verisine dayanır
    (Ayşe `0e879b9e-d72b-489f-aa5b-8291e0bcbefb`, Mühendislik departmanı; temiz kurulumda `tests/support/seed_demo.py`) — bkz. "Demo verisi".
  - Platform yöneticisi kiracı verisine yalnızca süreli erişim izniyle (`/api/tenant/platform-access/grants`)
    ulaşır; bordro dönemini hesaplayan kişi kapatamaz (testlerde dönemi `ik` kapatır).
  - e2e: Playwright (`tests/e2e`), `pip install pytest playwright && playwright install --with-deps chromium`.
  - Test kalıntıları: integration ve e2e sonunda (başarısız olsalar da) `tests/support/cleanup_test_data.py`
    çalışır; test işaretli kayıtları (izin/akış/bildirim vb.) tek transaction'da siler, izin bakiyelerini
    yeniden hesaplar. Elle: `python3 tests/support/cleanup_test_data.py [--dry-run]`. Yeni test kayıt
    bırakıyorsa işaretini (gerekçe/başlık öneki) bu betiğe ekle; demo seed verisine dokunma.
- `deploy/nginx/nginx.conf` değişince gateway'i yeniden oluştur: `docker compose ... up -d --force-recreate --no-deps gateway`.
  Dosya tek başına bağlı (bind mount); düzenleyici dosyayı yeni kopyayla değiştirirse konteyner eskisini görür ve
  `nginx -s reload` hiçbir şey değiştirmez. Doğrula: `docker exec hr360-gateway-1 grep -c <yeni satır> /etc/nginx/nginx.conf`.
- Arayüz tip kontrolü: `cd apps/web && npx tsc -b --noEmit`
- Çeviri: `cd apps/web && node scripts/i18n-check.mjs --missing` (eksik anahtarlar), ekledikten sonra
  `node scripts/i18n-check.mjs --write`. Sunucu iletileri `"@server:<Türkçe metin>"` anahtarıyla.
- Bir dalga bittiğinde: değişen servisleri derle/dağıt → `scripts/test.sh all` → commit/push → CI.

## Demo verisi
Repo seed verisi içermez; demo şirketi (`demo`), Ayşe/Mehmet ve test verisi canlı veritabanındadır.
Yeni ortama taşıma: kaynak ortamda `scripts/backup.sh --with-env --no-encrypt`, hedefte
`scripts/restore.sh <arsiv> --with-env --yes`. Şifreli alanlar `.env`'deki anahtarlarla (TENANT_SECRET_KEY vb.)
açıldığından veri ve `.env` birlikte taşınmalıdır. Arşiv ve `tests/credentials.json` tüm parolaları içerir:
taşımayı proje sahibi kendisi yapar, işi bitince siler. Taşınmazsa: `install.sh` ile temiz kurulum yapılır,
demo şirketi ve test kullanıcıları yeniden oluşturulur ve integration testlerindeki sabit kimlikler
(ör. Ayşe'nin çalışan kimliği) buna göre güncellenir.

## Açık işler / yol haritası
- ML önerileri (onay bekliyor): kişisel veri dedektörü (serbest metinde TCKN/IBAN/sağlık/sabıka uyarısı),
  devir modelini gerçek veriyle eğitme (kiracı izni, zaman bazlı doğrulama), olasılık kalibrasyonu,
  eşik ayarı, şampiyon/aday model (MLflow, İK onayıyla terfi), adillik denetimi (≥5 grup), masraf/bordro/
  puantaj anomalisi, e-Fatura QR okuma, vardiya planı optimizasyonu (OR-Tools; 11 saat dinlenme, 45 saat
  hafta), izin tahmininde mevsimsellik, anket konu çıkarma, beceri çıkarımı, ücret adaleti analizi.
  Büyük modeller (BERT vb.) isteğe bağlı olmalı; veri yurt dışına çıkmaz.
- Proje sahibi büyük listeleri dalgalar hâlinde, her dalgadan sonra test ederek ister; küçük partiler tercih.
