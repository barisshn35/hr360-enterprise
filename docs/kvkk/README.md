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
webhook gönderim kayıtları. "Otomatik" işaretli politikalar günde bir çalışır; Silme, Yok Etme
veya Anonim Hale Getirme Yönetmeliği'ndeki en geç 6 aylık periyodik imha süresinin içinde kalır.

Her silme ve anonimleştirme **imha tutanağına** yazılır: tarih, veri kategorisi, yöntem,
etkilenen kayıt sayısı, tetikleyen (periyodik / elle). Tutanaklar silinmez (yönetmelik en az
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

`tests/integration/test_kvkk.py` uyum durumu, envanter, aktarım kilidi ve 5 iş günü kuralı,
imha tutanağı, şifreleme, gerekçe zorunluluğu, erişim kaydı ve itiraz akışını uçtan uca denetler.
