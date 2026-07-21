import { ImageResponse } from "next/og";
import { site } from "@/lib/site";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = site.title;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#f5ead8",
          color: "#201e1d",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 36 }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: "#c67139", display: "flex", alignItems: "center", justifyContent: "center", color: "#f5ead8", fontSize: 40 }}>
            ◍
          </div>
          <div style={{ fontSize: 40, fontWeight: 700 }}>{site.name}</div>
        </div>
        <div style={{ fontSize: 74, lineHeight: 1.05, maxWidth: 900, letterSpacing: "-0.02em" }}>
          How might this look on you?
        </div>
        <div style={{ fontSize: 30, marginTop: 28, color: "#8c491a", maxWidth: 860 }}>
          AI virtual try-on for Pakistani fashion — shalwar kameez, abayas, bridal & western.
        </div>
      </div>
    ),
    size,
  );
}
