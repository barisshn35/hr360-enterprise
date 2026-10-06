# KVKK uyumu

HR360'ta 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) için yerleşik araçlar.
Hepsi **Yönetim › KVKK** ekranındadır. Çalışanlar kendi haklarını **Profilim › Gizlilik**
sekmesinden kullanır. Bu araçlar uyumu kolaylaştırır; hukuki danışmanlığın yerini tutmaz.
Metinleri ve saklama sürelerini bir KVKK danışmanıyla gözden geçirin.

## Uyum durumu

Açılış sekmesi. Şunları denetler ve sorunlu satırdan ilgili sekmeye götürür:

| Denetim | Sorun sayılan durum |
|---|---|
| Aydınlatma metni | Okumamış kullanıcı var |
| İlgili kişi başvuruları | 30 günlük süresi geçen başvuru (m.13) |
| Otomatik analize itirazlar | Karar bekleyen itiraz |
| Periyodik imha | Otomatik çalışmayan saklama politikası |
| Yurt dışına aktarım | Dayanak kaydı olmadan kullanılan hizmet ya da Kurul'a bildirimi geciken standart sözleşme |
| E-posta sağlayıcısı | SMTP sunucusu yurt dışında olabilir (bilgi) |

## İşleme envanteri (m.16, VERBİS hazırlığı)

Her modül için işleme faaliyeti, ilgili kişi grubu, veri kategorileri, amaç, hukuki sebep,
özel nitelikli veri olup olmadığı, saklama süresi, alıcı grupları, yurt dışı aktarım ve
güvenlik önlemleri listelenir. "Excel olarak indir" ile VERBİS'e girilecek bilgilerin taslağı
alınır. Yurt dışı aktarım sütunu o an açık olan entegrasyonlara göre hesaplanır.
Envanter metni Türkçedir.

## Yurt dışına aktarım (m.9)

Slack, Microsoft (Teams, Outlook takvimi), Google (Takvim, Meet), Zoom ve yurt dışındaki
yapay zekâ sağlayıcıları (Anthropic, OpenAI uyumlu) kişisel veriyi yurt dışına aktarır.
Her biri için hukuki dayanak kaydedilir: standart sözleşme, yeterlilik kararı, bağlayıcı
şirket kuralları ya da taahhütname.

- **Kilit:** Dayanak kaydı olmadan ilgili entegrasyon açılamaz. Kayıt sonradan silinirse
  (yalnızca hizmet kullanımda değilken mümkün) arka plandaki gönderimler de durur: sohbet
  botu bildirimleri, takvime izin yazma, toplantı oluşturma, uygun saat sorgusu, yapay zekâ
  istekleri. Gelen Slack/Teams istekleri de yanıtlanmaz.
- **Standart sözleşme:** İmzadan sonra 5 iş günü içinde Kurul'a bildirilmelidir. Bildirim
  tarihi girilmemişse durum "Kurul bildirimi bekliyor", süre geçtiyse "Bildirim süresi geçti"
  olur ve uyum ekranında hata olarak görünür.
- Yapay zekâ yerel modelle (Ollama, `LLM_LOCAL=true`) çalışıyorsa aktarım olmaz, kayıt gerekmez.
- E-posta (SMTP) sağlayıcısı kilitlenmez; yurt dışındaysa uyum ekranı uyarır.

## Saklama ve imha

Saklama politikaları: olumsuz sonuçlanan aday başvuruları, ayrılmış çalışanlar, denetim
kayıtları, bildirim geçmişi, yapay zekâ kullanım kayıtları, sohbet botu mesaj kayıtları,
webhook gönderim kayıtları, bordro pusulaları (kapanmış dönemler, varsayılan 10 yıl), çalışan
belge talepleri (varsayılan 24 ay). "Otomatik" işaretli politikalar günde bir çalışır; Silme, Yok Etme
veya Anonim Hale Getirme Yönetmeliği'ndeki en geç 6 aylık periyodik imha süresinin içinde kalır.

Her silme ve anonimleştirme **imha tutanağına** yazılır: tarih, veri kategorisi, yöntem,
etkilenen kayıt sayısı, tetikleyen (periyodik / elle / yedekten geri yükleme sonrası).

**Yedekler:** `scripts/backup.sh` arşivi AES-256 ile şifreler (`BACKUP_ENCRYPTION_KEY`); dış
depoya yalnızca şifreli arşiv gider, yurt dışı depo m.9 dayanağı ister. Yedekten geri
yükleme yapılınca etkin saklama politikaları hemen yeniden çalışır; yedekten sonra imha
edilmiş kayıtlar yeniden silinir (bkz. README › Yedekleme). Tutanaklar silinmez (yönetmelik en az
3 yıl ister); ekrandan tarih aralığıyla yazdırılabilir.

## Hassas veri: şifreleme, maskeleme, erişim kaydı

- **Şifreleme:** Profildeki T.C. kimlik no ve IBAN veritabanında AES-256-GCM ile şifrelidir
  (`enc1:` önekli). Anahtar `.env`'deki `TENANT_SECRET_KEY`'dir. Eski düz metin değerler
  engagement-service açılırken kendiliğinden şifrelenir. Kişisel veri dökümünde açık metin verilir.
- **Maskeleme:** Bu alanlar ekranda maskeli görünür. Kişi kendi değerini açabilir. İK
  başkasınınkini ancak **gerekçe yazarak** açabilir.
- **Erişim kaydı:** Şunlar kaydedilir ve **Erişim kayıtları** sekmesinde görünür:
  T.C. kimlik no / IBAN açılması (gerekçesiyle), İK'nın başkasının özel profil bilgilerini
  (adres, doğum tarihi, acil durum kişisi) görüntülemesi, ücret kayıtlarının görüntülenmesi,
  kişisel veri dökümü, otomatik analiz. Çalışan kendi kaydını **Profilim › Gizlilik ›
  Verilerime erişenler** bölümünde görür.

## Modüllere özel önlemler

| Modül | Önlem |
|---|---|
| Giriş-çıkış | Biyometri yok (Kurul 2026/921). Konum isteğe bağlı, yalnızca o an "noktada mı" hesabı; koordinat saklanmaz, denetim kaydına yazılmaz. Kart no ve PIN özet olarak tutulur. |
| Bordro | Pusulayı çalışan (dönem kapanınca) ve bordro yetkilisi görür; liste/pusula görüntülemesi erişim kaydında; tutarlar denetim kaydına yazılmaz. |
| Fazla mesai | Gerekçede sağlık bilgisi istenmez. |
| Belge talebi | Belge şifreli saklanır; doğrulama sayfası yalnızca belge türü, tarih ve baş harfler gösterir; İK'nın belgeyi açması erişim kaydında. |
| Onay akışları | Belirli kişiye giden adım için uyarı; onaycılardan gizlenecek alanlar; onaycı e-postasında talep konusu yazmaz. |
| Vekâlet | Vekil yalnızca kendisine düşen kaydı görür; süre bitince erişim kapanır; kararları "(vekâleten)" diye kaydedilir. |
| Anlık bildirim (PWA) | Push içeriğinde kişisel veri yok; oturum kapanınca cihaz aboneliği ve çevrimdışı kuyruk silinir. |
| Yasal izin hakkı | Doğum tarihi yalnızca yaş kuralı için kullanılır, gösterilmez. |
| Bordro dosyaları | SGK/banka dosyası TCKN/IBAN içerir: şifreli saklanır, banka dosyası tek indirme, tümü 24 saatte silinir, indirmeler erişim kaydında; muhasebe fişi yalnızca masraf merkezi toplamı. |
| Avans | Yalnızca çalışan ve bordro yetkilisi görür; bildirimde tutar yazmaz. |
| SGK bildirimi (APHB) | TCKN yalnızca dosyada (şifreli saklanır); doğrulama raporu ad gösterir, TCKN göstermez ve erişim kaydına yazılır. Meslek kodu ve SGDP (emekli çalışan) özel nitelikli veri değildir. Eksik gün nedeni "01 istirahat" yasal bildirim içindir; tanı tutulmaz. |
| e-Bordro | Bildirimde (uygulama içi/e-posta) tutar yok; pusula yalnızca uygulamada. Teslim edilen içerik özeti (SHA-256) ve şifreli kopyası saklanır; "teslim aldım" kaydında IP yalnızca /24 öneki. |
| Kıdem/ihbar | Yalnızca bordro yetkilisi; önizleme ve ibraname üretimi erişim kaydında; hazırlayan onaylayamaz (dört göz), otomatik karar yok. |
| Fark bordrosu | Aday listesi ücret içerdiği için görüntüleme erişim kaydında; kapanmış dönem değişmez. |
| Ücret bandı uyumu | Kişi bazlı compa-ratio yalnızca İK/ücret görme izni, görüntüleme kaydedilir; toplu raporda 5 kişiden az grup gizli. |
| Esnek yan haklar | Sağlık beyanı alınmaz; İK özeti seçenek bazında sayı gösterir. |
| Zam dönemi | Yönetici yalnızca kendi bölümünü görür; çalışma sayfası açılışı erişim kaydında; 5 kişiden az grup özette gizli. |
| Seyahat | Pasaport no şifreli, yalnızca yurt dışında istenir, seyahat bitince 7 gün içinde silinir; açılışı kaydedilir. |
| Fiş okuma | Yerel OCR; görüntü saklanmaz, ham metin döndürülmez. |
| Duyuru/politika kabulü | "Okudum" kaydı açık rızadan ayrı tutulur; okumayanlar listesi yalnızca kabul gerektirenlerde. |
| Etik hattı | IP/kullanıcı/tarayıcı tutulmaz, gateway kaydı kapalı, takip kodu özet olarak, iletişim bilgisi şifreli; yalnızca etik kurulu. |
| İSG | Sağlık notları şifreli, yalnızca işyeri hekimi okur (her okuma kayıtlı); İK ve yönetici yalnızca uygun/uygun değil görür. |
| Disiplin | İK, bölüm yöneticisi (görüntüleme kayıtlı) ve çalışanın kendisi; adli sicil tutulmaz; 24 ay sonra imha. |
| Kariyer sayfası | Aydınlatma bilgi olarak, CV havuzu için ayrı açık rıza; aday kendi verisini silebilir; süre dolunca anonimleştirme; IP saklanmaz. |
| Mülakat | Notlarda özel nitelikli veri uyarısı; maaş teklifi yalnızca İK ve onaycıya, görüntüleme kayıtlı. |
| Yetkinlik/9-kutu | Yalnızca öneri ve tartışma aracı (otomatik karar yok); potansiyel puanı çalışana varsayılan gizli. |
| Anketler | En az 5 yanıt; küçük grup çıkarımı engellenir; yorumlar ve duygu analizi yerel ve eşik üstünde. |
| İşten ayrılış | Hesap kapatma, zimmet iadesi ve planlı anonimleştirme tarihi kayıtlı. |
| Özel alanlar | Her alan için hukuki sebep, amaç ve saklama süresi zorunlu; özel nitelikli alan onaylı etki değerlendirmesi ister, şifreli saklanır ve envantere otomatik eklenir. |
| Raporlar | 5 kişiden az gruplar her yerde gizli; zamanlanmış rapor yalnızca giriş gerektiren bağlantı gönderir, kişi bazlı rapor zamanlanamaz. |
| Zapier/n8n | Zapier (ABD) ve n8n Cloud aktarım dayanağı olmadan bağlanamaz; kendi sunucunuzdaki n8n serbest. |
| Bildirim tercihleri | Özet e-postası yalnızca konu başlıkları içerir; güvenlik bildirimleri kapatılamaz. |
| SCIM/LDAP | Yalnızca kullanıcı adı, ad, soyad, e-posta, etkinlik, unvan, bölüm alınır; diğer öznitelikler saklanmaz. |
| Basit e-imza | OTP özeti saklanır; delil kaydı (belge özeti, IP son okteti maskeli) değiştirilemez, belgeyle birlikte silinir; nitelikli e-imza değildir. |
| Ayrılma modeli | Cinsiyet, yaş, medeni hal, sağlık ve vekil öznitelikler yasak (eğitim/tahmin reddedilir); kayma ölçümü yalnızca toplu histogramla; yeniden eğitim denetim kaydında. |
| Sohbet botu (Dalga 5e) | Kişisel yanıt yalnızca kişiye özel DM'de; kanala yalnızca "herkes" duyurusu ve izin verenlerin kutlaması (yaş/doğum yılı yok); onay kartında başka çalışanların adı değil izinli SAYISI; belge içeriği değil bağlantısı; bordro özeti ve toplu/ücretle ilgili onay HR360'ta ek doğrulama ister; sessiz saate uyulur; ölçüm etiketlerinde kişi/metin yok. |
| Sohbet: Mattermost / Rocket.Chat | Kendi sunucunuzda yurt dışı aktarım yok; bulut (*.cloud.mattermost.com, *.rocket.chat) adresinde aktarım dayanağı olmadan açılamaz. Jetonlar şifreli. |
| Sohbet: fiş | Görüntü sağlayıcıdan bot jetonuyla indirilir, yalnızca bellekte yerel OCR'dan geçer, saklanmaz; öneriyi kişi onaylamadan taslak oluşmaz. |
| Sohbet: konuşma bağlamı | Son 6 soru şifreli, 30 gün (saklama kategorisi ChatContext); `geçmişimi sil` ile anında silinir. |
| Sohbet: nabız / çıkış anketi | Nabız yanıtı kimliksiz (rastgele anahtar, departman ve saat yok), "yanıtladı" ayrı tabloda; sonuç ≥ 5 yanıtla. Çıkış anketi ara yanıtları şifreli, bitince silinir; yalnızca İK görür. |

## Aydınlatma ve açık rıza metinleri

**KVKK › Metinler** sekmesinde şirket her metnin yeni sürümünü yayımlar. Aydınlatma metni
"okundu" olarak, açık rıza metinleri ayrı ayrı "verildi/verilmedi" olarak kaydedilir; ikisi tek
onay kutusunda birleştirilmez. Yeni sürüm yayımlanınca eski onaylar "güncel değil" görünür ve
çalışandan yeniden okuması istenir. Eski sürümler silinmez: kimin hangi metni gördüğü kanıttır.

## Veri ihlali (m.12/5)

**KVKK › Veri ihlali**: tespit anı, etkilenen veri kategorileri ve çalışanlar, neden ve önlemler
kaydedilir. 72 saatlik Kurul bildirim süresi tespitten başlar; uyum ekranı süre aşımını hata
olarak gösterir. Kurul'un bildirim formu alanlarına göre taslak üretilir (VERBİS'e elle girilir),
etkilenen çalışanlara uygulama içi bilgilendirme gönderilir (başka kişilerin verisi içermez).

## İlgili kişi başvuruları (m.11, m.13)

Panelden gelen başvuruda kimlik oturumla doğrulanmış sayılır. E-posta, KEP, posta ya da elden
gelen başvuru İK tarafından kaydedilir; 30 günlük süre başvurunun ulaştığı tarihten başlar.
Kimlik doğrulanmadan (KEP, güvenli e-imza, kayıtlı e-posta, kimlik belgesi görülerek) başvuru
"Sonuçlandı" yapılamaz; kimlik belgesinin kopyası saklanmaz. Yanıt şablonları (bilgi, düzeltme,
silme, yasal saklama nedeniyle ret, itiraz, kimlik doğrulama isteği) hazır gelir.

## Gizlilik etki değerlendirmesi

**KVKK › Etki değerlendirmesi**: yeni entegrasyon, özel alan ya da süreç öncesi 12 soruluk
kontrol listesi. Risk yanıtlardan hesaplanır (özel nitelikli veri + yurt dışı = yüksek). Yüksek
riskli değerlendirmeyi hazırlayan kişi onaylayamaz; yanıt değişince onay düşer. Uyum ekranı,
kullanılan ama onaylı değerlendirmesi olmayan entegrasyonları uyarı olarak gösterir.

## Alan düzeyinde yetki

**KVKK › Alan yetkileri**: profil alanlarının başkalarına hangi düzeyden itibaren görüneceği
(tüm çalışanlar / bölüm yöneticisi / yalnızca İK / yalnızca kişinin kendisi). T.C. kimlik no ve
IBAN yalnızca İK'ya ya da yalnızca kişiye açılabilir. Yönetici bir özel alanı görüntülediğinde
erişim kaydına yazılır.

## Değiştirilemez denetim kaydı ve SIEM

Her kiracının denetim kaydı bir hash zinciridir: her satır önceki satırın SHA-256 özetini içerir,
satırlar güncellenemez (veritabanı tetikleyicisi). **Denetim kaydı › Zinciri doğrula** değiştirilmiş
satırı, kopuk bağı ve eksik sırayı gösterir. Saklama süresi dolan en eski kayıtların silinmesi
zincirin başını kısaltır, hata sayılmaz.

`SIEM_SYSLOG_ENDPOINT=udp://sunucu:514` (ya da `tcp://`) tanımlanırsa kayıtlar RFC 5424 syslog
olarak aktarılır. Veri en aza indirme: kullanıcı ve kayıt kimlikleri HMAC takma adına çevrilir
(`SIEM_PSEUDONYM_KEY`), ad, e-posta ve değişiklik içeriği gönderilmez, IP'nin son okteti
sıfırlanır. SIEM yurt dışındaysa yurt dışı aktarım dayanağı gerekir.

## Erişim güvenliği

- **IP kısıtı** (Ayarlar › Güvenlik): şirket kullanıcıları API'ye yalnızca listedeki adreslerden
  erişir; yönetici kendini dışarıda bırakan listeyi kaydedemez. Platform yöneticisi etkilenmez.
- **Oturumlar**: çalışan Profilim › Güvenlik'ten kendi oturumlarını görür ve kapatır; şirket
  yöneticisi bir kullanıcının tüm oturumlarını kapatabilir.
- **Passkey / güvenlik anahtarı**: giriş akışında doğrulayıcı uygulamaya alternatif ikinci adım
  (WebAuthn). Biyometrik veri cihazdan çıkmaz; yalnızca açık anahtar saklanır. Gerçek bir
  cihazla kayıt bu ortamda denenmedi (akış yapılandırması test edildi).

## Otomatik analize itiraz (m.11/1-g)

Yalnızca otomatik sistemlerle yapılan analizler: işten ayrılma riski tahmini, otomatik
performans puanı, yapay zekâ özetleri. Çalışan **Profilim › Gizlilik**'ten itiraz eder.

- İtiraz açıkken ya da kabul edildiyse kişinin işten ayrılma riski hesaplanmaz.
- İK **İtirazlar** sekmesinden gerekçe yazarak karar verir; çalışana bildirim gider.
- Risk tahmini yalnızca governance üzerinden yapılır
  (`POST /api/governance/privacy/analysis/attrition/{çalışan}`); her hesaplama çalışanın erişim
  kaydına yazılır. Gateway, model uçlarını (`/ml/predict`, `/ml/explain`) dışarıya kapatır.
- Ekranda skorun tek başına karar için kullanılamayacağı yazılıdır.

## Test

`tests/integration/test_payroll_time.py`, `test_workflow_docs.py` ve `test_push.py` modül
önlemlerini (koordinat ve kart numarasının saklanmaması, pusula/belge erişim kaydı, push içeriği,
gizlenen alanlar) denetler. `tests/integration/test_kvkk.py` uyum durumu, envanter, aktarım kilidi ve 5 iş günü kuralı,
imha tutanağı, şifreleme, gerekçe zorunluluğu, erişim kaydı ve itiraz akışını uçtan uca denetler.
`tests/integration/test_kvkk_ops.py` metin sürümlerini, 72 saat kuralını, kimlik doğrulama
zorunluluğunu, etki değerlendirmesini, alan yetkilerini, hash zincirinin kurcalamayı yakalamasını,
SIEM'de takma ad kullanımını, IP kısıtını ve oturum yönetimini denetler.
