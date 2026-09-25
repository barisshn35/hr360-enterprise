/**
 * Organizasyon şeması — departman ağacı + içindeki çalışanlar, sürükle-bırak
 * ile departman değişikliği.
 *
 * - Hiyerarşi departman seviyesinde: kutular `parentDepartmentId` zincirine
 *   göre yukarıdan aşağı dizilir, aralarında bağlantı çizgileri. Çalışanlar
 *   yalnızca kendi departman kutusunun İÇİNDE durur; alt departmanlar ayrı
 *   dal olarak altta — ikisi görsel olarak karışmaz.
 * - Sürükle-bırak native HTML5 olayları ile (projede DnD kütüphanesi yok).
 *   Bırakınca `POST /employees/{id}/assignments` çağrılır; iyimser güncelleme,
 *   hatada geri alma. Dokunmatik ekran ve klavye için her kartta "Taşı"
 *   düğmesi aynı işi bir diyalogla yapar.
 * - Büyük organizasyon: kalabalık şirkette departmanlar özet (kapalı) açılır,
 *   kutu başına en fazla 8 kart görünür; yakınlaştır/uzaklaştır, boş alanı
 *   tutup kaydırma, arama ile kişiyi bulup açma.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRightLeft,
  Building2,
  ChevronDown,
  ChevronUp,
  Crown,
  GitFork,
  LoaderCircle,
  Maximize2,
  Minus,
  Plus,
  Search,
  TriangleAlert,
  UserRoundX,
  X,
} from 'lucide-react'
import { ApiError } from '@/api/client'
import { useQueryClient } from '@tanstack/react-query'
import { qk, useAddAssignment, useDepartmentList, useEmployees } from '@/api/queries'
import type { CreateAssignmentInput, Department } from '@/api/types'
import { useDirectory } from '@/api/directory'
import { useAuth } from '@/auth/useAuth'
import { Panel } from '@/components/ui/Panel'
import { ErrorState, InfoNote, RowsSkeleton, EmptyState } from '@/components/ui/States'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import { formatDate, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { AvatarStack, PersonAvatar } from '@/features/performance/components/people'
import { errorText } from '@/features/performance/components/controls'
import { MoveEmployeeModal } from './MoveEmployeeModal'
import { activeAssignment, ancestorsOf, buildChart, type ChartDept, type ChartModel, type ChartPerson } from './orgChartModel'
import './orgchart.css'

/** Kutu başına ilk açılışta görünen kart sayısı. */
const CARD_LIMIT = 8
/** Bu sayıyı aşan şirkette departmanlar kapalı (özet) açılır. */
const OPEN_ALL_UNDER = 60

const DEPT_COLORS = ['--chart-2', '--chart-3', '--chart-5', '--chart-4', '--chart-1']
const deptColor = (i: number) => `hsl(var(${DEPT_COLORS[i % DEPT_COLORS.length]}))`

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const norm = (s: string) => s.toLocaleLowerCase('tr-TR')

/* ------------------------------------ Bağlam ------------------------------------ */

interface DragState {
  employeeId: string
  fromDeptId: string | null
}

interface ChartCtx {
  model: ChartModel
  /** Çalışan listesi okunabiliyor mu (yönetici ve üstü). Değilse kutular yalnızca departmanı gösterir. */
  peopleKnown: boolean
  canMove: boolean
  drag: DragState | null
  setDrag: (d: DragState | null) => void
  overId: string | null
  setOverId: (id: string | null) => void
  dropOn: (deptId: string) => void
  openMove: (employeeId: string) => void
  pending: Set<string>
  highlight: Set<string>
  nameOf: (id: string) => string
  isOpen: (deptId: string) => boolean
  toggleOpen: (deptId: string) => void
  showAll: Set<string>
  toggleShowAll: (deptId: string) => void
  kidsHidden: Set<string>
  toggleKids: (deptId: string) => void
}

const Ctx = createContext<ChartCtx | null>(null)
const useChart = () => useContext(Ctx)!

/* ------------------------------------- Kart ------------------------------------- */

function PersonCard({ person, deptId, isHead }: { person: ChartPerson; deptId: string | null; isHead: boolean }) {
  const { canMove, drag, setDrag, setOverId, openMove, pending, highlight } = useChart()
  const busy = pending.has(person.id)
  const lifted = drag?.employeeId === person.id
  const draggable = canMove && !busy

  const onDragStart = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', person.id)
    setDrag({ employeeId: person.id, fromDeptId: deptId })
  }

  return (
    <div
      id={`org-emp-${person.id}`}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={() => {
        setDrag(null)
        setOverId(null)
      }}
      className={cn(
        'group/card relative flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-[opacity,box-shadow]',
        isHead
          ? 'border-[hsl(var(--warning))]/55 bg-[hsl(var(--warning))]/8'
          : 'border-border bg-background',
        draggable && 'cursor-grab active:cursor-grabbing',
        lifted && 'opacity-40',
        busy && 'opacity-70',
        highlight.has(person.id) && 'ring-2 ring-primary',
      )}
    >
      <PersonAvatar id={person.id} name={person.name} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <Link
            to={`/panel/calisanlar/${person.id}`}
            draggable={false}
            className="truncate text-[12px] font-medium hover:underline"
          >
            {person.name}
          </Link>
          {isHead && <Crown aria-label="Departman başı" className="size-3.5 shrink-0 text-[hsl(var(--warning))]" />}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {isHead ? 'Departman başı' : (person.title ?? 'Unvan yok')}
          {isHead && person.title ? ` · ${person.title}` : ''}
          {person.future && person.since ? ` · ${formatDate(person.since)} itibarıyla` : ''}
        </span>
      </span>
      {busy ? (
        <LoaderCircle aria-label="Kaydediliyor" className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        canMove && (
          <button
            type="button"
            onClick={() => openMove(person.id)}
            aria-label={`${person.name} için departman değiştir`}
            title="Başka departmana taşı"
            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover/card:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <ArrowRightLeft className="size-3.5" />
          </button>
        )
      )}
    </div>
  )
}

/* ------------------------------------- Kutu ------------------------------------- */

function DeptBox({ node }: { node: ChartDept }) {
  const c = useChart()
  const { dept, members, children } = node
  const open = c.isOpen(dept.id)
  const all = c.showAll.has(dept.id)
  const kidsHidden = c.kidsHidden.has(dept.id)
  const headId = dept.headEmployeeId ?? null
  const headIsMember = Boolean(headId && members.some((m) => m.id === headId))

  const droppable = Boolean(c.canMove && c.drag && c.drag.fromDeptId !== dept.id)
  const over = droppable && c.overId === dept.id
  const visible = all ? members : members.slice(0, CARD_LIMIT)
  const rest = members.length - visible.length

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!droppable) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (c.overId !== dept.id) c.setOverId(dept.id)
  }
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) c.setOverId(null)
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    c.setOverId(null)
    if (droppable) c.dropOn(dept.id)
  }

  return (
    <div
      data-dept={dept.id}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      aria-dropeffect={droppable ? 'move' : undefined}
      className={cn(
        'relative w-64 overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-[border-color,box-shadow,background-color] duration-150',
        over
          ? 'border-primary bg-primary/5 shadow-md ring-4 ring-primary/20'
          : droppable
            ? 'border-dashed border-primary/45'
            : 'border-border',
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: deptColor(node.colorIndex) }} />

      <div className="flex items-start gap-1 border-b border-border py-2 pr-1.5 pl-3.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold" title={dept.name}>
            {dept.name}
          </p>
          <p className="tabular text-[11px] text-muted-foreground">
            {c.peopleKnown
              ? `${formatNumber(members.length)} kişi${children.length > 0 ? ` · ${children.length} alt departman · toplam ${formatNumber(node.total)}` : ''}`
              : children.length > 0
                ? `${children.length} alt departman`
                : 'Departman'}
          </p>
        </div>
        {children.length > 0 && (
          <Button
            size="icon-sm"
            variant="ghost"
            className="size-7"
            onClick={() => c.toggleKids(dept.id)}
            aria-expanded={!kidsHidden}
            aria-label={kidsHidden ? `${dept.name} alt departmanlarını göster` : `${dept.name} alt departmanlarını gizle`}
            title={kidsHidden ? 'Alt departmanları göster' : 'Alt departmanları gizle'}
          >
            <GitFork className={cn('size-3.5', kidsHidden && 'text-primary')} />
          </Button>
        )}
        {members.length > 0 && (
          <Button
            size="icon-sm"
            variant="ghost"
            className="size-7"
            onClick={() => c.toggleOpen(dept.id)}
            aria-expanded={open}
            aria-label={open ? `${dept.name} çalışanlarını gizle` : `${dept.name} çalışanlarını göster`}
          >
            {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
        )}
      </div>

      {headId && !headIsMember && (
        <p className="flex items-center gap-1.5 border-b border-border py-1.5 pr-2 pl-3.5 text-[11px] text-muted-foreground">
          <Crown className="size-3.5 shrink-0 text-[hsl(var(--warning))]" aria-hidden />
          <span className="truncate">
            Başı: <span className="font-medium text-foreground">{c.nameOf(headId)}</span>
            {c.peopleKnown && ' (başka departmanda kayıtlı)'}
          </span>
        </p>
      )}

      {!c.peopleKnown ? null : members.length === 0 ? (
        <p className="py-2.5 pr-2 pl-3.5 text-[12px] text-muted-foreground">
          {over ? 'Bırakın, buraya atansın.' : 'Bu departmanda çalışan yok.'}
        </p>
      ) : open ? (
        <div className="space-y-1 p-2 pl-3">
          {visible.map((p) => (
            <PersonCard key={p.id} person={p} deptId={dept.id} isHead={p.id === headId} />
          ))}
          {(rest > 0 || all) && members.length > CARD_LIMIT && (
            <button
              type="button"
              onClick={() => c.toggleShowAll(dept.id)}
              className="w-full rounded-md py-1 text-[12px] font-medium text-primary hover:bg-primary/5"
            >
              {all ? 'Daha az göster' : `+${formatNumber(rest)} kişi daha`}
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => c.toggleOpen(dept.id)}
          className="flex w-full items-center gap-2 py-2 pr-2 pl-3.5 text-left hover:bg-muted/50"
        >
          <AvatarStack people={members} max={5} />
          <span className="text-[12px] text-muted-foreground">Çalışanları göster</span>
        </button>
      )}

      {over && (
        <p className="border-t border-primary/30 bg-primary/10 py-1.5 pr-2 pl-3.5 text-[11px] font-medium text-primary">
          Bırakınca {c.nameOf(c.drag!.employeeId)} bu departmana atanır
        </p>
      )}
    </div>
  )
}

function Branch({ node }: { node: ChartDept }) {
  const { kidsHidden } = useChart()
  return (
    <li>
      <DeptBox node={node} />
      {node.children.length > 0 && !kidsHidden.has(node.dept.id) && (
        <ul>
          {node.children.map((c) => (
            <Branch key={c.dept.id} node={c} />
          ))}
        </ul>
      )}
    </li>
  )
}

/* ------------------------------------- Şema ------------------------------------- */

export function OrgChart({ companyId, companyName }: { companyId: string; companyName: string }) {
  const { can } = useAuth()
  const toast = useToast()
  const canSeePeople = can('employee:viewAll')
  // Backend ucu RequireHrAdmin; bu projede employee:manage yalnızca hr-admin ve üstünde.
  const canMove = can('employee:manage')

  const departments = useDepartmentList(companyId)
  const employees = useEmployees({ enabled: canSeePeople })
  const directory = useDirectory()
  const move = useAddAssignment()
  const qc = useQueryClient()

  const today = todayIso()
  const model = useMemo(
    () => buildChart(departments.data ?? [], employees.data ?? [], today),
    [departments.data, employees.data, today],
  )

  const nameOf = useMemo(() => {
    const names = new Map<string, string>()
    for (const d of directory.data ?? []) names.set(d.id, d.fullName || `${d.firstName} ${d.lastName}`.trim())
    for (const e of employees.data ?? []) names.set(e.id, `${e.firstName} ${e.lastName}`.trim())
    return (id: string) => names.get(id) ?? 'Bilinmeyen çalışan'
  }, [directory.data, employees.data])

  const pathOf = (deptId: string) =>
    ancestorsOf(model, deptId)
      .map((id) => model.byId.get(id)?.dept.name ?? '')
      .join(' › ')

  /* ------------------------------- görünüm durumu ------------------------------- */
  const personCount = model.deptOf.size
  const [openSet, setOpenSet] = useState<Set<string> | null>(null)
  const defaultOpen = personCount <= OPEN_ALL_UNDER
  const isOpen = (id: string) => (openSet ? openSet.has(id) : defaultOpen)
  const toggleOpen = (id: string) =>
    setOpenSet((prev) => {
      const base = prev ?? new Set(defaultOpen ? model.byId.keys() : [])
      const next = new Set(base)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const [showAll, setShowAll] = useState<Set<string>>(new Set())
  const toggleShowAll = (id: string) =>
    setShowAll((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const [kidsHidden, setKidsHidden] = useState<Set<string>>(new Set())
  const toggleKids = (id: string) =>
    setKidsHidden((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const [drag, setDrag] = useState<DragState | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [moving, setMoving] = useState<string | null>(null)

  /* ------------------------------------ taşıma ------------------------------------ */
  const currentActive = (employeeId: string) => {
    const e = employees.data?.find((x) => x.id === employeeId)
    return e ? activeAssignment(e) : null
  }
  const currentTitle = (employeeId: string) => currentActive(employeeId)?.positionTitle ?? null

  const performMove = (employeeId: string, input: CreateAssignmentInput) => {
    const fromId = model.deptOf.get(employeeId) ?? null
    if (fromId === input.departmentId) return
    const name = nameOf(employeeId)
    const toName = model.byId.get(input.departmentId)?.dept.name ?? 'yeni'
    const wasHeadOf = fromId && model.byId.get(fromId)?.dept.headEmployeeId === employeeId ? model.byId.get(fromId)!.dept : null

    setPending((s) => new Set(s).add(employeeId))
    // Hedef kutu kapalıysa açılsın: kişi taşındığı yerde hemen görünsün.
    if (!isOpen(input.departmentId)) toggleOpen(input.departmentId)
    move.mutate(
      { employeeId, input },
      {
        onSuccess: () => {
          toast.ok(`${name} artık ${toName} departmanında.`)
          // Backend eski departmanın başını kendisi temizler (best-effort). Departmanlar bu noktada
          // yeniden çekilmiş olur; uyarı yalnızca temizleme gerçekleşmediyse çıkar.
          if (wasHeadOf) {
            const fresh = qc.getQueryData<Department[]>(qk.departments(companyId))
            if (fresh?.find((d) => d.id === wasHeadOf.id)?.headEmployeeId === employeeId) {
              toast.info(`${name} hâlâ ${wasHeadOf.name} departmanının başı olarak kayıtlı. Departman başını ayrıca güncelleyin.`)
            }
          }
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 403) {
            toast.stop('Departman değiştirme yetkiniz yok. Bu işlemi yalnızca İK yöneticisi yapabilir; değişiklik geri alındı.')
          } else {
            toast.stop(`${name} taşınamadı, eski departmanına geri alındı. ${errorText(error)}`)
          }
        },
        onSettled: () =>
          setPending((s) => {
            const n = new Set(s)
            n.delete(employeeId)
            return n
          }),
      },
    )
  }

  const dropOn = (deptId: string) => {
    if (!drag) return
    const { employeeId } = drag
    setDrag(null)
    // Bugünden itibaren; kişinin ileri tarihli bir ataması varsa o tarih (aynı gün → backend günceller,
    // geriye dönük tarih 400 alırdı).
    const activeFrom = currentActive(employeeId)?.effectiveFrom.slice(0, 10)
    const effectiveFrom = activeFrom && activeFrom > today ? activeFrom : today
    performMove(employeeId, { departmentId: deptId, positionTitle: currentTitle(employeeId) ?? undefined, effectiveFrom })
  }

  /* ------------------------------------ arama ------------------------------------ */
  const [query, setQuery] = useState('')
  const q = norm(query.trim())
  const highlight = useMemo(() => {
    if (q.length < 2) return new Set<string>()
    const hits = new Set<string>()
    for (const node of model.byId.values()) for (const p of node.members) if (norm(p.name).includes(q)) hits.add(p.id)
    for (const p of model.unassigned) if (norm(p.name).includes(q)) hits.add(p.id)
    return hits
  }, [q, model])

  // İlk eşleşmeyi görünür yap: atalarının dalları ve kendi kutusu açılsın, ekrana kaydırılsın.
  const firstHit = highlight.values().next().value as string | undefined
  useEffect(() => {
    if (!firstHit) return
    const deptId = model.deptOf.get(firstHit)
    if (deptId) {
      const chain = ancestorsOf(model, deptId)
      setKidsHidden((s) => {
        if (!chain.some((id) => s.has(id))) return s
        const n = new Set(s)
        chain.forEach((id) => n.delete(id))
        return n
      })
      setOpenSet((prev) => {
        if (prev === null && defaultOpen) return prev
        const n = new Set(prev ?? (defaultOpen ? model.byId.keys() : []))
        n.add(deptId)
        return n
      })
      const node = model.byId.get(deptId)
      if (node && node.members.findIndex((m) => m.id === firstHit) >= CARD_LIMIT) setShowAll((s) => new Set(s).add(deptId))
    }
    const t = window.setTimeout(() => {
      document.getElementById(`org-emp-${firstHit}`)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    }, 80)
    return () => window.clearTimeout(t)
    // Yalnızca aranan kişi değişince çalışır; sonrasında açma/kapama kullanıcıya kalır.
  }, [firstHit])

  /* ------------------------------ yakınlaştır / kaydır ------------------------------ */
  const [zoom, setZoom] = useState(1)
  const viewport = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)

  const fit = () => {
    const vp = viewport.current
    const cv = canvas.current
    if (!vp || !cv) return
    const natural = cv.scrollWidth
    setZoom(Math.max(0.4, Math.min(1, +((vp.clientWidth - 32) / natural).toFixed(2))))
  }

  // İlk açılışta şema ekrandan genişse bir kez sığdır; en fazla %60'a kadar küçült ki kartlar okunur kalsın.
  const fitted = useRef(false)
  // Tuval ancak tüm veri gelince çizilir; ölçüm ondan önce yapılırsa boşa gider.
  const ready = model.roots.length > 0 && !departments.isPending && !(canSeePeople && employees.isPending)
  useEffect(() => {
    if (fitted.current || !ready) return
    const t = window.setTimeout(() => {
      const vp = viewport.current
      const cv = canvas.current
      if (!vp || !cv) return
      fitted.current = true
      const ratio = (vp.clientWidth - 32) / cv.scrollWidth
      if (ratio < 1) setZoom(Math.max(0.6, +ratio.toFixed(2)))
      // Yakınlaştırma uygulandıktan sonra şirket düğümü (üst orta) görünür olsun.
      window.requestAnimationFrame(() => {
        vp.scrollLeft = Math.max(0, (vp.scrollWidth - vp.clientWidth) / 2)
      })
    }, 60)
    return () => window.clearTimeout(t)
  }, [ready])

  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Yalnızca boş alandan tutunca kaydır; kart ve düğmeler kendi işini yapsın.
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-dept],button,a,input,[draggable="true"]')) return
    const vp = viewport.current!
    pan.current = { x: e.clientX, y: e.clientY, left: vp.scrollLeft, top: vp.scrollTop }
    vp.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pan.current) return
    const vp = viewport.current!
    vp.scrollLeft = pan.current.left - (e.clientX - pan.current.x)
    vp.scrollTop = pan.current.top - (e.clientY - pan.current.y)
  }
  const endPan = () => {
    pan.current = null
  }

  /** Sürüklerken kenara yaklaşınca tuval kendiliğinden kaysın. */
  const onViewportDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!drag) return
    const vp = viewport.current!
    const r = vp.getBoundingClientRect()
    const edge = 48
    const step = 18
    if (e.clientX < r.left + edge) vp.scrollLeft -= step
    else if (e.clientX > r.right - edge) vp.scrollLeft += step
    if (e.clientY < r.top + edge) vp.scrollTop -= step
    else if (e.clientY > r.bottom - edge) vp.scrollTop += step
  }

  /* ------------------------------------ çizim ------------------------------------ */

  if (departments.isPending || (canSeePeople && employees.isPending)) {
    return (
      <Panel>
        <RowsSkeleton rows={6} columns={4} />
      </Panel>
    )
  }
  if (departments.isError) {
    return (
      <Panel>
        <ErrorState message={errorText(departments.error)} onRetry={() => void departments.refetch()} />
      </Panel>
    )
  }
  if (model.roots.length === 0) {
    return (
      <Panel>
        <EmptyState icon={Building2} title="Henüz departman yok" detail="Şemayı görmek için önce bir departman ekleyin." />
      </Panel>
    )
  }

  const ctx: ChartCtx = {
    model,
    peopleKnown: canSeePeople,
    canMove,
    drag,
    setDrag,
    overId,
    setOverId,
    dropOn,
    openMove: setMoving,
    pending,
    highlight,
    nameOf,
    isOpen,
    toggleOpen,
    showAll,
    toggleShowAll,
    kidsHidden,
    toggleKids,
  }

  const movingPerson = moving
    ? ([...model.byId.values()].flatMap((n) => n.members).find((p) => p.id === moving) ??
      model.unassigned.find((p) => p.id === moving))
    : undefined

  return (
    <Ctx.Provider value={ctx}>
      <div className="space-y-3">
        {!canSeePeople ? (
          <InfoNote>Şema yalnızca departmanları gösteriyor. Çalışanları görmek için yönetici yetkisi gerekir.</InfoNote>
        ) : canMove ? (
          <InfoNote>
            Bir çalışan kartını tutup başka bir departman kutusuna bırakın; atama bugünden itibaren değişir. Tarih ya
            da unvan değiştirmek, klavye veya dokunmatik ekranla taşımak için kartın üzerindeki{' '}
            <ArrowRightLeft className="inline size-3.5 align-[-2px]" aria-label="taşı" /> düğmesini kullanın.
          </InfoNote>
        ) : (
          <InfoNote>Departman değişikliğini yalnızca İK yöneticisi yapabilir; şema sizin için salt okunur.</InfoNote>
        )}

        {model.cycleCount > 0 && (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-[hsl(var(--warning))]/35 bg-[hsl(var(--warning))]/8 px-3 py-2 text-[13px]">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[hsl(var(--warning))]" aria-hidden />
            {model.cycleCount} departmanın üst departman zinciri kendi içinde döngüye giriyor; bu departmanlar kök
            seviyede gösterildi. Üst departman bilgisini düzeltmek gerekir.
          </p>
        )}

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {/* Araç çubuğu */}
          <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
            {canSeePeople ? (
              <div className="flex items-center gap-2">
                <label className="relative block w-full sm:w-72">
                  <span className="sr-only">Çalışan ara</span>
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Çalışan ara"
                    className="h-9 w-full rounded-md border border-input bg-background pr-8 pl-9 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      aria-label="Aramayı temizle"
                      className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </label>
                {q.length >= 2 && (
                  <span className="shrink-0 text-[12px] text-muted-foreground" aria-live="polite">
                    {highlight.size ? `${highlight.size} eşleşme` : 'Eşleşme yok'}
                  </span>
                )}
              </div>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className="tabular text-[12px] text-muted-foreground">
                {formatNumber(model.byId.size)} departman
                {canSeePeople && ` · ${formatNumber(personCount)} kişi`}
              </span>
              {canSeePeople && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setOpenSet(new Set(model.byId.keys()))}>
                    Tümünü aç
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setOpenSet(new Set())}>
                    Özet
                  </Button>
                </>
              )}
              <div className="flex items-center rounded-md border border-border">
                <Button size="icon-sm" variant="ghost" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))} aria-label="Uzaklaştır">
                  <Minus aria-hidden />
                </Button>
                <span className="tabular w-11 text-center text-[12px] font-medium">%{Math.round(zoom * 100)}</span>
                <Button size="icon-sm" variant="ghost" onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(2)))} aria-label="Yakınlaştır">
                  <Plus aria-hidden />
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={fit} aria-label="Ekrana sığdır" title="Ekrana sığdır">
                  <Maximize2 aria-hidden />
                </Button>
              </div>
            </div>
          </div>

          {/* Tuval */}
          <div
            ref={viewport}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            onDragOver={onViewportDragOver}
            className="relative max-h-[72vh] min-h-[420px] cursor-grab overflow-auto bg-[radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:18px_18px] active:cursor-grabbing"
          >
            <div ref={canvas} className="dept-chart w-max min-w-full p-6" style={{ zoom }}>
              <div className="flex flex-col items-center">
                <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 shadow-sm">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Building2 className="size-4" aria-hidden />
                  </span>
                  <span>
                    <span className="block text-[14px] font-semibold">{companyName}</span>
                    <span className="tabular block text-[11px] text-muted-foreground">
                      {model.roots.length} kök departman
                    </span>
                  </span>
                </div>
                <ul className="dept-root">
                  {model.roots.map((r) => (
                    <Branch key={r.dept.id} node={r} />
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        {canSeePeople && model.unassigned.length > 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
              <UserRoundX className="size-4 text-muted-foreground" aria-hidden />
              Atanmamış
              <span className="tabular font-normal text-muted-foreground">{model.unassigned.length}</span>
            </p>
            <p className="mb-2.5 text-[12px] text-muted-foreground">
              Aktif departman ataması olmayan çalışanlar{canMove ? '. Bir departman kutusuna sürükleyerek atayabilirsiniz.' : '.'}
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
              {model.unassigned.map((p) => (
                <PersonCard key={p.id} person={p} deptId={null} isHead={false} />
              ))}
            </div>
          </div>
        )}
      </div>

      {moving && movingPerson && (
        <MoveEmployeeModal
          name={movingPerson.name}
          currentDeptId={model.deptOf.get(moving) ?? null}
          currentTitle={currentTitle(moving)}
          currentFrom={currentActive(moving)?.effectiveFrom.slice(0, 10) ?? null}
          options={[...model.byId.keys()].map((id) => ({ value: id, label: pathOf(id) })).sort((a, b) => a.label.localeCompare(b.label, 'tr-TR'))}
          defaultDate={today}
          onClose={() => setMoving(null)}
          onSubmit={(input) => {
            performMove(moving, input)
            setMoving(null)
          }}
        />
      )}
    </Ctx.Provider>
  )
}
