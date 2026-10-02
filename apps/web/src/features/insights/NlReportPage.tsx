import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Code2, CornerDownLeft, Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { InfoNote } from '@/components/ui/States'
import { governanceApi, type NlReport } from '@/api/governance'
import { ShinyText } from '@/components/fx/shiny-text'
import { PlanGate, errMsg } from '@/features/shared/kit'

const TT = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }

function ReportView({ r }: { r: NlReport }) {
  const [showSql, setShowSql] = useState(false)
  const data = r.rows.map((row) => ({ k: String(row[0] ?? '—'), v: Number(row[1] ?? 0) }))
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <p className="text-[15px] font-semibold">{r.interpretation}</p>
      {!r.understood ? null : r.chart === 'number' || data.length === 1 ? (
        <motion.p initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="tabular text-[56px] font-semibold tracking-tight text-primary">{data[0]?.v.toLocaleString('tr-TR') ?? 0}</motion.p>
      ) : data.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Bu aralıkta kayıt yok.</p>
      ) : (
        <div className="h-72">
          <ResponsiveContainer>
            {r.chart === 'line' ? (
              <LineChart data={data}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="k" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis fontSize={11} width={36} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={TT} />
                <Line dataKey="v" name={r.columns[1]} stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} animationDuration={1200} />
              </LineChart>
            ) : (
              <BarChart data={data}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="k" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis fontSize={11} width={36} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={TT} cursor={{ fill: 'hsl(var(--muted)/0.4)' }} />
                <Bar dataKey="v" name={r.columns[1]} fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} animationDuration={900} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
      {r.understood && data.length > 0 && (
        <table className="w-full max-w-lg text-[13px]">
          <thead><tr className="text-left text-muted-foreground">{r.columns.map((c) => <th key={c} className="py-1.5 font-medium">{c}</th>)}</tr></thead>
          <tbody>{r.rows.map((row, i) => <tr key={i} className="border-t border-border">{row.map((c, j) => <td key={j} className="tabular py-1.5">{c ?? '—'}</td>)}</tr>)}</tbody>
        </table>
      )}
      {r.understood && (
        <div>
          <button onClick={() => setShowSql((s) => !s)} className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"><Code2 className="size-3.5" /> {showSql ? 'Sorguyu gizle' : 'Çalıştırılan sorgu'}</button>
          {showSql && <pre className="mt-2 overflow-x-auto rounded-xl bg-muted/50 p-3 font-mono text-[11.5px] whitespace-pre-wrap">{r.sql}</pre>}
        </div>
      )}
    </motion.div>
  )
}

export function NlReportPage() {
  const ex = useQuery({ queryKey: ['nl-examples'], queryFn: ({ signal }) => governanceApi.examples(signal), staleTime: Infinity })
  const [q, setQ] = useState('')
  const [history, setHistory] = useState<Array<{ q: string; r?: NlReport; err?: string }>>([])
  const [busy, setBusy] = useState(false)
  const ask = async (question: string) => {
    if (!question.trim()) return
    setBusy(true)
    setQ('')
    try {
      const r = await governanceApi.report(question)
      setHistory((h) => [{ q: question, r }, ...h].slice(0, 8))
    } catch (e) {
      setHistory((h) => [{ q: question, err: errMsg(e) }, ...h])
    } finally {
      setBusy(false)
    }
  }
  return (
    <PlanGate feature="nl-report">
      <PageHeader title="Rapor asistanı" description="Türkçe sorun; tablo ve grafik gelsin. Rapor yazmak için SQL bilmeye gerek yok." />
      <div className="mb-5"><InfoNote><Sparkles className="mr-1 inline size-3.5" /> Kural tabanlı ayrıştırıcıdır (dil modeli değil): soruyu ölçüt + kırılım + zaman aralığına çevirir, hazır ve güvenli sorgu şablonlarından birini çalıştırır. Nasıl anladığını ve çalıştırdığı sorguyu her zaman gösterir.</InfoNote></div>
      <form onSubmit={(e) => { e.preventDefault(); void ask(q) }} className="surface relative mb-4 flex items-center gap-2 rounded-2xl border border-border p-2 shadow-[0_0_0_1px_hsl(var(--primary)/0.08),0_20px_60px_-30px_hsl(var(--primary)/0.4)]">
        <Sparkles className="ml-2 size-5 text-primary" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Örn. son 6 ayda departmanlara göre izin günleri" className="h-11 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground" autoFocus />
        <Button type="submit" disabled={busy || !q.trim()}>{busy ? <ShinyText>Hesaplanıyor…</ShinyText> : <><CornerDownLeft className="size-4" /> Sor</>}</Button>
      </form>
      <div className="mb-6 flex flex-wrap gap-1.5">
        {ex.data?.map((e) => <button key={e} onClick={() => void ask(e)} className="cursor-pointer rounded-full border border-border bg-card/50 px-3 py-1 text-[12.5px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground">{e}</button>)}
      </div>
      <div className="space-y-5">
        <AnimatePresence initial={false}>
          {history.map((h, i) => (
            <motion.div key={`${h.q}-${history.length - i}`} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <Panel>
                <PanelHead title={<span className="text-muted-foreground">“{h.q}”</span>} />
                <PanelBody>{h.err ? <p className="text-[13px] text-destructive">{h.err}</p> : h.r && <ReportView r={h.r} />}</PanelBody>
              </Panel>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </PlanGate>
  )
}
