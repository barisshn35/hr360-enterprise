/**
 * Uç durumları URL'den açmak için senaryolar:
 *
 *   ?senaryo=bos       Hiç metrik yok — şablon seçici görünür.
 *   ?senaryo=kayitsiz  Oturumdaki e-posta çalışan kaydıyla eşleşmez — /me uçları 404.
 *   ?senaryo=hata      Performans uçları 500 döner — hata durumları görünür.
 *   ?senaryo=normal    Varsayılana döner.
 *
 * Seçim sekme boyunca hatırlanır; sayfalar arasında gezinirken kaybolmaz.
 */

export type Scenario = 'normal' | 'bos' | 'kayitsiz' | 'hata'

const KEY = 'hr360.mock.senaryo'
const VALID: Scenario[] = ['normal', 'bos', 'kayitsiz', 'hata']

export function readScenario(): Scenario {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('senaryo')
    if (fromUrl && (VALID as string[]).includes(fromUrl)) {
      window.sessionStorage.setItem(KEY, fromUrl)
      return fromUrl as Scenario
    }
    const stored = window.sessionStorage.getItem(KEY)
    if (stored && (VALID as string[]).includes(stored)) return stored as Scenario
  } catch {
    /* depolama kapalı */
  }
  return 'normal'
}

export const scenarioLabels: Record<Scenario, string> = {
  normal: 'Normal',
  bos: 'Metrik yok',
  kayitsiz: 'Çalışan kaydı yok',
  hata: 'Servis hatası',
}
