# Keycloak yönetim paneline erişimi kısıtlama

Keycloak yönetim konsolu (`/auth/admin`) ve yönetici girişinin yapıldığı master realm
(`/auth/realms/master`) varsayılan olarak uygulamayla aynı adresten herkese açıktır.
Uygulama girişi (hr360 realm) bu ayardan hiç etkilenmez.

Erişim tek komutla değiştirilir; ayar `.env`'e yazılır ve kalıcıdır:

| Mod | Komut | Sonuç |
| --- | --- | --- |
| open (varsayılan) | `scripts/keycloak-admin-access.sh open` | Panel `https://<adres>/auth/admin/` üzerinden herkese açık |
| ip | `scripts/keycloak-admin-access.sh ip 203.0.113.10,10.20.0.0/16` | Panel aynı adreste, yalnızca listedeki IP/CIDR'lere açık; diğerleri 403 alır |
| port | `scripts/keycloak-admin-access.sh port` | Panel ana adreste tamamen kapalı; yalnızca `https://<adres>:8090/auth/admin/` üzerinden. Portu firewall ile kısıtlarsınız |
| port + ip | `scripts/keycloak-admin-access.sh port 203.0.113.10` | Port modu + nginx ayrıca o portta IP kısıtı (iki katman) |

Geçerli ayarı görmek için: `scripts/keycloak-admin-access.sh status`.
Kurulum sırasında da `install.sh` bu seçimi sorar.

## Neden firewall için ayrı port?

Firewall IP ve port üzerinden çalışır, URL yolunu (`/auth/admin`) göremez. Panel uygulamayla
aynı portta kalırsa firewall ya uygulamayı da kapatır ya da paneli açık bırakır. Port modunda
panel ayrı bir portta yayınlanır; o portu yalnızca yönetim IP'lerine açarsınız.

Port modunda betik ayrıca master realm'in "Frontend URL" ayarını yönetim portuna çevirir:
yönetim konsolunun girişi master realm üzerinden yapıldığı için, aksi halde giriş ekranı
kapalı olan ana adrese gider ve açılmaz. Diğer modlara dönünce bu ayar temizlenir.

## Firewall örnekleri (port modu, varsayılan port 8090)

```bash
# ufw
sudo ufw allow from 203.0.113.10 to any port 8090 proto tcp
sudo ufw deny 8090/tcp

# firewalld
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="203.0.113.10" port port="8090" protocol="tcp" accept'
sudo firewall-cmd --reload
```

**Docker ve host firewall'u:** Docker, yayınladığı portlar için iptables kurallarını ufw/firewalld
kurallarından önce ekler; bu yüzden yukarıdaki kurallar Docker portlarını her zaman kapatmaz. Güvenilir yol: bulut sağlayıcının
güvenlik grubu/ağ ACL'i, ya da `DOCKER-USER` zinciri:

```bash
sudo iptables -I DOCKER-USER -p tcp --dport 8090 ! -s 203.0.113.10 -j DROP
```

Emin değilseniz nginx katmanını da ekleyin: `scripts/keycloak-admin-access.sh port 203.0.113.10`.

## Dikkat

- nginx istemci IP'sini doğrudan bağlantıdan alır. Gateway'in önünde başka bir yük
  dengeleyici/ters vekil varsa herkes onun IP'si gibi görünür: kısıtı o cihazda yapın ya da
  nginx'te `real_ip` modülünü yapılandırın.
- Kendinizi dışarıda bıraktıysanız sunucuda `scripts/keycloak-admin-access.sh open` çalıştırmak
  paneli yeniden açar (sunucu kabuğu yeterli, panele erişim gerekmez).
- Uygulamanın kendi servisleri Keycloak yönetim API'sine iç ağdan (`keycloak:8080`) erişir;
  bu ayar onları etkilemez.
