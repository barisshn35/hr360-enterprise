# HR360 v2 Frontend — Claude Code Devir Notu

Bu dosyayı + `21ST-MANIFEST.md`'yi Claude Code oturumunda ilk mesaj olarak paylaş.

---

## Görev

HR360'ın arayüzünü **21st.dev bileşenleri üzerine baştan** kur. Mevcut frontend
çalışıyor ama bu sürümde iki şey değişiyor:

1. **Çok kiracılılık** arayüze yansıyacak (yeni: şirket kaydı, kiracı değiştirici,
   platform admin paneli)
2. Tüm görsel dil 21st.dev kataloğundan gelecek — `21ST-MANIFEST.md`'de hangi
   bileşenin nereye gideceği ve kurulum komutu yazılı

**Canlı:** https://staffware.com.tr

---

## Bu repoda HAZIR gelenler (tekrar yazma)

| Dosya | Ne |
|---|---|
| `src/styles/index.css` | Tasarım tokenları. 21st.dev bileşenlerinin beklediği tüm CSS değişkenleri (light + dark), Geist tipografisi, chart/sidebar token setleri. |
| `src/components/layout/SidebarNav.tsx` | 21st.dev "Dashboard Sidebar" uyarlaması. 14 modül, rol bazlı filtre, **TenantSwitcher**, ⌘K kancası, bildirim rozeti. |
| `src/auth/roles.ts` | İzin matrisi. Rol devralma zinciriyle (`platform-admin` → `system-admin` → `hr-admin` → `manager` → `employee`). |

`SidebarNav` şu ikisini bekliyor, bunları sen yazacaksın:
- `useAuth()` → `{ can, logout, tenant, canSwitchTenant, availableTenants, switchTenant }`
- `onOpenCommandPalette` prop'u

---

## Teknoloji

React 19 + TypeScript + Vite + Tailwind v4 + TanStack Query + react-router-dom v7
+ keycloak-js (Authorization Code + PKCE).

Tailwind **v4** kullanıyoruz — `index.css` `@import 'tailwindcss'` ve
`@theme inline` ile yapılandırılmış, ayrı `tailwind.config.js` yok.

---

## Kimlik doğrulama

```
Realm:       hr360
Auth URL:    https://staffware.com.tr/auth
Client:      hr360-web  (public, PKCE/S256)
Scope:       openid organization        ← "organization" ZORUNLU
```

**`organization` scope'u kritik:** Keycloak bu scope istendiğinde JWT'ye
`organization: ["<tenant-slug>"]` claim'ini ekliyor. Backend'deki tüm veri
izolasyonu bu claim'e dayanıyor. İstenmezse kullanıcı **hiçbir veri göremez**
(boş liste döner, hata vermez — sessiz başarısızlık).

```ts
keycloak.init({
  onLoad: 'check-sso',
  pkceMethod: 'S256',
  scope: 'openid organization',   // ← unutma
});
```

Token'dan okunacaklar:
- `realm_access.roles` → izin matrisi
- `organization[0]` → tenant slug

---

## Yeni ekranlar (çok kiracılılık)

### 1. Şirket kaydı — `/kayit` (anonim)

21st.dev: **Onboarding Wizard Form** (id 25064) + **Pricing** (id 21479)

```
POST /api/tenant/registration          (token GEREKMEZ)
  { companyName, adminEmail, adminFullName?, slug?, emailDomain?, taxNumber? }
  → { tenantId, slug, companyName, status, message }

GET  /api/tenant/registration/slug-available?slug=acme
  → { slug, available }
```

Akış: şirket bilgileri → yönetici → plan → özet → gönder → başarı ekranı.
Slug alanında **canlı müsaitlik kontrolü** (debounce ~400ms).
Başarı ekranı: "E-postanıza parola belirleme bağlantısı gönderildi."

Hata durumları: `409` slug/e-posta zaten kullanımda (mesajı göster),
`500` genel hata.

### 2. Kiracı değiştirici — sidebar'da (hazır geldi)

`TenantSwitcher` zaten `SidebarNav.tsx` içinde. `useAuth()`'tan bekliyor:
- `tenant` → `{ name, slug, plan, maxEmployees }` (`GET /api/tenant/my-tenant`)
- `canSwitchTenant` → `can('platform:manage')`
- `availableTenants` → platform-admin ise `GET /api/tenant/tenants`

Normal kullanıcı için switcher **tıklanamaz**, sadece şirket adını gösterir.

### 3. Platform admin paneli — `/panel/platform/kiracilar`

Yalnızca `platform:manage` izni. 21st.dev **Users List Datatable** (id 25159).

```
GET  /api/tenant/tenants?status=          → tüm kiracılar
GET  /api/tenant/tenants/{id}             → kiracı + provisioning log
POST /api/tenant/tenants/{id}/suspend     { reason }
POST /api/tenant/tenants/{id}/reactivate
POST /api/tenant/tenants/{id}/plan        { plan, maxEmployees }
```

Sütunlar: şirket, slug, plan, durum, çalışan kotası, kayıt tarihi.
Detay çekmecesinde **provisioning log** zaman çizelgesi (hangi adım başarılı/
başarısız — kayıt sırasında bir şey ters gittiyse burada görünür).

`TenantStatus`: `Pending | Active | Suspended | Cancelled`
`TenantPlan`: `Trial | Standard | Enterprise`

---

## Mevcut 14 modül

Endpoint listesi, enum'lar ve iş kuralları için **önceki devir notunu kullan**:
`hr360-frontend-9-modul-brief.md`. Hepsi geçerli — backend'de değişen tek şey
tenant izolasyonu, o da API sözleşmesini değiştirmiyor (yalnızca yanıtlara
`tenantSlug` alanı eklendi, arayüzde göstermeye gerek yok).

Modüller ve rotalar:

| Modül | Rota | İzin |
|---|---|---|
| Genel bakış | `/panel` | — |
| Onay kutusu | `/panel/onaylar` | `workflow:view` |
| İzin | `/panel/izin` | `leave:view` |
| Masraf | `/panel/masraf` | `expense:view` |
| İK vakaları | `/panel/ik-vakalari` | `case:view` |
| Puantaj | `/panel/puantaj` | `timeshift:view` |
| Organizasyon | `/panel/organizasyon` | `organization:view` |
| Çalışanlar | `/panel/calisanlar` | `employee:viewAll` |
| İşe alım | `/panel/ise-alim` | `recruitment:view` |
| Onboarding | `/panel/onboarding` | `onboarding:view` |
| Zimmet | `/panel/zimmet` | `onboarding:view` |
| Performans | `/panel/performans` | `performance:view` |
| Eğitim | `/panel/egitim` | `learning:view` |
| Ücret | `/panel/ucret` | `compensation:view` |
| Dokümanlar | `/panel/dokumanlar` | `document:manage` |
| Bildirimler | `/panel/bildirimler` | `notification:view` |

Rotalar `SidebarNav.tsx`'teki `navGroups` ile birebir eşleşmeli.

---

## Kafka otomasyonu — UI'da tekrarlama

Backend olay güdümlü. Şunlar **kendiliğinden** oluyor, arayüzde elle tetikleme:

- Çalışan oluşturulunca → hoş geldiniz bildirimi
- Workflow onaylanınca → **izin talebi otomatik sonuçlanır**, bakiye güncellenir
- Workflow onaylanınca → talep sahibine bildirim

Yani **izin ekranında "onayla" butonu olmamalı.** Onay yalnızca Onay
kutusu'ndan verilir, gerisi otomatik. (Önceki sürümde bu doğru yapılmıştı,
ekranda açıklayıcı bir not da vardı — koru.)

---

## Test kullanıcıları

```
test.admin    / w95fIs8ZI4bWZcOc     (hr-admin)
test.employee / EbQ5Hbe0xUY8yWbR     (employee)
```

İkisi de `hr360-enterprise` kiracısına bağlı. `platform-admin` rolü tanımlı ama
henüz kimseye atanmamış — platform panelini test etmek için bir kullanıcıya
atanması gerekir.

---

## Kalite beklentisi

- `npm run build` + `tsc --noEmit` sıfır hata
- Her liste: yükleme iskeleti (21st.dev skeleton bileşenleri) + boş durum + hata durumu
- Rol bazlı görünürlük her ekranda
- Mobil uyumlu
- Tüm metinler Türkçe
- Sabit renk kullanma — `index.css`'teki token'ları kullan

---

## Deployment

```bash
# app-01 ve app-02'de
cd /opt/hr360/web
rm -rf ./* && unzip -o /tmp/<zip> -d .
docker build -t hr360-web .
docker stop hr360-web && docker rm hr360-web
docker run -d --name hr360-web --restart unless-stopped -p 8081:8080 hr360-web
```

Gateway route'ları zaten tanımlı, ek yapılandırma gerekmez.
Tenant Service için route eklenmesi gerekebilir: `/api/tenant/*` → `172.33.55.2:5013`
(henüz gateway'de tanımlı DEĞİL — kayıt sayfası çalışması için eklenmeli).
