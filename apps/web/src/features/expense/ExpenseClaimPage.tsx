import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, LoaderCircle } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { DataField, Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ClaimStatusBadge } from '@/components/ui/ModuleBadges'
import { CenteredSpinner, EmptyState, ErrorState, InfoNote } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/auth/useAuth'
import { expenseApi } from '@/api/expense'
import { useExpenseClaim } from '@/api/queries'
import { expenseCategoryLabels } from '@/api/types'
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format'
import { useEmployeeName } from '@/lib/useEmployeeName'

export function ExpenseClaimPage() {
  const { claimId } = useParams<{ claimId: string }>()
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const reduced = useReducedMotion()

  const claim = useExpenseClaim(claimId)
  const nameOf = useEmployeeName()

  const submit = useMutation({
    mutationFn: () => expenseApi.submitClaim(claimId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expense'] })
      void queryClient.invalidateQueries({ queryKey: ['workflows'] })
      toast.ok('Talep onaya gönderildi')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Talep gönderilemedi.'),
  })

  const markPaid = useMutation({
    mutationFn: () => expenseApi.markPaid(claimId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expense'] })
      toast.ok('Talep ödendi olarak işaretlendi')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Talep işaretlenemedi.'),
  })

  if (claim.isPending) return <CenteredSpinner label="Masraf talebi yükleniyor" />

  if (claim.isError) {
    return (
      <Panel>
        <ErrorState
          message={claim.error instanceof Error ? claim.error.message : undefined}
          onRetry={() => void claim.refetch()}
        />
      </Panel>
    )
  }

  if (!claim.data) {
    return (
      <Panel>
        <EmptyState title="Talep bulunamadı" detail="Bu masraf talebi silinmiş olabilir." />
      </Panel>
    )
  }

  const c = claim.data
  const items = c.items ?? []

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2 cursor-pointer" asChild>
        <Link to="/panel/masraf">
          <ArrowLeft className="size-4" />
          Masraf
        </Link>
      </Button>

      <PageHeader
        title={c.title}
        description={`${nameOf(c.employeeId)}, ${formatNumber(items.length)} kalem`}
        actions={
          <>
            <ClaimStatusBadge status={c.status} />
            {c.status === 'Draft' && can('expense:create') && (
              <Button
                className="cursor-pointer"
                disabled={submit.isPending}
                onClick={() => submit.mutate()}
              >
                {submit.isPending && <LoaderCircle className="size-4 animate-spin" />}
                Onaya gönder
              </Button>
            )}
            {c.status === 'Approved' && can('expense:markPaid') && (
              <Button
                className="cursor-pointer"
                disabled={markPaid.isPending}
                onClick={() => markPaid.mutate()}
              >
                {markPaid.isPending && <LoaderCircle className="size-4 animate-spin" />}
                Ödendi işaretle
              </Button>
            )}
          </>
        }
      />

      <Panel>
        <PanelBody className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="block text-[12px] text-muted-foreground">Toplam</span>
            <motion.span
              className="tabular mt-1 block text-[34px] leading-none font-bold"
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
            >
              {formatMoney(c.totalAmount, c.currency)}
            </motion.span>
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHead title="Kalemler" note={`${formatNumber(items.length)} kalem`} />
        {items.length === 0 ? (
          <EmptyState title="Kalem yok" detail="Bu talebe kalem eklenmemiş." />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item, i) => (
              <motion.li
                key={item.id ?? i}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3.5"
                initial={reduced ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: 'easeOut', delay: Math.min(i * 0.04, 0.2) }}
              >
                <span className="min-w-0 flex-1 basis-52">
                  <span className="block text-[14px]">{expenseCategoryLabels[item.category]}</span>
                  {item.description && (
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">
                      {item.description}
                    </span>
                  )}
                </span>
                <span className="tabular shrink-0 text-[12px] text-muted-foreground">
                  {formatDate(item.expenseDate)}
                </span>
                <span className="tabular shrink-0 text-[14px] font-semibold">
                  {formatMoney(item.amount, c.currency)}
                </span>
              </motion.li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHead title="Talep bilgisi" />
        <PanelBody className="space-y-4">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
            <DataField label="Talep sahibi">{nameOf(c.employeeId)}</DataField>
            <DataField label="Oluşturulma">{formatDateTime(c.createdAt)}</DataField>
            <DataField label="Onay akışı">
              {c.workflowRequestId ? (
                <StatusBadge tone="info">Onay kutusuna düştü</StatusBadge>
              ) : (
                <span className="text-muted-foreground">Henüz gönderilmedi</span>
              )}
            </DataField>
          </dl>
          {c.status === 'Submitted' && (
            <InfoNote>
              Talep onay kutusunda bekliyor. Onay verildiğinde durum arka planda kendiliğinden
              güncellenir; burada ayrıca bir işlem yapmanız gerekmez.
            </InfoNote>
          )}
        </PanelBody>
      </Panel>
    </div>
  )
}
