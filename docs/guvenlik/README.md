# HR360 güvenlik notları

Bu belge sistemde hangi korumaların nerede olduğunu, düzenli taramaların nasıl
çalıştırıldığını ve bilinen, kabul edilmiş riskleri anlatır. Kurulum sırasında
yapılması gerekenler en sondaki kontrol listesindedir.

## Katmanlar

| Katman | Koruma | Nerede |
|---|---|---|
| Kimlik | Keycloak (OIDC, PKCE), isteğe bağlı TOTP zorunluluğu, kaba kuvvet koruması, Google/Microsoft SSO | `deploy/keycloak/realm-export.template.json` |
| Yetki | Rol ve izin denetimi her serviste (`[Authorize]` + izin politikaları); arayüz yalnızca görünürlük için aynı kuralları kullanır | `apps/services/*/Program.cs` |
| Kiracı yalıtımı | EF Core genel sorgu filtresi (`ITenantOwned`), ham SQL'de `tenant_id` koşulu | servislerin `DbContext`'leri |
| Ağ | Dışarıya yalnızca gateway açık; veritabanı, MinIO, Keycloak (8080), MLflow yalnızca `127.0.0.1` | `docker-compose.yml` |
| Gateway | Hız sınırı, güvenlik başlıkları, iç uçların kapatılması | `deploy/nginx/nginx.conf` |
| Arayüz | Katı içerik güvenliği politikası (CSP), satır içi betik yok | `apps/web/docker/security-headers.conf` |
| Giriş ekranı | Keycloak CSP'si sıkılaştırıldı | `scripts/keycloak-theme.sh` |
| Sırlar | `.env` dışında repo'da sır yok; kiracı sırları (SMTP parolası, SSO, Slack/Teams/takvim istemci sırları) AES-256-GCM ile şifreli | `SecretBox` (governance), tenant-service |
| Servisler arası | İç uçlar `X-Internal-Token` ister ve gateway'den erişilemez (404) | workflow-service `api/internal/*` |
| Dış entegrasyonlar | Webhook'lar HMAC imzalı; Slack istekleri imzalı (5 dk pencere), Teams istekleri Bot Framework JWT'si ile doğrulanır; takvim bağlantısı OAuth2 + PKCE | governance-service |
| Yapay zekâ | Kiracı açmadıkça modele istek gitmez; kişisel veri ayrı izne bağlı, gönderilmeden önce takma ad kullanılır; kullanım kaydında içerik tutulmaz | `Infrastructure/Ai/LlmClient.cs` |
| Konteynerler | Hiçbir uygulama konteyneri root çalışmaz | Dockerfile'lar |
| Denetim | Önemli işlemler denetim kaydına yazılır | governance `audit` |

### Gateway hız sınırı

| Bölge | Sınır | Uygulandığı yer |
|---|---|---|
| `hr360_api` | IP başına 50 istek/sn, 200 isteklik tampon | tüm sunucu |
| `hr360_login` | IP başına 10 istek/sn, 30 isteklik tampon | `/auth/` (Keycloak) |

Sınır aşılınca `429` döner. Özel ağ adresleri (`10/8`, `172.16/12`, `192.168/16`,
`127/8`) muaftır: servisler arası trafik ve ters vekil arkasındaki kurulumlar
etkilenmez. Gateway başka bir vekilin arkasındaysa gerçek istemci adresinin
görülmesi için `real_ip` ayarı eklenmelidir; aksi halde tüm istekler vekilin özel
adresinden geliyor görünür ve sınır uygulanmaz.

Sayaçlar her gateway örneğinin belleğindedir. Birden çok gateway çalıştırılırsa
sınır örnek başına uygulanır.

### Güvenlik başlıkları

Gateway her yanıta `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`,
`Permissions-Policy` (kamera, mikrofon, konum, ödeme, USB kapalı) ve
`Cross-Origin-Resource-Policy: same-origin` ekler. Sürüm bilgisi (`server_tokens`)
gizlidir. HTTPS, güvenilir bir sertifikayla açıldığında (`scripts/tls.sh enable
--cert/--letsencrypt`) `Strict-Transport-Security: max-age=15552000` eklenir.
Kendinden imzalı sertifikada HSTS bilerek eklenmez: tarayıcı o durumda uyarıyı
geçmeye izin vermez ve site aylarca açılamaz.

Arayüzün CSP'si:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';
frame-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none';
base-uri 'self'; form-action 'self'; frame-ancestors 'self'
```

Satır içi betik yoktur: tema ön yüklemesi (`public/theme-init.js`) ve Keycloak
sessiz oturum denetimi (`public/silent-check-sso.js`) ayrı dosyadadır. Yeni bir
`<script>` bloğu eklemek CSP'yi bozar; e2e testleri konsoldaki CSP ihlalini hata
sayar.

## Taramalar

```bash
scripts/security-scan.sh repo     # Trivy: bağımlılıklar (npm, pip, NuGet), sızmış sırlar, Dockerfile/compose hataları
scripts/security-scan.sh deps     # npm audit + dotnet list package --vulnerable
scripts/security-scan.sh images   # çalışan kurulumun imajları (işletim sistemi paketleri dahil)
scripts/security-scan.sh          # hepsi
```

Yalnızca HIGH ve CRITICAL bulgular raporlanır. Bulgu varsa çıkış kodu 1'dir.
Trivy sürümü özet değeriyle (`sha256`) sabitlenmiştir.

CI'da (`.github/workflows/ci.yml`) her push'ta `security` işi depo taramasını,
`npm audit`'i ve NuGet denetimini çalıştırır. `main`'e push'ta derlenen imajlar
düzeltmesi yayımlanmış CRITICAL açıklar için ayrıca taranır.

Dinamik tarama için OWASP ZAP'in temel taraması kullanıldı (aşağıda). Tekrarlamak
için:

```bash
docker run --rm --network hr360-net -v "$PWD:/zap/wrk" ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t http://gateway/ -m 2 -r zap.html
```

## Ekim 2026 taraması ve yapılan düzeltmeler

| Bulgu | Önem | Düzeltme |
|---|---|---|
| `xlsx` 0.18.5 (SheetJS): dosya okurken prototip kirletme ve ReDoS (CVE-2023-30533, CVE-2024-22363). Çalışan ve masraf içe aktarımı kullanıcı dosyası okuyordu. | HIGH | npm'deki son sürüm düzeltmeyi içermiyor. `read-excel-file` ve `write-excel-file`'a geçildi (`src/lib/spreadsheet.ts`). Eski ikili `.xls` biçimi artık okunmaz; kullanıcıya `.xlsx` olarak kaydetmesi söylenir. CSV okuma eklendi. |
| MLflow 2.17.2: 8 CRITICAL, 15 HIGH açık (yol geçişi, uzaktan kod çalıştırma vb.) | CRITICAL | İstemci ve sunucu 3.16.1'e yükseltildi. Sunucu açılışta şemayı günceller (`mlflow db upgrade`), Host başlığı denetimi açık, arka plan iş yürütücüsü kapalı. |
| `pypdf` 5.1.0 (CV ayrıştırma): 10 açık | HIGH | 6.19.0 |
| `python-multipart` 0.0.17, `starlette` 0.41.3 | HIGH | 0.0.32; FastAPI 0.142.2 + Starlette 1.7.0 (başlangıç kancası `lifespan`'e taşındı) |
| Taban imajlarda OpenSSL, pcre2, util-linux, gzip paketleri | HIGH | Dockerfile'larda `apt-get upgrade` / `apk upgrade` ve `pip`/`setuptools`/`wheel` güncellemesi |
| 18 Dockerfile root kullanıcıyla çalışıyordu (DS002) | HIGH | .NET servisleri `$APP_UID` (1654), arayüz `nginx-unprivileged` (101), ML imajları UID 10001 |
| MLflow veritabanı parolası süreç listesinde (`ps`) görünüyordu | Orta | Bağlantı dizesi ortam değişkenine taşındı |
| Arayüzde satır içi betikler; CSP yoktu | Orta | Betikler dosyaya taşındı, katı CSP |
| Keycloak giriş ekranında yalnızca çerçeve kısıtı vardı | Orta | `default-src 'self'` tabanlı CSP |
| Gateway'de hız sınırı yoktu | Orta | `hr360_api` ve `hr360_login` bölgeleri |
| Çalışan içe aktarımında "İşe giriş tarihi" başlığı tanınmıyordu (JavaScript'te `"İ".toLowerCase()` birleşik nokta üretir) | İşlev hatası | Başlık eşleştirme Türkçe harflere göre düzeltildi |

Taramanın son durumu: Trivy (depo ve imajlar) HIGH/CRITICAL bulgu yok, `npm audit`
0 açık, 15 .NET servisinde bilinen açıklı NuGet paketi yok. ZAP temel taraması:
0 FAIL. Kalan uyarılar aşağıda.

## Bilinen ve kabul edilen riskler

- **`style-src 'unsafe-inline'`** (ZAP uyarısı 10055): React bileşenleri ve
  animasyon kütüphanesi `style` özniteliği kullanır. Betik çalıştırmaya izin
  vermediği için risk düşüktür.
- **Keycloak giriş ekranında `script-src 'unsafe-inline'`**: Keycloak'ın kendi
  şablonları satır içi betik kullanır. Kullanıcı girdisi bu sayfalarda Keycloak
  tarafından kaçışlanır.
- **`KEYCLOAK_LOCALE` çerezi `SameSite=None`**: Keycloak'ın varsayılanı; oturum
  bilgisi taşımaz.
- **MLflow model yükleme**: Kayıtlı modeller pickle biçimindedir; model kaydına
  yazabilen biri sunucuda kod çalıştırabilir (CVE-2024-37059 türü). MLflow
  dışarıya kapalıdır (`127.0.0.1:5000`) ve kimlik doğrulaması yoktur; erişimi
  yalnızca sunucu yöneticisine verin.
- **Hız sınırı gateway belleğinde**: çok örnekli kurulumda örnek başınadır.
- **E-posta ile davet ve parola sıfırlama** Keycloak'ın SMTP ayarına bağlıdır;
  SMTP TLS'siz (25) yapılandırılırsa bu iletiler şifresiz gider.

## Kurulum kontrol listesi

1. HTTPS'i güvenilir bir sertifikayla açın: `scripts/tls.sh enable --letsencrypt ...`
   ya da `--cert/--key`. Slack, Teams, takvim ve Zoom entegrasyonları HTTPS ister.
2. `.env` dosyasını yalnızca root okuyabilsin: `chmod 600 .env`. Yedeklerde
   `--with-env` kullanıyorsanız arşivi de aynı şekilde saklayın.
3. Keycloak yönetim panelini kapalı ya da IP'ye kısıtlı tutun:
   `scripts/keycloak-admin-access.sh ip <adres>`.
4. Yönetici hesaplarında iki adımlı doğrulamayı zorunlu yapın (Güvenlik ekranı).
5. Sunucuda yalnızca 80/443 (ve gerekiyorsa 8090) açık olsun.
6. Ayda bir `scripts/security-scan.sh` çalıştırın; imajları güncellemek için
   `docker compose build --pull && docker compose up -d`.
