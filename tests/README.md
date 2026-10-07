# HR360 testleri

| Katman | Yer | Ne sınar | Nasıl |
|---|---|---|---|
| .NET birim | `tests/dotnet/` | Kural motoru, şablonlar, Slack imzası, PKCE, şifreli sırlar, Slack/Teams mesaj biçimleri, toplantı saati önerisi, kıdem/ihbar/izin hesabı | `scripts/test.sh unit` (CI'da her push) |
| Arayüz birim | `apps/web/src/**/*.test.ts` | Bordro (2026 GV dilimleri, asgari ücret istisnası, SGK tavanı, netten brüte) | `cd apps/web && npm test` |
| ML birim | `apps/ml-inference/tests/` | CV ayrıştırma, ayrımcı ifade, eşleşme, izin tahmini, eğitim önerisi | `scripts/test.sh unit` |
| API entegrasyon | `tests/integration/` | Slack uygulaması ve Teams botu (onay düğmeleri, imza/JWT, yetki), Google/Outlook takvim + Zoom/Teams/Meet, LLM (izin, takma ad, kota), Redis önbelleği (anahtar ayrımı, yazınca eskitme, Redis kapalıyken çalışma, açık API sayacı) | `scripts/test.sh integration` |
| Tarayıcı (e2e) | `tests/e2e/` | Dört rolle 50+ ekranda hata olmaması; izin talebi → yönetici onayı → Kafka → onaylı izin ve bildirim | `scripts/test.sh e2e` |

Entegrasyon ve e2e testleri **çalışan bir kurulum** ister:

- `tests/credentials.json` dosyası gerekir (`tests/credentials.example.json`'dan kopyalayın). Bu dosya git'e girmez. Alternatif: `HR360_TEST_USERS` ortam değişkeni.
- Adres `HR360_BASE_URL` ile verilir; varsayılanı `http://localhost`.
- Python bağımlılıkları: `pip install pytest playwright pytest-xdist` ve `playwright install chromium`.
- e2e paralel çalışır (pytest-xdist varsa): önce `-n ${HR360_E2E_WORKERS:-4} -m "not serial"`, sonra
  `-m serial` (kullanıcının sunucudaki ortak durumunu değiştiren testler, ör. dil tercihi). Oturum durumu
  rol başına bir kez alınıp (`storage_state`) yeniden kullanılır. `HR360_E2E_WORKERS=0` sıralı çalıştırır.
  Yeni test bir kullanıcının sunucudaki ayarını (dil, tercih vb.) geçici değiştiriyorsa `@pytest.mark.serial`
  ekleyin. Ayrıntı: `tests/e2e/conftest.py`.

Erişim jetonları test kullanıcılarıyla tarayıcıdan giriş yapılarak alınır ve süreleri dolana kadar önbellekte tutulur.

Gerçek Slack, Teams, Google, Microsoft ve Zoom hesabı gerekmez:

- `tests/integration/chatmock.py` bu servislerin ve LLM'in API'lerini taklit eder.
- `deploy/testing/chat-mock.yml` governance-service'i bu sahte servislere yönlendirir.
- `scripts/test.sh integration` ikisini de otomatik kurar, bitince her şeyi eski haline getirir.
