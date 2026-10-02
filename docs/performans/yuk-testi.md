# Yük testi raporu

Araç: **k6** (`tests/load/hr360.js`, çalıştırma: `scripts/loadtest.sh [smoke|load|stress]`).
Senaryo bir iş gününü taklit eder:

- %70 çalışan: ana sayfa, izin, bildirim, takdir, ofis.
- %25 yönetici: onay kutusu, ekip sağlığı, 1:1, organizasyon.
- %5 İK: analitik, denetim kaydı.

Her "ekran", tarayıcının yaptığı gibi paralel isteklerle yüklenir. Kullanıcılar ekranlar arasında 1–5 sn bekler.

**Ortam:** Tek sunucuda tüm yığın. Bu sunucuda 15 .NET servisi, PostgreSQL, Kafka, Keycloak, MinIO, ML servisi ile Prometheus, Grafana ve Loki çalışıyordu. Donanım **2 vCPU / 7 GB RAM** idi. İstekler gateway'e Docker ağı içinden gitti. Bu, önerilen asgari donanımın (8–16 GB) altındadır. Sonuçlar alt sınır olarak okunmalı.

**Eşikler:**

- Hatalı istek oranı < %1.
- Okuma uçlarında p95 < 800 ms ve p99 < 2 sn.
- Rapor ucunda p95 < 3 sn.

## Sonuçlar (2 Ekim 2026)

| Profil | Eşzamanlı kullanıcı | İstek/sn | Hata | Ort / p95 / p99 | Ekran p95 | Eşikler |
|---|---|---|---|---|---|---|
| load | 100 | 70 | %0,00 | 19 / 46 / 99 ms | 62 ms | geçti |
| stress (düzeltme öncesi) | 400 | 83 | **%17,55** | 3,1 sn / 14,4 sn / 20,6 sn | 17,4 sn | kaldı |
| stress (düzeltme sonrası) | 400 | 189 | %0,08 | 380 / 1.574 / 2.911 ms | 2,5 sn | gecikmede kaldı |
| stress (Redis önbelleği ile, 3 Ekim) | 400 | 213 | %0,00 | 179 / 735 / 1.135 ms | 986 ms | **geçti** |

## Bulunan sorun ve düzeltme

İlk stress denemesinde isteklerin %17,5'i hata verdi. Hatalar iki türdü:

- **500:** Loglarda ve Grafana panosunda PostgreSQL'in `too many clients` hatası görüldü (1.510 kez).
- **403:** Bunlar ikincil hatalardı. İzin, bildirim ve onay servisleri çalışan kimliğini employee-service'e sorar. employee-service 500 döndüğünde bu servisler güvenli tarafta kalıp isteği reddediyordu.

Kök neden bağlantı bütçesiydi:

- PostgreSQL'in varsayılan sınırı 100 bağlantı.
- Her .NET servisinin Npgsql havuzu ise varsayılan olarak 100'e kadar büyüyebiliyor. 15 servis ve Keycloak birlikte bu sınırı yük altında hemen aşıyordu.

Düzeltme (`docker-compose.yml`):

- Her servisin ana havuzu `Maximum Pool Size=12`, kiracı durum havuzu 3 bağlantıyla sınırlandı.
- Keycloak'ın havuzu `KC_DB_POOL_MAX_SIZE=20` ile sınırlandı.
- PostgreSQL `max_connections=300` yapıldı. Toplam bütçe yaklaşık 250 bağlantı, sınır 300.

Sonuç:

- Hata oranı %17,55'ten %0,08'e indi.
- Aynı donanımda saniyedeki istek 83'ten 189'a çıktı (2,3 kat).
- p95 14,4 sn'den 1,6 sn'ye düştü.

## Redis önbelleği (3 Ekim 2026)

Stres testinde en yavaş uçlar birden çok tabloyu birleştiren, kiracı genelinde aynı
sonucu veren okumalardı. Bunlar için kısa ömürlü paylaşılan önbellek eklendi
(Valkey, Redis uyumlu; `REDIS_URL`):

| Önbellek | Süre | Anahtar | Eskitme |
|---|---|---|---|
| Çalışan dizini (`PeopleDirectory`, engagement + governance) | 30 sn | kiracı | süre dolunca |
| Ofis doluluğu (`workplace/presence`) | 30 sn | kiracı + tarih aralığı | biri yerini güncelleyince hemen |
| Ekip sağlığı (`team-health`) | 60 sn | kiracı + kullanıcı + filtre | süre dolunca |
| Analitik özet (`analytics/overview`) | 2 dk | kiracı + dönem + gün | süre dolunca |

Yetki denetimi önbellekten önce yapılır; kullanıcıya göre değişen sonuçların
anahtarında kullanıcı vardır. Redis kapanırsa servisler 30 sn boyunca Redis'i hiç
denemeden doğrudan veritabanından okur (devre kesici), sonra yeniden bağlanır.
Açık API'nin dakikalık istek sınırı da artık Redis'teki ortak sayaçla tutulur;
servisin birden çok kopyası çalışsa da sınır doğru uygulanır.

Aynı 400 kullanıcılık stres profili, önbellekten önce ve sonra:

| Uç | p95 önce | p95 sonra |
|---|---|---|
| `team-health` | 3.393 ms | 323 ms |
| `workplace/presence` | 2.963 ms | 364 ms |
| `celebrations` (dizini kullanır) | 1.984 ms | 618 ms |
| `analytics/overview` | 1.953 ms | 346 ms |
| `kudos` (dizini kullanır) | 1.345 ms | 472 ms |
| Tüm istekler | 1.574 ms | 735 ms |

Pahalı sorgular aradan çıkınca veritabanı ve işlemci diğer uçlara da yetti:
önbelleğe alınmayan uçların çoğunda da p95 %15–40 düştü, saniyedeki istek 189'dan 213'e
çıktı ve 400 kullanıcıda tüm eşikler karşılandı. İsabet oranı Grafana panosundaki
"Önbellek isabet oranı" grafiğinde izlenir; Redis'e ulaşılamazsa
`OnbellekKullanilamiyor` alarmı tetiklenir.

## Yorum

- **100 eşzamanlı kullanıcı:** Tüm eşikler rahatça karşılandı (p95 46 ms). Bu yük, ekranlar arasındaki bekleme süreleriyle kabaca 1.000–2.000 kişilik bir şirketin yoğun saatine karşılık gelir.
- **400 eşzamanlı kullanıcı:** Önbellek öncesinde hata oranı düşük kaldı ama 2 vCPU doydu ve gecikme eşiği aşıldı. Redis önbelleğiyle aynı donanımda eşikler karşılanıyor (p95 735 ms).
- **En pahalı uçlar** (ekip sağlığı, ofis doluluğu, analitik) önbelleğe alındı. Sıradaki aday analitik görünümlerin materialized view'e çevrilmesidir.
- 400 kullanıcının üzerinde yatay ölçek gerekir: servislerin birden fazla kopyası ve gateway'de yük dengeleme. Orijinal 7 sunuculu mimari bunun içindir.

Test sırasında servis davranışı Grafana'daki "HR360 — Servis sağlığı" panosunda izlendi: istek hızı, p95, CPU, bellek ve PostgreSQL bağlantıları.
