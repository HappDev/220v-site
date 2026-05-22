const THEME_COLOR = "#0a0a0a";

/** Keep Safari toolbar/status tint aligned with the site background. */
export function pinSafariThemeColor(): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR);
  document.documentElement.style.setProperty("theme-color", THEME_COLOR);
}
