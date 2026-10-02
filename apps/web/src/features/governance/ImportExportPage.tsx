import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import * as XLSX from 'xlsx'
import { Building2, CalendarDays, Download, FileSpreadsheet, GraduationCap, LoaderCircle, Upload, Users, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { InfoNote } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { employeeApi } from '@/api/employees'
import { organizationApi } from '@/api/organization'
import { leaveApi, leaveStatusLabels, leaveTypeLabels } from '@/api/leave'
import { expenseApi } from '@/api/expense'
import { learningApi } from '@/api/learning'
import { useDirectory } from '@/api/directory'
import { ImportEmployeesModal } from '@/features/employees/ImportEmployeesModal'
import { PlanGate, errMsg } from '@/features/shared/kit'

type Dataset = { id: string; title: string; detail: string; icon: React.ElementType; load: () => Promise<Record<string, unknown>[]> }

function download(name: string, sheets: Record<string, Record<string, unknown>[]>) {
  const wb = XLSX.utils.book_new()
  for (const [title, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Bilgi: 'Kayıt yok' }])
    ws['!cols'] = Object.keys(rows[0] ?? { Bilgi: '' }).map((k) => ({ wch: Math.max(12, Math.min(40, k.length + 4)) }))
    XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31))
  }
  XLSX.writeFile(wb, name)
}

export function ImportExportPage() {
  const toast = useToast()
  const dir = useDirectory()
  const name = (id: string) => dir.data?.find((d) => d.id === id)?.fullName ?? id
  const departments = useQuery({ queryKey: ['organization', 'departments'], queryFn: ({ signal }) => organizationApi.listDepartments(undefined, signal) })
  const deptName = (id?: string | null) => departments.data?.find((d) => d.id === id)?.name ?? ''
  const [busy, setBusy] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const datasets: Dataset[] = [
    { id: 'employees', title: 'Çalışanlar', detail: 'Ad, e-posta, işe giriş, durum, güncel departman ve pozisyon', icon: Users, load: async () => (await employeeApi.list()).map((e) => {
      const a = [...(e.assignments ?? [])].sort((x, y) => (y.effectiveFrom ?? '').localeCompare(x.effectiveFrom ?? ''))[0]
      return { Ad: e.firstName, Soyad: e.lastName, 'E-posta': e.email, Telefon: e.phone ?? '', 'İşe giriş': e.hireDate, Durum: e.status, Departman: deptName(a?.departmentId), Pozisyon: a?.positionTitle ?? '' }
    }) },
    { id: 'departments', title: 'Departmanlar', detail: 'Ad, üst departman ve departman başı', icon: Building2, load: async () => (await organizationApi.listDepartments()).map((d) => ({ Ad: d.name, 'Üst departman': deptName(d.parentDepartmentId), 'Departman başı': d.headEmployeeId ? name(d.headEmployeeId) : '' })) },
    { id: 'leave', title: 'İzin talepleri', detail: 'Tüm izin talepleri ve durumları', icon: CalendarDays, load: async () => (await leaveApi.listRequests()).map((l) => ({ Çalışan: name(l.employeeId), Tür: leaveTypeLabels[l.type] ?? l.type, Başlangıç: l.startDate, Bitiş: l.endDate, Gün: l.days, Durum: leaveStatusLabels[l.status] ?? l.status, Açıklama: l.reason ?? '' })) },
    { id: 'expense', title: 'Masraflar', detail: 'Beyanlar, tutar ve durum', icon: Wallet, load: async () => (await expenseApi.listClaims()).map((c) => ({ Çalışan: name(c.employeeId), Başlık: c.title, Tutar: c.totalAmount, 'Para birimi': c.currency, Durum: c.status, Oluşturma: c.createdAt?.slice(0, 10) })) },
    { id: 'learning', title: 'Eğitim kayıtları', detail: 'Kurs bazında katılım ve tamamlama', icon: GraduationCap, load: async () => (await learningApi.listCourses()).flatMap((c) => (c.enrollments ?? []).map((e) => ({ Eğitim: c.title, Kategori: c.category, Zorunlu: c.isMandatory ? 'Evet' : 'Hayır', Çalışan: name(e.employeeId), Durum: e.status, Puan: e.score ?? '', Tamamlama: e.completedAt?.slice(0, 10) ?? '' }))) },
  ]

  const exportOne = async (d: Dataset) => {
    setBusy(d.id)
    try {
      const rows = await d.load()
      download(`hr360-${d.id}-${new Date().toISOString().slice(0, 10)}.xlsx`, { [d.title]: rows })
      toast.ok(`${rows.length} satır indirildi`)
    } catch (e) { toast.stop(errMsg(e)) } finally { setBusy(null) }
  }
  const exportAll = async () => {
    setBusy('all')
    try {
      const sheets: Record<string, Record<string, unknown>[]> = {}
      for (const d of datasets) {
        try { sheets[d.title] = await d.load() } catch { sheets[d.title] = [] }
      }
      download(`hr360-tum-veriler-${new Date().toISOString().slice(0, 10)}.xlsx`, sheets)
      toast.ok('Tüm veriler tek dosyada indirildi')
    } finally { setBusy(null) }
  }

  return (
    <PlanGate feature="import-export">
      <PageHeader title="İçe/dışa aktarım" description="Excel ile toplu veri: çalışanları içe aktarın, modül verilerini tek tıkla dışa aktarın." actions={<Button onClick={exportAll} disabled={busy !== null}>{busy === 'all' ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />} Hepsini tek dosyada indir</Button>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Panel>
          <PanelHead title="Dışa aktar" note="Yetkinizin gördüğü kadar veri indirilir; her sayfa ayrı Excel sekmesidir." />
          <PanelBody className="grid gap-3 sm:grid-cols-2">
            {datasets.map((d, i) => (
              <motion.button key={d.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} whileHover={{ y: -3 }} onClick={() => void exportOne(d)} disabled={busy !== null}
                className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card/40 p-4 text-left transition hover:border-primary/40 disabled:opacity-60">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">{busy === d.id ? <LoaderCircle className="size-5 animate-spin" /> : <d.icon className="size-5" />}</span>
                <div><p className="text-[14px] font-medium">{d.title}</p><p className="text-[12px] text-muted-foreground">{d.detail}</p></div>
              </motion.button>
            ))}
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHead title="İçe aktar" />
          <PanelBody className="space-y-4">
            <div className="flex items-start gap-3 rounded-2xl border border-dashed border-border p-4">
              <FileSpreadsheet className="mt-0.5 size-5 text-primary" />
              <div className="text-[13px]"><p className="font-medium">Çalışanlar (Excel)</p><p className="text-muted-foreground">Şablonu indirin, doldurun, yükleyin. Satırlar tek tek doğrulanır; hatalı satırlar atlanır ve raporlanır.</p></div>
            </div>
            <Button className="w-full" onClick={() => setImporting(true)}><Upload className="size-4" /> Çalışan içe aktar</Button>
            <InfoNote>Toplu içe aktarım çalışan kotanızı aşamaz; her eklenen çalışan için “işe alındı” olayı üretilir (bildirim, kural motoru ve webhook’lar tetiklenir).</InfoNote>
          </PanelBody>
        </Panel>
      </div>
      <ImportEmployeesModal open={importing} onClose={() => setImporting(false)} departments={(departments.data ?? []).map((d) => ({ id: d.id, label: d.name }))} />
    </PlanGate>
  )
}
