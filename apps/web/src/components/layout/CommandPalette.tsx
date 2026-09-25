import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Building2, CornerDownLeft, Inbox, User } from 'lucide-react'
import {
  OmniCommandPalette,
  type OmniItem,
  type OmniSource,
} from '@/components/ui/omni-command-palette'
import { employeeApi } from '@/api/employees'
import { organizationApi } from '@/api/organization'
import { workflowApi } from '@/api/workflows'
import { qk } from '@/api/queries'
import { workflowTypeLabels } from '@/api/types'
import { useAuth } from '@/auth/useAuth'
import { navGroups, type NavItemData } from './SidebarNav'

/**
 * ⌘K paleti — dört kaynağı tek arama kutusunda birleştirir:
 * çalışanlar, şirketler, onay talepleri ve modüllere gidiş komutları.
 *
 * Kaynaklar TanStack Query önbelleğinden okunuyor (fetchQuery); palet her
 * açılışta ağa çıkmıyor, listeler zaten sayfalarda çekilmiş oluyor.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { can } = useAuth()

  const sources = useMemo<OmniSource[]>(() => {
    const list: OmniSource[] = []

    /* --- Statik: modüllere gidiş. İzin filtresi sidebar ile birebir aynı. --- */
    const flatten = (items: NavItemData[]): NavItemData[] =>
      items.flatMap((i) => [i, ...(i.children ? flatten(i.children) : [])])

    const goItems: OmniItem[] = navGroups
      .flatMap((g) =>
        g.items
          .filter((i) => !i.permission || can(i.permission))
          .flatMap((i) => (i.children ? flatten([i]) : [i])),
      )
      .filter((i) => Boolean(i.path))
      .map((i) => ({
        id: `go:${i.id}`,
        label: i.title,
        groupId: 'go',
        subtitle: i.path,
        icon: <i.icon className="size-4" strokeWidth={1.5} />,
        keywords: [i.id, i.path ?? ''],
        onAction: () => navigate(i.path!),
      }))

    list.push({
      id: 'go',
      label: 'Git',
      fetch: (q) => {
        const needle = q.toLocaleLowerCase('tr-TR')
        return needle
          ? goItems.filter((i) => i.label.toLocaleLowerCase('tr-TR').includes(needle))
          : goItems
      },
      emptyHint: 'Eşleşen modül yok.',
    })

    /* ------------------------------- Çalışanlar ------------------------------- */
    if (can('employee:viewAll')) {
      list.push({
        id: 'employees',
        label: 'Çalışanlar',
        minQuery: 2,
        emptyHint: 'Eşleşen çalışan yok.',
        fetch: async (q) => {
          const employees = await qc.fetchQuery({
            queryKey: qk.employees,
            queryFn: ({ signal }) => employeeApi.list(signal),
            staleTime: 60_000,
          })
          const needle = q.toLocaleLowerCase('tr-TR')
          return employees
            .filter((e) =>
              `${e.firstName} ${e.lastName} ${e.email}`.toLocaleLowerCase('tr-TR').includes(needle),
            )
            .slice(0, 8)
            .map<OmniItem>((e) => ({
              id: `emp:${e.id}`,
              label: `${e.firstName} ${e.lastName}`,
              groupId: 'employees',
              subtitle: e.email,
              icon: <User className="size-4" strokeWidth={1.5} />,
              onAction: () => navigate(`/panel/calisanlar/${e.id}`),
            }))
        },
      })
    }

    /* -------------------------------- Şirketler ------------------------------- */
    if (can('organization:view')) {
      list.push({
        id: 'companies',
        label: 'Şirketler',
        minQuery: 2,
        emptyHint: 'Eşleşen şirket yok.',
        fetch: async (q) => {
          const companies = await qc.fetchQuery({
            queryKey: qk.companies,
            queryFn: ({ signal }) => organizationApi.listCompanies(signal),
            staleTime: 60_000,
          })
          const needle = q.toLocaleLowerCase('tr-TR')
          return companies
            .filter((c) => c.name.toLocaleLowerCase('tr-TR').includes(needle))
            .slice(0, 6)
            .map<OmniItem>((c) => ({
              id: `co:${c.id}`,
              label: c.name,
              groupId: 'companies',
              subtitle: `${c.departments?.length ?? 0} departman`,
              icon: <Building2 className="size-4" strokeWidth={1.5} />,
              onAction: () => navigate(`/panel/organizasyon/${c.id}`),
            }))
        },
      })
    }

    /* ----------------------------- Onay talepleri ----------------------------- */
    if (can('workflow:view')) {
      list.push({
        id: 'workflows',
        label: 'Onay talepleri',
        minQuery: 2,
        emptyHint: 'Eşleşen talep yok.',
        fetch: async (q) => {
          const workflows = await qc.fetchQuery({
            queryKey: qk.workflows({}),
            queryFn: ({ signal }) => workflowApi.list({}, signal),
            staleTime: 30_000,
          })
          const needle = q.toLocaleLowerCase('tr-TR')
          return workflows
            .filter((w) =>
              `${w.subject ?? ''} ${workflowTypeLabels[w.type]}`
                .toLocaleLowerCase('tr-TR')
                .includes(needle),
            )
            .slice(0, 6)
            .map<OmniItem>((w) => ({
              id: `wf:${w.id}`,
              label: w.subject || workflowTypeLabels[w.type],
              groupId: 'workflows',
              subtitle: workflowTypeLabels[w.type],
              icon: <Inbox className="size-4" strokeWidth={1.5} />,
              onAction: () => navigate(`/panel/onaylar/${w.id}`),
            }))
        },
      })
    }

    return list
  }, [can, navigate, qc])

  return (
    <OmniCommandPalette
      open={open}
      onOpenChange={onOpenChange}
      sources={sources}
      storageKey="hr360.omni.recents"
      placeholder="Çalışan, şirket, talep ara veya bir modüle git…"
      renderFooter={(active) => (
        <div className="flex items-center justify-between px-3 py-2 text-[11px] text-muted-foreground">
          <span>↑ ↓ gezin · Esc kapat</span>
          <span className="flex items-center gap-1">
            <CornerDownLeft className="size-3" />
            {active ? 'aç' : 'seç'}
          </span>
        </div>
      )}
    />
  )
}
