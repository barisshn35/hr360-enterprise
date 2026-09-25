import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** Render sırasındaki beklenmeyen hatada beyaz ekran yerine çıkış yolu sunar. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('HR360 render hatası:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div role="alert" className="flex min-h-dvh items-center justify-center bg-background px-6">
        <div className="max-w-md rounded-lg border border-destructive/30 bg-destructive/5 p-5">
          <h1 className="text-[22px] leading-tight font-semibold">Arayüz durdu</h1>
          <p className="mt-2 text-[14px] leading-relaxed break-words text-muted-foreground">
            {this.state.error.message}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex h-10 cursor-pointer items-center rounded-md border border-border bg-card px-4 text-sm font-medium transition-colors hover:bg-accent"
          >
            Sayfayı yenile
          </button>
        </div>
      </div>
    )
  }
}
