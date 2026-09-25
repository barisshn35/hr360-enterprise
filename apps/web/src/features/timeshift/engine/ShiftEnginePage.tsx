import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { Tabs, useTabParam } from '@/components/ui/Tabs'
import { useShiftPatterns, useShiftTeams } from '@/api/queries-shift-engine'
import { PatternsView } from './PatternsView'
import { RosterView } from './RosterView'
import { TeamsView } from './TeamsView'

type Tab = 'takvim' | 'ekipler' | 'desenler'

/**
 * Vardiya motoru: döngüsel vardiya desenleri, bu desenleri takip eden ekipler
 * ve ekiplerin hesaplanmış takvimi.
 *
 * Mevcut Puantaj akışının (sabit vardiya + elle atama) yerine geçmez, yanına
 * eklenir: hiç desen tanımlamayan şirket bu sayfayı kullanmak zorunda değil.
 */
export function ShiftEnginePage() {
  const [tab, setTab] = useTabParam<Tab>('sekme', 'takvim')
  const [params, setParams] = useSearchParams()
  const teamId = params.get('ekip')
  const teams = useShiftTeams()
  const patterns = useShiftPatterns()

  const selectTeam = (id: string, nextTab?: Tab) => {
    const next = new URLSearchParams(params)
    next.set('ekip', id)
    if (nextTab) {
      if (nextTab === 'takvim') next.delete('sekme')
      else next.set('sekme', nextTab)
    }
    setParams(next, { replace: true })
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vardiya planı"
        description="Döngüsel vardiya desenlerini tanımlayın, ekipleri desenin farklı günlerinden başlatarak 7/24 kapsama kurun. Onaylanan izinler takvime kendiliğinden işlenir."
      />

      <Tabs<Tab>
        label="Vardiya planı bölümleri"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'takvim', label: 'Takvim' },
          { key: 'ekipler', label: 'Ekipler', count: teams.data?.length },
          { key: 'desenler', label: 'Desenler', count: patterns.data?.length },
        ]}
      />

      {tab === 'takvim' && <RosterView teamId={teamId} onTeamChange={(id) => selectTeam(id)} />}
      {tab === 'ekipler' && (
        <TeamsView
          selectedId={teamId}
          onSelect={(id) => selectTeam(id)}
          onOpenRoster={(id) => selectTeam(id, 'takvim')}
        />
      )}
      {tab === 'desenler' && <PatternsView />}
    </div>
  )
}
