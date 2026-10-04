/**
 * G7: puantaj — geç kalma, erken çıkış ve olası fazla mesai (giriş-çıkış hareketleri ile
 * vardiya ya da varsayılan mesai karşılaştırması). Bilgilendirme amaçlıdır; tespit edilen fazla
 * mesai yalnızca kullanıcı talep oluşturursa mevcut onay akışına girer.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlarmClock, Settings2 } from 'lucide-react'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { TextAreaField, TextField } from '@/components/ui/Field'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { InfoNote, RowsSkeleton } from '@/components/ui/States'
import { useAuth } from '@/auth/useAuth'
import { isHr } from '@/auth/roles'
import { useMyEmployeeId } from '@/api/queries'
import { overtimeApi } from '@/api/timeclock'
import { opsApi, type AttendanceRow } from '@/api/opsPlus'
import { formatDate, parseDecimal } from '@/lib/format'
import { overtimeHoursError } from './OvertimePanel'
import { isoDate, useAction } from '@/features/shared/kit'
import { tx } from '@/lib/i18n'

const hm = (m?: number) => (!m ? '—' : m >= 60 ? `${Math.floor(m / 60)}s${m % 60 ? ` ${m % 60}dk` : ''}` : `${m}dk`)
/** Sunucu yerel saat (Europe/Istanbul) döndürür, saat dilimi eki yok: yalnızca saat kısmı gösterilir. */
const localClock = (s?: string | null) => (s ? s.slice(11, 16) : '—')

const statusView: Record<AttendanceRow['status'], { label: string; tone: 'neutral' | 'warning' | 'success' | 'danger' | 'info' }> = {
  Ok: { label: tx('Uygun'), tone: 'success' }, Late: { label: tx('Geç'), tone: 'warning' }, EarlyLeave: { label: tx('Erken çıkış'), tone: 'warning' },
  Absent: { label: tx('Kayıt yok'), tone: 'danger' }, MissingOut: { label: tx('Çıkış eksik'), tone: 'warning' }, Off: { label: tx('Tatil'), tone: 'neutral' },
  OffDayWork: { label: tx('Tatilde çalışma'), tone: 'info' }, Leave: { label: tx('İzinli'), tone: 'neutral' }, Holiday: { label: tx('Resmî tatil'), tone: 'neutral' },
  NotYet: { label: tx('Bugün'), tone: 'neutral' },
}

function OvertimeDraftModal({ row, self, onClose }: { row: AttendanceRow; self: boolean; onClose: () => void }) {
  const [hours, setHours] = useState(String(row.suggestedOvertimeHours ?? 0))
  const [reason, setReason] = useState(tx('Puantajdan tespit edilen fazla mesai ({0})', [hm(row.overtimeMinutes)]))
  const hoursErr = overtimeHoursError(hours)
  const create = useAction(() => overtimeApi.create({ employeeId: self ? undefined : row.employeeId, date: row.date, hours: parseDecimal(hours) ?? 0, reason: reason.trim() || undefined }),
    { success: self ? tx('Fazla mesai talebi onaya gönderildi') : tx('Fazla mesai kaydedildi'), invalidate: [['attendance'], ['overtime']], onDone: onClose })
  return (
    <Modal open onClose={onClose} title={tx('Fazla mesai talebi — {0}', [formatDate(row.date)])}
      note={self ? tx('Talep, mevcut fazla mesai onay akışına girer (yılda en çok 270 saat, günde en çok 4 saat).') : tx('Yönetici/İK olarak çalışan adına girilen fazla mesai doğrudan onaylı sayılır.')}
      footer={<><Button variant="outline" onClick={onClose}>{tx('Vazgeç')}</Button><Button onClick={() => create.mutate(undefined)} disabled={create.isPending || !!hoursErr}>{tx('Oluştur')}</Button></>}>
      <div className="space-y-3">
        <p className="text-[13px]">{row.name} · {tx('tespit: {0}', [hm(row.overtimeMinutes)])}</p>
        <TextField label={tx('Saat (0,5 adım)')} inputMode="decimal" value={hours} error={hoursErr} onChange={(e) => setHours(e.target.value)} />
        <TextAreaField label={tx('Gerekçe')} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  )
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const q = useQuery({ queryKey: ['attendance', 'settings'], queryFn: ({ signal }) => opsApi.timesheetSettings(signal) })
  const [d, setD] = useState<{ grace: string; start: string; end: string; brk: string } | null>(null)
  const v = d ?? (q.data ? { grace: String(q.data.lateGraceMinutes), start: q.data.defaultStart.slice(0, 5), end: q.data.defaultEnd.slice(0, 5), brk: String(q.data.defaultBreakMinutes) } : null)
  const save = useAction(() => opsApi.saveTimesheetSettings({ lateGraceMinutes: Number(v!.grace), defaultStart: `${v!.start}:00`, defaultEnd: `${v!.end}:00`, defaultBreakMinutes: Number(v!.brk) }),
    { success: tx('Puantaj ayarları kaydedildi'), invalidate: [['attendance']], onDone: onClose })
  return (
    <Modal open onClose={onClose} title={tx('Puantaj ayarları')} note={tx('Vardiyası olmayan günlerde varsayılan mesai (hafta içi) kullanılır.')}
      footer={<><Button variant="outline" onClick={onClose}>{tx('Vazgeç')}</Button><Button onClick={() => save.mutate(undefined)} disabled={!v || save.isPending}>{tx('Kaydet')}</Button></>}>
      {!v ? <RowsSkeleton rows={2} /> : (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={tx('Geç kalma toleransı (dk)')} type="number" min={0} max={60} value={v.grace} onChange={(e) => setD({ ...v, grace: e.target.value })} />
          <TextField label={tx('Mola (dk)')} type="number" min={0} max={180} value={v.brk} onChange={(e) => setD({ ...v, brk: e.target.value })} />
          <TextField label={tx('Mesai başlangıcı')} type="time" value={v.start} onChange={(e) => setD({ ...v, start: e.target.value })} />
          <TextField label={tx('Mesai bitişi')} type="time" value={v.end} onChange={(e) => setD({ ...v, end: e.target.value })} />
        </div>
      )}
    </Modal>
  )
}

export function AttendanceReportPanel() {
  const { roles } = useAuth()
  const hr = isHr(roles, 'ext-timeshift-manage')
  const { employeeId: me } = useMyEmployeeId()
  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 6 * 864e5)))
  const [to, setTo] = useState(isoDate())
  const [draft, setDraft] = useState<AttendanceRow | null>(null)
  const [settings, setSettings] = useState(false)
  const q = useQuery({ queryKey: ['attendance', from, to], queryFn: ({ signal }) => opsApi.attendance({ from, to }, signal), retry: false })
  const r = q.data
  const rows = (r?.rows ?? []).filter((x) => !['Off', 'Leave', 'Holiday'].includes(x.status))
  return (
    <Panel>
      <PanelHead title={<span className="flex items-center gap-2"><AlarmClock className="size-4 text-primary" />{' '}{tx('Geç kalma ve fazla mesai')}</span>}
        note={r ? (r.scope === 'self' ? tx('Yalnızca kendi kayıtlarınız') : r.scope === 'department' ? tx('Bölümünüzdeki çalışanlar') : tx('Tüm çalışanlar')) + ` · ${tx('tolerans {0} dk', [r.graceMinutes])}` : undefined}
        action={hr && <Button size="sm" variant="ghost" onClick={() => setSettings(true)}><Settings2 className="size-4" />{' '}{tx('Ayarlar')}</Button>} />
      <PanelBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40"><TextField label={tx('Başlangıç')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="w-40"><TextField label={tx('Bitiş')} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button variant="outline" size="sm" onClick={() => { setFrom(isoDate()); setTo(isoDate()) }}>{tx('Bugün')}</Button>
          <Button variant="outline" size="sm" onClick={() => { setFrom(isoDate(new Date(Date.now() - 6 * 864e5))); setTo(isoDate()) }}>{tx('Son 7 gün')}</Button>
        </div>
        <InfoNote>{tx('Bilgilendirme amaçlıdır; otomatik kesinti yapılmaz. Fazla mesai yalnızca talep ve onayla bordroya girer.')}</InfoNote>
        {q.isPending ? <RowsSkeleton rows={3} /> : q.isError ? <p className="text-[13px] text-destructive">{(q.error as Error).message}</p> : r && (
          <>
            {r.totals.length > 1 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr className="text-left text-muted-foreground"><th className="py-1.5">{tx('Çalışan')}</th><th>{tx('Geç (gün)')}</th><th>{tx('Geç toplam')}</th><th>{tx('Erken çıkış')}</th><th>{tx('Kayıt yok')}</th><th>{tx('Olası fazla mesai')}</th></tr></thead>
                  <tbody>{r.totals.map((t) => (
                    <tr key={t.employeeId} className="border-t border-border"><td className="py-1.5">{t.name}<span className="block text-[11.5px] text-muted-foreground">{t.department ?? ''}</span></td>
                      <td className="tabular">{t.lateDays}</td><td className="tabular">{hm(t.lateMinutes)}</td><td className="tabular">{hm(t.earlyLeaveMinutes)}</td><td className="tabular">{t.absentDays}</td><td className="tabular">{hm(t.overtimeMinutes)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {rows.length === 0 ? <p className="text-[13px] text-muted-foreground">{tx('Bu aralıkta değerlendirilecek gün yok.')}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr className="text-left text-muted-foreground">
                    {r.scope !== 'self' && <th className="py-1.5">{tx('Çalışan')}</th>}<th className="py-1.5">{tx('Gün')}</th><th>{tx('Plan')}</th><th>{tx('Giriş')}</th><th>{tx('Çıkış')}</th>
                    <th>{tx('Geç')}</th><th>{tx('Erken')}</th><th>{tx('Çalışılan')}</th><th>{tx('Olası FM')}</th><th>{tx('Durum')}</th><th />
                  </tr></thead>
                  <tbody>{rows.map((x) => (
                    <tr key={`${x.employeeId}-${x.date}`} className="border-t border-border">
                      {r.scope !== 'self' && <td className="py-1.5">{x.name}</td>}
                      <td className="tabular py-1.5">{formatDate(x.date)}</td>
                      <td className="tabular text-muted-foreground">{x.plannedStart ? `${localClock(x.plannedStart)}–${localClock(x.plannedEnd)}` : '—'}{x.source === 'Default' ? '*' : ''}</td>
                      <td className="tabular">{localClock(x.firstIn)}</td>
                      <td className="tabular">{localClock(x.lastOut)}</td>
                      <td className="tabular">{hm(x.lateMinutes)}</td><td className="tabular">{hm(x.earlyLeaveMinutes)}</td>
                      <td className="tabular">{hm(x.workedMinutes)}</td><td className="tabular">{hm(x.overtimeMinutes)}</td>
                      <td><StatusBadge tone={statusView[x.status].tone}>{statusView[x.status].label}</StatusBadge></td>
                      <td className="text-right">
                        {x.overtimeRequest ? <StatusBadge tone="info">{tx('FM talebi: {0}', [x.overtimeRequest.status])}</StatusBadge>
                          : (x.suggestedOvertimeHours ?? 0) > 0 && (x.employeeId === me || r.scope !== 'self') && (
                            <Button size="sm" variant="outline" onClick={() => setDraft(x)}>{tx('FM talebi oluştur')}</Button>
                          )}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
                <p className="mt-1 text-[11.5px] text-muted-foreground">{tx('* Vardiya atanmamış günlerde varsayılan mesai ({0}–{1}).', [r.defaultStart.slice(0, 5), r.defaultEnd.slice(0, 5)])}</p>
              </div>
            )}
          </>
        )}
      </PanelBody>
      {draft && <OvertimeDraftModal row={draft} self={draft.employeeId === me} onClose={() => setDraft(null)} />}
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
    </Panel>
  )
}
