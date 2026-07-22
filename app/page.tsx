import Link from "next/link";
import { Logo } from "@/components/Logo";
import { TryOnStudio } from "@/components/TryOnStudio";

export default function Home() {
  return (
    <div style={{ minHeight: "100vh", position: "relative", overflow: "hidden" }}>
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 340,
          right: -220,
          width: 560,
          height: 560,
          borderRadius: "50%",
          background: "var(--color-accent-2-200)",
          opacity: 0.4,
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative", maxWidth: 1160, margin: "0 auto", padding: "28px 40px 88px" }}>
        {/* Header */}
        <header className="flex items-center gap-4" style={{ marginBottom: 64 }}>
          <div style={{ marginRight: "auto" }}>
            <Logo />
          </div>
          <nav className="flex items-center" style={{ gap: 26 }}>
            <a className="text-muted" style={{ fontSize: 14, textDecoration: "none" }} href="#try-on">
              Try-on
            </a>
            <a className="text-muted" style={{ fontSize: 14, textDecoration: "none" }} href="#try-on">
              How it works
            </a>
            <Link className="text-muted" href="/auth/login" style={{ fontSize: 14, textDecoration: "none" }}>
              Sign in
            </Link>
            <Link className="text-muted" href="/auth/sign-up" style={{ fontSize: 14, textDecoration: "none" }}>
              Sign up
            </Link>
            <span className="tag tag-outline">AI style preview</span>
          </nav>
        </header>

        {/* Editorial hero — server-rendered for SEO */}
        <section
          className="dl-rise"
          style={{ display: "flex", flexWrap: "wrap", gap: 48, alignItems: "flex-end", marginBottom: 56 }}
        >
          <div style={{ flex: "1.7 1 340px", minWidth: 340 }}>
            <div className="flex items-center" style={{ gap: 12, marginBottom: 22 }}>
              <span style={{ width: 34, height: 1.5, background: "var(--color-accent)" }} />
              <span style={{ fontSize: 12, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--color-accent-700)" }}>
                Virtual try-on · Pakistan
              </span>
            </div>
            <h1 style={{ fontSize: "clamp(44px,6.4vw,78px)", lineHeight: 0.98, margin: "0 0 20px", maxWidth: "12ch" }}>
              How might this look on you?
            </h1>
            <p style={{ fontSize: 18, maxWidth: 440, margin: 0 }}>
              Add your photo and any Pakistani outfit — shalwar kameez, abaya, bridal or western — and
              see the style previewed on you before you decide.
            </p>
          </div>

          <div style={{ flex: "1 1 280px", minWidth: 260 }}>
            <div style={{ background: "var(--color-accent-2-100)", borderRadius: "var(--radius-lg)", padding: "26px 24px" }}>
              <div className="flex items-center" style={{ gap: 9, marginBottom: 12 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-2-700)" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span style={{ fontFamily: "var(--font-heading)", fontSize: 17, color: "var(--color-accent-2-800)" }}>
                  An honest promise
                </span>
              </div>
              <p style={{ fontSize: 14, margin: 0, color: "var(--color-accent-2-900)", lineHeight: 1.5 }}>
                Dekhlo shows how a style could <em>suit</em> you — it isn&apos;t a guaranteed fit. Real
                fabric, drape and colour may vary. Think of it as trying the look, not the size.
              </p>
            </div>
          </div>
        </section>

        {/* Interactive try-on tool (client) */}
        <TryOnStudio />
      </div>
    </div>
  );
}
