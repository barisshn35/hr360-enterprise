import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/Field'
import { EmptyState, RowsSkeleton } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { leaveApi } from '@/api/leave'
import { useLeaveHolidays } from '@/api/queries'
import { formatDate } from '@/lib/format'

/**
 * Resmi tatil takvimi (İK). Buradaki günler izin günü hesabında düşülür —
 * backend (leave-service) izin gününü artık kendisi hesaplıyor; dini bayramlar
 * her yıl değiştiği için hazır bir liste gömülmedi.
 */
export function HolidaysModal({ open, onClose, year }: { open: boolean; onClose: () => void; year: number }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const holidays = useLeaveHolidays(year, open)
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | undefined>()

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['leave', 'holidays'] })

  const add = useMutation({
    mutationFn: () => leaveApi.createHoliday({ date, name: name.trim() }),
    onSuccess: () => {
      invalidate()
      toast.ok('Tatil eklendi')
      setDate('')
      setName('')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Tatil eklenemedi.'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => leaveApi.deleteHoliday(id),
    onSuccess: () => {
      invalidate()
      toast.ok('Tatil silindi')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Tatil silinemedi.'),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!date) return setError('Tarih zorunlu.')
    if (name.trim().length < 2) return setError('Tatil adı zorunlu.')
    setError(undefined)
    add.mutate()
  }

  const rows = holidays.data ?? []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${year} resmi tatilleri`}
      note="Bu günler izin talebinde gün sayısından düşülür (hafta sonları zaten düşülür)."
      size="lg"
      footer={
        <Button variant="outline" className="cursor-pointer" onClick={onClose}>
          Kapat
        </Button>
      }
    >
      <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-end">
        <TextField
          id="holiday-date"
          label="Tarih"
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          error={error?.includes('Tarih') ? error : undefined}
        />
        <TextField
          id="holiday-name"
          label="Tatil adı"
          required
          placeholder="Örn. Cumhuriyet Bayramı"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error?.includes('adı') ? error : undefined}
        />
        <Button type="submit" className="cursor-pointer" disabled={add.isPending}>
          {add.isPending && <LoaderCircle className="size-4 animate-spin" />}
          Ekle
        </Button>
      </form>

      <div className="mt-5">
        {holidays.isPending ? (
          <RowsSkeleton rows={3} />
        ) : rows.length === 0 ? (
          <EmptyState title="Bu yıl için tatil girilmemiş" detail="İzin günleri yalnızca hafta sonları düşülerek hesaplanır." />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {rows.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium">{h.name}</p>
                  <p className="tabular text-[12px] text-muted-foreground">{formatDate(h.date)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="cursor-pointer"
                  aria-label={`${h.name} tatilini sil`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(h.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
