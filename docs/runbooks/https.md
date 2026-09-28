# HTTPS'i açma

HTTPS gateway'de (nginx) sonlanır; arkadaki servisler ve Keycloak iç ağda HTTP konuşur.
Tek komutla açılır, adres ve Keycloak ayarları betik tarafından güncellenir.

```bash
# Gerçek sertifika (örn. Let's Encrypt)
scripts/tls.sh enable --cert /etc/letsencrypt/live/hr.sirket.com/fullchain.pem \
                      --key  /etc/letsencrypt/live/hr.sirket.com/privkey.pem \
                      --host hr.sirket.com

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

Sertifika yenilendiğinde aynı `enable` komutunu yeni dosyalarla tekrar çalıştırın.

**Gateway'in önünde TLS'i sonlandıran bir yük dengeleyici varsa** bu betiği kullanmayın
(HTTP→HTTPS yönlendirmesi döngüye girer). Onun yerine `.env`'de `PUBLIC_ORIGIN=https://<host>`
yapıp `docker compose up -d` çalıştırın ve realm'de `sslRequired`'ı `external` yapın.
