import { site } from "@/lib/site";

export function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div
        className="grid place-items-center"
        style={{
          width: 40,
          height: 40,
          borderRadius: 13,
          background: "var(--color-accent)",
        }}
        aria-hidden
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-bg)" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3a7 7 0 0 0 0 18" />
          <path d="M12 3a5 5 0 0 1 0 18" />
          <path d="M12 3v18" />
        </svg>
      </div>
      <div style={{ lineHeight: 1 }}>
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 23, letterSpacing: "-.01em" }}>
          {site.name}
        </div>
        <div
          className="text-muted"
          style={{ fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", marginTop: 4 }}
        >
          {site.tagline}
        </div>
      </div>
    </div>
  );
}
