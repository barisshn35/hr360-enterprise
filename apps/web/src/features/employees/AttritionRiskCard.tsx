import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'motion/react'
import { LoaderCircle } from 'lucide-react'
import { mlApi } from '@/api/ml'
import type { Employee, ExplainResponse, PredictResponse } from '@/api/types'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge'
import { ProgressBar } from '@/components/ui/Progress'
import { useToast } from '@/components/ui/Toast'
import { formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'

const FEATURE_COUNT = 6

/**
 * Modelin (hr360-attrition-risk) özellik şeması backend'de belgelenmediği
 * için değerler açıkça elle girilir. İlk alan kayıttan hesaplanan kıdemdir.
 */
function defaultFeatures(employee: Employee): number[] {
  const tenureYears = Math.max(
    0,
    (Date.now() - new Date(employee.hireDate).getTime()) / (365.25 * 24 * 3600 * 1000),
  )
  const values = new Array<number>(FEATURE_COUNT).fill(0)
  values[0] = Number(tenureYears.toFixed(1))
  return values
}

function toContributions(explain: ExplainResponse) {
  const raw = explain.feature_contributions
  const list = Array.isArray(raw)
    ? raw.map((c) => ({ feature: c.feature, contribution: c.contribution }))
    : Object.entries(raw ?? {}).map(([feature, contribution]) => ({ feature, contribution }))
  return list.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
}

export function AttritionRiskPanel({ employee }: { employee: Employee }) {
  const toast = useToast()
  const reduced = useReducedMotion()
  const [features, setFeatures] = useState<number[]>(() => defaultFeatures(employee))
  const [result, setResult] = useState<PredictResponse | null>(null)
  const [explain, setExplain] = useState<ExplainResponse | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      // Açıklama başarısız olursa tahmin yine gösterilir.
      const prediction = await mlApi.predict(features)
      const explanation = await mlApi.explain(features).catch(() => null)
      return { prediction, explanation }
    },
    onSuccess: ({ prediction, explanation }) => {
      setResult(prediction)
      setExplain(explanation)
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Risk analizi yapılamadı.'),
  })

  const probability = useMemo(() => {
    if (!result?.probability?.length) return null
    // İkili sınıflandırmada pozitif sınıf (ayrılma) olasılığı son elemandır.
    return result.probability[result.probability.length - 1]
  }, [result])

  const contributions = useMemo(() => (explain ? toContributions(explain) : []), [explain])
  const maxAbs = contributions[0] ? Math.abs(contributions[0].contribution) : 1

  const tone: StatusTone =
    probability === null
      ? 'neutral'
      : probability >= 0.66
        ? 'danger'
        : probability >= 0.33
          ? 'warning'
          : 'success'
  const label =
    probability === null ? '' : probability >= 0.66 ? 'Yüksek' : probability >= 0.33 ? 'Orta' : 'Düşük'

  return (
    <Panel>
      <PanelHead
        title="Devir riski"
        note="hr360-attrition-risk, MLflow sürüm 1"
        action={<StatusBadge tone="neutral">Model</StatusBadge>}
      />
      <PanelBody className="space-y-4">
        <p className="border-l-2 border-border pl-3 text-[12px] leading-relaxed text-muted-foreground">
          Modelin özellik şeması belgelenmediği için değerleri elle girin. İlk alan kıdem (yıl)
          olarak kayıttan dolduruldu.
        </p>

        <fieldset className="grid grid-cols-3 gap-2">
          <legend className="sr-only">Model giriş özellikleri</legend>
          {features.map((value, i) => (
            <label key={i} className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">Özellik {i + 1}</span>
              <Input
                type="number"
                step="any"
                value={value}
                onChange={(e) => {
                  const next = [...features]
                  next[i] = Number(e.target.value)
                  setFeatures(next)
                }}
                className="tabular h-9 px-2 text-[13px]"
              />
            </label>
          ))}
        </fieldset>

        <Button
          className="w-full cursor-pointer"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
          Riski hesapla
        </Button>

        {result && (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.26, ease: 'easeOut' }}
            className="space-y-4 border-t border-border pt-4"
          >
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[12px] text-muted-foreground">Ayrılma olasılığı</p>
                <p className="tabular mt-1 text-[30px] leading-none font-bold">
                  {probability === null ? '—' : formatPercent(probability, 1)}
                </p>
              </div>
              {label && <StatusBadge tone={tone}>{label} risk</StatusBadge>}
            </div>

            {probability !== null && (
              <ProgressBar
                value={probability * 100}
                tone={tone}
                label="Ayrılma olasılığı"
                thick
              />
            )}

            {contributions.length > 0 && (
              <div>
                <p className="mb-2 text-[12px] text-muted-foreground">
                  Hangi özellik ne kadar etkiledi
                </p>
                <ul className="space-y-2">
                  {contributions.slice(0, 6).map((c) => {
                    const width = Math.round((Math.abs(c.contribution) / maxAbs) * 100)
                    const raises = c.contribution >= 0
                    return (
                      <li key={c.feature} className="flex items-center gap-2.5 text-[12px]">
                        <span className="w-16 shrink-0 truncate text-muted-foreground">
                          {c.feature}
                        </span>
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                          <span
                            className={cn(
                              'block h-full rounded-full',
                              raises ? 'bg-destructive' : 'bg-[hsl(var(--success))]',
                            )}
                            style={{ width: `${width}%` }}
                          />
                        </span>
                        <span
                          className={cn(
                            'tabular w-14 shrink-0 text-right font-semibold',
                            raises ? 'text-destructive' : 'text-[hsl(var(--success))]',
                          )}
                        >
                          {raises ? '+' : ''}
                          {c.contribution.toFixed(3)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Kırmızı riski artırır, yeşil azaltır.
                </p>
              </div>
            )}
          </motion.div>
        )}
      </PanelBody>
    </Panel>
  )
}
