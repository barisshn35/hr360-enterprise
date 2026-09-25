# HR360 — Kalan Backend Mikroservisleri

Planın Hafta 14–23 aralığındaki 9 mikroservisi. Mevcut üç servisle (Organization,
Employee, Workflow) **birebir aynı pattern**: ASP.NET Core 9 + EF Core + Npgsql,
Keycloak JWT auth, gerçek rol bazlı yetkilendirme, Prometheus metrikleri, Docker.

Hepsi `dotnet build` ile **sıfır hata, sıfır uyarı** derlenmiş durumda.

---

## Servisler

| Servis | Port | Hafta | Kapsam |
|---|---:|---|---|
| `recruitment-service` | 5005 | 14 | İlan, aday, başvuru, mülakat |
| `onboarding-service` | 5006 | 16 | İşe başlangıç görev planı, zimmet (asset) |
| `leave-service` | 5004 | 17 | İzin bakiyesi, izin talebi |
| `timeshift-service` | 5007 | 18 | Vardiya, vardiya ataması, puantaj |
| `performance-service` | 5008 | 19 | Değerlendirme dönemi, hedef, review |
| `learning-service` | 5009 | 20 | Eğitim kataloğu, kayıt, sertifika |
| `compensation-service` | 5010 | 21 | Ücret bandı, ücret geçmişi, zam simülasyonu |
| `expense-service` | 5011 | 22 | Masraf beyanı, özlük dokümanı, İK vakası |
| `notification-service` | 5012 | 23 | Bildirim şablonu, gönderim kuyruğu |

Port 5001–5003 mevcut servislerde kullanılıyor (Organization, Employee, Workflow).

---

## Yetkilendirme modeli

Her serviste iki policy tanımlı, mevcut servislerle aynı:

- **`RequireHrAdmin`** → `hr-admin`, `system-admin`
- **`RequireManagerOrAbove`** → `manager`, `hr-admin`, `system-admin`

Keycloak'ın `realm_access.roles` claim'i, `OnTokenValidated` event'inde ASP.NET
Core'un `ClaimTypes.Role`'üne eşleniyor — bu adım olmadan policy'ler sessizce
çalışmaz (mevcut servislerde düzeltilen kritik güvenlik açığının aynısı).

Uygulanan kurallar özet:

| Servis | Herkes (authenticated) | Manager+ | hr-admin |
|---|---|---|---|
| leave | kendi talebini oluşturma, listeleme | talebi sonuçlandırma | bakiye tanımlama |
| recruitment | — | aday/başvuru/mülakat | ilan oluşturma/yayınlama |
| onboarding | görev durumu güncelleme | göreve ekleme | plan oluşturma, zimmet |
| timeshift | kendi giriş/çıkış kaydı | puantaj özeti, vardiya atama | vardiya tanımlama |
| performance | hedef oluşturma/ilerleme, review gönderme | dönem özeti | dönem tanımlama |
| learning | eğitim listesi, kayıt olma | uyum raporu, sertifika süresi | eğitim tanımlama |
| compensation | — | — | **tüm uç noktalar** (hassas veri) |
| expense | masraf beyanı, İK vakası açma | beyan/vaka sonuçlandırma | doküman, ödendi işaretleme |
| notification | okundu işaretleme, kendi listesi | bildirim oluşturma/gönderim | şablon yönetimi |

---

## Kurulum

### 1. Veritabanı tablolarını oluştur

Her serviste `sql/schema.sql` var. **db-01'de** (172.33.55.4):

```bash
# Her servis için tek tek, ya da hepsini birleştirip:
docker exec -i db-postgres-1 psql -U hr360admin -d hr360_operational < leave-service/sql/schema.sql
docker exec -i db-postgres-1 psql -U hr360admin -d hr360_operational < recruitment-service/sql/schema.sql
# ... diğerleri
```

**Neden elle SQL?** EF Core `EnsureCreated()`, paylaşımlı bir veritabanında
(başka servisin tabloları zaten varken) yeni tabloları oluşturmuyor — bu,
Employee Service kurulumunda öğrenilen bir davranış. Kalıcı çözüm gerçek EF
Migrations'a geçmek; `sql/schema.sql` şimdilik bunun yerini tutuyor.

### 2. Servisleri ayağa kaldır

Servisler node'lara dağıtılabilir (mevcut kurulumda Organization/Employee app-01'de,
Workflow app-02'de). Her servis klasöründe:

```bash
export HR360_DB_PASSWORD='...'   # docker-compose.yml bu değişkeni bekler
docker compose build
docker compose up -d
curl -s http://localhost:<port>/health
```

`docker-compose.yml` içinde DB parolası **hardcode edilmedi** — ortam
değişkeninden okunuyor. Bu, mevcut üç servisten farklı (ve daha iyi) bir
yaklaşım; onlar da zamanla buna çevrilmeli.

### 3. Gateway route'u ekle

Her iki node'daki `/opt/hr360/app/gateway/nginx.conf` dosyasına, mevcut
`/api/organization/` bloğuyla aynı şekilde:

```nginx
upstream leave_backend { server 172.33.55.2:5004; }

location /api/leave/ {
    rewrite ^/api/leave/(.*) /api/$1 break;
    proxy_pass http://leave_backend;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Cross-Origin-Resource-Policy "same-origin" always;
}
```

### 4. Prometheus'a ekle

**ops-01'de** `/opt/hr360/ops/prometheus/prometheus.yml`:

```yaml
  - job_name: "leave_service"
    static_configs:
      - targets: ["172.33.55.2:5004"]
        labels:
          role: "backend"
          module: "leave"
```

---

## Servisler arası bağlantılar

Mikroservis sınırları korunuyor: **gerçek foreign key yok**, ID referansı var.

- `leave-service.LeaveRequest.WorkflowRequestId` → Workflow Service
- `expense-service.ExpenseClaim.WorkflowRequestId` → Workflow Service
- `recruitment-service.JobPosting.DepartmentId` → Organization Service
- `recruitment-service.Interview.InterviewerEmployeeId` → Employee Service
- `timeshift-service.Shift.DepartmentId` → Organization Service
- `expense-service.Document.StorageKey` → MinIO (mw-01)
- `recruitment-service.Candidate.ResumeStorageKey` → MinIO

Tüm `EmployeeId` alanları Employee Service'e referans verir.

---

## Öne çıkan iş mantığı

Bunlar CRUD'un ötesinde, gerçekten çalışan kurallar:

**leave-service** — Talep oluşturulunca bakiyeden `PendingDays` olarak düşülür,
onay/red sonrası `resolve` ile kesinleşir (onaylanırsa `UsedDays`'e geçer,
reddedilirse geri iade edilir). Yetersiz bakiyede talep reddedilir.

**recruitment-service** — Yalnızca yayındaki ilana başvuru alınır; aynı aday
aynı ilana iki kez başvuramaz; sonuçlanmış başvurunun durumu değiştirilemez;
mülakat planlanınca başvuru otomatik `Interview` durumuna geçer.

**onboarding-service** — Plan oluşturulurken 8 standart görev (IT hesabı, zimmet,
giriş kartı, özlük evrakı, sözleşme, uyum eğitimi, ekip tanışma, İSG) işe başlama
tarihine göre otomatik tarihlendirilir. Tüm görevler bitince plan otomatik kapanır.

**timeshift-service** — Çıkış kaydı girişten önce olamaz; çalışılan süre otomatik
hesaplanır, 8 saati aşan kısım fazla mesai olarak ayrılır; aynı gün için tek kayıt.

**compensation-service** — Yeni ücret kaydı, öncekini otomatik kapatır
(`EffectiveTo` = yeni başlangıç - 1 gün), böylece tarihsel geçmiş tutarlı kalır.
Zam simülasyonu, önerilen ücretlerin bant dışına çıkıp çıkmadığını raporlar.

**notification-service** — Şablonlar `{{degisken}}` yer tutucularını destekler,
regex ile render edilir. Gönderim durumu ve deneme sayısı takip edilir.

---

## Bilinen sınırlar / sonraki adımlar

- **EF Migrations yok** — `sql/schema.sql` ile elle kurulum. Tüm serviste
  (mevcut üçü dahil) gerçek migration'a geçilmesi öneriliyor.
- **Kafka entegrasyonu yok** — servisler event yayınlamıyor/tüketmiyor. Plan
  §12'deki olay güdümlü mimari ve Hafta 15 offer-to-hire saga'sı bu altyapıya
  bağımlı. Outbox pattern ile eklenmeli.
- **Employee doğrulaması yapılmıyor** — servisler `EmployeeId`'nin gerçekten
  var olduğunu Employee Service'e sormuyor (senkron çağrı bağımlılık yaratır).
  Doğru çözüm: Kafka üzerinden employee cache'i ya da API composition.
- **Hafta 12 (bitemporal/audit) ayrı bir iş** — bu servislerde `EffectiveFrom/To`
  deseni var (Assignment, CompensationRecord) ama tam bitemporal model
  (transaction time + valid time) ve merkezi audit log yok.
- **Hafta 15 (offer-to-hire saga)** dahil edilmedi — Kafka gerektiriyor.
- **Frontend ekranları yok** — bu servisler yalnızca API. UI'ları
  `hr360frontend` projesine eklenecek.
