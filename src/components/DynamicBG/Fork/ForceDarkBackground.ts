import type { KawarpOptions } from "@kawarp/core";

const KawarpOptionsForceDark: Partial<KawarpOptions> = {
  saturation: 0.75,
  tintColor: [0.025, 0.022, 0.03],
  tintIntensity: 0.38,
};

export type Rgba = { red: number; green: number; blue: number; alpha: number };

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function rgbToHsl({ red, green, blue }: Rgba): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number, alpha: number): Rgba {
  if (s === 0) {
    const value = Math.round(l * 255);
    return { red: value, green: value, blue: value, alpha };
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    let next = t;
    if (next < 0) next += 1;
    if (next > 1) next -= 1;
    if (next < 1 / 6) return p + (q - p) * 6 * next;
    if (next < 1 / 2) return q;
    if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    red: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    green: Math.round(hue2rgb(p, q, h) * 255),
    blue: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    alpha,
  };
}

function forceDarkColor(color: Rgba, enabled: boolean): Rgba {
  if (!enabled) return color;
  const [h, s, l] = rgbToHsl(color);
  const mutedS = Math.min(s * 0.62, 0.5);
  const darkL = Math.min(l * 0.58, 0.24);
  return hslToRgb(h, clamp01(mutedS), clamp01(darkL), color.alpha);
}

export function backgroundColorToCss(color: Rgba, enabled: boolean): string {
  const next = forceDarkColor(color, enabled);
  return `${next.red}, ${next.green}, ${next.blue}, ${next.alpha}`;
}

export function withForceDarkBackground(base: KawarpOptions, enabled: boolean): KawarpOptions {
  return enabled ? { ...base, ...KawarpOptionsForceDark } : base;
}
