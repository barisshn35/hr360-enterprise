# Arayüz dili (Türkçe / İngilizce)

Panel Türkçe ve İngilizce kullanılabilir. Dil üst çubuktaki **EN / TR** düğmesiyle
değiştirilir; seçim tarayıcıda saklanır. Bağlantıya `?lang=en` eklemek de dili seçer.
Keycloak giriş ekranı da seçili dilde açılır.

## Nasıl çalışır

- Kodda metinler Türkçe yazılır ve `tx()` ile sarılır; Türkçe metnin kendisi anahtardır:

  ```tsx
  <Button>{tx('Kaydet')}</Button>
  toast.ok(tx('{0} kayıt içe aktarıldı', [n]))
  ```

- İngilizce karşılıklar `apps/web/src/locales/en.json` dosyasındadır. Sözlük yalnızca
  İngilizce seçildiğinde, uygulama yüklenmeden önce indirilir. Türkçe kullanıcılar için ek
  yük yoktur.
- Sayı ilk yer tutucudaysa tekil ve çoğul `|` ile ayrılır: `"{0} record|{0} records"`.
- Yüzde için `pct(40)` kullanılır (Türkçe `%40`, İngilizce `40%`). Tarih ve sayı
  biçimleri `appLocale` ile seçili dile göre yapılır.
- **Sunucu iletileri** (hata iletileri, bildirim konusu ve metni, ekip sağlığı uyarıları,
  olay radarı özetleri, rozet adları…) servislerden Türkçe gelir. İngilizce arayüzde API
  yanıtları ve hata iletileri sözlükteki `@server:` kayıtlarıyla çevrilir. Değişken içeren
  iletiler kalıpla eşleşir: `"@server:{0} gündür izin kullanmadı"` → `"No leave taken for {0} days"`.
  Sözlükte karşılığı olmayan ileti olduğu gibi gösterilir.
- Kullanıcı verisi çevrilmez: çalışan adı, departman, pozisyon, kural adı, gerekçe gibi
  alanlar girildikleri dilde kalır.

## Yeni metin eklerken

1. Metni `tx('…')` ile sarın. Değişkenler için `tx('… {0} …', [değer])` kullanın; metni
   değişkenle birleştirmeyin, çünkü İngilizcede sözcük sırası farklı olabilir.
2. `npm run i18n:check -- --write` eksik anahtarları `en.json`'a boş değerle ekler.
   Karşılıklarını yazın.
3. `npm run i18n:check` eksik ya da yer tutucusu uyumsuz anahtar kalmadığını doğrular.
   CI bu denetimi her push'ta çalıştırır.

Tarayıcı testi `tests/e2e/test_english.py` tüm ekranları İngilizce açar. Hata
olmamasını ve sözlükteki bir Türkçe metnin çevrilmeden görünmemesini denetler.

## Bilinen sınırlar

- **Rapor asistanı** soruları yalnızca Türkçe anlar. Örnek sorular bu yüzden Türkçe
  gösterilir.
- **Sohbet botu** komutları (`onaylarım`, `bakiye`, `izindekiler`, `kimnerede`) Türkçedir.
- **E-postalar ve kayıtlı bildirimler** gönderildikleri anda Türkçe üretilir. Panelde
  bilinen kalıplar çevrilir; e-posta kutusuna Türkçe gider.
- **Yapay zekâ çıktıları** (ilan taslağı, özet) Türkçe istenir.
