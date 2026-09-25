import { Link } from 'react-router-dom'
import { SECTIONS } from './LandingNav'

const MODULE_LINKS = [
  'Organizasyon',
  'Çalışanlar',
  'Onay akışları',
  'İzin ve puantaj',
  'İşe alım',
  'Onboarding ve zimmet',
  'Performans',
  'Eğitim',
  'Ücret',
  'İK vakaları',
]

export function LandingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-7xl px-5 py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Link to="/" className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
              <img
                src="/icon-emerald.svg"
                alt=""
                aria-hidden="true"
                className="size-7 shrink-0"
              />
              Staffware Enterprise
            </Link>
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
              Çok kiracılı insan kaynakları platformu. Her şirketin verisi kendi kiracısında
              izole, erişim rolüne göre şekillenir.
            </p>
          </div>

          <nav aria-label="Modüller">
            <p className="mb-4 text-[12px] font-semibold tracking-wider text-muted-foreground uppercase">
              Modüller
            </p>
            <ul className="grid grid-cols-1 gap-y-2 sm:grid-cols-2">
              {MODULE_LINKS.map((label) => (
                <li key={label} className="text-[13px] text-muted-foreground">
                  {label}
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Bağlantılar">
            <p className="mb-4 text-[12px] font-semibold tracking-wider text-muted-foreground uppercase">
              Bağlantılar
            </p>
            <ul className="space-y-2">
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {section.label}
                  </a>
                </li>
              ))}
              <li>
                <Link
                  to="/giris"
                  className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Giriş yap
                </Link>
              </li>
              <li>
                <Link
                  to="/kayit"
                  className="text-[13px] font-medium text-primary transition-opacity hover:opacity-75"
                >
                  Şirket kaydı
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 sm:flex-row">
          <p className="text-[12px] text-muted-foreground">
            Staffware Enterprise — çok kiracılı insan kaynakları platformu
          </p>
          <p className="text-[12px] text-muted-foreground">
            Kimlik doğrulama Keycloak üzerinden (PKCE)
          </p>
        </div>
      </div>
    </footer>
  )
}
