/**
 * Değerlendirmeler — `/panel/performans/degerlendirme`.
 *
 * Sekmeler: "Yazdıklarım" (değerlendiren benim), "Hakkımdakiler" (konu
 * benim) ve yöneticide "Tümü". Taslaklar üstte ve "devam et" ile açılır.
 * Hakkımdaki ekip arkadaşı / yukarı yönlü değerlendirmelerde yazanın adı
 * gösterilmez (bkz. rapor: kararsız kalınan yer).
 */

import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, ClipboardList, FilePen, Lock, Plus, UserRound } from 'lucide-react'
import { reviewTypeLabels, useMyEmployeeId, useReviews, type Review, type ReviewType } from '@/api/performance'
import { useAuth } from '@/auth/useAuth'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/Panel'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CountUp, EASE } from '@/motion/primitives'
import { Chip, Segmented, errorText } from '../components/controls'
import { PerfPageHeader } from '../components/PerfPageHeader'
import { PersonAvatar } from '../components/people'
import { CyclePicker } from '../components/pickers'
import { useCurrentCycle, usePeople } from '../hooks'
import { StartReviewDialog } from './StartReviewDialog'

type Tab = 'mine' | 'about' | 'all'
const ANONYMOUS: ReviewType[] = ['Peer', 'Upward']

export function ReviewsPage() {
  const { can } = useAuth()
  const manager = can('performance:manage')
  const me = useMyEmployeeId()
  const people = usePeople()
  const { cycles, current } = useCurrentCycle()
  const [params, setParams] = useSearchParams()
  const cycleId = params.get('donem') ?? current?.id ?? ''
  const cycle = cycles.find((c) => c.id === cycleId)
  // Kapanmış dönemdeki taslaklar silinmez ama artık gönderilemez.
  const closed = cycle?.status === 'Closed'
  const [tab, setTab] = useState<Tab>('mine')
  const [starting, setStarting] = useState(false)

  const reviews = useReviews({ cycleId: cycleId || undefined }, Boolean(cycleId))

  const rows = useMemo(() => {
    const all = reviews.data ?? []
    const list = tab === 'mine' ? all.filter((r) => r.reviewerEmployeeId === me.employeeId) : tab === 'about' ? all.filter((r) => r.employeeId === me.employeeId) : all
    return [...list].sort((a, b) => Number(a.isSubmitted) - Number(b.isSubmitted) || (b.submittedAt ?? b.createdAt ?? '').localeCompare(a.submittedAt ?? a.createdAt ?? ''))
  }, [reviews.data, tab, me.employeeId])

  const mine = (reviews.data ?? []).filter((r) => r.reviewerEmployeeId === me.employeeId)
  const drafts = mine.filter((r) => !r.isSubmitted).length
  const sent = mine.filter((r) => r.isSubmitted).length
  const hasSelf = mine.some((r) => r.type === 'Self')

  if (me.notLinked) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <Panel>
          <EmptyState icon={Lock} title="Hesabınıza bağlı çalışan kaydı bulunamadı" detail="Değerlendirme yazabilmeniz için hesabınızın bir çalışan kaydıyla eşleşmesi gerekiyor. İK yöneticinize başvurun." />
        </Panel>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PerfPageHeader
        eyebrow="Performans"
        title="Değerlendirmeler"
        description="Metrik bazlı değerlendirme: her metrik kendi ölçeğinde puanlanır. Taslak otomatik kaydedilir, istediğiniz zaman kaldığınız yerden devam edersiniz; gönderdiğinizde kilitlenir."
        actions={
          <Button
            onClick={() => setStarting(true)}
            disabled={!me.employeeId || !cycles.some((c) => c.status === 'Open')}
            title={
              !me.employeeId
                ? 'Hesabınıza bağlı bir çalışan kaydı yok; değerlendirme başlatılamaz.'
                : !cycles.some((c) => c.status === 'Open')
                  ? 'Açık bir dönem yok; önce bir dönem açın.'
                  : undefined
            }
          >
            <Plus aria-hidden />
            Yeni değerlendirme
          </Button>
        }
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <CyclePicker className="w-64" cycles={cycles} value={cycleId} onChange={(v) => setParams({ donem: v }, { replace: true })} />
          <dl className="grid max-w-xs grid-cols-2 gap-6">
            <div>
              <dt className="text-[11px] text-muted-foreground">{closed ? 'Gönderilmeyen' : 'Taslaklarım'}</dt>
              <dd className="text-[20px] leading-tight font-semibold">
                <CountUp to={drafts} duration={0.8} />
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">Gönderdiklerim</dt>
              <dd className="text-[20px] leading-tight font-semibold">
                <CountUp to={sent} duration={0.8} delay={0.08} />
              </dd>
            </div>
          </dl>
        </div>
      </PerfPageHeader>

      {cycle?.status === 'Open' && !hasSelf && me.employeeId && !reviews.isPending && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4 flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-[13px]">
            <UserRound className="size-4 text-primary" aria-hidden />
            {cycle.name} için öz değerlendirmenizi henüz başlatmadınız.
          </p>
          <Button size="sm" asChild>
            <Link to={`/panel/performans/degerlendirme/yeni?calisan=${me.employeeId}&donem=${cycle.id}&tur=Self`}>
              Öz değerlendirmeyi başlat
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </motion.div>
      )}

      <div className="mb-3 flex items-center justify-between gap-3">
        <Segmented
          ariaLabel="Liste"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'mine', label: 'Yazdıklarım' },
            { value: 'about', label: 'Hakkımdakiler' },
            ...(manager ? [{ value: 'all' as const, label: 'Tümü' }] : []),
          ]}
        />
      </div>

      {reviews.isError ? (
        <Panel>
          <ErrorState title="Değerlendirmeler alınamadı" message={errorText(reviews.error)} onRetry={() => void reviews.refetch()} />
        </Panel>
      ) : reviews.isPending || me.isPending ? (
        <Panel aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-0">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-7 w-24" />
            </div>
          ))}
        </Panel>
      ) : rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon={ClipboardList}
            title={tab === 'about' ? 'Bu dönemde hakkınızda değerlendirme yok' : 'Bu dönemde değerlendirmeniz yok'}
            detail={tab === 'about' ? 'Yöneticiniz ya da ekip arkadaşlarınız değerlendirme başlattığında burada görünür.' : 'Yeni değerlendirme başlatın; metrikler çalışanın departmanına göre otomatik gelir.'}
            action={
              tab !== 'about' && cycle?.status === 'Open' ? (
                <Button
                  onClick={() => setStarting(true)}
                  disabled={!me.employeeId}
                  title={
                    !me.employeeId
                      ? 'Hesabınıza bağlı bir çalışan kaydı yok; değerlendirme başlatılamaz.'
                      : undefined
                  }
                >
                  <Plus aria-hidden />
                  Yeni değerlendirme
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <Panel>
          <ul className="divide-y divide-border">
            <AnimatePresence initial={false}>
              {rows.map((r, i) => (
                <ReviewRow key={r.id} review={r} index={i} tab={tab} me={me.employeeId} nameOf={people.nameOf} closed={closed} />
              ))}
            </AnimatePresence>
          </ul>
        </Panel>
      )}

      {starting && me.employeeId && <StartReviewDialog cycles={cycles} defaultCycleId={cycleId} me={me.employeeId} manager={manager} onClose={() => setStarting(false)} />}
    </div>
  )
}

function ReviewRow({
  review: r,
  index,
  tab,
  me,
  nameOf,
  closed,
}: {
  review: Review
  index: number
  tab: Tab
  me?: string
  nameOf: (id: string | null | undefined) => string
  closed: boolean
}) {
  const expired = closed && !r.isSubmitted
  const iAmReviewer = r.reviewerEmployeeId === me
  const subject = r.type === 'Self' ? 'Öz değerlendirme' : nameOf(r.employeeId)
  const hiddenAuthor = tab === 'about' && ANONYMOUS.includes(r.type) && !iAmReviewer
  const author = hiddenAuthor ? (r.type === 'Peer' ? 'Bir ekip arkadaşı' : 'Ekibinden biri') : nameOf(r.reviewerEmployeeId)
  const avatarId = tab === 'about' ? (hiddenAuthor ? `anon-${r.id}` : (r.reviewerEmployeeId ?? r.id)) : r.employeeId
  const avatarName = tab === 'about' ? author : subject

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: EASE, delay: Math.min(index, 10) * 0.04 }}
      className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <PersonAvatar id={avatarId} name={avatarName} size="md" />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-[14px] font-medium">
            {tab === 'about' ? author : subject}
            <Chip>{reviewTypeLabels[r.type]}</Chip>
          </p>
          <p className="text-[12px] text-muted-foreground">
            {tab === 'all' ? `${nameOf(r.reviewerEmployeeId)} → ${nameOf(r.employeeId)} · ` : ''}
            {r.isSubmitted ? `Gönderildi · ${formatDateTime(r.submittedAt)}` : `Başlatıldı · ${formatDate(r.createdAt ?? null)}`}          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:justify-end">
        {r.isSubmitted ? (
          <Chip tone="success">
            <Lock className="size-3" aria-hidden />
            Gönderildi
          </Chip>
        ) : expired ? (
          <Chip>Gönderilmedi · dönem kapandı</Chip>
        ) : (
          <Chip tone="warning">
            <span className="size-1.5 animate-pulse rounded-full bg-[hsl(var(--warning))]" />
            Taslak
          </Chip>
        )}
        {iAmReviewer || tab === 'all' ? (
          <Button asChild size="sm" variant={r.isSubmitted || expired ? 'ghost' : 'default'} className={cn(!r.isSubmitted && !expired && 'shadow-sm')}>
            <Link to={`/panel/performans/degerlendirme/${r.id}`}>
              {r.isSubmitted || expired ? 'Görüntüle' : (
                <>
                  <FilePen aria-hidden />
                  Devam et
                </>
              )}
            </Link>
          </Button>
        ) : null}
      </div>
    </motion.li>
  )
}
