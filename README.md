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
| Alan adı ya da adres | `hr.sirket.com`. Alan adı girilince adres `https://hr.sirket.com`, port 80 ve HTTPS Let's Encrypt olur; port ve HTTPS ayrıca sorulmaz. |
| Keycloak yönetim paneli | Yönetim IP'niz sabitse `2` ve o IP; değilse `3` (ayrı port 8090'ı firewall'da kısıtlarsınız). Ayrıntı: [docs/runbooks/keycloak-yonetim-paneli-erisimi.md](docs/runbooks/keycloak-yonetim-paneli-erisimi.md) |
| Yönetici e-postası | Sertifika bildirimleri ve sistem uyarıları (Alertmanager) bu adrese gider; SMTP deneme e-postası da buraya gönderilir. |
| Gönderen e-posta adresi | `ik@sirket.com`. Sunucu ve port adresten bulunur (aşağıya bakın); kullanıcı adı varsayılan olarak bu adrestir, yalnızca parola sorulur. Boş bırakılırsa Mailpit kullanılır ve **e-postalar kimseye ulaşmaz**. |
| Parolalar ve anahtarlar | Boş bırakın; güçlü değerler otomatik üretilir. |

Alan adıyla kurulumda zorunlu iki adım kendiliğinden yapılır:

- **HTTPS.** Sunucunun kendi güvenlik duvarına (ufw/firewalld) dokunulmaz: devreye alınmaz,
  kural eklenmez. Erişim izni dış güvenlik duvarında verilir (aşağıya bakın); yerel duvar
  çalışıyor ve 80/443'ü engelliyorsa yalnızca uyarı basılır. Alan adının DNS kaydının bu sunucunun genel IP'sini
  gösterip göstermediği denetlenir; göstermiyorsa eklenecek kayıt (`hr.sirket.com A 203.0.113.10`)
  ekrana basılır. Kayıt build sürerken eklenebilir. Sertifika kurulumun sonunda istenir.
  DNS o zamana kadar yayılmadıysa ya da 80 dışarıdan kapalıysa kurulum durmaz: HTTPS
  geçici, kendinden imzalı bir sertifikayla açılır ve Let's Encrypt saatte bir kendiliğinden
  yeniden denenir (systemd zamanlayıcı, yoksa cron). Sertifika alınınca gerçek sertifikaya
  geçilir ve zamanlayıcı kaldırılır. DNS denetlenmeden certbot çalıştırılmaz; böylece
  Let's Encrypt'in saatlik deneme sınırı harcanmaz.
- **E-posta.** Sunucu gönderen adresten bulunur: Gmail ve Google Workspace, Microsoft 365,
  Outlook/Hotmail, Yandex, Yahoo, iCloud, Zoho. Kendi alan adınızda (`ik@sirket.com`)
  sağlayıcı MX kaydından tanınır. Gmail ve Microsoft 365 için uygulama şifresi / SMTP AUTH
  notu gösterilir. Ayar, yönetici e-postasına bir deneme e-postası gönderilerek
  doğrulanır. Gönderilemezse hata nedeni (parola, kapalı port, sunucu adı) gösterilir ve
  bilgileri yeniden girme, yine de devam etme ya da Mailpit seçenekleri sunulur.

Kurulumun sonunda HTTPS, sertifika, HTTP→HTTPS yönlendirmesi ve giriş (Keycloak) adresi
denetlenip özette gösterilir (`scripts/tls.sh verify`).

Soru sormadan kurulum (otomasyon, bulut başlangıç betiği):

```bash
HR360_SMTP_PASSWORD='uygulama-sifresi' ./install.sh --yes \
  --domain hr.sirket.com --email it@sirket.com --smtp-from ik@sirket.com
```

Tüm seçenekler: `./install.sh --help` (`--url`, `--tls`, `--cert/--key`, `--smtp-host`,
`--smtp-port`, `--smtp-user`, `--no-smtp-test`, `--keycloak-admin` ...). Verilmeyen her şey
için varsayılan kullanılır, sırlar rastgele üretilir. Mevcut kurulumda `--yes` güncelleme yapar.

80 ve 443/tcp dış güvenlik duvarında gelen trafiğe açılmalıdır: bulut güvenlik grubu
(AWS Security Group, Azure NSG, GCP firewall) ya da vCloud Director'da Edge Gateway firewall
kuralı ve genel IP'den sunucuya DNAT. Betik bunları ayarlamaz.

### 3. Kontrol edin

- `https://hr.sirket.com` açılıyor ve `demo.admin` ile giriş yapılabiliyor mu?
- Kendinize bir çalışan kaydı açıp davet gönderin; e-posta geliyor mu?
- `scripts/tls.sh status` sertifikanın bitiş tarihini ve
  "Otomatik yenileme: calisiyor" satırını gösteriyor mu? Geçici sertifikayla açıldıysa
  `scripts/tls.sh check` neyin eksik olduğunu (DNS, port) söyler.
- `.env` dosyasını güvenli bir yere yedekleyin. Bütün parolalar bu dosyada ve git'e girmiyor.

Kurulum yalnızca örnek bir **demo** şirketiyle gelir. Gerçek şirketler uygulamadaki
kayıt ekranından açılır. Demo şirketini `platform.admin` hesabıyla askıya alabilirsiniz.

### Sonradan değiştirme ve güncelleme

| İş | Komut |
|---|---|
| HTTPS'i aç/kapat, sertifika değiştir | `scripts/tls.sh enable ... / disable / status` |
| Let's Encrypt (olmazsa geçici sertifika + saatlik yeniden deneme) | `scripts/tls.sh auto --host hr.sirket.com --email it@sirket.com`; ön koşullar `scripts/tls.sh check`, hemen dene `scripts/tls.sh retry`, uçtan uca denetim `scripts/tls.sh verify` |
| TLS'i öndeki bir yük dengeleyici sonlandırıyorsa | `scripts/tls.sh external --host hr.sirket.com` |
| Keycloak paneli erişimi | `scripts/keycloak-admin-access.sh open / ip <IP,...> / port [IP,...] / status` |
| E-posta (SMTP) sunucusu | `scripts/smtp.sh set --from ik@sirket.com --password '…'` (sunucu adresten bulunur), `scripts/smtp.sh set` (soru sorar), `scripts/smtp.sh test adres@sirket.com`, `scripts/smtp.sh status`, `scripts/smtp.sh mailpit` |
| Keycloak giriş ekranı teması (HR360 görünümü + Türkçe) | Kurulum ve güncelleme (`./install.sh`) sırasında otomatik uygulanır. Elle: `scripts/keycloak-theme.sh`; Keycloak'ın kendi temasına dönmek için `scripts/keycloak-theme.sh default` |
| Yeni sürüme güncelleme (tek komut, otomatik geri dönüş) | `scripts/update.sh` (önce yedek, sonra sürüm, göçler, imajlar ve tüm servislerin sağlık denetimi; denetim geçmezse önceki sürüme döner). `scripts/update.sh --ref v2.1`, `scripts/update.sh rollback`, `scripts/update.sh status` |
| İzleme (Prometheus + Grafana + Loki + Alertmanager) | `scripts/monitoring.sh enable / status / password / disable / purge` |
| Alarm kanalları (e-posta, Slack, Teams) | `scripts/monitoring.sh alerts status / email … / slack … / teams … / test` |
| Testler | `scripts/test.sh unit / integration / e2e / all` (ayrıntı: [tests/README.md](tests/README.md)) |
| Yük testi | `scripts/loadtest.sh smoke / load / stress` |
| Güvenlik taraması | `scripts/security-scan.sh repo / deps / images` (Trivy, npm audit, NuGet) |
| Yedek al | `scripts/backup.sh [--keep 14] [--with-env] [--no-minio] [--out DİZİN]` |
| Gece yedeği + haftalık geri yükleme testi | `scripts/backup.sh schedule --at 03:15 --keep 30 --verify-weekly`, kaldırmak için `unschedule`, durum `scripts/backup.sh status` |
| Yedeği doğrula (geçici veritabanına geri yükler) | `scripts/backup.sh verify [arşiv]` |
| Yedekten dön | `scripts/restore.sh backups/hr360-….tar.gz[.enc] [--with-env] [--only-db] [--yes]` |

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

**Şifreleme (KVKK m.12).** Kurulum `.env`'e `BACKUP_ENCRYPTION_KEY` yazar; arşiv
AES-256 ile şifrelenir (`hr360-….tar.gz.enc`). Anahtar olmadan yedek açılamaz: anahtarı
yedeklerden ayrı bir yerde (parola kasası) saklayın.

**Zamanlama ve doğrulama.** `scripts/backup.sh schedule --at 03:15 --keep 30 --verify-weekly`
her gece yedek alır, Pazar günleri son yedeği ağa bağlı olmayan geçici bir PostgreSQL
konteynerine geri yükleyip tabloları sayar (`backups/verify.log`, `DOGRULANDI`/`DOGRULANAMADI`).
Üretim veritabanına dokunulmaz.

**Dış depo.** `.env`'e `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY`,
`BACKUP_S3_SECRET_KEY` (isteğe bağlı `BACKUP_S3_PREFIX`) yazılırsa her yedek S3 uyumlu depoya
(MinIO, Ceph, yerli bulut) da gönderilir. Yalnızca şifreli arşiv gönderilir. Uç nokta yurt
dışındaki bilinen bir sağlayıcıysa (AWS, Azure, GCP, Backblaze, Wasabi, Cloudflare R2…) KVKK
m.9 dayanağı olmadan gönderilmez; dayanak varsa `BACKUP_S3_ABROAD_OK=1`.

**Geri yüklemede KVKK.** Yedekten sonra imha edilmiş kayıtlar geri gelebileceği için
`restore.sh` bittiğinde etkin saklama politikaları hemen yeniden çalışır (imha tutanağında
"Geri yükleme sonrası"). Yedek tarihinden sonra yerine getirilmiş silme başvurularını KVKK ›
Başvurular ekranından kontrol edin.

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
bellek/CPU, PostgreSQL bağlantı ve boyutu, hata logları ve log araması.

Alarm kuralları (`deploy/monitoring/alerts.yml`: servis erişilemiyor, 5xx oranı,
yavaş yanıt, bellek, disk, PostgreSQL bağlantı sayısı) Alertmanager üzerinden
e-posta, Slack ve Microsoft Teams'e gider; düzelince "düzeldi" mesajı gelir:

```bash
scripts/monitoring.sh alerts email ops@sirket.com,it@sirket.com   # SMTP_* ile (Microsoft 365: smtp.office365.com:587)
scripts/monitoring.sh alerts slack https://hooks.slack.com/services/…
scripts/monitoring.sh alerts teams https://….logic.azure.com/workflows/…
scripts/monitoring.sh alerts test     # tüm kanallara deneme alarmı
```

Teams adresi kanalda **Workflows › "Post to a channel when a webhook request is
received"** şablonuyla alınır (eski "Incoming Webhook" bağlayıcıları Microsoft
tarafından kapatıldı). Alarmlar Grafana'da da (Alerting, "Alertmanager" veri
kaynağı) görülür ve susturulabilir. Yığın yaklaşık 1,5 GB bellek sınırı ekler.
Prometheus (`127.0.0.1:9090`) ve Alertmanager (`127.0.0.1:9093`) yalnızca
sunucunun kendisinden erişilebilir.

## Modüller

### Takvimler ve toplantılar (Google, Microsoft 365, Zoom)

- **Takvim bağlama:** Çalışan Profil › Takvim'den Google Takvim ya da Outlook
  (Microsoft 365) hesabını bağlar (OAuth 2.0 + PKCE). Onaylanan izinleri anında
  takvime "dışarıda" etkinliği olarak yazılır; bağlantı kurulunca gelecekteki izinler
  de eklenir. Takvim bağlamayanlar için .ics aboneliği her takvimle çalışır.
- **Toplantı:** 1:1 ve mülakat ekranlarında tek tıkla **Zoom**, **Microsoft Teams**
  ya da **Google Meet** bağlantısı; katılımcılara (istenirse adaya) takvim daveti
  gider, iptal edilince toplantı ve davetler silinir.
- **Uygun saat:** Yönetici 1:1 planlarken herkesin boş olduğu iş saatleri önerilir;
  bağlı takvimlerden yalnızca dolu aralıklar okunur (başlık görülmez), HR360'taki
  izin ve 1:1'ler de hesaba katılır.
- **Kurulum:** Entegrasyonlar › Takvim ve toplantı'da Google (OAuth istemcisi),
  Microsoft (Entra ID uygulama kaydı) ve Zoom (Server-to-Server OAuth) bilgileri
  girilir; adım adım yönerge ekrandadır. Google ve Microsoft yönlendirme adresi
  için HTTPS gerekir.
- Uçtan uca test (sahte Google/Graph/Zoom ile): `tests/integration/test_calendar.py`.

### Bordro, fazla mesai ve giriş-çıkış

- **Bordro dönemi** (Ücret › Bordro, `/panel/bordro`): ay açılır, hesaplanır, kontrol edilip
  kapatılır. Brütten nete: SGK işçi %14 ve işsizlik %1 (tavan asgari ücretin 9 katı), kümülatif
  matrahla gelir vergisi (2026 ücret tarifesi 190 bin / 400 bin / 1,5 milyon / 5,3 milyon),
  asgari ücret GV ve damga istisnası, işveren SGK %21,75 − teşvik puanı. Girdiler: onaylı
  ücretsiz izin günleri (eksik gün), **yalnızca onaylı** fazla mesai (saatlik ücretin %150'si)
  ve döneme özel ek ödeme/kesintiler. Parametreler yıl başına değiştirilebilir. Kapanan dönem
  değiştirilemez; yeniden açmayı yalnızca kiracı yöneticisi gerekçeyle yapar (denetim kaydına
  yazılır). Doğrulama: 2026 asgari ücret neti 28.075,50 TL, işveren maliyeti 40.214,03 TL.
- **Bordrolarım** (`/panel/bordrolarim`): çalışan, dönem kapanınca kendi pusulasını görür ve
  yazdırır/PDF alır. KVKK: pusulayı yalnızca çalışan ve bordro yetkilisi görür, İK'nın listeyi
  açması erişim kaydına yazılır, pusulalar 10 yıl saklanıp imha edilir.
- **Fazla mesai** (Puantaj sayfası): talep onay akışına gider; günde en fazla 4 saat, yılda
  270 saat (İş Kanunu m.41) aşılamaz. Gerekçede sağlık bilgisi istenmez.
- **Giriş-çıkış** (`/panel/giris-cikis`, yönetim `/panel/giris-cikis/yonetim`): ofisteki
  kiosk ekranında dakikada bir değişen QR kod, kart okuyucu ya da sicil kodu + PIN terminali
  (`POST /api/timeshift/time-clock/terminal/punch`, `X-Device-Key`). **Biyometri yoktur**
  (KVKK Kurulu 2026/921). Konum denetimi nokta başına isteğe bağlıdır; koordinat yalnızca o
  istekte "noktada mı" hesabında kullanılır, saklanmaz. Kart numarası ve PIN özet olarak
  tutulur; 5 hatalı PIN'de 15 dakika kilit.
- **Bordro dosyaları** (kapanmış dönem sayfası): SGK aylık prim ve hizmet belgesi (XML taslağı,
  eksik gün nedeni, işe giriş/çıkış günü), SGK işe giriş/ayrılış listesi, banka toplu maaş ödeme
  dosyası (CSV) ve muhasebe fişi (genel/Logo/Mikro/Netsis sütunları, masraf merkezi özeti; kişi
  verisi içermez). Dosyalar şifreli saklanır, her indirme kaydedilir; banka dosyası bir kez
  indirilir, tümü 24 saatte silinir. SGK XML'i ve muhasebe şablonları SGK'nın/yazılımların güncel
  şablonuyla birebir doğrulanmadı; yüklemeden önce karşılaştırın.
- **Avans ve borç** (Bordrolarım › Avans ve borçlarım; İK: Bordro › Avanslar): çalışan talep eder,
  İK onaylar; taksitler dönem hesabında kesinti olarak otomatik eklenir, dönem kapanınca ödenmiş
  sayılır. Taksit brüt ücretin %25'ini aşarsa İK uyarı görür.
- **Esnek yan haklar** (`/panel/yan-haklar`): yıllık bütçe ve seçim penceresi; kategori başına bir
  seçenek. Özel sağlık sigortası için sağlık beyanı istenmez.
- **Zam dönemi** (`/panel/zam-donemi`): İK bütçe yüzdesiyle dönemi açar, bölüm yöneticileri kendi
  ekipleri için öneri yapar (bant konumu ve bant dışı uyarısıyla), İK onaylar ve yürürlük
  tarihiyle yeni ücret kaydına dönüştürür. Bölüm özetinde 5 kişiden az gruplar gizlenir; çalışma
  sayfasının her açılışı erişim kaydına yazılır.
- **Masraf**: yabancı para kalemleri harcama günündeki TCMB döviz alış kuruyla TL'ye çevrilir
  (hafta sonu önceki iş günü; İK elle kur girebilir), kilometre masrafı km × şirket km ücreti,
  kategori başına kalem/aylık limit ve fiş zorunluluğu onaya gönderirken denetlenir. **Fiş okuma**
  yereldir (ml-inference içindeki Tesseract): görüntü saklanmaz, yalnızca tutar/tarih/VKN önerisi
  döner.
- **Seyahat** (`/panel/seyahat`): talep onay akışına gider, harcırah gün × şirket oranıyla hesaplanır
  ve onaydan sonra tek tıkla masraf beyanına dönüşür. Pasaport no yalnızca yurt dışı seyahatte,
  şifreli tutulur; seyahat bitiminden 7 gün sonra (iptal/retle hemen) silinir.

### Belge talebi, onay akışları ve vekâlet

- **Belge talebi** (`/panel/belge-talebi`): çalışma belgesi, maaş yazısı gibi şablonları
  çalışan kendisi ister; İK şablonda "çalışan talep edebilir" ve "İK onayı gerekir" seçer.
  Düzenlenen belge şifreli saklanır, altında doğrulama kodu bulunur. `/belge-dogrula/<kod>`
  oturumsuz doğrular; kişisel veri göstermez (belge türü, tarih, baş harfler).
- **Onay akışları** (`/panel/onay-akislari`): talep türüne göre çok adımlı zincir — bölüm başı,
  üst bölüm başı, belirli kişi; gün/tutar/saat koşulları; adım başına karar süresi. KVKK:
  belirli kişiye giden adım için uyarı, onaycılardan gizlenecek alanlar (ör. izin gerekçesi).
- **Vekâlet** (Onay kutusu › Vekâlet): tarih aralığında onaylar vekile geçer; vekil yalnızca
  kendisine düşen kaydı görür, süre bitince ya da geri alınınca adımlar asıl onaycıya döner;
  vekilin kararı geçmişte "(vekâleten)" diye görünür.
- **Toplu onay** (Onay kutusunda seçip), **süre aşımında üst yöneticiye iletme** ve
  **e-postadan tek tıkla karar**: onaycı e-postasında tek kullanımlık (72 saat) bağlantı;
  sayfa ayrıca onay ister, böylece e-posta tarayıcıları karar veremez. E-postada talep konusu
  yazmaz (yalnızca tür ve talep eden).
- **İzin**: saatlik izin (tek gün, 0,5 saat adımlarla; gün = saat / 7,5, `LEAVE_DAY_HOURS`),
  kıdeme ve yaşa göre yasal yıllık izin hakkı (İş Kanunu m.53) ön izleme ve bakiyelere yazma,
  kullanılmayan iznin sonraki yıla devri (isteğe bağlı üst sınır; tekrar çalıştırılabilir).

### İK süreçleri (duyuru, doküman, etik, İSG, disiplin, işe alım, eğitim, operasyon)

- **Duyurular** (`/panel/duyurular`) ve **doküman kütüphanesi** (`/panel/belgeler-kutuphanesi`): hedef kitleye göre
  yayın, "Okudum" ve politika kabulü (açık rızadan ayrı kayıt; yeni sürüm yeniden kabul ister), sürümlü
  belgeler ve yetki süzgeçli tam metin arama.
- **Etik hattı**: `/etik/<şirket>` oturumsuz ve anonimdir (IP, kullanıcı, tarayıcı bilgisi tutulmaz; gateway bu yolu
  kaydetmez), takip kodu yalnızca özet olarak saklanır; bildirimleri yalnızca şirketin atadığı etik kurulu görür.
- **İSG** (`/panel/isg`): iş kazası/ramak kala (SGK'ya 3 iş günü bildirim süresi), periyodik muayene (sağlık notları
  şifreli, yalnızca işyeri hekimi rolü — Ayarlar › Roller'den `osh:physician` ek izni), İSG eğitimleri.
- **Disiplin** (`/panel/disiplin`): savunma istemi (en az 2 iş günü), tutanak, karar; çalışan kendi savunmasını
  uygulamadan verir; adli sicil bilgisi tutulmaz (uyarı), kapanıştan 24 ay sonra imha.
- **İşe alım**: herkese açık kariyer sayfası `/kariyer/<şirket>` (aydınlatma bilgi olarak, CV havuzu için ayrı açık
  rıza, adayın kendi kaydını görüp silebildiği tek kullanımlık bağlantı, süre dolunca anonimleştirme), mükerrer aday
  tespiti, sürükle-bırak aday hattı, mülakat değerlendirme kartı (özel nitelikli veri uyarısı) ve randevu çakışma
  denetimi, teklif mektubu + onay akışı (maaş bildirimlerde yer almaz).
- **Eğitim ve gelişim**: yetkinlik matrisi ve açık analizi (yalnızca öneri), video/metin/sınav/SCORM 1.2 içerik,
  sertifika ve doğrulama kodu, sertifika süresi hatırlatmaları; performansta 9-kutu (tartışma aracı; potansiyel
  puanı varsayılan olarak çalışana gizli, kalibrasyon gerekçeli ve kayıtlı) ve dönem şablonları.
- **Operasyon**: rol bazlı onboarding şablonları, buddy ve ilk gün karşılama mesajı; işten ayrılışta Keycloak hesabının
  kapatılması, zimmet iade kontrolü ve planlı anonimleştirme tarihi; zimmet QR etiketi, iade hatırlatma, bakım
  kaydı; anketlerde en az 5 yanıt eşiği, eNPS eğilimi ve yerel (sunucu dışına çıkmayan) duygu analizi; vardiya
  tercihleri ve takas (11 saat dinlenme, haftalık 45 saat); giriş-çıkıştan geç kalma/fazla mesai raporu (bilgi amaçlı).

### Mobil uygulama (PWA)

Uygulama telefona kurulur (Hesap menüsü › Uygulama olarak yükle). **Profilim › Güvenlik ›
Bu cihaz** ekranından anlık bildirim açılır: Web Push (VAPID, RFC 8291 şifreleme; harici
servis yok). Bildirimde kişisel veri yer almaz ("Yeni bir bildiriminiz var"). İnternet yokken
izin ve fazla mesai talepleri cihazda sıraya alınır, bağlantı gelince gönderilir. Oturum
kapatılınca bu cihazın aboneliği ve sıradaki talepler silinir.

### Slack ve Microsoft Teams'ten onay

Onaycıya izin, masraf ve diğer talepler **Onayla / Reddet** düğmeli kişisel mesaj
olarak gider; karar verilince mesaj güncellenir, talep sahibine sonuç bildirilir.
Komutlar (Slack'te `/hr360 …` ya da bota DM, Teams'te bota mesaj): `onaylarım`,
`bakiye`, `izindekiler`, `kimnerede`, `bekleyen`, `ben`, `izin al`, `özet`, `yardım`.
Komut dışındaki her soru ("kaç gün iznim kaldı?", "masraf politikası ne?") web'deki
İK asistanına gider ve aynı yetki kurallarıyla yanıtlanır. Dil, kişinin HR360 bildirim
tercihine göre seçilir; İngilizce komutlar da çalışır (`approvals`, `balance`, `leave`,
`home`, `help`).

- **İzin formu:** `izin al` Slack'te bir form (modal), Teams'te Adaptive Card açar; talep
  sohbetten oluşturulur, onay akışı web'deki gibi başlar.
- **Gerekçeli ret:** Reddet'e basınca gerekçe sorulur; gerekçe onay geçmişine yazılır,
  talep sahibine giden sohbet mesajında yer almaz (yalnızca "karar notu var" denir).
- **Ana sayfa:** Slack App Home sekmesi ve `özet` komutu bekleyen onayları, izin
  bakiyesini ve bugün izinde olan ekip arkadaşlarını gösterir.
- **Sabah özeti:** İş günleri `CHAT_DIGEST_HOUR` saatinde
  (varsayılan 09:00) bekleyen onaylar ve bugünün özeti kişiye gönderilir; uygulama ayarından kapatılabilir.

- Kişiler **e-posta adresiyle** eşleşir, ama e-posta eşleşmesi tek başına yetmez:
  bot ilk kez yazan ya da onay alacak kişiye tek kullanımlık bir bağlantı gönderir; kişi
  HR360'a giriş yapıp "Bu hesap benim" diyene kadar ona talep içeriği gitmez. E-postalar
  uyuşmazsa bağlama reddedilir. Bağlı hesaplar **Profilim › Güvenlik**'te görünür ve
  kaldırılabilir; yönetici de bağı kaldırabilir. Uygulama ayarından kapatılabilir.
- **KVKK veri en aza indirme:** Varsayılan "Az" ayrıntıda onay mesajında talep edenin
  soyadı kısaltılır, talep konusu yazılmaz. `izindekiler` yöneticiye yalnızca kendi
  ekibini, diğerlerine yalnızca sayıyı gösterir. Teams'te grup sohbetine yazılan komutun
  yanıtı kişiye özel sohbete gider. Ayrılan çalışanın sohbet erişimi ilk istekte kapanır.
- Gönderilemeyen mesajlar kuyruğa alınır ve 1, 5, 15, 60 ve 180 dakika sonra yeniden
  denenir; talep bu arada karara bağlandıysa gönderilmez.
- Karar workflow-service'te web arayüzüyle **aynı kurallarla** yetkilendirilir:
  yalnızca adımın onaycısı ya da vekili karar verebilir, kimse kendi talebini
  onaylayamaz. Servisler arası çağrı `INTERNAL_SERVICE_TOKEN` ile korunur, gateway
  `/api/*/internal/` yollarını dışarıya kapatır.
- Slack istekleri imzayla (HMAC, 5 dk penceresi), Teams istekleri Bot Framework
  JWT'siyle (imza, yayıncı, hedef kitle, `serviceUrl` ve Microsoft 365 kiracısı)
  doğrulanır. Bot jetonları ve gizli anahtarlar veritabanında AES-256-GCM ile
  şifreli tutulur.
- Gerçek Slack/Teams hesabı olmadan uçtan uca test: `tests/integration/chatmock.py`
  ve `tests/integration/test_chat.py`.

### Zapier ve n8n (REST hook)

Webhook'lar ve açık API (`/api/governance/public/v1`, OpenAPI: `.../openapi.json`)
Zapier ve n8n ile kullanılabilir. **Entegrasyonlar › API anahtarları**'ndan
`hooks:write` (ve okuma için `employees:read` vb.) yetkili bir anahtar açın; istekler
`X-Api-Key` başlığıyla gönderilir.

| Uç | Ne yapar |
|---|---|
| `POST /hooks` `{"target_url": "...", "event": "leave.approved"}` | Abone olur (Zapier `hookUrl`, `url` de kabul edilir). Yanıtta `id` ve imza anahtarı (`signingSecret`, yalnızca bir kez) döner. |
| `DELETE /hooks/{id}` | Aboneliği kaldırır (Zapier "unsubscribe"). |
| `GET /hooks/samples/{event}` | Olayın **sentetik** örnek yükü (Zapier "perform list", n8n alan eşleme); gerçek kişi verisi dönmez. |
| `GET /hooks/events`, `GET /hooks` | Abone olunabilen olaylar ve mevcut abonelikler. |

Teslimat mevcut webhook altyapısıyla yapılır (HMAC-SHA256 imzası `X-HR360-Signature`,
teslim geçmişi, 20 ardışık hatada uç kapanır); yük, İK webhook'larıyla aynı olay zarfıdır, ek kişisel
veri eklenmez.

- **Zapier** (ABD) ve **n8n Cloud** (`*.n8n.cloud`, AB) yurt dışı aktarımdır: KVKK ›
  Yurt dışı aktarım ekranında dayanak kaydı yoksa abonelik `409 transfer_basis_required`
  ile reddedilir; kayıt sonradan silinirse teslimat da durur.
- **Kendi sunucunuzdaki n8n** (iç ağ adresi ya da kendi alan adınız) aktarım sayılmaz,
  ek kayıt gerekmez. n8n'de *Webhook* düğümünün üretim adresini `target_url` olarak
  verin (ör. `http://n8n:5678/webhook/izin-onay`; HR360 ile aynı Docker ağında servis
  adıyla) ya da abone olmadan İK › Webhook'lar ekranından aynı adresi ekleyin. Veri
  çekmek için n8n *HTTP Request* düğümüyle `GET /employees`, `/leaves`, `/events`
  uçlarını `X-Api-Key` başlığıyla çağırın.

Ana İK süreçleri (çalışan, organizasyon, izin, onay akışı, vardiya/puantaj,
performans, eğitim, ücret, masraf, işe alım, işe giriş, bildirimler) dışında:

| Alan | Neler var |
|---|---|
| Çalışan deneyimi | Takdir duvarı (rozet, beğeni, liderlik tablosu), doğum günü ve iş yıl dönümü kutlamaları, self-servis profil (IBAN/TCKN doğrulama ve maskeleme, acil durum kişisi), yetenek dizini, ofis/masa rezervasyonu ve "kim nerede", mentorluk eşleştirme, iç ilan panosu, anket ve eNPS (3 yanıttan az grupta sonuç gösterilmez), ekran paylaşım modu (hassas alanlar bulanıklaşır), PWA olarak kurulum |
| Yönetici | Ekip sağlığı paneli (uzun süre izin kullanmama, fazla mesai, performans düşüşü, 1:1 aralığı ve ruh hâli işaretleri), 1:1 defteri (yöneticiye özel notlar, takvime ekleme), org senaryo planlama (taşıma/ekleme/çıkarma ve maliyet etkisi), ardıl planlama |
| İK ve uyum | Denetim kaydı ekranı (filtre, aynı istekte yapılanlar, CSV), KVKK (uyum durumu, işleme envanteri, yurt dışı aktarım kilidi, açık rıza, veri sahibi talepleri, otomatik analize itiraz, TCKN/IBAN şifreleme ve gerekçeli erişim kaydı, JSON dışa aktarım, anonimleştirme, saklama süreleri ve imha tutanağı; bkz. [docs/kvkk](docs/kvkk/README.md)), offboarding (kontrol listesi, zimmet iadesi, çıkış görüşmesi, kıdem/ihbar/izin hesabı), belge şablonları ve toplu yazdırma, kural motoru (olay → koşul → bildirim/webhook/Slack), toplu içe/dışa aktarım (Excel/CSV), bordro simülasyonu (2026 parametreleriyle brütten nete/netten brüte), işe alım saga'sı (teklif → çalışan kaydı → işe giriş planı) |
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

**İsteğe bağlı dil modeli (LLM).** `.env`'de `LLM_PROVIDER` (`anthropic`, `openai`
ya da yerel model için `ollama`), `LLM_MODEL` ve gerekiyorsa `LLM_API_KEY` tanımlanırsa
AI araçları ekranında ek seçenekler açılır: **yapay zekâ ile ilan yazma**, **kapsayıcı
dille yeniden yazma**, **performans özeti** ve bilgi bankasına dayalı **İK asistanı**.

- Kurulumda tanımlı olsa bile **şirketin İK yöneticisi açmadıkça hiçbir veri modele
  gönderilmez** (varsayılan kapalı).
- Kişisel veri içeren görevler (performans özeti) ayrıca izin ister; çalışanın adı
  modele gönderilmez, takma adla gönderilip yanıtta yerine konur.
- İK asistanında modele yalnızca bilgi bankası makaleleri gider; izin bakiyesi gibi
  kişisel sorular yine veritabanından, modelsiz yanıtlanır.
- Model çıktıları da ayrımcı ifade denetiminden geçer.
- İstek içerikleri kaydedilmez; görev, süre ve jeton sayısı tutulur. Şirket başına
  saatlik kota vardır (`LLM_HOURLY_LIMIT`).
- `ollama` ile model kendi sunucunuzda çalışır, veri kurum dışına çıkmaz.
- Uçtan uca test (sahte model ile): `tests/integration/test_ai_llm.py`.

### Yapılandırma gerektirenler

| Özellik | Durum |
|---|---|
| Slack uygulaması | Entegrasyonlar › Sohbet uygulamaları. HR360'ın verdiği manifestle Slack'te uygulama açılır; bot jetonu ve imzalama anahtarı girilir. Sunucunun **internetten HTTPS ile** erişilebilmesi gerekir. |
| Microsoft Teams botu | Azure'da tek kiracılı bir **Azure Bot** (App ID, gizli anahtar, kiracı kimliği) açılır; HR360'ın ürettiği Teams paketi yönetim merkezinden yüklenir. Teams, bota kişinin ilk mesajından sonra yazmaya izin verir; kullanıcı uygulamayı bir kez ekler. HTTPS gerekir. |
| Google / Microsoft 365 takvim | Google Cloud'da OAuth istemcisi, Entra ID'de uygulama kaydı (Calendars.ReadWrite); yönlendirme adresi ekranda verilir. HTTPS gerekir. |
| Zoom | Zoom Marketplace'te Server-to-Server OAuth uygulaması (Account ID, Client ID, Secret). |
| Teams/Slack kanal bildirimi | Gelen webhook adresi (Teams'te Workflows şablonu) Entegrasyonlar › Kanal bildirimleri'nden girilir. |
| SSO | Google veya Microsoft (Azure AD) OAuth istemci kimliği ve sırrı Güvenlik ekranından girilir; e-posta alan adı organizasyona bağlanır. |
| E-posta | Bildirimler için SMTP (`scripts/smtp.sh set`). |

## Dil

Panel Türkçe ve İngilizce kullanılabilir (üst çubukta **EN / TR**). Ayrıntılar ve yeni metin ekleme kuralları: [docs/dil/README.md](docs/dil/README.md).

## Testler

- **Birim testleri:** 50 .NET testi (xUnit), arayüzde bordro hesabı ve Excel/CSV okuma (Vitest) ve ML
  servisi (pytest). Her push'ta CI'da çalışır.
- **API entegrasyon testleri:** Slack, Teams, takvim/toplantı, LLM ve Redis önbelleği için. Sahte
  sağlayıcı sunucusuyla gerçek hesap gerektirmez.
- **Tarayıcı testleri (Playwright):** Dört rolle tüm ekranları, İngilizce arayüzü ve izin onay akışını
  baştan sona dener.
- Hepsi `scripts/test.sh` ile çalışır; ayrıntılar [tests/README.md](tests/README.md)'de.
- **Yük testi (k6):** `scripts/loadtest.sh [smoke|load|stress]`. 2 vCPU'lu test
  sunucusunda 100 eşzamanlı kullanıcıda p95 46 ms ve sıfır hata. Stres testinde
  bulunan veritabanı bağlantı darboğazı ve düzeltmesi
  [docs/performans/yuk-testi.md](docs/performans/yuk-testi.md)'de.

## Mimari

Ayrıntılı belge diyagramlarla [docs/mimari/README.md](docs/mimari/README.md) dosyasındadır: sistem bağlamı, konteynerler, Kafka olay kataloğu, izin onayı ve Slack/Teams onay akışları. Tüm servislerin canlı API belgesi uygulamada **Yönetim → API belgeleri** ekranındadır (`/panel/api-belgeleri`); "Try it out" istekleri oturumdaki yetkiyle gider.


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
- **Önbellek:** Valkey (Redis uyumlu). Çalışan dizini, ofis doluluğu, ekip sağlığı
  ve analitik özet 30 sn–2 dk tutulur; açık API'nin dakikalık sınır sayacı da buradadır.
  Kalıcı veri tutmaz; erişilemezse servisler doğrudan veritabanından okur
  ([yük testi raporu](docs/performans/yuk-testi.md))
- **E-posta:** `install.sh` kurulumda gönderen adresi sorar, SMTP sunucusunu
  adresten bulur ve deneme e-postasıyla doğrular; boş
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
  monitoring/            Prometheus, alarm kuralları, Alertmanager, Loki/Promtail ve Grafana (pano + veri kaynakları)
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
  (HR360) kalır. İstisna: şirket kendi doğrulanmış alan adını kullanıyorsa (aşağıda
  "Özel alan adı") `/giris` ekranı o şirketin adını, logosunu ve rengini gösterir.
- **Platformun kendi markası** (HR360 adı, varsayılan logo ve renk) ayarlardan
  değiştirilemez; bunun için kod değişikliği gerekir: panel renkleri
  `apps/web/src/styles/index.css`, Keycloak giriş sayfası
  `deploy/keycloak/themes/hr360` klasöründedir.

### Özel alan adı (ör. `ik.sirket.com.tr`)

Enterprise plandaki şirket yöneticisi **Güvenlik → Özel alan adı** panelinden kendi alan
adını ekler. Sahiplik DNS TXT kaydıyla kanıtlanır:

```
_hr360-verify.ik.sirket.com.tr.  TXT  "hr360-verify=<paneldeki değer>"
```

**Doğrula** düğmesi kaydı sorgular (DnsClient); eşleşirse durum `Pending` → `Verified` olur.
Bir alan adı aynı anda yalnızca tek şirkette doğrulanmış olabilir; platformun kendi adresi
(`PUBLIC_ORIGIN`, `PLATFORM_HOSTS`) ve alt alanları kullanılamaz. Doğrulanan alan adı
Keycloak'taki `hr360-web` istemcisinin yönlendirme adreslerine eklenir
(`CUSTOM_DOMAIN_KEYCLOAK_SYNC=false` ile kapatılabilir).

Giriş ekranı `GET /api/tenant/public/branding?host=<tarayıcının adresi>` ile şirketi tanır
(yalnızca doğrulanmış alan adı + etkin şirket; aksi halde 404) ve şirket adını, logosunu,
rengini gösterip girişte o şirketi ön seçer.

İşletme adımları (uygulama bunları **yapmaz**):

1. **DNS:** `ik.sirket.com.tr` için platform sunucusunun genel IP'sine `A`/`CNAME` kaydı.
2. **TLS sertifikası:** mevcut ACME betiğiyle alan adını sertifikaya ekleyin, örneğin
   `CERTBOT_EXTRA_ARGS="-d ik.sirket.com.tr --expand" ./scripts/tls.sh enable --letsencrypt --host hr.sirket.com`
   (ya da şirketin verdiği sertifikayı `--cert/--key` ile). Sertifika olmadan tarayıcı
   uyarı verir.
3. **Gateway:** nginx `server_name` yönergesi alan adını kabul etmelidir. Varsayılan
   yapılandırma (`server_name _;`) tüm adları kabul eder; kısıtlı bir yapılandırma
   kullanıyorsanız alan adını ekleyin.

### Dizin sağlama: SCIM 2.0 ve LDAP / Active Directory

Şirket yöneticisi **Güvenlik** sayfasındaki iki panelle çalışan hesaplarını kurumsal
dizinden yönetebilir:

- **SCIM 2.0** (Entra ID, Okta, OneLogin, JumpCloud...): taban adres
  `https://<platform>/api/tenant/scim/v2`, kimlik doğrulama panelde üretilen jeton
  (`Bearer hr360scim_...`; yalnızca bir kez gösterilir, veritabanında SHA-256 özeti tutulur,
  iptal edilebilir). Desteklenen: `ServiceProviderConfig`, `ResourceTypes`, `Schemas`,
  `Users` (liste, `filter=userName eq "..."`, `startIndex`/`count`, GET, POST, PUT, PATCH,
  DELETE). DELETE ve `active=false` hesabı kapatır ve tüm oturumları sonlandırır; çalışan
  kaydı silinmez (işten çıkış ve saklama süresi İK/KVKK süreciyle yürür).
- **LDAP / AD**: `ldaps://` önerilir (`ldap://` kaydedilir ama uyarı verilir); bağlama
  parolası AES-256-GCM ile şifrelenir. "Bağlantıyı test et", "Önizleme (dry-run)" ve
  "Şimdi eşitle"; isteğe bağlı otomatik eşitleme `DIRECTORY_SYNC_MINUTES` (varsayılan 60)
  dakikada bir. Dizinde olup HR360'ta olmayan kullanıcılar oluşturulur, dizinden silinen ya
  da pasifleştirilenler kapatılır (arama boş dönerse ya da aktiflerin yarısından fazlası
  kaybolursa onay olmadan toplu kapatma yapılmaz).

Her iki yolda da hesap Keycloak'ta şirket organizasyonuna `employee` rolüyle açılır ve
çalışan kaydı employee-service'in iç ucuyla (`INTERNAL_SERVICE_TOKEN`) oluşturulur. Roller
dizinden atanmaz. **KVKK veri minimizasyonu:** yalnızca kullanıcı adı, ad, soyad, birincil
e-posta, etkinlik durumu, unvan ve departman saklanır; telefon, adres, fotoğraf, yönetici
gibi diğer nitelikler kabul edilir ama yok sayılır (SCIM `ServiceProviderConfig` bunu ilan
eder; LDAP'tan bu nitelikler hiç istenmez).

### Basit elektronik imza (doküman imzalatma)

İK, **Dokümanlar** sayfasında bir özlük dokümanını çalışana **İmzaya gönder**ir. Çalışan
**İmzalarım** sayfasında belgeyi görür, 6 haneli tek kullanımlık kod ister (uygulama içi
bildirim ve e-posta) ve kodla onaylar. Kod yalnızca özetiyle saklanır, 10 dakika
geçerlidir, en fazla 5 deneme hakkı vardır. Kanıt kaydı: doküman özeti (SHA-256), imzalayan
çalışan, zaman, son okteti maskelenmiş IP, tarayıcı bilgisinin özeti ve kod kanalı;
doküman saklandığı sürece saklanır ve değiştirilemez. İmzalanan doküman değiştirilemez;
yeniden imza için yeni talep gerekir.

> **Basit elektronik imza — 5070 sayılı Kanun kapsamında nitelikli (güvenli) elektronik
> imza değildir.** Kanunen ıslak imza ya da güvenli e-imza gerektiren belgeler (ör. bazı iş
> sözleşmesi değişiklikleri, ibraname) için kullanılmamalıdır.

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
- Hiçbir uygulama konteyneri root çalışmaz. Gateway IP başına hız sınırı uygular
  (API 50 istek/sn, giriş 10 istek/sn), arayüz katı bir içerik güvenliği politikası
  (CSP) ile sunulur; güvenilir sertifikayla HTTPS açıldığında HSTS eklenir.
- Şirket yöneticisi **Ayarlar › Güvenlik**'ten IP kısıtı tanımlayabilir, kullanıcıların açık
  oturumlarını kapatabilir; çalışanlar **Profilim › Güvenlik**'ten kendi oturumlarını yönetir ve
  passkey/güvenlik anahtarı (WebAuthn) ekler. Passkey, doğrulayıcı uygulamaya alternatif ikinci
  adımdır (`KEYCLOAK_PASSKEYS=false` ile kapatılır).
- Denetim kaydı hash zinciriyle değiştirilemezdir (**Denetim kaydı › Zinciri doğrula**);
  `SIEM_SYSLOG_ENDPOINT` ile syslog'a takma adlı olarak aktarılır. Ayrıntı: [docs/kvkk/README.md](docs/kvkk/README.md).
- Bağımlılıklar, imajlar ve repo her push'ta Trivy, `npm audit` ve NuGet denetimiyle
  taranır. Korumaların tam listesi, son taramanın bulguları ve kabul edilen riskler:
  [docs/guvenlik/README.md](docs/guvenlik/README.md).
