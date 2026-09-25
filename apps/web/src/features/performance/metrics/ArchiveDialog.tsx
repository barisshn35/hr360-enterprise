/**
 * Arşivleme onayı. "Sil" gibi görünmemeli: veri kaybolmaz, yalnızca yeni
 * değerlendirmelerde metrik artık sorulmaz.
 */

import { Archive, History, ShieldCheck } from 'lucide-react'
import { categoryLabels, useArchiveMetric, type Metric } from '@/api/performance'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import { errorText } from '../components/controls'

export function ArchiveDialog({
  metric,
  onClose,
  onArchived,
}: {
  metric: Metric
  onClose: () => void
  onArchived?: () => void
}) {
  const toast = useToast()
  const archive = useArchiveMetric()

  const confirm = () =>
    archive.mutate(metric.id, {
      onSuccess: () => {
        toast.ok(`«${metric.name}» arşivlendi. Geçmiş değerlendirmeler korunuyor.`)
        onArchived?.()
        onClose()
      },
      onError: (e) => toast.stop(errorText(e)),
    })

  return (
    <Modal
      open
      onClose={onClose}
      title={`«${metric.name}» arşivlensin mi?`}
      note={`${categoryLabels[metric.category]} kategorisinden çıkar; yeni değerlendirmelerde sorulmaz.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={archive.isPending}>
            Vazgeç
          </Button>
          <Button onClick={confirm} disabled={archive.isPending}>
            <Archive aria-hidden />
            {archive.isPending ? 'Arşivleniyor…' : 'Arşivle'}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-3 text-[13px]">
        <li className="flex gap-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[hsl(var(--success))]" aria-hidden />
          <span>
            <span className="font-medium">Hiçbir veri silinmez.</span>{' '}
            <span className="text-muted-foreground">Bu metrikle verilmiş tüm puanlar geçmiş değerlendirmelerde ve puan dökümlerinde olduğu gibi kalır.</span>
          </span>
        </li>
        <li className="flex gap-3">
          <History className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span className="text-muted-foreground">
            Kapanmış dönemlerin puanları değişmez. Açık dönemde henüz gönderilmemiş değerlendirmelerde metrik artık görünmez.
          </span>
        </li>
        {metric.isRequired && (
          <li className="rounded-md border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/8 px-3 py-2 text-[12px] text-foreground">
            Bu metrik <span className="font-medium">zorunluydu</span>. Arşivlendikten sonra değerlendirmeler onsuz gönderilebilir.
          </li>
        )}
      </ul>
    </Modal>
  )
}
