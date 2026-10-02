import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Bot, FileUp, GraduationCap, ScanSearch, Users, Wand2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { EmptyState, InfoNote, RowsSkeleton } from '@/components/ui/States'
import { Tabs, useTabParam } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { aiApi, type BiasResult, type CvResult, type JobDraftInput, type MatchRow } from '@/api/ai'
import { recruitmentApi } from '@/api/recruitment'
import { learningApi } from '@/api/learning'
import { goalsApi, reviewsApi } from '@/api/performance/client'
import { governanceApi } from '@/api/governance'
import { useMyEmployeeId } from '@/api/queries'
import { useAuth } from '@/auth/useAuth'
import { cn } from '@/lib/utils'
import { ChipInput, Metric, PersonSelect, PlanGate, errMsg, useAction } from '@/features/shared/kit'

type TabKey = 'cv' | 'ilan' | 'eslesme' | 'performans' | 'izin' | 'egitim'

const HONEST = 'Bu araçlar dil modeli kullanmaz: sözlük, düzenli ifade, TF-IDF ve istatistik tabanlıdır. Karar vermez, gerekçeli öneri üretir; veriler sunucu dışına çıkmaz.'

/* ------------------------------------------------------------------ CV */
function CvTool() {
  const toast = useToast()
  const [res, setRes] = useState<CvResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const save = useAction(() => {
    const [first, ...rest] = (res!.name ?? 'Aday').split(' ')
    return recruitmentApi.createCandidate({ firstName: first, lastName: rest.join(' ') || '-', email: res!.email ?? '', phone: res!.phone ?? undefined, source: 'CV yükleme' })
  }, { success: 'Aday havuzuna eklendi', invalidate: [['recruitment']] })
  const run = async (f: File) => {
    setBusy(true)
    try { setRes(await aiApi.parseCv(f)) } catch (e) { toast.stop(errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      <label onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void run(f) }}
        className={cn('flex min-h-64 cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed p-6 text-center transition', drag ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40')}>
        <motion.span animate={busy ? { rotate: 360 } : { y: [0, -6, 0] }} transition={busy ? { repeat: Infinity, duration: 1, ease: 'linear' } : { repeat: Infinity, duration: 2.4 }} className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
          {busy ? <ScanSearch className="size-6" /> : <FileUp className="size-6" />}
        </motion.span>
        <p className="text-[14px] font-medium">{busy ? 'Okunuyor…' : 'CV dosyasını bırakın veya seçin'}</p>
        <p className="text-[12px] text-muted-foreground">PDF, DOCX veya TXT · en fazla 5 MB</p>
        <input type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && void run(e.target.files[0])} />
      </label>
      <Panel>
        <PanelHead title="Ayrıştırılan bilgiler" action={res?.email && <Button size="sm" onClick={() => save.mutate(undefined)} disabled={save.isPending}>Aday olarak kaydet</Button>} />
        <PanelBody>
          {!res ? <p className="text-[13px] text-muted-foreground">Bir CV yükleyin; ad, iletişim, beceriler, diller, eğitim ve deneyim süresi çıkarılır.</p> : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <p className="text-[15px] font-semibold">{res.summary}</p>
              <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
                {([['Ad', res.name], ['E-posta', res.email], ['Telefon', res.phone], ['LinkedIn', res.linkedin], ['Konum', res.location], ['Eğitim', res.education], ['Üniversite', res.universities.join(', ')], ['Deneyim', res.experience_years != null ? `${res.experience_years} yıl (${res.experience_basis})` : null], ['Diller', res.languages.join(', ')]] as const).map(([k, v]) => (
                  <div key={k} className="flex gap-2"><dt className="w-24 shrink-0 text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v || '—'}</dd></div>
                ))}
              </dl>
              <div className="flex flex-wrap gap-1.5">{res.skills.map((s, i) => <motion.span key={s} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.03 }} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[12px] text-primary">{s}</motion.span>)}</div>
              {res.warnings.map((w) => <p key={w} className="text-[12px] text-[hsl(var(--warning))]">⚠ {w}</p>)}
            </motion.div>
          )}
        </PanelBody>
      </Panel>
    </div>
  )
}

/* -------------------------------------------------- ilan yazıcı + ayrımcılık */
function Highlighted({ text, bias }: { text: string; bias: BiasResult | null }) {
  if (!bias?.findings.length) return <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{text}</p>
  const parts: React.ReactNode[] = []
  let last = 0
  bias.findings.forEach((f, i) => {
    if (f.start < last) return
    parts.push(text.slice(last, f.start))
    parts.push(<mark key={i} title={`${f.category}: ${f.reason} → ${f.suggestion}`} className={cn('rounded px-0.5', f.severity === 'high' ? 'bg-rose-500/30 text-foreground' : 'bg-amber-400/25 text-foreground')}>{text.slice(f.start, f.end)}</mark>)
    last = f.end
  })
  parts.push(text.slice(last))
  return <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{parts}</p>
}

function JobAdTool() {
  const toast = useToast()
  const [f, setF] = useState<JobDraftInput>({ title: '', department: '', level: 'mid', skills: [], responsibilities: [], location: 'İstanbul', work_model: 'hybrid', employment_type: 'full', benefits: [], tone: 'friendly' })
  const [text, setText] = useState('')
  const [bias, setBias] = useState<BiasResult | null>(null)
  const draft = async () => {
    try { const d = await aiApi.jobDraft(f); setText(d.text); setBias(d.bias) } catch (e) { toast.stop(errMsg(e)) }
  }
  const check = async () => { try { setBias(await aiApi.biasCheck(text)) } catch (e) { toast.stop(errMsg(e)) } }
  return (
    <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
      <Panel>
        <PanelHead title="İlan bilgileri" />
        <PanelBody className="space-y-3">
          <TextField label="Pozisyon" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Örn. Kıdemli Backend Geliştirici" />
          <TextField label="Departman" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Seviye" value={f.level} onChange={(v) => setF({ ...f, level: v as JobDraftInput['level'] })} options={[{ value: 'junior', label: 'Başlangıç' }, { value: 'mid', label: 'Orta' }, { value: 'senior', label: 'Kıdemli' }, { value: 'lead', label: 'Lider' }]} />
            <SelectField label="Çalışma" value={f.work_model} onChange={(v) => setF({ ...f, work_model: v as JobDraftInput['work_model'] })} options={[{ value: 'office', label: 'Ofis' }, { value: 'hybrid', label: 'Hibrit' }, { value: 'remote', label: 'Uzaktan' }]} />
          </div>
          <ChipInput label="Yetkinlikler" value={f.skills} onChange={(v) => setF({ ...f, skills: v })} suggestions={['.NET', 'React', 'SQL', 'İletişim', 'Excel']} />
          <ChipInput label="Yan haklar" value={f.benefits} onChange={(v) => setF({ ...f, benefits: v })} suggestions={['Özel sağlık sigortası', 'Yemek kartı', 'Eğitim bütçesi', 'Esnek saat']} />
          <Button onClick={draft} disabled={!f.title.trim()}><Wand2 className="size-4" /> Taslak oluştur</Button>
        </PanelBody>
      </Panel>
      <div className="space-y-5">
        <Panel>
          <PanelHead title="İlan metni" note="Düzenleyin; kapsayıcılık denetimi ayrımcı ve dışlayıcı ifadeleri işaretler." action={<Button size="sm" variant="outline" onClick={check} disabled={!text.trim()}><ScanSearch className="size-4" /> Denetle</Button>} />
          <PanelBody className="space-y-3">
            <TextAreaField label="" aria-label="İlan metni" rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="Taslak oluşturun ya da kendi ilan metninizi yapıştırıp denetleyin." className="font-mono text-[12.5px]" />
            {bias && (
              <div className="grid gap-4 lg:grid-cols-[160px_1fr]">
                <Metric label="Kapsayıcılık" value={`${bias.score}/100`} tone={bias.score >= 90 ? 'good' : bias.score >= 60 ? 'warn' : 'bad'} hint={bias.verdict} />
                <div className="rounded-2xl border border-border p-3"><Highlighted text={text} bias={bias} /></div>
              </div>
            )}
            <AnimatePresence>
              {bias?.findings.map((x, i) => (
                <motion.div key={`${x.start}-${i}`} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className={cn('rounded-xl border p-3 text-[13px]', x.severity === 'high' ? 'border-rose-500/40 bg-rose-500/5' : 'border-amber-400/40 bg-amber-400/5')}>
                  <p><b>“{x.phrase}”</b> · {x.category}</p>
                  <p className="text-muted-foreground">{x.reason} Öneri: {x.suggestion}.</p>
                </motion.div>
              ))}
            </AnimatePresence>
          </PanelBody>
        </Panel>
      </div>
    </div>
  )
}

/* -------------------------------------------------------- aday–ilan eşleşme */
function MatchTool() {
  const toast = useToast()
  const postings = useQuery({ queryKey: ['recruitment', 'postings', 'all'], queryFn: ({ signal }) => recruitmentApi.listPostings(undefined, signal) })
  const [posting, setPosting] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [cvs, setCvs] = useState<Array<{ id: string; name: string; text: string }>>([])
  const [rows, setRows] = useState<MatchRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const p = postings.data?.find((x) => x.id === posting)
  const addFiles = async (files: FileList) => {
    setBusy(true)
    for (const f of Array.from(files).slice(0, 20)) {
      try {
        const r = await aiApi.parseCv(f)
        setCvs((c) => [...c, { id: `${f.name}-${c.length}`, name: r.name ?? f.name, text: [r.summary, r.skills.join(' '), r.education, r.universities.join(' '), r.languages.join(' ')].join(' ') }])
      } catch (e) { toast.stop(`${f.name}: ${errMsg(e)}`) }
    }
    setBusy(false)
  }
  const run = async () => {
    try { setRows(await aiApi.match({ job_title: p?.title ?? '', job_text: p?.description ?? '', job_skills: skills, candidates: cvs })) } catch (e) { toast.stop(errMsg(e)) }
  }
  return (
    <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
      <Panel>
        <PanelHead title="İlan ve CV'ler" />
        <PanelBody className="space-y-3">
          <SelectField label="İlan" value={posting} onChange={setPosting} options={(postings.data ?? []).map((x) => ({ value: x.id, label: x.title }))} />
          <ChipInput label="Aranan yetkinlikler" value={skills} onChange={setSkills} suggestions={['docker', 'kafka', 'postgresql', 'react', 'ingilizce']} />
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border p-4 text-[13px] text-muted-foreground hover:border-primary/40">
            <FileUp className="size-4" /> {busy ? 'Okunuyor…' : 'CV dosyaları ekle (çoklu)'}
            <input type="file" multiple accept=".pdf,.docx,.txt" className="hidden" onChange={(e) => e.target.files && void addFiles(e.target.files)} />
          </label>
          <ul className="space-y-1 text-[12.5px]">{cvs.map((c) => <li key={c.id} className="truncate">• {c.name}</li>)}</ul>
          <Button onClick={run} disabled={!posting || cvs.length === 0}><Users className="size-4" /> Eşleştir</Button>
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHead title="Sıralama" note="Puan = %60 metin benzerliği (TF-IDF) + %40 yetkinlik kesişimi" />
        <PanelBody className="space-y-2">
          {!rows ? <p className="text-[13px] text-muted-foreground">İlan seçip CV yükleyin.</p> : rows.map((r, i) => (
            <motion.div key={r.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="rounded-xl border border-border p-3">
              <div className="flex items-center gap-3">
                <span className="tabular w-6 text-[15px] font-semibold text-muted-foreground">{i + 1}</span>
                <span className="flex-1 font-medium">{r.name}</span>
                <div className="h-2 w-40 overflow-hidden rounded-full bg-muted"><motion.div initial={{ width: 0 }} animate={{ width: `${r.score}%` }} className="h-full rounded-full bg-primary" /></div>
                <span className="tabular w-10 text-right font-semibold">{r.score}</span>
              </div>
              <p className="mt-1.5 text-[12px] text-muted-foreground">Eşleşen: {r.skill_overlap.join(', ') || '—'} · Eksik: {r.missing_skills.join(', ') || '—'} · Ortak terimler: {r.top_terms.join(', ') || '—'}</p>
            </motion.div>
          ))}
        </PanelBody>
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------- performans özeti */
function PerfTool() {
  const [emp, setEmp] = useState('')
  const summary = useQuery({
    queryKey: ['ai', 'perf', emp],
    enabled: !!emp,
    queryFn: async ({ signal }) => {
      const [reviews, goals] = await Promise.all([reviewsApi.list({ employeeId: emp }, signal), goalsApi.list({ employeeId: emp }, signal)])
      return aiApi.perfSummary({
        name: '',
        goals: goals.map((g) => ({ title: g.title, progress: g.targetValue ? Math.min(100, ((g.currentValue ?? 0) / g.targetValue) * 100) : g.status === 'Achieved' ? 100 : null, weight: g.weight })),
        reviews: reviews.filter((r) => r.isSubmitted).map((r) => ({ type: r.type, strengths: r.strengths, improvements: r.improvements, comments: r.comments })),
        feedback: [],
      })
    },
  })
  const s = summary.data
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <Panel><PanelHead title="Çalışan" /><PanelBody><PersonSelect label="Kimin özeti?" value={emp} onChange={setEmp} /></PanelBody></Panel>
      <Panel>
        <PanelHead title="Dönem özeti" note={s?.method} />
        <PanelBody>
          {!emp ? <p className="text-[13px] text-muted-foreground">Bir çalışan seçin; gönderilmiş değerlendirmeler ve hedeflerden özet çıkarılır.</p> : summary.isPending ? <RowsSkeleton rows={3} /> : summary.isError ? <p className="text-[13px] text-destructive">{errMsg(summary.error)}</p> : s && (
            <div className="space-y-4">
              <p className="text-[13.5px] leading-relaxed">{s.paragraph}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><p className="mb-1.5 text-[13px] font-medium text-[hsl(var(--success))]">Güçlü yönler</p><ul className="list-disc space-y-1 pl-5 text-[13px]">{s.strengths.map((x) => <li key={x}>{x}</li>)}{!s.strengths.length && <li className="text-muted-foreground">Veri yok</li>}</ul></div>
                <div><p className="mb-1.5 text-[13px] font-medium text-[hsl(var(--warning))]">Gelişim alanları</p><ul className="list-disc space-y-1 pl-5 text-[13px]">{s.development.map((x) => <li key={x}>{x}</li>)}{!s.development.length && <li className="text-muted-foreground">Veri yok</li>}</ul></div>
              </div>
              <div className="flex flex-wrap gap-1.5">{s.themes.map((t) => <span key={t.theme} className="rounded-full bg-muted px-2.5 py-0.5 text-[12px]">{t.theme} · {t.mentions}</span>)}</div>
            </div>
          )}
        </PanelBody>
      </Panel>
    </div>
  )
}

/* --------------------------------------------------------------- izin tahmini */
function LeaveForecastTool() {
  const toast = useToast()
  const hist = useQuery({ queryKey: ['analytics', 24], queryFn: ({ signal }) => governanceApi.analytics(24, signal), retry: false })
  const history = useMemo(() => {
    const m = new Map<string, number>()
    hist.data?.timeline.forEach((t) => m.set(t.month.slice(0, 7), 0))
    hist.data?.leave.forEach((l) => m.set(l.month.slice(0, 7), (m.get(l.month.slice(0, 7)) ?? 0) + Number(l.days)))
    return [...m.entries()].sort().map(([month, days]) => ({ month, days }))
  }, [hist.data])
  const fc = useQuery({ queryKey: ['ai', 'leave-fc', history.length], enabled: history.length > 0, queryFn: () => aiApi.forecastLeave(history, 6).catch((e) => { toast.stop(errMsg(e)); throw e }) })
  const data = [...history.map((h) => ({ month: h.month, actual: h.days })), ...(fc.data?.points.map((p) => ({ month: p.month, forecast: p.forecast, band: [p.low, p.high] as [number, number] })) ?? [])]
  return (
    <Panel>
      <PanelHead title="Şirket geneli aylık izin günü tahmini" note={fc.data ? `${fc.data.method} · eğilim ${fc.data.trend_per_month > 0 ? '+' : ''}${fc.data.trend_per_month} gün/ay · ${fc.data.note}` : 'Son 24 ay onaylı izin verisinden'} />
      <PanelBody>
        {hist.isPending ? <RowsSkeleton /> : hist.isError ? <p className="text-[13px] text-muted-foreground">Analitik verisine erişim gerekli (yönetici).</p> : (
          <div className="h-72">
            <ResponsiveContainer>
              <ComposedChart data={data}>
                <XAxis dataKey="month" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis fontSize={11} width={30} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 12 }} />
                <Area dataKey="band" name="%80 aralık" stroke="none" fill="hsl(var(--primary))" fillOpacity={0.15} />
                <Line dataKey="actual" name="Gerçekleşen" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} />
                <Line dataKey="forecast" name="Tahmin" stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="6 4" dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </PanelBody>
    </Panel>
  )
}

/* --------------------------------------------------------------- eğitim önerisi */
function TrainingTool() {
  const { employeeId: me } = useMyEmployeeId()
  const { can } = useAuth()
  const [emp, setEmp] = useState('')
  const target = emp || me || ''
  const [areas, setAreas] = useState<string[]>([])
  const courses = useQuery({ queryKey: ['learning', 'courses', 'ai'], queryFn: ({ signal }) => learningApi.listCourses({}, signal) })
  const recs = useQuery({
    queryKey: ['ai', 'training', target, areas.join('|'), courses.data?.length],
    enabled: !!target && !!courses.data,
    queryFn: () => aiApi.recommendTraining({
      position: null, skills: [], goals: [], development_areas: areas,
      completed_course_ids: (courses.data ?? []).filter((c) => c.enrollments?.some((e) => e.employeeId === target && e.status === 'Completed')).map((c) => c.id),
      courses: (courses.data ?? []).map((c) => ({ id: c.id, title: c.title, description: c.description, category: c.category, is_mandatory: c.isMandatory })),
    }),
  })
  return (
    <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
      <Panel>
        <PanelHead title="Profil" />
        <PanelBody className="space-y-3">
          {can('performance:manage') && <PersonSelect label="Çalışan (boş: ben)" value={emp} onChange={setEmp} />}
          <ChipInput label="Gelişim alanları" value={areas} onChange={setAreas} suggestions={['zaman yönetimi', 'liderlik', 'sunum', 'excel', 'iş güvenliği']} />
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHead title="Önerilen eğitimler" note="Tamamlanmamış zorunlu eğitimler önce; sonra gelişim alanlarıyla içerik benzerliği" />
        <PanelBody className="space-y-2">
          {!target ? <p className="text-[13px] text-muted-foreground">Çalışan kaydınız yok; bir çalışan seçin.</p> : recs.isPending ? <RowsSkeleton rows={3} /> : (recs.data ?? []).length === 0 ? <EmptyState icon={GraduationCap} title="Öneri yok" detail="Katalogda henüz eğitim yok ya da hepsi tamamlanmış." /> : recs.data!.map((r, i) => (
            <motion.div key={r.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="flex items-center gap-3 rounded-xl border border-border p-3">
              <GraduationCap className={cn('size-5', r.is_mandatory ? 'text-[hsl(var(--warning))]' : 'text-primary')} />
              <div className="min-w-0 flex-1"><p className="text-[13.5px] font-medium">{r.title}</p><p className="text-[12px] text-muted-foreground">{r.reason}</p></div>
              <span className="tabular text-[13px] font-semibold">{r.score}</span>
            </motion.div>
          ))}
        </PanelBody>
      </Panel>
    </div>
  )
}

export function AiToolsPage() {
  const [tab, setTab] = useTabParam<TabKey>('arac', 'cv')
  return (
    <PlanGate feature="ai-tools">
      <PageHeader title="Yapay zekâ araçları" description="CV ayrıştırma, kapsayıcı ilan yazımı, aday eşleştirme, performans özeti, izin tahmini ve eğitim önerisi." />
      <div className="mb-4"><InfoNote><Bot className="mr-1 inline size-3.5" /> {HONEST}</InfoNote></div>
      <div className="mb-5">
        <Tabs label="Araç" value={tab} onChange={setTab} tabs={[
          { key: 'cv', label: 'CV ayrıştırma' }, { key: 'ilan', label: 'İlan yazıcı' }, { key: 'eslesme', label: 'Aday eşleşme' },
          { key: 'performans', label: 'Performans özeti' }, { key: 'izin', label: 'İzin tahmini' }, { key: 'egitim', label: 'Eğitim önerisi' },
        ]} />
      </div>
      <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        {tab === 'cv' && <CvTool />}
        {tab === 'ilan' && <JobAdTool />}
        {tab === 'eslesme' && <MatchTool />}
        {tab === 'performans' && <PerfTool />}
        {tab === 'izin' && <LeaveForecastTool />}
        {tab === 'egitim' && <TrainingTool />}
      </motion.div>
    </PlanGate>
  )
}
