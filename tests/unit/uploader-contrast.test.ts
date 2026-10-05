import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const CSS = readFileSync("app/globals.css", "utf8");
const UPLOADER = readFileSync("components/Uploader.tsx", "utf8");

function cssHex(name: string): string {
  const match = CSS.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));

  assert.ok(match, `${name} must be a hex color in app/globals.css`);

  return match[1].toLowerCase();
}

function cssVar(name: string): string {
  const match = CSS.match(new RegExp(`${name}:\\s*var\\((--[a-z0-9-]+)\\)`));

  assert.ok(match, `${name} must reference another token`);

  const target = match[1];
  const hex = CSS.match(new RegExp(`${target}:\\s*(#[0-9a-fA-F]{6})`));

  assert.ok(hex, `${target} must be a hex color`);

  return hex[1].toLowerCase();
}

function channel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
}

function linear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const red = linear(channel(hex, 1));
  const green = linear(channel(hex, 3));
  const blue = linear(channel(hex, 5));

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));

  return (lighter + 0.05) / (darker + 0.05);
}

describe("uploader text contrast", () => {
  it("uses the muted foreground token for the hint and the drop label", () => {
    assert.match(UPLOADER, /className="text-muted-foreground"/);
    assert.doesNotMatch(UPLOADER, /className="text-muted"/);
  });

  it("meets WCAG AA for the hint on the page background and the drop label on the surface", () => {
    const foreground = cssVar("--muted-foreground");
    const page = cssHex("--color-bg");
    const surface = cssHex("--color-surface");

    assert.ok(contrast(foreground, page) >= 4.5, `hint contrast ${contrast(foreground, page)}`);
    assert.ok(
      contrast(foreground, surface) >= 4.5,
      `drop label contrast ${contrast(foreground, surface)}`,
    );
  });
});
