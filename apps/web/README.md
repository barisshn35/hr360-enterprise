# HR360 Enterprise — Web Frontend (v2)

React 19 + TypeScript + Vite + Tailwind v4 + TanStack Query ile yazılmış, Keycloak
(Authorization Code + PKCE) kimlik doğrulamalı **çok kiracılı** kurumsal İK arayüzü.
Türkçe, açık/koyu tema, rol bazlı görünürlük.

Görsel dil 21st.dev kataloğundan gelen bileşenler üzerine kuruldu (bkz.
`21ST-MANIFEST.md`); iş mantığı ve API sözleşmesi önceki sürümden taşındı.

## Hızlı başlangıç

```bash
npm install
npm run dev
```

`http://localhost:5173` açılır. Vite dev sunucusu `/api`, `/ml`, `/auth` ve `/gateway`
isteklerini çalışan bir HR360 kurulumuna proxy'ler. Varsayılan hedef aynı makinedeki
`install.sh` kurulumudur (`http://localhost`); başka bir kurulum için
`VITE_DEV_PROXY_TARGET` değişkenini ayarlayın.

Backend olmadan çalışmak için `npm run dev:mock` kullanın: API ve giriş tarayıcıda
taklit edilir (MSW).

> **Önkoşul:** Keycloak `hr360` realm'indeki `hr360-web` client'ının *Valid redirect URIs*
> listesinde `http://localhost:5173/*` bulunmalı. Kurulum yalnızca kendi adresini ekler;
> bu adresi Keycloak yönetim panelinden elle ekleyin. Aksi hâlde sessiz SSO isteği `400`
> döner ve uygulama giriş ekranında kalır (konsola uyarı basılır).

## Komutlar

| Komut | Açıklama |
|-------|----------|
| `npm run dev` | Geliştirme sunucusu (proxy'li) |
| `npm run dev:mock` | Backend'siz geliştirme (taklit API ve giriş) |
| `npm run build` | Tip kontrolü + prod build → `dist/` |
| `npm run build:mock` | Taklit API'li demo build |
| `npm run preview` | Build çıktısını yerelde servis eder |
| `npm run lint` | Yalnızca tip kontrolü |

## Ortam değişkenleri

Gerekirse `apps/web/.env.local` dosyasında tanımlayın (dosya git'e girmez).

| Değişken | Varsayılan | Açıklama |
|----------|-----------|----------|
| `VITE_KEYCLOAK_URL` | `/auth` | Keycloak kök adresi (gateway üzerinden relative) |
| `VITE_KEYCLOAK_REALM` | `hr360` | Realm adı |
| `VITE_KEYCLOAK_CLIENT_ID` | `hr360-web` | Public client (PKCE S256) |
| `VITE_API_BASE` | *(boş)* | Boşsa aynı origin kullanılır |
| `VITE_DEV_PROXY_TARGET` | `http://localhost` | Yalnızca `npm run dev` |
| `VITE_MOCK_API` / `VITE_MOCK_AUTH` | `false` | `true` ise API / giriş taklit edilir (`--mode mock`) |

## Çok kiracılılık

**`organization` scope'u zorunludur.** Keycloak bu scope istendiğinde JWT'ye
`organization` claim'ini ekler; backend'deki tüm veri izolasyonu bu claim'e dayanır.
İstenmezse kullanıcı **hata almaz, her listeyi boş görür** — sessiz başarısızlık.

Scope tek sabitte tutulur (`src/auth/keycloak.ts` → `BASE_SCOPE`) ve üç yol da oradan
okur: `initKeycloak()`, `login()` ve `switchTenant()`. Claim gelmezse panelin üstünde
uyarı şeridi çıkar (`AppShell`).

Kiracı değiştirme yalnızca `platform:manage` iznindedir ve **yeni token almayı**
gerektirir: `switchTenant(slug)` seçimi saklar ve Keycloak'a `organization:<slug>`
scope'uyla yeniden gider. İstemci tarafında bayrak çevirmek backend'i etkilemez.

### Tenant Service uçları

| Uç | Not |
|---|---|
| `POST /api/tenant/registration` | **Anonim** — kayıt sırasında token yok |
| `GET /api/tenant/registration/slug-available?slug=` | **Anonim**, 400 ms debounce ile çağrılır |
| `GET /api/tenant/my-tenant` | Sidebar'daki kiracı göstergesi |
| `GET /api/tenant/tenants` | Platform paneli |
| `GET /api/tenant/tenants/{id}` | Detay + kurulum (provisioning) kayıtları |
| `POST /api/tenant/tenants/{id}/suspend` \| `/reactivate` \| `/plan` | Platform eylemleri |

## Olay güdümlü akış — arayüzde tekrarlanmaz

Backend Kafka üzerinden çalışır. Şunlar **kendiliğinden** olur, arayüzde elle
tetiklenmez:

- Çalışan oluşturulunca → hoş geldiniz bildirimi
- Workflow onaylanınca → izin talebi sonuçlanır, **bakiye güncellenir**
- Workflow onaylanınca → talep sahibine bildirim

Bu yüzden **İzin ekranında "onayla" düğmesi yoktur**; karar yalnızca Onay kutusundaki
zincirden verilir. Aynı not Masraf ekranında da duruyor.

## Mimari

```
src/
  api/          Servis istemcileri (client.ts + 14 modül + tenant) ve TanStack Query hook'ları
  auth/         Keycloak init, AuthProvider, rol/izin matrisi, rota koruyucuları
  components/
    ui/         shadcn primitifleri + HR360 desenleri (DataTable, StatCard, Panel,
                Field, Modal, Tabs, Progress, StatusBadge, ModuleBadges, States)
    layout/     AppShell, SidebarNav, Topbar, PageHeader, CommandPalette
  motion/       Hareket sözlüğü (Reveal, Stagger, CountUp, Magnetic, useRevealed…)
  features/     Ekran modülleri: auth, registration, pricing, dashboard,
                organization, employees, workflows, leave, recruitment, onboarding,
                timeshift, performance, learning, compensation, expense, cases,
                documents, notification, settings, platform
  lib/          cn/utils, env, tema, tr-TR biçimlendirme, çalışan adı çözücü
  styles/       Tasarım tokenları (Tailwind v4 @theme) + koyu tema
```

### Tasarım tokenları

Renkler ve boyutlar `src/styles/index.css` içinde tek yerde tanımlıdır (varsayılan ana
renk zümrüt `#0b8f63`; Enterprise kiracılar kendi ana rengini çalışma zamanında uygular,
bkz. `src/lib/tenant-brand.ts`). 21st.dev bileşenlerinin ihtiyaç duyduğu ek renkler token
dosyasına eklenmek yerine bileşen tarafında mevcut token'lara çevrildi.

### Hareket katmanı

`src/motion/primitives.tsx` + `src/styles/motion.css`. Sürekli dönen süslemeler
(aurora, şerit, ışıltı, dönen kenarlık) CSS'te; giriş/çıkış ve scroll'a bağlı
hareketler `motion/react` tarafında.

Keyframe'ler ayrı bir dosyada ve `main.tsx` üzerinden yükleniyor; o dosya yalnızca hareket tanımlar, hiçbir renk token'ı
tanımlamaz — hepsini `index.css`'ten okur.

Primitifler: `Reveal`, `Stagger`/`StaggerItem`, `WordReveal`, `CountUp`,
`Magnetic`, `Spotlight`, `useParallax`, `ScrollProgress`, `PageTransition`.

İki kural: hareket bilgi taşır (bir sayı değişiyorsa ne kadar değiştiği
okunmalı), ve `prefers-reduced-motion` her primitifte karşılanır — kapatıldığında
içerik kaybolmaz, anında yerine oturur.

Görünürlük ölçümü `useRevealed` üzerinden yapılıyor, IntersectionObserver ile
değil: gözlemcinin geri çağırma yapmadığı ortamlarda sayfanın yarısı kalıcı
olarak görünmez kalırdı. Ölçüm `getBoundingClientRect` ile; kaydırma/yeniden
boyutlandırma dinleyicileri, ilk saniyede kare yoklaması ve görünene kadar
250 ms'lik emniyet yoklaması birlikte çalışıyor.

### Liste deseni

Liste ekranlarının tamamı tek `DataTable` bileşenini kullanır: arama (Türkçe karakter duyarlı),
sütun bazlı sıralama, açılır filtreler, sayfalama, satır seçimi, satır aksiyon menüsü,
CSV dışa aktarma (BOM + noktalı virgül — Excel Türkçe yerelinde bozulmaz) ve
**yükleme / boş / hata** durumlarının üçü de gömülü.

## Bilinen sınırlar

- **Oturum → çalışan eşlemesi** `GET /api/employee/employees/me` ile yapılır
  (`useMyEmployeeId`). Çalışan kaydına bağlı olmayan hesaplarda (ör. şirket yöneticisi
  hesabı) "benim" ekranları "kayıt yok" durumunu gösterir.
- **Doküman modülü dosya tutmaz** — yükleme ucu backend'de yok; ekran yalnızca hangi
  çalışanda hangi belgenin bulunduğunu kayda geçirir.
- **Devir riski modeli** (`hr360-attrition-risk`) özellik şeması belgelenmediği için
  değerler elle giriliyor; yalnızca kıdem alanı kayıttan doldurulabiliyor.
- **Plan fiyatları tanımlı değil.** Kartların başlık rakamı çalışan kotası. Fiyat
  netleşince `src/features/pricing/plans.ts` içindeki `priceLabel` alanı doldurulur.
- **Plan bazlı modül kısıtı yok.** Fiyat kartları bazı modülleri Standard ve üstüne
  ayırır; arayüz ve backend bunu henüz uygulamaz (yalnızca marka/SMTP Enterprise'a ve
  çalışan kotası plana bağlıdır).

## Deployment

Web arayüzü kök dizindeki `docker-compose.yml` içinde `web` servisi olarak build edilir
ve gateway'in arkasında çalışır; ayrı bir kurulum adımı yoktur (`./install.sh`).
