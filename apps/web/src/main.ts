// 🔴 ZUERST die Fänger für Fehler im Browser (WI-0202): Sie stehen, bevor irgendein anderes Modul ausgewertet wird.
import "./besuch/fehler-start";
import { createApp } from "vue";
// 🔴 VOR der Anwendung. Die Datei bringt die Hausschrift und jede Farbe, Groesse und jeden Abstand
// als CSS-Variable mit; sie ist erzeugt aus config/design-canon/avesmaps.json (WI-0014). Eine
// Komponente, die einen Wert braucht, nimmt ihn von hier - nie als eigenes Literal.
import "./styles/canon.css";
import App from "./app.vue";
import { applyTheme, followSystemTheme, theme } from "./theme/theme";
import { applyLocale, ladeStarttafel, locale, t } from "./i18n/i18n";
import { openAuthWindow, windowForEditorStart, windowForEntry } from "./auth/auth-windows";
import { GOOD_OUTCOMES, isEditorAddress, readEntry, takeRememberedLink, takeRememberedView } from "./auth/entry";
import { folgeSeitentitel } from "./auth/seitentitel";
import { authState, followLateSession, loadSession } from "./auth/session-state";
import { ladeStartansicht } from "./map/start-view";
import { ladeKartenserien } from "./map/kartenserien-stand";
import { ladeZoombaender } from "./map/zoombaender-stand";
import { adminWindowFor, readAdminLink } from "./auth/verwaltung";
import { secondFactorMissing } from "./auth/zweiter-faktor";
import { showToast } from "./feedback/toast";
import { faengeVueFehler, oberflaecheSteht, startGescheitert } from "./besuch/fehler-faenger";
import { useNeueVersion } from "./system/neue-version";
import { ladeEditorVor } from "./nachladen";
import { oeffneStatus } from "./community/community-besucher";
import { ergebnisSatz, nimmSchluessel } from "./community/discord-verbinden";
import { oeffneReisebildStatus } from "./photobox/reisebild-besucher";
import { oeffneKartenvorschlagStatus } from "./kartenvorschlag/kartenvorschlag-besucher";

// Ein nachgeladener Teil fehlt (WI-0235: Editorfenster, Sprachtafeln). Meist steht der Tab über ein Release offen, und die Stage hat
// die alten Dateien schon entfernt. „Neue Version“ fragt dann sofort nach und bietet „Neu laden“ an; nie automatisch neu laden.
globalThis.addEventListener("vite:preloadError", () => void useNeueVersion().pruefe());

/*
 * 🔴 Die SEITE zoomt nie per Pinch, nur die Karte (Betreiber 2026-09-24). iOS Safari zoomt die
 * ganze Seite, sobald eine Zwei-Finger-Geste auf einem Bedienelement beginnt, und kehrt nicht
 * zurück - `user-scalable=no` ignoriert es. Seine eigenen Gestenereignisse lassen sich aber
 * abfangen. MapLibre liest Touch-Ereignisse, keine Gesten: Pinch, Drehen und Neigen der Karte
 * bleiben unberührt.
 */
for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
}

// Das Thema steht schon (Kopf der Seite); hier kommt die Farbe der Browserleiste dazu, und ohne
// eigene Wahl zieht die Seite mit, wenn jemand sein System umstellt.
applyTheme(theme.value);
followSystemTheme();
// Die Sprache aus `?lang=` oder dem Speicher: das Attribut `lang` an <html> folgt ihr (WI-0032).
applyLocale(locale.value);

// Ein Link der Anmeldung (`/einladung#…`) oder die Rückkehr von Discord (`?anmeldung=…`): VOR dem Start lesen und aus der
// Adresse nehmen, bevor die Karte ihren Ausschnitt ins Fragment schreibt (`auth/entry.ts`). Nach der Rückkehr kommt der
// gemerkte Ausschnitt zurück, damit die Karte dort weitermacht, wo sie vor dem Umweg stand.
const entry = readEntry(window.location);
if (entry.url !== null) history.replaceState(history.state, "", entry.url);
// Ein gemerkter Link (erster Passkey) überlebt die Anmeldung: nach Discord mit, nach dem Passwort ohne `?anmeldung=`. Discord
// kehrt ohne Sitzung über `/anmelden` zurück (`discordReturnPath`), also auch dort.
const returned = entry.link === null || (entry.link.kind === "login" && entry.outcome !== null);
const remembered = returned ? takeRememberedLink() : null;
if (entry.outcome !== null && window.location.hash === "") {
    const view = takeRememberedView();
    if (view !== null)
        history.replaceState(history.state, "", `${window.location.pathname}${window.location.search}${view}`);
}

// Der tiefe Link in die Verwaltung (`?verwaltung=<eintrag>`, SYS-0001 §9d.1): einmal lesen, dann aus der Adresse.
const adminLink = readAdminLink(window.location.search);
if (adminLink.eintrag !== null)
    history.replaceState(history.state, "", `${window.location.pathname}${adminLink.search}${window.location.hash}`);

// Die Sitzung VOR dem Start: aus ihr entsteht die Ansicht (`viewer/bootstrap-viewer.ts`). Höchstens 2,5 s, danach ohne.
// Daneben die Startansicht aus den Karteneinstellungen (WI-0166, `map/start-view.ts`) und die Kartenserien (WI-0220,
// `map/kartenserien-stand.ts`): gleichzeitig, also ohne eigene Wartezeit. Ebenso die Sprachtafel, wenn sie nicht Deutsch ist
// (WI-0235): Das erste Bild steht gleich in der richtigen Sprache; kommt sie nicht, startet die Seite auf Deutsch.
void Promise.all([loadSession(), ladeStartansicht(), ladeKartenserien(), ladeZoombaender(), ladeStarttafel()])
    // Editoren bekommen ihre Fenster vor dem Einhängen (WI-0235, `nachladen.ts`); Besucher laden sie nie.
    .then(() =>
        authState.value.capabilities.includes("use_editor_menu") ? ladeEditorVor().catch(() => undefined) : undefined,
    )
    .then(() => {
        // Der Browsertitel folgt der Sitzung: „Avesmaps3D · Editor“ mit Anmeldung (`auth/seitentitel.ts`).
        folgeSeitentitel();
        const app = createApp(App);
        faengeVueFehler(app);
        app.mount("#app");
        oberflaecheSteht();
        // `/meldung#…`: die Statusseite einer Meldung (WI-0268 C2); der Schlüssel ist schon aus der Adresse genommen (`readEntry`).
        // Kommt der Melder von Discord zurück (`?discord=<Ergebnis>`), trägt die Adresse keinen Schlüssel: Er kommt aus dem Speicher dieses Tabs (WI-0268 C8), und das Ergebnis steht als Toast.
        if (entry.status !== undefined) {
            const gemerkt = entry.discord === undefined ? null : nimmSchluessel();
            oeffneStatus(entry.status ?? gemerkt);
            if (entry.discord !== undefined) {
                const satz = ergebnisSatz(entry.discord);
                showToast(t(satz.key), satz.ton);
            }
        }
        // `/reisebild#…`: die Statusseite eines Reisebilds (WI-0272 S2b); der Schlüssel ist ebenfalls schon aus der Adresse genommen.
        if (entry.reisebild !== undefined) oeffneReisebildStatus(entry.reisebild);
        // `/kartenvorschlag#…`: die Statusseite eines Kartenvorschlags (WI-0275 Stufe C), ebenso.
        if (entry.kartenvorschlag !== undefined) oeffneKartenvorschlagStatus(entry.kartenvorschlag);
        // `/paket#…`: der Token-Link der Karten (WI-0280), ebenso.
        if (entry.kartenPaket !== undefined) openAuthWindow({ name: "kartenPaket", token: entry.kartenPaket });
        // Ohne Link und Rückkehr: `/edit` ohne Anmeldung öffnet das Anmeldefenster (WI-0203). Kam keine Antwort, fragt die Seite
        // im Hintergrund weiter nach; bringt die späte Antwort eine Person, lädt sie in den Editormodus.
        const opening =
            windowForEntry(entry, remembered, authState.value.person !== null, secondFactorMissing(authState.value)) ??
            windowForEditorStart(authState.value, window.location);
        if (!authState.value.known && isEditorAddress(window.location)) void followLateSession();
        if (opening !== null) openAuthWindow(opening);
        else if (entry.outcome !== null && GOOD_OUTCOMES.has(entry.outcome)) {
            showToast(t(`auth.return.${entry.outcome}`), "success");
        }
        // Ein Link der Anmeldung geht vor; sonst öffnet der tiefe Link das Fenster, das den Eintrag trägt (nur mit dem Recht).
        const adminOpening = opening === null ? adminWindowFor(adminLink.eintrag, authState.value.capabilities) : null;
        if (adminOpening !== null)
            openAuthWindow({ ...adminOpening, ...(adminLink.ops === undefined ? {} : { ops: adminLink.ops }) });
    })
    .catch(startGescheitert);
