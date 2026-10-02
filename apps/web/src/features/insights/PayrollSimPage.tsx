import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Calculator, Info } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Checkbox } from '@/components/ui/checkbox'
import { TextField } from '@/components/ui/Field'
import { InfoNote } from '@/components/ui/States'
import { Tabs } from '@/components/ui/Tabs'
import { formatMoney } from '@/lib/format'
import { MONTHS_TR, PARAMS_2026, grossToNetYear, netToGrossYear } from '@/lib/payroll'
import { cn } from '@/lib/utils'
import { Metric, PlanGate } from '@/features/shared/kit'

const TT = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }
const tl = (n: number) => formatMoney(n)

export function PayrollSimPage() {
  const [mode, setMode] = useState<'brut' | 'net'>('brut')
  const [amount, setAmount] = useState('75000')
  const [discount, setDiscount] = useState(true)
  const [minWage, setMinWage] = useState(String(PARAMS_2026.minWageGross))
  const params = useMemo(() => ({ ...PARAMS_2026, minWageGross: Number(minWage) || PARAMS_2026.minWageGross, sgkCeiling: (Number(minWage) || PARAMS_2026.minWageGross) * 9 }), [minWage])
  const value = Math.max(0, Number(amount.replace(/\./g, '').replace(',', '.')) || 0)
  const rows = useMemo(() => (mode === 'brut' ? grossToNetYear(value, params, discount) : netToGrossYear(value, params, discount)), [mode, value, params, discount])
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a + (r[k] as number), 0)
  const jan = rows[0]
  const dec = rows[11]
  const chart = rows.map((r) => ({ ay: MONTHS_TR[r.month - 1].slice(0, 3), Net: r.net, 'Gelir vergisi': r.incomeTaxPayable, SGK: r.sgk + r.unemployment, Damga: r.stampPayable }))

  return (
    <PlanGate feature="payroll-sim">
      <PageHeader title="Bordro simülasyonu" description="Brütten nete veya netten brüte; 12 aylık kümülatif gelir vergisi, asgari ücret istisnası, SGK tavanı ve işveren maliyetiyle." />
      <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
        <div className="space-y-5">
          <Panel>
            <PanelHead title={<span className="flex items-center gap-2"><Calculator className="size-4 text-primary" /> Hesap</span>} />
            <PanelBody className="space-y-4">
              <Tabs label="Yön" value={mode} onChange={setMode} tabs={[{ key: 'brut', label: 'Brütten nete' }, { key: 'net', label: 'Netten brüte' }]} />
              <TextField label={mode === 'brut' ? 'Aylık brüt ücret (TL)' : 'Hedef aylık net (TL)'} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <label className="flex items-center gap-2 text-[13px]"><Checkbox checked={discount} onCheckedChange={(v) => setDiscount(v === true)} /> İşverene 5 puanlık SGK teşviki</label>
              <details className="text-[12.5px]">
                <summary className="cursor-pointer text-muted-foreground">Parametreler (2026)</summary>
                <div className="mt-3 space-y-3">
                  <TextField label="Brüt asgari ücret" value={minWage} onChange={(e) => setMinWage(e.target.value)} hint="SGK tavanı = asgari ücret × 9" />
                  <ul className="space-y-0.5 text-muted-foreground">
                    <li>SGK işçi %14 + işsizlik %1 · işveren %21,75 + %2</li>
                    <li>SGK tavanı {tl(params.sgkCeiling)}</li>
                    <li>GV dilimleri: 190.000 / 400.000 / 1.500.000 / 5.300.000 TL → %15/20/27/35/40</li>
                    <li>Damga vergisi binde 7,59</li>
                  </ul>
                </div>
              </details>
            </PanelBody>
          </Panel>
          <InfoNote><Info className="mr-1 inline size-3.5" /> Simülasyondur. Engellilik indirimi, BES, sendika aidatı, yan haklar ve kıst ay hesabı dahil değildir.</InfoNote>
        </div>
        <div className="min-w-0 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label={mode === 'brut' ? 'Ocak net' : 'Ocak brüt'} value={tl(mode === 'brut' ? jan.net : jan.gross)} />
            <Metric label={mode === 'brut' ? 'Aralık net' : 'Aralık brüt'} value={tl(mode === 'brut' ? dec.net : dec.gross)} hint={`Dilim %${Math.round(dec.bracketRate * 100)}`} tone={mode === 'brut' && dec.net < jan.net ? 'warn' : undefined} />
            <Metric label="Yıllık net" value={tl(sum('net'))} />
            <Metric label="Yıllık işveren maliyeti" value={tl(sum('employerCost'))} />
          </div>
          <Panel>
            <PanelHead title="Aylık dağılım" note="Kümülatif matrah arttıkça vergi dilimi yükselir; net ücret yıl içinde azalabilir." />
            <PanelBody className="h-72">
              <ResponsiveContainer>
                <BarChart data={chart}>
                  <XAxis dataKey="ay" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis fontSize={11} width={48} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}b`} />
                  <Tooltip contentStyle={TT} formatter={(v: number) => tl(v)} cursor={{ fill: 'hsl(var(--muted)/0.4)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Net" stackId="a" fill="hsl(var(--primary))" animationDuration={700} />
                  <Bar dataKey="SGK" stackId="a" fill="#38bdf8" />
                  <Bar dataKey="Gelir vergisi" stackId="a" fill="#f59e0b" />
                  <Bar dataKey="Damga" stackId="a" fill="#a78bfa" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHead title="12 aylık bordro" />
            <PanelBody className="overflow-x-auto p-0">
              <table className="w-full min-w-[980px] text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-right text-[11px] text-muted-foreground">
                    {['Ay', 'Brüt', 'SGK %14', 'İşsizlik %1', 'GV matrahı', 'Kümülatif', 'Hesaplanan GV', 'AÜ istisnası', 'Ödenecek GV', 'Damga', 'Net', 'İşveren maliyeti'].map((h, i) => <th key={h} className={cn('px-3 py-2 font-medium', i === 0 && 'text-left')}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <motion.tr key={r.month} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }} className="tabular border-b border-border/50 text-right last:border-0">
                      <td className="px-3 py-1.5 text-left">{MONTHS_TR[r.month - 1]}</td>
                      <td className="px-3">{tl(r.gross)}</td><td className="px-3">{tl(r.sgk)}</td><td className="px-3">{tl(r.unemployment)}</td>
                      <td className="px-3">{tl(r.taxBase)}</td><td className="px-3 text-muted-foreground">{tl(r.cumulativeBase)}</td>
                      <td className="px-3">{tl(r.incomeTax)}</td><td className="px-3 text-[hsl(var(--success))]">−{tl(r.incomeTaxExemption)}</td>
                      <td className="px-3">{tl(r.incomeTaxPayable)}</td><td className="px-3">{tl(r.stampPayable)}</td>
                      <td className="px-3 font-semibold">{tl(r.net)}</td><td className="px-3">{tl(r.employerCost)}</td>
                    </motion.tr>
                  ))}
                  <tr className="tabular border-t-2 border-border text-right font-semibold">
                    <td className="px-3 py-2 text-left">Toplam</td>
                    {(['gross', 'sgk', 'unemployment', 'taxBase'] as const).map((k) => <td key={k} className="px-3">{tl(sum(k))}</td>)}
                    <td />
                    {(['incomeTax', 'incomeTaxExemption', 'incomeTaxPayable', 'stampPayable', 'net', 'employerCost'] as const).map((k) => <td key={k} className="px-3">{tl(sum(k))}</td>)}
                  </tr>
                </tbody>
              </table>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </PlanGate>
  )
}
