# HR360 v2 — 21st.dev Bileşen Manifesti

Tüm arayüz 21st.dev kataloğundan seçilmiş bileşenler üzerine kuruluyor.
Bu dosya **hangi bileşenin nereye gittiğini** ve kurulum komutunu listeler.

## Kurulum

21st.dev registry'si API anahtarı ister. Bir kez ayarla:

```bash
export API_KEY_21ST="<21st.dev hesabından alınan anahtar>"
```

Sonra aşağıdaki komutları çalıştır. Hepsi `shadcn` registry protokolü
kullanıyor, dosyalar doğrudan projeye iniyor.

---

## 1. Uygulama iskeleti

### Dashboard Sidebar — `arunjdass` (id 14941) ✅ UYARLANDI
```bash
npx shadcn@latest add "https://21st.dev/r/arunjdass/dashboard-sidebar?api_key=$API_KEY_21ST"
```
**Nereye:** `src/components/layout/SidebarNav.tsx`
**Durum:** Bu repoda **zaten uyarlanmış halde var** — tekrar kurma, üzerine yazar.

Yapılan uyarlamalar:
- `WorkspaceSwitcher` → `TenantSwitcher` (çok kiracılılık: kullanıcının şirketi;
  platform-admin ise kiracılar arası geçiş)
- Mock navigasyon → HR360'ın 14 modülü, gruplu ve **rol bazlı filtreli**
- `onSelect(id)` → react-router navigasyonu
- Bildirim rozeti okunmamış sayısına bağlandı

### Command Palette — `lovesickfromthe6ix` (id 5530)
```bash
npx shadcn@latest add "https://21st.dev/r/lovesickfromthe6ix/omni-command-palette?api_key=$API_KEY_21ST"
```
**Nereye:** `src/components/layout/CommandPalette.tsx`
**Neden bu:** Async çoklu kaynak desteği var — çalışan, şirket, talep aramasını
tek palette'te birleştirebiliriz. Sidebar'daki ⌘K zaten buna bağlı
(`onOpenCommandPalette`).

**Bağlanacak kaynaklar:** çalışanlar (`/api/employee/employees`), şirketler
(`/api/organization/companies`), onay talepleri (`/api/workflow/workflows`),
ve statik "git" komutları (her modüle kısayol).

---

## 2. Liste ekranları (en çok tekrar eden desen)

### Users List Datatable — `shadcnstore` (id 25159)
```bash
npx shadcn@latest add "https://21st.dev/r/shadcnstore/datatable-1?api_key=$API_KEY_21ST"
```
**Nereye:** `src/components/ui/DataTable.tsx` (genelleştirilerek)
**Neden bu:** Arama + filtre + dışa aktarma + sayfalama + satır seçimi + avatar +
rol/durum rozetleri + satır aksiyon menüsü — HR360'ın **çalışan listesi** neredeyse
birebir bu. Genelleştirilip şu ekranların hepsinde kullanılacak:

| Ekran | Sütunlar |
|---|---|
| Çalışanlar | ad, departman, pozisyon, işe giriş, durum |
| Onay kutusu | tür, talep eden, SLA kalan, durum |
| İzin talepleri | çalışan, tür, tarih aralığı, gün, durum |
| Adaylar | ad, e-posta, kaynak, başvuru sayısı |
| Başvurular | aday, ilan, aşama, mülakat sayısı |
| Zimmet | etiket, tür, model, atanan, durum |
| Masraf beyanları | başlık, çalışan, tutar, durum |
| İK vakaları | konu, kategori, öncelik, durum |
| Eğitimler | başlık, kategori, süre, zorunlu |
| Kiracılar (platform) | şirket, slug, plan, çalışan sayısı, durum |

### Complex Data Table — `felipemenezes098` (id 22177) *(alternatif)*
```bash
npx shadcn@latest add "https://21st.dev/r/felipemenezes098/table-20?api_key=$API_KEY_21ST"
```
Saf TanStack Table; kolon görünürlüğü toggle'ı var. 25159 fazla "kullanıcı
listesi"ne özelse buna geç.

---

## 3. Genel bakış (dashboard)

### Stat Card — `felipemenezes098` (id 26138)
```bash
npx shadcn@latest add "https://21st.dev/r/felipemenezes098/card-05?api_key=$API_KEY_21ST"
```
**Nereye:** `src/components/ui/StatCard.tsx`
**Kullanım:** Çalışan sayısı, bekleyen onay, süresi geçen, açık ilan, bu ay izin.
Trend rozeti önceki döneme göre değişimi gösteriyor — İK metriklerinde anlamlı.

### Progress Metric Card — `makviesainte` (id 15024)
```bash
npx shadcn@latest add "https://21st.dev/r/makviesainte/progress-metric-card?api_key=$API_KEY_21ST"
```
**Kullanım:** Büyük rakam + Recharts grafik. İzin bakiyesi (kalan/hak edilen),
hedef gerçekleşme (performans), zorunlu eğitim uyum oranı.

### Stat Cards Skeleton — `felipemenezes098` (id 18999)
```bash
npx shadcn@latest add "https://21st.dev/r/felipemenezes098/skeleton-10?api_key=$API_KEY_21ST"
```
**Kullanım:** Dashboard yüklenirken. Önceki sürümde "boş ekran" şikayeti vardı,
bu onu çözer.

### Sidebar Dashboard Skeleton — `cnippet-dev` (id 19009)
```bash
npx shadcn@latest add "https://21st.dev/r/cnippet-dev/v-skeleton-8?api_key=$API_KEY_21ST"
```
**Kullanım:** İlk açılış / oturum doğrulanırken tam sayfa iskelet.

---

## 4. Şirket kaydı (YENİ — çok kiracılılık)

### Onboarding Wizard Form — `cnippet-dev` (id 25064)
```bash
npx shadcn@latest add "https://21st.dev/r/cnippet-dev/v-form-8?api_key=$API_KEY_21ST"
```
**Nereye:** `src/features/registration/RegisterCompanyWizard.tsx`
**Neden bu:** Üç adım + özet + başarı ekranı yapısı, HR360 kayıt akışıyla birebir:

| Adım | İçerik | API |
|---|---|---|
| 1. Şirket | ad, vergi no, e-posta alan adı, **slug** (canlı müsaitlik kontrolü) | `GET /api/tenant/registration/slug-available?slug=` |
| 2. Yönetici | ad soyad, e-posta | — |
| 3. Plan | Deneme / Standart / Kurumsal | — |
| Özet | girilenlerin gözden geçirilmesi | — |
| Gönder | | `POST /api/tenant/registration` |
| Başarı | "E-postanıza parola belirleme bağlantısı gönderildi" | — |

**Kritik:** Bu uç **anonim** (`[AllowAnonymous]`), token gerekmez.
Slug otomatik türetiliyor ama kullanıcı düzenleyebilmeli.

### Startup Pricing Plans — `shadcnspace` (id 21479)
```bash
npx shadcn@latest add "https://21st.dev/r/shadcnspace/pricing-01?api_key=$API_KEY_21ST"
```
**Nereye:** Landing'de plan bölümü **ve** kayıt sihirbazının 3. adımı.
Planlar: Deneme (25 çalışan), Standart (250), Kurumsal (10.000).

---

## 5. Landing (herkese açık)

### SaaS Template — `waleedkibhen` (id 8948)
```bash
npx shadcn@latest add "https://21st.dev/r/waleedkibhen/saa-s-template?api_key=$API_KEY_21ST"
```
**Nereye:** `src/features/landing/LandingPage.tsx`
**Neden bu:** Sabit navigasyon + gradyan başlık + duyuru rozeti + **dashboard
önizleme mockup'ı**. Mockup yerine HR360'ın gerçek ekran görüntüsü konacak —
ürünü göstermek en iyi pazarlama.

CTA'lar: "Şirketinizi kaydedin" → `/kayit`, "Giriş yap" → `/giris`.

### Shape Landing Hero — `kokonutd` (id 524) *(alternatif)*
```bash
npx shadcn@latest add "https://21st.dev/r/kokonutd/shape-landing-hero?api_key=$API_KEY_21ST"
```
Daha sanatsal, animasyonlu şekiller. Mevcut 3D dağ hero'suna yakın bir his.

---

## 6. Giriş

### Auth Section 2 — `solaceui` (id 20036)
```bash
npx shadcn@latest add "https://21st.dev/r/solaceui/auth-section-2?api_key=$API_KEY_21ST"
```
**Nereye:** `src/features/auth/SignInPage.tsx`
**Uyarlama:** Sosyal giriş butonları **kaldırılacak** — HR360'da kimlik doğrulama
yalnızca Keycloak üzerinden (Authorization Code + PKCE). Sağdaki görsel panelde
rol açıklamaları kalsın (mevcut sürümde beğenilmişti).

---

## Kurulum sırası (önerilen)

```bash
export API_KEY_21ST="..."

# 1) İskelet
npx shadcn@latest add "https://21st.dev/r/lovesickfromthe6ix/omni-command-palette?api_key=$API_KEY_21ST"

# 2) Liste deseni — en çok kullanılan
npx shadcn@latest add "https://21st.dev/r/shadcnstore/datatable-1?api_key=$API_KEY_21ST"

# 3) Dashboard
npx shadcn@latest add "https://21st.dev/r/felipemenezes098/card-05?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/makviesainte/progress-metric-card?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/felipemenezes098/skeleton-10?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/cnippet-dev/v-skeleton-8?api_key=$API_KEY_21ST"

# 4) Kayıt akışı
npx shadcn@latest add "https://21st.dev/r/cnippet-dev/v-form-8?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/shadcnspace/pricing-01?api_key=$API_KEY_21ST"

# 5) Herkese açık sayfalar
npx shadcn@latest add "https://21st.dev/r/waleedkibhen/saa-s-template?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/solaceui/auth-section-2?api_key=$API_KEY_21ST"
```

---

## Tema uyumu

Kurulan bileşenlerin **hiçbirinde renk değiştirmeye gerek yok.**

Hepsi shadcn'in CSS değişken sözleşmesini kullanıyor (`bg-card`,
`text-muted-foreground`, `border-border`, `bg-primary`...). `src/styles/index.css`
o değişkenleri HR360 paletiyle dolduruyor — koyu çinko yüzey, mor vurgu, Geist.

Bir bileşen sabit renk (`bg-slate-900` gibi) kullanıyorsa **token'a çevir**,
yoksa tema değiştiğinde o parça kopuk görünür.
