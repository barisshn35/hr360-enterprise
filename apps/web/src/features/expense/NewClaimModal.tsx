import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { LoaderCircle, Plus, Upload } from 'lucide-react'
import * as XLSX from 'xlsx'
import { Button } from '@/components/ui/button'
import { Modal, ErrorSummary, type SummaryItem } from '@/components/ui/Modal'
import { SelectField, TextField } from '@/components/ui/Field'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { useToast } from '@/components/ui/Toast'
import { expenseApi } from '@/api/expense'
import { useMyEmployeeId } from '@/api/queries'
import { useAuth } from '@/auth/useAuth'
import { expenseCategoryLabels, type ExpenseCategory, type ExpenseItem } from '@/api/types'
import { formatMoney } from '@/lib/format'

/** Formda tutulan taslak kalem — tutar kullanıcı yazarken metin kalır. */
interface DraftItem {
  key: number
  category: ExpenseCategory
  amount: string
  expenseDate: string
  description: string
}

let nextKey = 1
function emptyItem(): DraftItem {
  return {
    key: nextKey++,
    category: 'Travel',
    amount: '',
    expenseDate: new Date().toISOString().slice(0, 10),
    description: '',
  }
}

// Türkçe/İngilizce kategori adını ExpenseCategory değerine çevirir.
const CATEGORY_BY_LABEL: Record<string, ExpenseCategory> = Object.fromEntries(
  (Object.keys(expenseCategoryLabels) as ExpenseCategory[]).flatMap((c) => [
    [c.toLowerCase(), c],
    [expenseCategoryLabels[c].toLowerCase(), c],
  ]),
)

function excelDateToIso(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const s = String(value ?? '').trim()
  const m1 = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
  if (m1) return `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return new Date().toISOString().slice(0, 10)
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '')
}

const ITEM_HEADER_ALIASES: Record<string, 'category' | 'amount' | 'expenseDate' | 'description'> = {
  tür: 'category',
  tur: 'category',
  kategori: 'category',
  tutar: 'amount',
  tarih: 'expenseDate',
  açıklama: 'description',
  aciklama: 'description',
}

/** Excel dosyasını okuyup DraftItem listesine çevirir - tutarı 0 ya da
 * negatif olan satırlar (başlık tekrarı, boş satır vb.) atlanır. */
async function parseItemsFromFile(file: File): Promise<DraftItem[]> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })

  const drafts: DraftItem[] = []
  for (const record of raw) {
    const mapped: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      const field = ITEM_HEADER_ALIASES[normalizeHeader(key)]
      if (field) mapped[field] = value
    }
    const amount = Number(mapped.amount)
    if (!amount || amount <= 0) continue

    const categoryRaw = String(mapped.category ?? '').trim().toLowerCase()
    drafts.push({
      key: nextKey++,
      category: CATEGORY_BY_LABEL[categoryRaw] ?? 'Other',
      amount: String(amount),
      expenseDate: excelDateToIso(mapped.expenseDate),
      description: String(mapped.description ?? '').trim(),
    })
  }
  return drafts
}

interface Errors {
  employeeId?: string
  title?: string
  items?: string
}

/**
 * Çok kalemli masraf formu.
 *
 * Toplam kullanıcı yazdıkça kendiliğinden güncellenir; backend zaten
 * kalemlerden hesapladığı için gönderilmez, burada yalnızca gösterilir.
 */
export function NewClaimModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const reduced = useReducedMotion()

  // Başkası adına beyan yalnızca İK/muhasebe açabilir (backend 403 döner);
  // diğerleri için talep sahibi her zaman kendileridir.
  const { roles } = useAuth()
  const canPickOthers = roles.some((r) =>
    r === 'hr-admin' || r === 'tenant-admin' || r === 'platform-admin' || r === 'accounting')
  const me = useMyEmployeeId(!canPickOthers)

  const [pickedEmployeeId, setEmployeeId] = useState('')
  const employeeId = canPickOthers ? pickedEmployeeId : (me.employeeId ?? '')
  const [title, setTitle] = useState('')
  const [items, setItems] = useState<DraftItem[]>([emptyItem()])
  const [errors, setErrors] = useState<Errors>({})
  const [submitted, setSubmitted] = useState(false)

  const total = items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0)

  function patch(key: number, changes: Partial<DraftItem>) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...changes } : i)))
  }

  function reset() {
    setTitle('')
    setItems([emptyItem()])
    setErrors({})
    setSubmitted(false)
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const imported = await parseItemsFromFile(file)
      if (imported.length === 0) {
        toast.stop('Dosyada geçerli (tutarı olan) satır bulunamadı.')
        return
      }
      // Bos ilk kalemi (kullanici hic dokunmadiysa) ithal edilenlerle degistir.
      setItems((prev) => {
        const isUntouched =
          prev.length === 1 && !prev[0].amount && !prev[0].description
        return isUntouched ? imported : [...prev, ...imported]
      })
      toast.ok(`${imported.length} kalem içe aktarıldı.`)
    } catch {
      toast.stop('Dosya okunamadı. Geçerli bir .xlsx dosyası seçin.')
    }
  }

  function validate(overrideEmployeeId?: string): Errors {
    const next: Errors = {}
    if (!(overrideEmployeeId ?? employeeId)) next.employeeId = 'Çalışan seçilmeli.'
    if (title.trim().length < 3) next.title = 'Başlık en az 3 karakter olmalı.'
    if (items.length === 0) {
      next.items = 'En az bir kalem eklenmeli.'
    } else if (items.some((i) => !i.amount || Number(i.amount) <= 0)) {
      // GUVENLIK/VERI BUTUNLUGU: onceki hali yalnizca "!Number(i.amount)"
      // kontrol ediyordu - bu, negatif tutarlari (orn. -50) YAKALAMIYORDU,
      // cunku Number('-50') JavaScript'te "truthy". Form negatif tutari
      // kabul edip gonderiyordu, backend'in jenerik "istek gecersiz"
      // hatasina kadar hicbir uyari gorunmuyordu.
      next.items = 'Her kalemin tutarı 0\'dan büyük olmalı.'
    } else if (items.some((i) => !i.expenseDate)) {
      next.items = 'Her kalemin tarihi girilmeli.'
    }
    return next
  }

  const mutation = useMutation({
    mutationFn: () => {
      const payload: ExpenseItem[] = items.map((i) => ({
        category: i.category,
        amount: Number(i.amount),
        expenseDate: i.expenseDate,
        description: i.description.trim() || undefined,
      }))
      return expenseApi.createClaim({
        employeeId,
        title: title.trim(),
        currency: 'TRY',
        items: payload,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expense'] })
      toast.ok('Masraf talebi taslak olarak oluşturuldu')
      onClose()
      reset()
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Talep oluşturulamadı.'),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    const next = validate()
    setErrors(next)
    if (Object.keys(next).length === 0) mutation.mutate()
  }

  const summary: SummaryItem[] = submitted
    ? ([
        errors.employeeId && { fieldId: 'claim-employee', message: errors.employeeId },
        errors.title && { fieldId: 'claim-title', message: errors.title },
        errors.items && { fieldId: `item-amount-${items[0]?.key}`, message: errors.items },
      ].filter(Boolean) as SummaryItem[])
    : []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yeni masraf talebi"
      note="Taslak olarak açılır; onaya göndermek ayrı bir adımdır."
      size="lg"
      footer={
        <>
          <span className="tabular mr-auto text-[13px] text-muted-foreground">
            Toplam{' '}
            <motion.span
              key={total}
              className="text-[15px] font-semibold text-foreground"
              initial={reduced ? false : { opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              {formatMoney(total)}
            </motion.span>
          </span>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Vazgeç
          </Button>
          <Button
            type="submit"
            form="new-claim"
            className="cursor-pointer"
            disabled={mutation.isPending}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Taslağı oluştur
          </Button>
        </>
      }
    >
      <form id="new-claim" onSubmit={submit} noValidate className="space-y-5">
        <ErrorSummary items={summary} />

        {canPickOthers ? (
          <EmployeePicker
            id="claim-employee"
            value={employeeId}
            onChange={(next) => {
              setEmployeeId(next)
              if (submitted) setErrors(validate(next))
            }}
            hint={submitted ? errors.employeeId : undefined}
          />
        ) : (
          <p className="text-[13px] text-muted-foreground">
            {me.notLinked
              ? 'Hesabınıza bağlı çalışan kaydı bulunamadı; masraf beyanı açamazsınız.'
              : 'Beyan sizin adınıza oluşturulacak.'}
          </p>
        )}
        <TextField
          id="claim-title"
          label="Başlık"
          required
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => submitted && setErrors(validate())}
          error={errors.title}
        />

        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-[14px] font-semibold">Kalemler</h3>
            <div className="flex items-center gap-3">
              <span className="tabular text-[12px] text-muted-foreground">
                {items.length} kalem
              </span>
              <label
                htmlFor="claim-items-import"
                className="flex cursor-pointer items-center gap-1 text-[12px] text-muted-foreground underline hover:text-foreground"
              >
                <Upload className="size-3" />
                Excel'den içe aktar
              </label>
              <input
                id="claim-items-import"
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleImportFile}
              />
            </div>
          </div>

          <ul className="space-y-3">
            <AnimatePresence initial={false}>
              {items.map((item, index) => (
                <motion.li
                  key={item.key}
                  layout={!reduced}
                  initial={reduced ? false : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={reduced ? undefined : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.24, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div className="rounded-md border border-border p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="tabular text-[12px] text-muted-foreground">
                        Kalem {index + 1}
                      </span>
                      {items.length > 1 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="cursor-pointer"
                          onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}
                        >
                          Kaldır
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <SelectField
                        id={`item-cat-${item.key}`}
                        label="Tür"
                        value={item.category}
                        onChange={(v) => patch(item.key, { category: v as ExpenseCategory })}
                        options={(Object.keys(expenseCategoryLabels) as ExpenseCategory[]).map(
                          (c) => ({ value: c, label: expenseCategoryLabels[c] }),
                        )}
                      />
                      <TextField
                        id={`item-amount-${item.key}`}
                        label="Tutar"
                        type="number"
                        min={0}
                        step="0.01"
                        className="tabular"
                        value={item.amount}
                        onChange={(e) => patch(item.key, { amount: e.target.value })}
                        onBlur={() => submitted && setErrors(validate())}
                      />
                      <TextField
                        id={`item-date-${item.key}`}
                        label="Tarih"
                        type="date"
                        value={item.expenseDate}
                        onChange={(e) => patch(item.key, { expenseDate: e.target.value })}
                      />
                    </div>
                    <div className="mt-3">
                      <TextField
                        id={`item-desc-${item.key}`}
                        label="Açıklama"
                        hint="İsteğe bağlı"
                        value={item.description}
                        onChange={(e) => patch(item.key, { description: e.target.value })}
                      />
                    </div>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="cursor-pointer"
            onClick={() => setItems((prev) => [...prev, emptyItem()])}
          >
            <Plus className="size-4" />
            Kalem ekle
          </Button>

          {submitted && errors.items && (
            <p role="alert" className="text-[13px] text-destructive">
              {errors.items}
            </p>
          )}
        </div>
      </form>
    </Modal>
  )
}
