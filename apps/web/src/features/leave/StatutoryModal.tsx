import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { SelectField, TextField } from '@/components/ui/Field'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { InfoNote, RowsSkeleton } from '@/components/ui/States'
import { useDirectory } from '@/api/directory'
import { leaveApi } from '@/api/leave'
import { formatDate, formatNumber } from '@/lib/format'
import { useAction } from '@/features/shared/kit'
import { tx } from '@/lib/i18n'

/** İK: kıdeme göre yasal yıllık izin hakkı ve kullanılmayan iznin devri (G8). */
export function StatutoryModal({ onClose }: { onClose: () => void }) {
  const now = new Date().getFullYear()
  const [year, setYear] = useState(String(now))
  const [maxDays, setMaxDays] = useState('')
  const dir = useDirectory()
  const nameOf = (id: string) => dir.data?.find((d) => d.id === id)?.fullName ?? '—'
  const q = useQuery({ queryKey: ['leave', 'statutory', year], queryFn: ({ signal }) => leaveApi.statutory(Number(year), signal) })
  const apply = useAction(() => leaveApi.applyStatutory(Number(year)), { success: (r) => tx('{0} bakiye güncellendi', [r.changed]), invalidate: [['leave']] })
  const carry = useAction(() => leaveApi.carryOver(Number(year) - 1, maxDays ? Number(maxDays) : undefined), {
    success: (r) => tx('{0} çalışanın {1} günü {2} yılına devredildi', [r.employees, formatNumber(r.days), year]), invalidate: [['leave']],
  })
  const rows = (q.data ?? []).filter((r) => r.statutoryDays > 0 || (r.currentEntitled ?? 0) > 0)
  const below = rows.filter((r) => (r.currentEntitled ?? 0) - r.carriedOver < r.statutoryDays).length
  return (
    <Modal open onClose={onClose} size="lg" title={tx('Yasal izin hakkı ve devir')}
      note={tx('İş Kanunu m.53: 1-5 yıl 14 gün, 5-15 yıl 20 gün, 15 yıl ve üstü 26 gün; 18 yaş ve altı ile 50 yaş ve üstüne en az 20 gün. Hak, işe giriş yıl dönümünde doğar.')}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label={tx('Yıl')} value={year} onChange={setYear} options={[now - 1, now, now + 1].map((y) => ({ value: String(y), label: String(y) }))} />
        </div>
        {q.isPending ? <RowsSkeleton rows={4} /> : (
          <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
            <table className="w-full text-[12.5px]">
              <thead className="bg-muted/40 text-left text-muted-foreground"><tr><th className="px-3 py-2">{tx('Çalışan')}</th><th className="px-3 py-2">{tx('Kıdem')}</th><th className="px-3 py-2">{tx('Yıl dönümü')}</th><th className="px-3 py-2 text-right">{tx('Yasal')}</th><th className="px-3 py-2 text-right">{tx('Tanımlı')}</th></tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.employeeId}>
                    <td className="px-3 py-1.5">{nameOf(r.employeeId)}{r.ageRule && <> {' '}<StatusBadge tone="info">{tx('yaş kuralı')}</StatusBadge></>}</td>
                    <td className="px-3 py-1.5">{tx('{0} yıl', [r.serviceYears])}</td>
                    <td className="px-3 py-1.5">{formatDate(r.anniversary)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.statutoryDays}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.currentEntitled ?? '—'}{r.carriedOver ? ` (+${formatNumber(r.carriedOver)} ${tx('devir')})` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={apply.isPending || !below} onClick={() => apply.mutate(undefined)}>{tx('Yasal hakkı bakiyelere yaz ({0})', [below])}</Button>
          <span className="text-[12.5px] text-muted-foreground">{tx('Bakiye yoksa açılır, yasal günün altındaysa yükseltilir; asla düşürülmez.')}</span>
        </div>
        <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <TextField label={tx('{0} yılından devredilecek en fazla gün (boş: tamamı)', [Number(year) - 1])} inputMode="numeric" value={maxDays} onChange={(e) => setMaxDays(e.target.value)} />
          <Button variant="outline" disabled={carry.isPending} onClick={() => carry.mutate(undefined)}>{tx('Kullanılmayan izni devret')}</Button>
        </div>
        <InfoNote>{tx('Yıllık ücretli izin yanmaz; üst sınır yalnızca şirket içi devir politikası içindir. Devir tekrar çalıştırılabilir: yalnızca fark aktarılır. Doğum tarihi yalnızca yaş kuralı için kullanılır ve gösterilmez (KVKK).')}</InfoNote>
      </div>
    </Modal>
  )
}
