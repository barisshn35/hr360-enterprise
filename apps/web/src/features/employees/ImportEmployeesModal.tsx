import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Upload, FileSpreadsheet, CheckCircle2, XCircle } from 'lucide-react'
import * as XLSX from 'xlsx'
import { employeeApi } from '@/api/employees'
import { tenantApi } from '@/api/tenant'
import { qk } from '@/api/queries'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'

interface DepartmentOption {
  id: string
  label: string
}

interface ParsedRow {
  rowNumber: number
  firstName: string
  lastName: string
  email: string
  phone: string
  hireDate: string // yyyy-MM-dd
  departmentLabel: string
  error?: string
}

type ImportResult = {
  row: ParsedRow
  status: 'ok' | 'failed'
  message?: string
}

// Excel şablonundaki başlıklar için kabul edilen varyasyonlar (küçük harfe
// çevrilip boşluklar temizlenerek karşılaştırılır).
const HEADER_ALIASES: Record<string, keyof Omit<ParsedRow, 'rowNumber' | 'error'>> = {
  ad: 'firstName',
  isim: 'firstName',
  soyad: 'lastName',
  soyisim: 'lastName',
  eposta: 'email',
  'e-posta': 'email',
  email: 'email',
  telefon: 'phone',
  'işegiriştarihi': 'hireDate',
  'işegiris': 'hireDate',
  giriştarihi: 'hireDate',
  departman: 'departmentLabel',
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '')
}

function excelDateToIso(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const s = String(value ?? '').trim()
  // gg.aa.yyyy veya gg/aa/yyyy
  const m1 = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
  if (m1) return `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`
  // zaten yyyy-aa-gg
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return ''
}

function parseWorkbook(buffer: ArrayBuffer, departments: DepartmentOption[]): ParsedRow[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })

  const deptByLabel = new Map(departments.map((d) => [d.label.trim().toLowerCase(), d.id]))

  return raw.map((record, idx) => {
    const mapped: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      const field = HEADER_ALIASES[normalizeHeader(key)]
      if (field) mapped[field] = value
    }

    const firstName = String(mapped.firstName ?? '').trim()
    const lastName = String(mapped.lastName ?? '').trim()
    const email = String(mapped.email ?? '').trim()
    const phone = String(mapped.phone ?? '').trim()
    const hireDate = mapped.hireDate ? excelDateToIso(mapped.hireDate) : ''
    const departmentLabel = String(mapped.departmentLabel ?? '').trim()

    let error: string | undefined
    if (!firstName || !lastName) error = 'Ad/Soyad eksik'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) error = 'E-posta geçersiz'
    else if (!hireDate) error = 'İşe giriş tarihi okunamadı'
    else if (departmentLabel && !deptByLabel.has(departmentLabel.toLowerCase()))
      error = `Departman bulunamadı: "${departmentLabel}"`

    return {
      rowNumber: idx + 2, // Excel'de 1. satır başlık
      firstName,
      lastName,
      email,
      phone,
      hireDate,
      departmentLabel,
      error,
    }
  })
}

export function ImportEmployeesModal({
  open,
  onClose,
  departments,
}: {
  open: boolean
  onClose: () => void
  departments: DepartmentOption[]
}) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [rows, setRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<ImportResult[] | null>(null)

  function reset() {
    setRows([])
    setFileName('')
    setResults(null)
    setProgress(0)
  }

  function handleClose() {
    if (importing) return
    reset()
    onClose()
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResults(null)
    setParsing(true)
    try {
      const buffer = await file.arrayBuffer()
      setRows(parseWorkbook(buffer, departments))
    } catch {
      toast.stop('Dosya okunamadı. Geçerli bir .xlsx dosyası seçin.')
      setRows([])
    } finally {
      setParsing(false)
    }
  }

  const validRows = rows.filter((r) => !r.error)
  const invalidRows = rows.filter((r) => r.error)
  const deptByLabel = new Map(departments.map((d) => [d.label.trim().toLowerCase(), d.id]))

  async function handleImport() {
    setImporting(true)
    setProgress(0)
    const outcomes: ImportResult[] = []

    for (const row of validRows) {
      try {
        const employee = await employeeApi.create({
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
          phone: row.phone || undefined,
          hireDate: row.hireDate,
        })

        const deptId = row.departmentLabel
          ? deptByLabel.get(row.departmentLabel.toLowerCase())
          : undefined
        if (deptId) {
          try {
            await employeeApi.addAssignment(employee.id, {
              departmentId: deptId,
              positionTitle: undefined,
              effectiveFrom: row.hireDate,
            })
          } catch {
            // Kayıt oluştu, sadece atama başarısız - liste/şemadan elle tamamlanabilir.
          }
        }

        try {
          await tenantApi.inviteMember(employee.id)
        } catch {
          // Davet e-postası gönderilemedi - kayıt yine de geçerli.
        }

        outcomes.push({ row, status: 'ok' })
      } catch (e: unknown) {
        outcomes.push({
          row,
          status: 'failed',
          message: e instanceof Error ? e.message : 'Bilinmeyen hata',
        })
      }
      setProgress(outcomes.length)
    }

    setResults(outcomes)
    setImporting(false)
    void queryClient.invalidateQueries({ queryKey: qk.employees })
    void queryClient.invalidateQueries({ queryKey: ['departments'] })

    const okCount = outcomes.filter((o) => o.status === 'ok').length
    const failCount = outcomes.length - okCount
    if (failCount === 0) toast.ok(`${okCount} çalışan başarıyla içe aktarıldı.`)
    else toast.stop(`${okCount} başarılı, ${failCount} başarısız. Detaylar aşağıda.`)
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Excel'den çalışan içe aktar"
      note="Sütunlar: Ad, Soyad, E-posta, Telefon (isteğe bağlı), İşe giriş tarihi, Departman (isteğe bağlı)."
      size="lg"
      footer={
        <>
          <Button variant="outline" className="cursor-pointer" onClick={handleClose} disabled={importing}>
            {results ? 'Kapat' : 'Vazgeç'}
          </Button>
          {!results && (
            <Button
              className="cursor-pointer"
              onClick={handleImport}
              disabled={importing || validRows.length === 0}
            >
              {importing && <LoaderCircle className="size-4 animate-spin" />}
              {importing
                ? `İçe aktarılıyor (${progress}/${validRows.length})`
                : `${validRows.length || ''} kaydı içe aktar`}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {!fileName && (
          <label
            htmlFor="employee-import-file"
            className="border-border flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center hover:bg-white/5"
          >
            <Upload className="text-muted-foreground size-6" />
            <span className="text-sm font-medium">.xlsx dosyasını seçin</span>
            <span className="text-muted-foreground text-xs">
              veya sürükleyip bırakın — ilk satır başlık olmalı
            </span>
            <input
              id="employee-import-file"
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleFile}
            />
          </label>
        )}

        {fileName && (
          <div className="border-border flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <FileSpreadsheet className="size-4 shrink-0" />
            <span className="truncate">{fileName}</span>
            {!results && !importing && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground ml-auto cursor-pointer text-xs underline"
                onClick={reset}
              >
                Değiştir
              </button>
            )}
          </div>
        )}

        {parsing && (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <LoaderCircle className="size-4 animate-spin" />
            Dosya okunuyor…
          </div>
        )}

        {!parsing && rows.length > 0 && !results && (
          <>
            <div className="flex gap-4 text-sm">
              <span className="flex items-center gap-1 text-emerald-500">
                <CheckCircle2 className="size-4" /> {validRows.length} geçerli
              </span>
              {invalidRows.length > 0 && (
                <span className="flex items-center gap-1 text-red-500">
                  <XCircle className="size-4" /> {invalidRows.length} hatalı (atlanacak)
                </span>
              )}
            </div>

            <div className="border-border max-h-64 overflow-y-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/5 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2">Satır</th>
                    <th className="px-3 py-2">Ad Soyad</th>
                    <th className="px-3 py-2">E-posta</th>
                    <th className="px-3 py-2">Departman</th>
                    <th className="px-3 py-2">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rowNumber} className="border-border border-t">
                      <td className="text-muted-foreground px-3 py-2">{r.rowNumber}</td>
                      <td className="px-3 py-2">
                        {r.firstName} {r.lastName}
                      </td>
                      <td className="px-3 py-2">{r.email}</td>
                      <td className="px-3 py-2">{r.departmentLabel || '—'}</td>
                      <td className="px-3 py-2">
                        {r.error ? (
                          <span className="text-red-500">{r.error}</span>
                        ) : (
                          <span className="text-emerald-500">Hazır</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {results && (
          <div className="space-y-2">
            <div className="flex gap-4 text-sm">
              <span className="flex items-center gap-1 text-emerald-500">
                <CheckCircle2 className="size-4" />
                {results.filter((r) => r.status === 'ok').length} başarılı
              </span>
              {results.some((r) => r.status === 'failed') && (
                <span className="flex items-center gap-1 text-red-500">
                  <XCircle className="size-4" />
                  {results.filter((r) => r.status === 'failed').length} başarısız
                </span>
              )}
            </div>
            {results.some((r) => r.status === 'failed') && (
              <div className="border-border max-h-48 overflow-y-auto rounded-lg border">
                <table className="w-full text-left text-sm">
                  <tbody>
                    {results
                      .filter((r) => r.status === 'failed')
                      .map((r) => (
                        <tr key={r.row.rowNumber} className="border-border border-t">
                          <td className="px-3 py-2 text-red-500">
                            Satır {r.row.rowNumber} ({r.row.firstName} {r.row.lastName}):{' '}
                            {r.message}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
