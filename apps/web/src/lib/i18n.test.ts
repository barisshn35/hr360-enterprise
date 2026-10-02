import { afterAll, describe, expect, it } from 'vitest'
import { pct, setDictionary, tx, txServer } from './i18n'

describe('i18n', () => {
  afterAll(() => setDictionary({}, 'tr'))

  it('Türkçede kaynak metni yer tutucularıyla döndürür', () => {
    setDictionary({ 'Kaydet': 'Save' }, 'tr')
    expect(tx('Kaydet')).toBe('Kaydet')
    expect(tx('{0} kayıt', [3])).toBe('3 kayıt')
    expect(pct(40)).toBe('%40')
  })

  it('İngilizcede sözlükten çevirir, tekil/çoğul seçer, eksikte Türkçeye düşer', () => {
    setDictionary({ 'Kaydet': 'Save', '{0} kayıt': '{0} record|{0} records', 'Toplam {0} / {1}': '{1} of {0}' }, 'en')
    expect(tx('Kaydet')).toBe('Save')
    expect(tx('{0} kayıt', [1])).toBe('1 record')
    expect(tx('{0} kayıt', [5])).toBe('5 records')
    expect(tx('Toplam {0} / {1}', [10, 2])).toBe('2 of 10')
    expect(tx('Çevrilmemiş')).toBe('Çevrilmemiş')
    expect(pct(40)).toBe('40%')
  })

  it('sunucu iletilerini birebir ve kalıpla çevirir', () => {
    setDictionary({
      '@server:Talep onaylandı': 'Request approved',
      '@server:{0} gündür izin kullanmadı': 'No leave taken for {0} day|No leave taken for {0} days',
      '@server:{0} günlük {1} talebi ({2} - {3})': '{0}-day {1} request ({2} – {3})',
    }, 'en')
    expect(txServer('Talep onaylandı')).toBe('Request approved')
    expect(txServer('261 gündür izin kullanmadı')).toBe('No leave taken for 261 days')
    expect(txServer('1 gündür izin kullanmadı')).toBe('No leave taken for 1 day')
    expect(txServer('3 günlük Annual talebi (07.06.2027 - 09.06.2027)')).toBe('3-day Annual request (07.06.2027 – 09.06.2027)')
    expect(txServer('Bilinmeyen ileti')).toBe('Bilinmeyen ileti')
    expect(txServer(null)).toBe('')
  })
})

describe('kalıp önceliği', () => {
  it('iç içe iletide daha belirgin kalıp kazanır', () => {
    setDictionary({
      '@server:{0} günlük {1} talebi ({2} - {3})': '{0}-day {1} request ({2} – {3})',
      '@server:"{0}" talebiniz reddedildi. Gerekçe: {1}': 'Your request "{0}" was rejected. Reason: {1}',
      '@server:(Slack üzerinden)': '(via Slack)',
    }, 'en')
    expect(txServer('"1 günlük Unpaid talebi (04.10.2028 - 04.10.2028)" talebiniz reddedildi. Gerekçe: (Slack üzerinden)'))
      .toBe('Your request "1-day Unpaid request (04.10.2028 – 04.10.2028)" was rejected. Reason: (via Slack)')
    setDictionary({}, 'tr')
  })
})
