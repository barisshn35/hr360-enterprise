import { getValidToken, keycloak } from '@/auth/keycloak'
import { env } from '@/lib/env'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** Sıralı onay kuralı ihlali gibi iş kuralı hataları. */
  get isBusinessRule() {
    return this.status === 400 || this.status === 409
  }
}

/** Backend hata gövdesinden okunabilir bir Türkçe mesaj çıkarır. */
async function toApiError(res: Response): Promise<ApiError> {
  let detail: unknown
  let message = ''

  try {
    const text = await res.text()
    if (text) {
      try {
        detail = JSON.parse(text)
        if (typeof detail === 'string') {
          // ASP.NET Core'da BadRequest("düz metin") gövdeyi {detail:...}
          // gibi bir nesne değil, DOĞRUDAN bir JSON string olarak döner
          // (örn. "Kalem tutarı sıfırdan büyük olmalı"). Aşağıdaki nesne
          // alanı okuması (d.detail/d.title/...) bunu hiç yakalamıyordu -
          // backend'in verdiği anlamlı, alan-bazlı hata mesajı kullanıcıya
          // hiç ulaşmıyor, "İstek geçersiz" jenerik mesajına düşüyordu.
          message = detail
        } else {
          const d = detail as Record<string, unknown>
          message =
            (typeof d.detail === 'string' && d.detail) ||
            (typeof d.title === 'string' && d.title) ||
            (typeof d.message === 'string' && d.message) ||
            (typeof d.error === 'string' && d.error) ||
            ''
        }
      } catch {
        message = text.slice(0, 300)
      }
    }
  } catch {
    /* gövde okunamadı */
  }

  if (!message) {
    const byStatus: Record<number, string> = {
      400: 'İstek geçersiz. Girdiğiniz bilgileri kontrol edin.',
      401: 'Oturumunuzun süresi doldu. Lütfen yeniden giriş yapın.',
      403: 'Bu işlem için yetkiniz yok.',
      404: 'Kayıt bulunamadı.',
      409: 'İşlem mevcut durumla çakışıyor.',
      500: 'Sunucu hatası oluştu. Lütfen daha sonra tekrar deneyin.',
      502: 'Servise ulaşılamıyor (gateway).',
      503: 'Servis geçici olarak kullanılamıyor.',
    }
    message = byStatus[res.status] ?? `Beklenmeyen hata (HTTP ${res.status}).`
  }

  return new ApiError(res.status, message, detail)
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  /** Auth gerektirmeyen uçlar (ör. /gateway/health) için. */
  anonymous?: boolean
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, anonymous = false } = options

  const headers: Record<string, string> = { Accept: 'application/json' }

  if (!anonymous) {
    const token = await getValidToken()
    if (!token) {
      // Refresh başarısız — oturumu yenilemek için Keycloak'a yönlendir.
      throw new ApiError(401, 'Oturumunuzun süresi doldu. Lütfen yeniden giriş yapın.')
    }
    headers.Authorization = `Bearer ${token}`
  }

  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(`${env.apiBase}${path}`, {
    method,
    headers,
    signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (res.status === 401 && !anonymous) {
    keycloak.clearToken()
    throw new ApiError(401, 'Oturumunuzun süresi doldu. Lütfen yeniden giriş yapın.')
  }

  if (!res.ok) throw await toApiError(res)

  if (res.status === 204) return undefined as T

  /*
   * Gateway'de route'u olmayan bir /api yolu nginx'e düşüyor ve arayüzün
   * kendi index.html'i 200 ile dönüyor. JSON.parse bunu "Unexpected token <"
   * diye patlatırdı — kullanıcı ne olduğunu anlamaz. Açık bir hataya çevir.
   */
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('text/html')) {
    throw new ApiError(
      503,
      'Servis bu adreste yanıt vermiyor. Gateway yönlendirmesi tanımlı olmayabilir.',
      { path },
    )
  }

  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/**
 * Sorgu dizesi kurar; tanımsız ve boş değerleri atar.
 * Modül servisleri bunu paylaşır, her dosyada tekrarlanmaz.
 */
export function qs(params: object): string {
  const search = new URLSearchParams()
  // Arayüzlerde index imzası olmadığı için Record yerine object alınır.
  for (const [key, value] of Object.entries(params) as [string, unknown][]) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const out = search.toString()
  return out ? `?${out}` : ''
}

/**
 * Dosya yükleme uçları için — apiFetch'ten ayrı, çünkü apiFetch body'yi
 * her zaman JSON'a çevirir. FormData'da Content-Type header'ını TARAYICI
 * kendi koyar (boundary içerir); elle eklemek isteği bozar.
 */
export async function apiUploadFile<T>(
  path: string,
  file: File,
  fieldName = 'file',
): Promise<T> {
  const token = await getValidToken()
  if (!token) {
    throw new ApiError(401, 'Oturumunuzun süresi doldu. Lütfen yeniden giriş yapın.')
  }

  const formData = new FormData()
  formData.append(fieldName, file)

  const res = await fetch(`${env.apiBase}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    body: formData,
  })

  if (res.status === 401) {
    keycloak.clearToken()
    throw new ApiError(401, 'Oturumunuzun süresi doldu. Lütfen yeniden giriş yapın.')
  }

  const text = await res.text()
  const data = text ? JSON.parse(text) : undefined

  if (!res.ok) {
    throw new ApiError(res.status, (data as { message?: string })?.message ?? 'İstek başarısız', data)
  }

  return data as T
}
