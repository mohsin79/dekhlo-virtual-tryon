import Link from "next/link";
import { Logo } from "@/components/Logo";
import { TryOnStudio } from "@/components/TryOnStudio";

export default function DemoPage() {
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
        <header className="flex items-center gap-4" style={{ marginBottom: 48 }}>
          <div style={{ marginRight: "auto" }}>
            <Logo />
          </div>
          <nav className="flex items-center" style={{ gap: 26 }}>
            <Link className="text-muted" href="/" style={{ fontSize: 14, textDecoration: "none" }}>
              Home
            </Link>
            <Link className="text-muted" href="/auth/login" style={{ fontSize: 14, textDecoration: "none" }}>
              Sign in
            </Link>
          </nav>
        </header>

        <section className="dl-rise" style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: "clamp(36px,5vw,56px)", lineHeight: 1.05, margin: "0 0 12px" }}>
            Demo try-on
          </h1>
          <p style={{ fontSize: 17, maxWidth: 640, margin: 0, color: "var(--color-muted-foreground)" }}>
            Upload your photo and any garment image to preview the legacy two-image experience. Demo usage is
            rate-limited and does not consume merchant credits.
          </p>
        </section>

        <TryOnStudio />
      </div>
    </div>
  );
}
