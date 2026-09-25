/**
 * Plan kartları.
 *
 * Kaynak: 21st.dev "Startup Pricing Plans" (shadcnspace, id 21479). Sabit
 * `bg-blue-500/10` / `bg-white text-black` renkleri token'lara çevrildi ve
 * kartlar seçilebilir hâle getirildi — aynı bileşen hem landing'de tanıtım,
 * hem kayıt sihirbazının 3. adımında seçim olarak çalışıyor.
 */

import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowUpRight, Check } from 'lucide-react'
import type { TenantPlan } from '@/api/tenant'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { EASE, useRevealed } from '@/motion/primitives'
import { PLANS } from './plans'

/**
 * Kart görünürken sırayla yükselir. Görünürlük ölçümü `useRevealed` üzerinden;
 * sayfadaki diğer girişlerle aynı mekanizma, aynı davranış.
 */
function PlanCard({ index, children }: { index: number; children: ReactNode }) {
  const reduced = useReducedMotion()
  const [ref, revealed] = useRevealed<HTMLDivElement>(0.15)

  return (
    <motion.div
      ref={ref}
      initial={reduced ? false : { opacity: 0, y: 24 }}
      animate={revealed || reduced ? { opacity: 1, y: 0 } : undefined}
      transition={{ delay: reduced ? 0 : index * 0.09, duration: 0.5, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

type CommonProps = {
  className?: string
}

type SelectableProps = CommonProps & {
  mode: 'select'
  value: TenantPlan
  onChange: (plan: TenantPlan) => void
}

type ShowcaseProps = CommonProps & {
  mode: 'showcase'
  ctaLabel: string
  onCta: (plan: TenantPlan) => void
}

export function PricingPlans(props: SelectableProps | ShowcaseProps) {
  const selectable = props.mode === 'select'

  return (
    <div className={cn('grid gap-5 lg:grid-cols-3', props.className)}>
      {PLANS.map((plan, index) => {
        const active = selectable && props.value === plan.id
        return (
          <PlanCard key={plan.id} index={index}>
            <Card
              className={cn(
                'h-full rounded-2xl transition-colors',
                plan.highlighted ? 'bg-primary/[0.06]' : 'bg-card',
                active && 'ring-2 ring-primary',
                selectable && 'cursor-pointer hover:border-primary/50',
              )}
              onClick={selectable ? () => props.onChange(plan.id) : undefined}
              {...(selectable
                ? {
                    role: 'radio' as const,
                    'aria-checked': active,
                    tabIndex: 0,
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        props.onChange(plan.id)
                      }
                    },
                  }
                : {})}
            >
              <CardContent className="flex h-full flex-col gap-6 px-6 py-2 sm:px-8">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={plan.highlighted ? 'default' : 'secondary'} className="h-7 px-3">
                      {plan.name}
                    </Badge>
                    {plan.highlighted && (
                      <span className="text-[11px] font-medium tracking-wide text-primary uppercase">
                        En çok tercih edilen
                      </span>
                    )}
                  </div>
                  <p className="max-w-64 text-sm text-muted-foreground">{plan.tagline}</p>
                </div>

                <div className="flex flex-col gap-1">
                  {plan.priceLabel ? (
                    <p className="text-4xl font-semibold text-card-foreground">{plan.priceLabel}</p>
                  ) : (
                    <p className="tabular flex items-end gap-1.5 text-4xl font-semibold text-card-foreground">
                      {formatNumber(plan.maxEmployees)}
                      <span className="pb-1 text-base font-normal text-muted-foreground">
                        çalışana kadar
                      </span>
                    </p>
                  )}
                </div>

                <Separator />

                <ul className="flex flex-1 flex-col gap-2.5">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2.5 text-[13px] leading-relaxed text-card-foreground"
                    >
                      <Check
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-primary"
                        strokeWidth={2}
                      />
                      {feature}
                    </li>
                  ))}
                </ul>

                {selectable ? (
                  <Button
                    type="button"
                    variant={active ? 'default' : 'outline'}
                    className="w-full cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onChange(plan.id)
                    }}
                  >
                    {active ? 'Seçildi' : 'Bu planı seç'}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant={plan.highlighted ? 'default' : 'outline'}
                    className="w-full cursor-pointer"
                    onClick={() => props.onCta(plan.id)}
                  >
                    {props.ctaLabel}
                    <ArrowUpRight className="size-4" />
                  </Button>
                )}
              </CardContent>
            </Card>
          </PlanCard>
        )
      })}
    </div>
  )
}
