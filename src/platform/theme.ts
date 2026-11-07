/**
 * Theme & appearance application: writes `data-theme` plus live CSS token
 * overrides on <html> from settings (tokens.css defines the Islands Dark
 * `:root` and Islands Light `[data-theme="light"]` palettes).
 */
import type { Settings, ThemeId } from "./settings";

export function applyTheme(theme: ThemeId): void {
  const html = document.documentElement;
  if (theme === "light") html.setAttribute("data-theme", "light");
  else html.removeAttribute("data-theme");
}

export function currentTheme(): ThemeId {
  return document.documentElement.hasAttribute("data-theme") ? "light" : "dark";
}

/** Editor font size is a CSS token, so the setting applies live to every view. */
export function applyFontSize(px: number): void {
  const size = Math.min(32, Math.max(9, Math.round(px) || 13));
  const root = document.documentElement.style;
  root.setProperty("--fs-code", `${size}px`);
  root.setProperty("--lh-code", `${Math.round(size * 1.7)}px`);
}

/** Accent override; null restores the theme default. */
export function applyAccent(hex: string | null | undefined): void {
  const root = document.documentElement.style;
  if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) root.setProperty("--accent", hex);
  else root.removeProperty("--accent");
}

/** UI zoom (Chromium zoom scales the px-token UI uniformly). */
export function applyUiScale(percent: number): void {
  const scale = Math.min(300, Math.max(50, Math.round(percent) || 100));
  document.documentElement.style.zoom = scale === 100 ? "" : String(scale / 100);
}

/** UI font size + optional family override. */
export function applyUiFont(px: number, family: string | null | undefined): void {
  const size = Math.min(20, Math.max(10, Math.round(px) || 13));
  const root = document.documentElement.style;
  root.setProperty("--fs-ui", `${size}px`);
  root.setProperty("--fs-small", `${size - 1}px`);
  root.setProperty("--fs-tiny", `${size - 2}px`);
  if (family && family.trim()) root.setProperty("--font-ui", `"${family.trim().replace(/"/g, "")}", Inter, system-ui, sans-serif`);
  else root.removeProperty("--font-ui");
}

export function applyCompact(on: boolean): void {
  if (on) document.documentElement.setAttribute("data-compact", "");
  else document.documentElement.removeAttribute("data-compact");
}

/** Applies every appearance-related setting (boot + settings dialog Apply). */
export function applyAppearance(settings: Settings): void {
  applyTheme(settings.theme);
  applyFontSize(settings.fontSize);
  applyAccent(settings.accent);
  applyUiScale(settings.uiScale ?? 100);
  applyUiFont(settings.uiFontSize ?? 13, settings.uiFontFamily);
  applyCompact(settings.compact ?? false);
}
