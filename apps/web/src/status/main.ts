import { createApp } from "vue";
// 🔴 VOR der Anwendung: die Hausschrift und jede Farbe, Größe und jeden Abstand als CSS-Variable (aus config/design-canon).
import "../styles/canon.css";
import "./status-page.css";
import StatusApp from "./status-app.vue";
import { applyTheme, followSystemTheme, theme } from "../theme/theme";
import { applyLocale, ladeStarttafel, locale } from "../i18n/i18n";

/**
 * Einstieg der Statusseite (`status.html`, WI-0074): eine eigene Seite ohne Karte, mit denselben Sprachtafeln, demselben Kanon und
 * demselben Thema wie die Karte. Sie liegt neben `index.html` und wird mit ihr gebaut (`vite.config.ts`).
 */
applyTheme(theme.value);
followSystemTheme();
applyLocale(locale.value);

// Erst die Sprachtafel, dann einhängen (WI-0235: nur Deutsch steht im Startpaket); ohne sie auf Deutsch.
void ladeStarttafel().then(() => createApp(StatusApp).mount("#status"));
