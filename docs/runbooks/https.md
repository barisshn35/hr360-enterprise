# HTTPS'i açma

HTTPS gateway'de (nginx) sonlanır; arkadaki servisler ve Keycloak iç ağda HTTP konuşur.
Tek komutla açılır, adres ve Keycloak ayarları betik tarafından güncellenir.

`install.sh` kurulumda HTTPS'i sorar ve seçilen yöntemle bu betiği kendisi çalıştırır;
aşağıdaki komutlar kurulumdan sonra değiştirmek için.

```bash
# Let's Encrypt: ücretsiz sertifika + otomatik yenileme (önerilen)
scripts/tls.sh enable --letsencrypt --host hr.sirket.com --email it@sirket.com

# Kendi sertifikanız (kurumsal CA, satın alınmış sertifika)
scripts/tls.sh enable --cert /yol/fullchain.pem --key /yol/privkey.pem --host hr.sirket.com

# Test için kendinden imzalı sertifika
scripts/tls.sh enable --self-signed --host hr.sirket.local

scripts/tls.sh status
scripts/tls.sh disable
```

Açınca:
- 443'te HTTPS açılır, HTTP istekleri HTTPS'e yönlendirilir.
- `PUBLIC_URL`/`PUBLIC_ORIGIN` `https://<host>` olur; Keycloak'ın genel adresi, uygulama
  istemcisinin yönlendirme adresleri ve servislerin beklediği jeton üreticisi (issuer) buna göre
  güncellenir. Açık oturumlar yeniden giriş ister (eski jetonlar farklı issuer taşır).
- Realm'de "SSL gerekli: dış istekler" (`sslRequired=external`) açılır.
- Yönetim paneli ayrı porttaysa (`keycloak-admin-access.sh port`) adresi yeni kökene göre yenilenir.
  Not: ayrı yönetim portu (8090) HTTP kalır; onu yalnızca yönetim ağına açın.

## Let's Encrypt

Koşullar:
- Alan adının DNS A/AAAA kaydı sunucunun genel IP'sini göstermeli.
- 80/tcp ve 443/tcp internete açık olmalı (firewall / bulut güvenlik grubu).
- `GATEWAY_PORT=80` olmalı; doğrulama 80. porttan yapılır.

Nasıl çalışır:
- `certbot` servisi, doğrulama dosyasını `deploy/nginx/acme/` klasörüne yazar; gateway bu
  dosyayı `/.well-known/acme-challenge/` yolundan sunar. Bu yol HTTPS'e yönlendirilmez.
- Sertifikalar `deploy/letsencrypt/` klasöründe durur (git'e girmez; yedeğe alın).
- `certbot` servisi 12 saatte bir kontrol eder ve süresi 30 günden az kalan sertifikayı
  yeniler. Servis `.env`'deki `COMPOSE_PROFILES=letsencrypt` ile açılır.
- Gateway 6 saatte bir nginx'i yeniden yükler, böylece yeni sertifika kesinti olmadan devreye girer.

Denetim:
- `scripts/tls.sh status` sertifikanın bitiş tarihini ve yenileme servisinin çalışıp
  çalışmadığını gösterir.
- `docker compose logs certbot` yenileme kayıtlarını gösterir.
- Önce denemek isterseniz `--staging` ekleyin. Bu, Let's Encrypt'in test ortamıdır;
  tarayıcı sertifikaya güvenmez ama istek sınırlarına takılmazsınız. Sonra `--staging`
  olmadan tekrar çalıştırın.

Kurulumda Let's Encrypt başarısız olursa (DNS henüz yayılmadı, port kapalı) kurulum durmaz.
Uygulama HTTP ile açılır ve ekrana tekrar deneme komutu basılır.

## Kendi sertifikanız

Sertifika yenilendiğinde aynı `enable --cert ... --key ...` komutunu yeni dosyalarla tekrar
çalıştırın.

**Gateway'in önünde TLS'i sonlandıran bir yük dengeleyici varsa** bu betiği kullanmayın
(HTTP→HTTPS yönlendirmesi döngüye girer). Onun yerine `.env`'de `PUBLIC_ORIGIN=https://<host>`
yapıp `docker compose up -d` çalıştırın ve realm'de `sslRequired`'ı `external` yapın.
