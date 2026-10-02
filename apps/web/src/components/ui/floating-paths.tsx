/**
 * Arka planda yavaşça akan eğri çizgiler.
 *
 * Kaynak: 21st.dev "Split Login" (mohammadshehadeh / Hirael login-03, id 28369,
 * MIT) içindeki FloatingPaths. Uyarlama: renk --primary'den gelir, çizgi sayısı
 * ve opaklığı koyu zeminde göz yormayacak şekilde ayarlandı; hareket azaltma
 * tercihinde çizgiler sabit kalır.
 */

import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'

const jitter = (i: number) => {
  const value = Math.sin(i + 1) * 10_000
  return value - Math.floor(value)
}

function PathLayer({ position }: { position: number }) {
  const reduced = useReducedMotion()
  const paths = Array.from({ length: 32 }, (_, i) => ({
    id: i,
    d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${380 - i * 5 * position} -${189 + i * 6} -${
      312 - i * 5 * position
    } ${216 - i * 6} ${152 - i * 5 * position} ${343 - i * 6}C${616 - i * 5 * position} ${470 - i * 6} ${
      684 - i * 5 * position
    } ${875 - i * 6} ${684 - i * 5 * position} ${875 - i * 6}`,
    width: 0.5 + i * 0.03,
  }))

  return (
    <svg
      className="absolute inset-0 h-full w-full text-primary"
      fill="none"
      viewBox="0 0 696 316"
      preserveAspectRatio="xMidYMid slice"
    >
      {paths.map((path) => (
        <motion.path
          key={path.id}
          d={path.d}
          stroke="currentColor"
          strokeWidth={path.width}
          strokeOpacity={0.06 + path.id * 0.022}
          initial={{ pathLength: 0.3 }}
          animate={reduced ? undefined : { pathLength: 1, pathOffset: [0, 1, 0] }}
          transition={{ duration: 20 + jitter(path.id) * 10, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
        />
      ))}
    </svg>
  )
}

export function FloatingPaths({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('pointer-events-none absolute inset-0', className)}>
      <PathLayer position={1} />
      <PathLayer position={-1} />
    </div>
  )
}
