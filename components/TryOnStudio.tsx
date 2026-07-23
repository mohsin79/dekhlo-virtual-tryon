"use client";

import { useState } from "react";
import { Uploader } from "@/components/Uploader";

type Phase = "idle" | "generating" | "done" | "error";

const SparkleIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z" />
  </svg>
);

export function TryOnStudio() {
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [outfitFile, setOutfitFile] = useState<File | null>(null);
  const [outfitPreview, setOutfitPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canTry = !!personFile && !!outfitFile && phase !== "generating";

  async function tryOn() {
    if (!personFile || !outfitFile) return;
    setPhase("generating");
    setSaved(false);
    setError(null);
    try {
      const body = new FormData();
      body.append("person", personFile);
      body.append("item", outfitFile);
      const res = await fetch("/api/demo/try-on", { method: "POST", body });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "Something went wrong." }));
        throw new Error(msg || "Something went wrong.");
      }
      const { image } = await res.json();
      setResultUrl(image);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("error");
    }
  }

  function reset() {
    setPhase("idle");
    setResultUrl(null);
    setSaved(false);
    setError(null);
  }

  const showResult = phase === "generating" || phase === "done";

  return (
    <>
      {/* Tool */}
      <section
        id="try-on"
        className="dl-rise"
        style={{ background: "var(--color-surface)", borderRadius: "var(--radius-lg)", padding: 34, animationDelay: ".2s" }}
      >
        <div className="flex" style={{ alignItems: "baseline", gap: 14, marginBottom: 26 }}>
          <h2 style={{ margin: 0, fontSize: 27 }}>Preview a look</h2>
          <span className="text-muted" style={{ fontSize: 14 }}>Two steps — drop, then try.</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 22 }}>
          <Uploader
            id="person"
            index="01"
            indexColor="var(--color-accent)"
            title="Your photo"
            hint="Full-length, front-facing, well-lit."
            placeholder="Drop your photo, or click to browse"
            borderColor="var(--color-accent-400)"
            washed
            onChange={setPersonFile}
          />
          <Uploader
            id="item"
            index="02"
            indexColor="var(--color-accent-2-700)"
            title="The item"
            hint="Clothing, hat, glasses, makeup, or any accessory."
            placeholder="Drop a garment, accessory, or product photo"
            borderColor="var(--color-accent-2-400)"
            onChange={(f) => {
              setOutfitFile(f);
              setOutfitPreview(f ? URL.createObjectURL(f) : null);
            }}
          />
        </div>

        <div className="flex" style={{ alignItems: "center", gap: 20, flexWrap: "wrap", marginTop: 26 }}>
          <button className="btn btn-primary" onClick={tryOn} disabled={!canTry} style={{ padding: "15px 34px", fontSize: 15 }}>
            {phase === "generating" ? (
              <>
                <span
                  className="dl-spin"
                  style={{
                    width: 16, height: 16, borderRadius: "50%",
                    border: "2.5px solid color-mix(in srgb, var(--color-bg) 55%, transparent)",
                    borderTopColor: "var(--color-bg)", display: "inline-block",
                  }}
                />
                Styling your look…
              </>
            ) : (
              <>
                <SparkleIcon />
                {phase === "done" ? "Try again" : "Try this on"}
              </>
            )}
          </button>

          <div className="flex" style={{ alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            <span className="text-muted flex items-center" style={{ gap: 7, fontSize: 12.5 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-2-700)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              Your photo stays private
            </span>
            <span className="text-muted flex items-center" style={{ gap: 7, fontSize: 12.5 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-2-700)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
              Ready in seconds
            </span>
          </div>
        </div>

        {phase === "error" && error && (
          <p style={{ marginTop: 16, marginBottom: 0, color: "var(--color-accent-700)", fontSize: 13 }}>
            {error}
          </p>
        )}
      </section>

      {/* Result */}
      {showResult && (
        <section style={{ marginTop: 44, animation: "dl-rise .55s ease both" }}>
          <div className="flex items-center" style={{ gap: 14, marginBottom: 20 }}>
            <span style={{ width: 34, height: 1.5, background: "var(--color-accent)" }} />
            <span style={{ fontSize: 12, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--color-accent-700)" }}>
              The result
            </span>
          </div>

          <div style={{ background: "var(--color-surface)", borderRadius: "var(--radius-lg)", padding: 30, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {phase === "generating" && (
              <div style={{ aspectRatio: "16 / 9", borderRadius: "var(--radius-md)", background: "var(--color-bg)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
                <div className="dl-spin" style={{ width: 46, height: 46, borderRadius: "50%", border: "4px solid var(--color-accent-200)", borderTopColor: "var(--color-accent)" }} />
                <div className="dl-pulse" style={{ fontFamily: "var(--font-heading)", fontSize: 19 }}>
                  Placing the outfit on you…
                </div>
              </div>
            )}

            {phase === "done" && resultUrl && (
              <>
                <div className="flex" style={{ alignItems: "baseline", gap: 14 }}>
                  <h2 style={{ margin: 0, fontSize: 27 }}>Here&apos;s the look on you</h2>
                  <span className="tag tag-accent">Style preview</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: 24, alignItems: "start" }}>
                  <div style={{ borderRadius: "var(--radius-md)", overflow: "hidden", aspectRatio: "3 / 4", boxShadow: "var(--shadow-md)" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="washed" src={resultUrl} alt="Your styled preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                    <div>
                      <div className="text-muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 10 }}>
                        The item you chose
                      </div>
                      <div style={{ borderRadius: "var(--radius-md)", overflow: "hidden", aspectRatio: "3 / 4", maxWidth: 180, boxShadow: "var(--shadow-sm)" }}>
                        {outfitPreview && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={outfitPreview} alt="Outfit reference" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        )}
                      </div>
                    </div>
                    <div className="flex" style={{ gap: 11, background: "var(--color-accent-2-100)", borderRadius: "var(--radius-md)", padding: "15px 16px" }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-2-700)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", marginTop: 1 }}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                      <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-accent-2-800)", lineHeight: 1.5 }}>
                        This shows how the <strong>style</strong> suits you — not exact fit. Fabric, drape
                        and colour may differ in real life.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex" style={{ gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <a className="btn btn-secondary" href={resultUrl} download="dekhlo-look.png">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
                    Download
                  </a>
                  <button className="btn btn-secondary" onClick={() => setSaved((s) => !s)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill={saved ? "var(--color-accent)" : "none"} stroke={saved ? "var(--color-accent)" : "currentColor"} strokeWidth={saved ? 2 : 2.75} strokeLinecap="round" strokeLinejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" /></svg>
                    {saved ? "Saved" : "Save look"}
                  </button>
                  <button className="btn btn-secondary" onClick={reset}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.36 2.64L3 8" /><path d="M3 3v5h5" /></svg>
                    Try another item
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      )}
    </>
  );
}
