"use client";

import { useCallback, useRef, useState } from "react";

export type UploaderProps = {
  id: string;
  index: string;          // "01" / "02"
  indexColor: string;     // css color
  title: string;
  hint: string;
  placeholder: string;
  borderColor: string;    // dashed border color
  washed?: boolean;       // apply the .washed treatment to previews (people)
  onChange: (file: File | null) => void;
};

export function Uploader({
  id,
  index,
  indexColor,
  title,
  hint,
  placeholder,
  borderColor,
  washed,
  onChange,
}: UploaderProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File | null) => {
      if (preview) URL.revokeObjectURL(preview);
      if (file && file.type.startsWith("image/")) {
        setPreview(URL.createObjectURL(file));
        onChange(file);
      } else {
        setPreview(null);
        onChange(null);
      }
    },
    [onChange, preview],
  );

  return (
    <div className="dl-up" style={{ background: "var(--color-bg)", borderRadius: "var(--radius-md)", padding: 20 }}>
      <div className="flex items-center" style={{ gap: 12, marginBottom: 16 }}>
        <span style={{ fontFamily: "var(--font-heading)", fontSize: 30, color: indexColor, lineHeight: 1 }}>
          {index}
        </span>
        <div>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, lineHeight: 1.2 }}>{title}</div>
          <div className="text-muted" style={{ fontSize: 12.5 }}>{hint}</div>
        </div>
      </div>

      <button
        type="button"
        aria-label={placeholder}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFile(e.dataTransfer.files?.[0] ?? null);
        }}
        className="dl-drop"
        style={{
          display: "block",
          width: "100%",
          padding: 0,
          cursor: "pointer",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          aspectRatio: "3 / 4",
          border: `2px dashed ${dragging ? "var(--color-accent)" : borderColor}`,
          background: "var(--color-surface)",
          position: "relative",
        }}
      >
        {preview ? (
          <img
            src={preview}
            alt={title}
            className={washed ? "washed" : undefined}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span
            className="text-muted"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              textAlign: "center",
              padding: 20,
              fontSize: 13,
            }}
          >
            {placeholder}
          </span>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}
