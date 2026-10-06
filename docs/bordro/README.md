# Türkiye bordrosu (dalga 8, madde 58–65)

Bu belge bordro dalgası 8'in kapsamını, dosya düzenlerini ve **doğrulanmamış** noktaları anlatır.
Kod: `apps/services/compensation-service` (`Payroll/`, `Controllers/PayrollTrController.cs`),
arayüz: Ücret › Bordro (`/panel/bordro`, sekmeler) ve dönem sayfası. Şema:
`scripts/sql/2026-10-21_payroll_tr.sql`.

> **Dış sistemler:** HR360 SGK e-Bildirge'ye, bankalara, KEP'e ya da muhasebe yazılımına
> **bağlanmaz**. Yalnızca dosya üretir; e-posta bildirimleri notification-service kuyruğuna yazılır
> (test ortamında mailpit). Hiçbir dosya düzeni resmî sistemde gerçek hesapla denenmedi.

## Önceden var olanlar

| Konu | Durum (dalga 8 öncesi) |
|---|---|
| Brütten nete hesap | `PayrollCalculator` (SGK/işsizlik, kümülatif GV, asgari ücret istisnası, damga). Değişmedi; yalnızca istisna aç/kapa bayrağı eklendi. |
| Parametreler | Yıl başına tek satır (asgari ücret, işveren SGK, teşvik, damga, tavan çarpanı, dilimler); işçi oranları kodda sabitti. |
| SGK APHB | Basit XML taslağı (eksik gün nedeni sabit 13, meslek kodu yok, tek belge). |
| Banka dosyası | Genel CSV, TR IBAN mod-97, toplam satırı. |
| Muhasebe | Logo/Mikro/Netsis/genel CSV, istek başına hesap kodları (kalıcı değildi), dengesizlikte yalnızca uyarı. |
| Kıdem/ihbar | offboarding'de tahmini hak ediş (engagement-service `SettlementCalculator`; tavan ortam değişkeni, ihbar GV'si yok, onay/belge yok). |
| Pusula | İstemci tarafında yazdırma/PDF (`payslipPrint.ts`). |
| Ücret bantları | Kademe + yıl (alt/orta/üst); zam dönemi çalışma sayfasında compa-ratio. |
| Fark bordrosu | Yoktu. |

## 60 — Yıllık / yarıyıllık parametreler

`compensation_payroll_parameters`: yıl + **yürürlük ayı** (`ValidFromMonth`, ör. 7 = Temmuz) başına
satır. Dönem hesaplanırken ayına göre en son yürürlüğe giren satır kullanılır; o yıl satır yoksa
koddaki yasal varsayılan (`PayrollDefaults`). Alanlar: brüt/net asgari ücret, SGK işçi/işveren,
işsizlik işçi/işveren, teşvik puanı, damga, SGK tavan çarpanı (taban = asgari ücret), GV dilimleri,
asgari ücret istisnası (aç/kapa), AGİ (2022 öncesi, **yalnızca bilgi**, hesaplamaya girmez), kıdem
tavanı (Ocak–Haziran / Temmuz–Aralık), "doğrulandı" bayrağı, kaynak notu. Değişiklik önce/sonra
değerleriyle denetim kaydına yazılır (`PayrollParameterSet`).

Tohum (yalnızca o yıl için hiç satırı olmayan şirketlere):

| Yıl | Durum | Kaynak |
|---|---|---|
| 2025 | doğrulandı | brüt asgari ücret 26.005,50, net 22.104,67; dilimler 158 bin / 330 bin / 1,2 milyon / 4,3 milyon; işveren %20,75 − 5 puan; tavan 7,5 kat; kıdem tavanı 46.655,43 / 53.919,68 |
| 2026 | **doğrulanmadı** | uygulamadaki 2026 varsayılanlarının kopyası: 33.030,00 / 28.075,50; 190 bin / 400 bin / 1,5 milyon / 5,3 milyon; %21,75 − 2 puan; 9 kat; kıdem tavanı 64.948,77 (1. yarı, doğrulanmadı) / 73.729,87 |

Tohum değerleri koddaki varsayılanlarla birebir aynıdır; mevcut dönemlerin sonucu değişmez
(birim testi: `Tohum_satirlari_kod_varsayilaniyla_ayni_sonucu_verir`). Şirketin önceden girdiği
parametre satırına dokunulmaz.

## 58 — SGK Aylık Prim ve Hizmet Belgesi (APHB)

Kapanmış dönemden XML ya da TXT. Dönem sayfasında **Doğrula** raporu (indirmeden önce): geçersiz/eksik
TCKN (hata, dosyaya alınmaz), eksik meslek kodu, prim günü 0–30 dışı, PEK asgari ücretin altında /
tavanın üstünde, nedeni bulunamayan eksik gün, SGDP, işten çıkış kodu bulunamadı (uyarı).

Alanlar: TCKN (engagement profilindeki şifreli alandan açılır), ad/soyad (Türkçe büyük harf), prim
günü, hak edilen ücret (dönem ücreti + fazla mesai, PEK'i aşmaz), prim/ikramiye (PEK − ücret), PEK,
eksik gün sayısı ve nedeni, işe giriş/işten çıkış günü, çıkış nedeni kodu (offboarding nedeninden),
meslek kodu, belge türü ve kanun (çalışan > şirket varsayılanı; SGDP işaretliyse belge türü 02).
XML'de belge türü + kanun başına bir `BELGE` grubu (kişi sayısı, toplam PEK ve gün).

TXT sütun sırası (noktalı virgül, başlıksız, CRLF, virgüllü ondalık):
`BelgeTuru;KanunNo;TCKimlikNo;Ad;Soyad;PrimGun;HakEdilenUcret;PrimIkramiye;EksikGunSayisi;EksikGunNedeni;IseGirisGun;IstenCikisGun;IstenCikisNedeni;MeslekKodu`

**Doğrulanmamış / belirsiz noktalar** (yüklemeden önce SGK'nın güncel e-Bildirge toplu dosya
kılavuzuyla karşılaştırın):

- XML eleman adları ve TXT sütun sırası kamuya açık örneklerden derlenmiştir; resmî şema değildir.
  "İlk soyadı", "uzaktan çalışma günü", "tahakkuk nedeni", "hizmet dönemi" gibi alanlar yazılmaz.
- Eksik gün kodları (varsayılan eşleme, şirket değiştirebilir): ücretsiz izin **21** (diğer ücretsiz
  izin), istirahat **01** (hastalık/doğum; varsayılan olarak ücretten düşmez), birden fazla neden
  **12**, eşleme yok **13** (diğer nedenler). Önceki sürüm ücretsiz izne 13 yazıyordu.
- İşten çıkış kodları (varsayılan): istifa 03, işveren feshi 04, belirli süreli sözleşme sonu 05,
  emeklilik 08, diğer 22.
- Belge türü varsayılanı 01, SGDP 02; kanun varsayılanı 05510 (teşviksiz). Teşvik kanunları ve
  belge türü kombinasyonları denetlenmez.
- SGDP'li çalışanın bordrosu SGDP oranlarıyla **hesaplanmaz** (uyarı verilir).
- Meslek kodu biçimi `0000.00` denetlenir; SGK meslek kodu listesinde varlığı denetlenmez.

"Ücretten düşer" işaretli izin türleri bordroda eksik gün sayılır (varsayılan yalnızca ücretsiz izin
— önceki davranışla aynı).

## 62 — Banka toplu ödeme dosyası

Şablonlar: `generic` (HR360 genel CSV, önceki biçim), **örnek şablon A** (noktalı virgüllü CSV,
virgüllü ondalık, ASCII büyük harf ad, sıra no ve TOPLAM satırı, ISO-8859-9), **örnek şablon B**
(sabit uzunluklu TXT: `H` başlık = firma kodu 10 + tarih 8 + borçlu IBAN 26 + kayıt sayısı 6 + toplam
kuruş 15; `D` detay = sıra 6 + IBAN 26 + ad 40 + tutar kuruş 15 + döviz 3 + açıklama 30; `T` toplam =
kayıt 6 + toplam kuruş 15) ve **özel düzen** (sütunlar: name, iban, amount, currency, description,
date, tckn, employeeNo, seq; ayırıcı, ondalık, başlık/toplam satırı, kodlama, ASCII, tarih biçimi).

> Örnek şablonlar yaygın banka dosyalarına benzer ama **hiçbir bankanın resmî biçimi olarak
> doğrulanmamıştır**. Bankanızın teknik dokümanıyla karşılaştırın; gerekirse özel düzeni kullanın.

IBAN: TR, 26 karakter, mod-97 = 1; geçersiz IBAN'lı kişi dosyaya alınmaz (uyarı). Dosyanın SHA-256
özeti dışa aktarım kaydında ve oluşturma/indirme denetim kayıtlarında tutulur. Banka dosyası tek
indirmeliktir, 24 saatte silinir (önceki kural).

## 64 — Muhasebe fişi

Şirketin hesap planı (ücret gideri, işveren SGK gideri, personele borçlar, ödenecek GV/damga/SGK,
avans ve diğer kesintiler) ve bölüm → masraf merkezi kodu eşlemesi (SGK ve dosya ayarları sekmesi).
Fiş borç = alacak denetiminden geçmezse dosya **üretilmez** (422 `journal_unbalanced`). Biçimler:
genel, Logo, Mikro, Netsis sütun düzeni (yazılımların içe aktarma şablonuyla birebir doğrulanmadı).
Not: tek kişilik bölümde masraf merkezi toplamı kişinin ücretini gösterir; dosya yalnızca muhasebeye
gider (yetkili alıcı).

## 61 — Kıdem ve ihbar

Ücret › Bordro › Kıdem ve ihbar (ayrılış kaydından ya da elle; offboarding ekranından bağlantı).
Giydirilmiş aylık brüt = aylık brüt + düzenli ek ödemeler (öneri: son 12 kapanmış pusulanın ek ödeme
ortalaması; İK değiştirir) + diğer sürekli yan haklar (elle). Kıdem = min(giydirilmiş, kıdem tavanı)
× hizmet günü / 365; GV'den istisna, damga vergisi. İhbar = giydirilmiş / 30 × 7 × hafta (2/4/6/8);
SGK yok, gelir vergisi (yılın kümülatif matrahıyla) ve damga. Kullanılmayan izin brüt gösterilir (son
bordroda ek ödeme olarak işlenir). Kıdem hakkı ve ihbar ödemesi ayrılış nedeninden önerilir, İK
değiştirebilir (otomatik karar yok). Akış: hazırla (taslak) → **başka** bir bordro yetkilisi onaylar
(görevler ayrılığı) → ibraname. İbraname metni governance belge şablonlarındaki "İbraname"
şablonundan (örnek şablonlara eklendi) ya da varsayılan metinden; hukuk birimince uyarlanmalıdır.
offboarding'deki tahmini hesap da kıdem tavanını artık bordro parametrelerinden okur.

## 63 — Fark bordrosu

Son 24 aydaki kapanmış dönemlerde, pusuladaki aylık brüt ile o dönem için geçerli ücret kaydı
farklıysa (geriye dönük zam) pusula saklı girdileriyle yeniden hesaplanır; brüt farkından önceden
ödenen farklar düşülür. İK seçtiği farkları açık bir döneme **"Fark: YYYY/AA"** ek ödemesi olarak
onaylar; kapanmış dönem açılmaz. Onaylayan o dönemin hazırlayanı sayılır (kapatamaz). Negatif fark
yalnızca gösterilir.

**Sınırlama:** fark ödendiği ayın bordrosunda vergilendirilir ve o ayın PEK'ine girer. SGK açısından
ücret farkının ait olduğu aya ek APHB ile bildirilmesi gerekebilir; bu sürüm ek belge üretmez.

## 59 — e-Bordro

Kapanmış dönemde **Yayımla**: her pusulanın kanonik JSON'u (sabit alan sırası) SHA-256 ile özetlenir,
kopyası AES-256-GCM ile şifreli saklanır (`TENANT_SECRET_KEYS`, anahtar yenilemede yeniden yazılır),
çalışana uygulama içi + (e-postası varsa) e-posta bildirimi gider — **tutar yazmaz**. Çalışanın açması
"okundu" (ilk/son açılış, sayaç); "Okudum, teslim aldım" onaylanan özet, zaman ve IP /24 önekiyle
kaydedilir (denetim kaydı). Dönem yeniden açılıp pusula değişirse özet tutmaz; yeniden yayımlama onayı
sıfırlar. Sunucu tarafında PDF üretilmez (gömülü Türkçe yazı tipi gerektirir); PDF tarayıcının
yazdırma penceresinden alınır. Bu bir **e-imza değildir** (e-imza motoru tek: governance
`SignatureEngine`); gerekirse teslim onayı ileride bu motora bağlanabilir.

## 65 — Ücret bantları ve compa-ratio

Bantlara yürürlük tarihi eklendi (aynı kademede yıl içinde yeni bant). Bant eşlemesi: çalışanın ücret
kaydındaki kademe + para birimi, bugün yürürlükte olan en yeni bant. Bant uyumu sekmesi: bant ve
bölüm bazında altında/içinde/üstünde sayıları ve ortalama compa-ratio (5 kişiden az grup gizli);
kişi bazlı compa-ratio yalnızca İK/ücret görme izni, görüntüleme kaydedilir. Ücret adaleti analizi
(ML dalgası 2) zaten kademe ve unvanı meşru etken olarak kullanıyor; ML tarafında değişiklik yapılmadı.

## Uçlar (gateway öneki `/api/compensation/compensation`)

| Uç | Yetki |
|---|---|
| `GET/PUT/DELETE payroll/parameters/{yıl}` (`?month=`, `?validFromMonth=`) | okuma: bordro görüntüleyen; yazma: bordro yetkilisi |
| `GET/PUT payroll/settings` | okuma/yazma |
| `GET payroll/sgk/employees`, `PUT payroll/sgk/employees/{id}` | okuma/yazma |
| `GET payroll/periods/{id}/sgk/validation` | bordro yetkilisi |
| `POST payroll/periods/{id}/exports` (`kind`, `format`, `payDate`) | bordro yetkilisi |
| `GET payroll/retro/candidates`, `POST payroll/retro/apply`, `GET payroll/retro` | yetkili / görüntüleyen |
| `POST severance/preview`, `POST severance`, `GET severance`, `POST severance/{id}/decide`, `GET severance/{id}/document` | bordro yetkilisi (liste: görüntüleyen) |
| `POST payroll/periods/{id}/e-payslips/publish`, `GET payroll/periods/{id}/e-payslips` | yetkili / görüntüleyen |
| `GET payslips/{id}/e-payslip`, `POST payslips/{id}/acknowledge` | çalışanın kendisi (görüntüleme İK da) |
| `GET bands/compa-ratios`, `GET bands/coverage` | İK ve ücret görme izni |
