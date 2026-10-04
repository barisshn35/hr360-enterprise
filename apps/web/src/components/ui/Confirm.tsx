import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { tx } from '@/lib/i18n'

/**
 * Geri alınamaz ya da etkisi geniş işlemler için ortak onay penceresi.
 *
 *   const confirm = useConfirm()
 *   if (await confirm({ title: tx('Dönem kapatılsın mı?'), note: ..., action: tx('Kapat') })) close.mutate()
 */
export interface ConfirmOptions {
  title: string
  note?: string
  /** Onay düğmesinin metni (varsayılan "Onayla"). */
  action?: string
  /** Kırmızı (yıkıcı) düğme; varsayılan true. */
  destructive?: boolean
}

type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>

const Ctx = createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((o) => {
    resolver.current?.(false)
    setOpts(o)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const done = (v: boolean) => {
    resolver.current?.(v)
    resolver.current = null
    setOpts(null)
  }

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal
        open={opts !== null}
        onClose={() => done(false)}
        title={opts?.title ?? ''}
        note={opts?.note}
        footer={
          <>
            <Button variant="outline" onClick={() => done(false)}>
              {tx('Vazgeç')}
            </Button>
            <Button variant={opts?.destructive === false ? 'default' : 'destructive'} onClick={() => done(true)} autoFocus>
              {opts?.action ?? tx('Onayla')}
            </Button>
          </>
        }
      >
        {null}
      </Modal>
    </Ctx.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const fn = useContext(Ctx)
  if (!fn) throw new Error('useConfirm, ConfirmProvider içinde kullanılmalı')
  return fn
}
