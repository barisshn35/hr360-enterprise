/**
 * Tenant'ın kendi ana rengini (Enterprise plan) çalışma zamanında uygular.
 * shadcn/Tailwind CSS değişkenleri HSL bileşenleri olarak tutulur
 * ("160 86% 30%"), o yüzden hex önce HSL'e çevrilir. --primary-foreground
 * (metin rengi) parlaklığa (lightness) göre otomatik seçilir - tenant bunu
 * ayarlamaz, koyu bir renk seçilse de metin her zaman okunur kalır.
 */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const delta = max - min

  let h = 0
  let s = 0
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1))
    switch (max) {
      case r:
        h = ((g - b) / delta) % 6
        break
      case g:
        h = (b - r) / delta + 2
        break
      default:
        h = (r - g) / delta + 4
    }
    h *= 60
    if (h < 0) h += 360
  }

  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/

const VARS = [
  '--tenant-primary',
  '--tenant-primary-foreground',
  '--tenant-primary-dark',
  '--tenant-primary-dark-foreground',
] as const

/** Orta parlaklıktan koyusu beyaz metin ister, açık renkler koyu metin. */
function foregroundFor(l: number) {
  return l > 60 ? '160 50% 4%' : '0 0% 100%'
}

/**
 * `primaryColorHex` verilmişse şirketin rengini uygular; null/undefined ya da
 * geçersiz formatsa önceki ayarı temizler (varsayılan zümrüde döner).
 *
 * index.css --primary'yi bu değişkenlerden okur. Açık ve koyu tema için ayrı
 * değer yazılır: koyu temada çok koyu bir marka rengi (ör. lacivert) obsidyen
 * zeminde kaybolacağı için parlaklığı en az %45'e çekilir; ton (hue) ve
 * doygunluk aynı kalır, şirket rengini tanır.
 */
export function applyTenantBrandColor(primaryColorHex: string | null | undefined) {
  const root = document.documentElement

  if (!primaryColorHex || !HEX_PATTERN.test(primaryColorHex)) {
    for (const v of VARS) root.style.removeProperty(v)
    return
  }

  const { h, s, l } = hexToHsl(primaryColorHex)
  const darkL = Math.min(Math.max(l, 45), 70)
  root.style.setProperty('--tenant-primary', `${h} ${s}% ${l}%`)
  root.style.setProperty('--tenant-primary-foreground', foregroundFor(l))
  root.style.setProperty('--tenant-primary-dark', `${h} ${s}% ${darkL}%`)
  root.style.setProperty('--tenant-primary-dark-foreground', foregroundFor(darkL))
}
