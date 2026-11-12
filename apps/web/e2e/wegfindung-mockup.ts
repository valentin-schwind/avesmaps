import type { Page } from "@playwright/test";
import { gabe, type PanelGabe } from "./wegfindung-werte.ts";

/**
 * Mockup „Wegfindung“ in der Systemsteuerung (WI-0153, Betreiber 2026-10-15 nach der Entscheidung zum Fangradius
 * 0,02: „ich möchte nun folgende option haben: in der systemsteuerung: ‚Wegfindung‘ … ein mockup mit den wichtigsten
 * und derzeitigen einstellungen zur Wegfindung“).
 *
 * 🔴 **Am App-Code ist nichts geändert, und die Sprachtafeln sind nicht angefasst.** Dieses Modul hängt den Reiter im
 * Browser in die GEBAUTE Systemsteuerung ein: eine Zeile in der Schiene unter „System & Betrieb“, ein Rumpf aus
 * geklonten Bausteinen und die Fußzeile des Fensters. Die Werte stehen in `wegfindung-werte.ts`.
 *
 * **Warum geklont.** Die Bausteine des Hauses (`AvmHinweis`, `FensterKarte`, `AvmKnopf`, `AvmEingabe`, `AvmStatus`,
 * `AvmKreis`) tragen ihr Aussehen in `<style scoped>`, also hinter einem `data-v-…`-Merkmal. Eigenes Markup bekäme
 * davon nichts. Darum sammelt das Modul Merkmale und ganze Bausteine aus einem Reiter, der sie zeigt (das
 * Höhenmodell samt seinem Formular „⊕ Neuer Entwurf“), und baut den Rumpf daraus.
 *
 * **Die Form** (Betreiber 2026-10-15, drei Vorgaben nacheinander):
 *
 * - **Drei Panele** mit festen Namen: „Allgemeine Wegfindungseinstellungen“, „Dijkstra-Einstellungen“,
 *   „A* Einstellungen“. Unter jeder Überschrift eine ruhige Zeile, wann die Werte greifen; damit steht die
 *   Zuordnung da, ohne dass eine Überschrift etwas behauptet, was der Code nicht tut.
 * - **Zwei Spalten je Zeile:** links Kreis, Name, Feld und Einheit (feste Spalten, damit die Felder fluchten),
 *   rechts der eine Satz in Alltagssprache, darunter leise die Herkunft. Am Telefon fallen sie untereinander.
 * - **Der Bestand, kein Auszug:** „grundsätzlich soll da alles stehen, was zentrale kenngrößen sind“.
 * - Alle Werte sind änderbar, auch die aus dem Reisemodell; die Pille „fest“ ist weg.
 *
 * 🪤 Eine Gruppe „Oberfläche“ mit dem Platzhalter „Kommt später: Schwellen der Darstellung“ stand in der ersten Runde
 * im Blatt und ist wieder heraus (Betreiber: „den unterpunkt ‚Oberfläche‘ hab ich nicht bei Wegfindung gemeint“).
 */

const TEXTE = {
    reiter: "Wegfindung",
    reiterWert: "0,02",
    einleitungErst: "Die Wegfindung",
    einleitung:
        "rechnet jede Route auf dem gezeichneten Wegenetz, und wo kein Weg liegt, auf einem Raster. Hier stehen " +
        "die Kenngrößen beider Verfahren. Eine Änderung gilt erst, wenn das Wegenetz neu berechnet ist.",
    folge: "Gilt erst nach dem Neuberechnen des Wegenetzes. Danach ändern sich Routen für alle.",
    handlung: "Wegenetz neu berechnen",
    fuss:
        "Ändern fragt nach dem Passkey und steht im Protokoll. Wirksam wird es erst mit dem Neuberechnen des " +
        "Wegenetzes, und dann nur für diese Umgebung.",
    keinRecht: "Ändern braucht das Recht „Systemschalter“.",
    abweichend: "abweichend",
    zurueck: "Auf die Vorgabe zurücksetzen",
    zurueckWert: "Auf die Vorgabe zurücksetzen: {wert}",
    zurueckRuht: "Steht schon auf der Vorgabe",
    // Die Leiste ganz oben: links der Zustand des Wegenetzes, rechts der eine Auslöser.
    gebaut: "Zuletzt gebaut: heute 21:14",
    offen: "1 Wert geändert, noch nicht gerechnet",
    ruhig: "keine offenen Änderungen",
    laeuft: "läuft seit 0:12",
    kreisLauf: "wird gerade gerechnet",
};

/**
 * Maße und Farben nur aus `canon.css`.
 *
 * **Zwei Säulen je Panel** (Betreiber 2026-10-15: „perfekt“ zu dieser Form): zwei Einstellungen nebeneinander, je
 * Einstellung Name, Feld, Einheit und das Rücksetzzeichen in einer Zeile, der erklärende Satz darunter.
 *
 * **Kein Kreis vor dem Namen** (Betreiber: „die grünen punkte kannst du weglassen“): In dieser Liste trug er keine
 * Auskunft, jede Zeile war dieselbe. Was sich unterscheidet, steht ohnehin da: die Zeile „statt 0,02“ und das wache
 * Rücksetzzeichen. Der Kreis der Leiste oben bleibt, denn dort sagt er etwas.
 *
 * Je Wert feste Spalten, sonst flackert die Feldspalte von Zeile zu Zeile: Name, Feld, Einheit, Rücksetzen.
 */
const CSS = `
.mock-wegfindung { display: flex; flex-direction: column; gap: var(--space-10); min-width: 0; }
.mock-wegfindung .hinweis strong { font-weight: 400; color: var(--color-accent-strong); }
.mock-leise { margin: 0; color: var(--color-text-muted); font-size: var(--font-size-small); }
.mock-wirkung { margin: 0 0 var(--space-6); color: var(--color-text-muted); font-size: var(--font-size-small); }
/* Die Leiste ganz oben: der Zustand des Wegenetzes und der EINE Auslöser. */
.mock-netz { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-6) var(--space-10); padding: var(--space-8) var(--space-12); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-panel-muted); }
.mock-netz__stand { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-6); min-width: 0; color: var(--color-text); font-size: var(--font-size-small); }
.mock-netz__offen { color: var(--color-accent-strong); }
.mock-werte { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-8) var(--space-24); margin: 0; align-items: start; }
/*
 * Das Feld beginnt in JEDER Zeile an derselben Stelle: im Goldenen Schnitt der Säule (Betreiber 2026-10-15,
 * mit einem Strich je Säule ins Bild gezeichnet). Vorher war die Einheitenspalte "auto" und damit je Zeile
 * verschieden breit, und weil jede Zeile ihr eigenes Raster ist, wanderte das Feld mit.
 */
.mock-wert { display: grid; grid-template-columns: minmax(0, 61.8%) 96px minmax(92px, 1fr) var(--space-24); gap: var(--space-2) var(--space-6); align-items: center; min-width: 0; }
.mock-wert__name { min-width: 0; }
.mock-wert__feld { display: flex; min-width: 0; }
.mock-wert__feld .eingabe-huelle, .mock-wert__feld .eingabe { width: 100%; }
.mock-wert__einheit { color: var(--color-text-muted); font-size: var(--font-size-small); white-space: nowrap; }
.mock-wert__satz { grid-column: 1 / -1; margin: 0; color: var(--color-text-muted); font-size: var(--font-size-small); }
/* Was eine Aenderung nach sich zieht: am Ende des Satzes, damit es an JEDER Zeile steht. */
.mock-wert__wirkt--netz, .mock-wert__wirkt--seegraph { color: var(--color-accent-strong); }
.mock-wert__unten { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-8); margin: 0; color: var(--color-text-muted); font-size: var(--font-size-small); }
.mock-wert__unten .status { font-size: var(--font-size-small); }
.mock-wert__folge { color: var(--color-accent-strong); }
/*
 * Rücksetzen: quadratisch und so hoch wie das Feld. Steht der Wert auf der Vorgabe, ist das Zeichen still: ohne Rand
 * und Fläche, aber lesbar.
 * Die Scoped-Regel des Knopfs ist ".knopf[data-v-...]:disabled" und damit genauso spezifisch wie
 * ".x .knopf:disabled"; bei Gleichstand entscheidet die Reihenfolge, und Vite haengt seine Stile nach.
 * Darum steht hier eine Klasse mehr davor.
 */
.mock-wegfindung .mock-wert__zurueck .knopf { width: var(--space-24); min-width: var(--space-24); padding-inline: 0; }
.mock-wegfindung .mock-wert__zurueck .knopf:disabled { border-color: transparent; background: transparent; color: var(--color-text-muted); opacity: 0.7; cursor: default; }
/* Die Zwischenüberschriften stehen über beide Säulen, nicht in einer. */
.mock-abschnitt { grid-column: 1 / -1; margin: var(--space-6) 0 0; color: var(--color-accent-strong); font-size: var(--font-size-small); }
.mock-abschnitt:first-child { margin-top: 0; }
@media (max-width: 900px) {
    .mock-werte { grid-template-columns: minmax(0, 1fr); }
}
`;

export interface WegfindungForm {
    /** Die Zeile „Fangradius am Wegende“ im geänderten Zustand zeigen (Vorgabe `true`). */
    geaendert?: boolean;
    /** Der Zustand des Wegenetzes in der Leiste oben; ohne Angabe „eine Änderung offen“. */
    netz?: "offen" | "ruhig" | "laeuft";
    /** Ohne das Recht „Systemschalter“: Felder und Knopf ruhen, der Satz steht oben (Vorgabe `false`). */
    ohneRecht?: boolean;
}

/**
 * Hängt den Reiter ein. Muss vor `page.goto` laufen: Das Skript stellt Schiene, Rumpf und Fuß nach jeder Änderung am
 * DOM wieder her, weil Vue das Fenster beim Wechsel des Eintrags neu zeichnet.
 *
 * 🪤 Die Bausteine werden gesammelt, solange sie dastehen. Die Spec öffnet darum erst das Höhenmodell (und darin
 * „⊕ Neuer Entwurf“, der die Eingabefelder zeigt) und wählt danach „Wegfindung“.
 */
export async function mockupWegfindung(page: Page, form: WegfindungForm = {}): Promise<void> {
    await page.addInitScript(
        ({
            css,
            panele,
            texte,
            form: wahl,
        }: {
            css: string;
            panele: PanelGabe[];
            texte: typeof TEXTE;
            form: { geaendert: boolean; ohneRecht: boolean; netz: "offen" | "ruhig" | "laeuft" };
        }) => {
            /** Die `data-v-…`-Merkmale je Baustein und eine Vorlage zum Klonen, gesammelt aus einem echten Reiter. */
            const merkmale: Record<string, string[]> = {};
            const vorlagen: Record<string, HTMLElement> = {};

            const sammle = (name: string, gefunden: HTMLElement | null, ganz = false): void => {
                if (vorlagen[name] !== undefined || gefunden === null) return;
                if (gefunden.closest(".mock-wegfindung") !== null) return;
                merkmale[name] = gefunden.getAttributeNames().filter((attr) => attr.startsWith("data-v-"));
                vorlagen[name] = gefunden.cloneNode(ganz) as HTMLElement;
            };
            /**
             * Gesucht wird NUR im Fenster „Systemsteuerung“: Im Rumpf der Seite stehen auch andere, geschlossene
             * Fenster, und aus einem davon gesammelte Bausteine sähen anders aus.
             */
            const fenster = (): ParentNode | null => document.querySelector('[data-testid="systemsteuerung-fenster"]');
            const such = (selektor: string): HTMLElement | null =>
                fenster()?.querySelector<HTMLElement>(selektor) ?? null;

            const sammleAlles = (): void => {
                sammle("hinweis", such(".hinweis"));
                sammle("karte", such(".fenster-karte"));
                sammle("karteTitel", such(".fenster-karte__titel"));
                sammle("kreis", such(".avm-kreis"));
                sammle("status", such(".status"), true);
                sammle("knopf", such('[data-testid="hoehenmodell-zurueck"]')?.closest("span") ?? null, true);
                sammle("eingabe", such(".eingabe-huelle"), true);
            };

            /** Ein eigenes Element mit dem Aussehen eines Bausteins: dessen Merkmale, eigene Kinder. */
            const bau = (tag: string, klassen: string, baustein?: string): HTMLElement => {
                const element = document.createElement(tag);
                element.className = klassen;
                for (const attr of merkmale[baustein ?? ""] ?? []) element.setAttribute(attr, "");
                return element;
            };
            const klon = (baustein: string): HTMLElement | null =>
                (vorlagen[baustein]?.cloneNode(true) as HTMLElement | undefined) ?? null;
            const text = (tag: string, klassen: string, inhalt: string): HTMLElement => {
                const element = document.createElement(tag);
                element.className = klassen;
                element.textContent = inhalt;
                return element;
            };

            /** Der Kreis des Hauses: ● gilt im Netz, ◐ eingetragen und noch nicht gerechnet. */
            const kreis = (fuellung: "voll" | "halb", name: string): HTMLElement => {
                const element = bau("span", `avm-kreis avm-kreis--${fuellung}`, "kreis");
                element.setAttribute("role", "img");
                element.setAttribute("aria-label", name);
                element.setAttribute("title", name);
                element.dataset["kreis"] = fuellung;
                return element;
            };

            /** Der Statuspunkt des Hauses (`AvmStatus`): das stille Zeichen für eine Abweichung. */
            const status = (ton: string, wort: string): HTMLElement => {
                const element = klon("status") ?? document.createElement("span");
                element.className = `status status--${ton}`;
                element.removeAttribute("data-testid");
                const innen = element.querySelector(".status__text") ?? element;
                innen.textContent = wort;
                return element;
            };

            /** Ein Eingabefeld mit Wert. */
            const eingabe = (wert: string, gesperrt: boolean): HTMLElement => {
                const huelle = klon("eingabe") ?? document.createElement("span");
                huelle.querySelector("[data-testid]")?.removeAttribute("data-testid");
                const feld = huelle.querySelector<HTMLInputElement>("input");
                if (feld !== null) {
                    feld.value = wert;
                    feld.removeAttribute("placeholder");
                    feld.removeAttribute("id");
                    feld.removeAttribute("aria-describedby");
                    feld.setAttribute("inputmode", "decimal");
                    feld.disabled = gesperrt;
                }
                huelle.querySelector(".eingabe")?.classList.toggle("is-gesperrt", gesperrt);
                return huelle;
            };

            /** Ein Backend-Knopf mit abstraktem Zeichen (AGENTS.md „Editor: abstrakte Zeichen“). */
            const knopf = (zeichen: string, wort: string, gesperrt: boolean): HTMLElement => {
                const huelle = klon("knopf") ?? document.createElement("span");
                const taste = huelle.querySelector<HTMLButtonElement>("button");
                if (taste !== null) {
                    taste.className = "knopf knopf--gefuellt knopf--zeile";
                    taste.disabled = gesperrt;
                    taste.removeAttribute("title");
                    taste.removeAttribute("aria-describedby");
                    taste.dataset["testid"] = "wegfindung-rechnen";
                    const beschriftung = taste.querySelector(".knopf__text") ?? taste;
                    beschriftung.replaceChildren();
                    const marke = document.createElement("span");
                    marke.setAttribute("aria-hidden", "true");
                    marke.textContent = `${zeichen} `;
                    beschriftung.append(marke, document.createTextNode(wort));
                }
                for (const rest of huelle.querySelectorAll(".knopf-huelle > :not(button)")) rest.remove();
                return huelle;
            };

            /**
             * Das Rücksetzen hinter einem Wert: nur das Zeichen ↺, der Name steht im `title` und für Vorleser
             * (Betreiber 2026-10-15: „kannst du hinter jeden wert ein reset button machen, der den wert auf den
             * default zurücksetzt?“). Steht der Wert schon auf der Vorgabe, ruht der Knopf mit seinem Grund.
             */
            const zuruecksetzen = (vorgabe: string | null, gesperrt: boolean): HTMLElement => {
                const huelle = klon("knopf") ?? document.createElement("span");
                huelle.className = "knopf-huelle mock-wert__zurueck";
                const taste = huelle.querySelector<HTMLButtonElement>("button");
                if (taste !== null) {
                    taste.className = "knopf knopf--weich knopf--zeile";
                    taste.disabled = gesperrt || vorgabe === null;
                    taste.removeAttribute("aria-describedby");
                    taste.removeAttribute("data-testid");
                    const name = vorgabe === null ? texte.zurueckRuht : texte.zurueckWert.replace("{wert}", vorgabe);
                    taste.title = name;
                    taste.setAttribute("aria-label", name);
                    const beschriftung = taste.querySelector(".knopf__text") ?? taste;
                    beschriftung.replaceChildren();
                    const marke = document.createElement("span");
                    marke.setAttribute("aria-hidden", "true");
                    marke.textContent = "↺";
                    beschriftung.append(marke);
                }
                for (const rest of huelle.querySelectorAll(".knopf-huelle > :not(button)")) rest.remove();
                return huelle;
            };

            /** Eine Einstellung: Name, Feld, Einheit und das Rücksetzen in einer Zeile, der Satz darunter. */
            const wertZeile = (wert: PanelGabe["werte"][number]): HTMLElement => {
                const reihe = document.createElement("div");
                reihe.className = "mock-wert";
                const geaendert = wert.neu !== undefined && wahl.geaendert;
                // Kein Kreis vor dem Namen (Betreiber 2026-10-15): In dieser Liste sagte er nichts.
                reihe.append(text("span", "mock-wert__name", wert.name));

                const feld = document.createElement("span");
                feld.className = "mock-wert__feld";
                feld.append(eingabe(geaendert ? (wert.neu ?? "") : (wert.abweichend ?? wert.wert), wahl.ohneRecht));
                reihe.append(feld);
                // Hinter dem Wert: Zurück auf die Vorgabe. Steht er schon dort, ruht der Knopf.
                const vorgabe = geaendert || wert.abweichend !== undefined ? wert.wert : null;
                // Was eine Änderung nach sich zieht, steht an JEDER Zeile (Betreiber 2026-10-15: „nicht vergessen,
                // schreib immer dazu, welche werte eine neuberechnung erforderlich machen“).
                const satz = text("p", "mock-wert__satz", `${wert.satz} `);
                satz.append(text("span", `mock-wert__wirkt mock-wert__wirkt--${wert.folge}`, wert.folgeSatz));
                reihe.append(
                    text("span", "mock-wert__einheit", geaendert ? (wert.nebenNeu ?? "") : wert.neben),
                    zuruecksetzen(vorgabe, wahl.ohneRecht),
                    satz,
                );

                // Unter dem Satz, leise: die Herkunft, die Abweichung oder die Folge einer Änderung.
                const unten = document.createElement("p");
                unten.className = "mock-wert__unten";
                if (geaendert) {
                    unten.append(text("span", "", `statt ${wert.wert} ${wert.neben}`));
                    unten.append(text("span", "mock-wert__folge", texte.folge));
                }
                if (wert.herkunft !== undefined) {
                    unten.append(text("span", "", wert.herkunft));
                    // Das Feld trägt den eingestellten Wert, die Zeile darunter den der Herkunft: jede Zahl einmal.
                    if (wert.abweichend !== undefined) unten.append(status("warnung", texte.abweichend));
                }
                if (unten.childElementCount > 0) reihe.append(unten);
                return reihe;
            };

            /**
             * Die Leiste ganz oben: links der Zustand des Wegenetzes, rechts der EINE Auslöser (Betreiber
             * 2026-10-15: „du hast einen link, der soll da hinführen, wo ich das kann. falls es nichts gibt, dann
             * will ich den button ganz oben als zentralen auslöser“ — es gibt nichts, also steht er hier).
             * Der Kreis steht nur, wenn er etwas sagt: während eines Laufs.
             */
            const netzleiste = (): HTMLElement => {
                const leiste = document.createElement("div");
                leiste.className = "mock-netz";
                leiste.dataset["testid"] = "wegfindung-netz";
                const stand = document.createElement("div");
                stand.className = "mock-netz__stand";
                if (wahl.netz === "laeuft") stand.append(kreis("halb", texte.kreisLauf));
                stand.append(text("span", "", `${texte.gebaut} ·`));
                stand.append(
                    wahl.netz === "ruhig"
                        ? text("span", "", texte.ruhig)
                        : text("span", "mock-netz__offen", wahl.netz === "laeuft" ? texte.laeuft : texte.offen),
                );
                leiste.append(stand, knopf("↺", texte.handlung, wahl.ohneRecht || wahl.netz !== "offen"));
                return leiste;
            };

            /** Der Rumpf des Reiters: drei Panele. */
            const rumpf = (): HTMLElement => {
                const wurzel = document.createElement("div");
                wurzel.className = "mock-wegfindung";
                wurzel.dataset["testid"] = "wegfindung";

                const hinweis = bau("div", "hinweis hinweis--neutral", "hinweis");
                const erst = document.createElement("strong");
                erst.textContent = texte.einleitungErst;
                hinweis.append(erst, document.createTextNode(` ${texte.einleitung}`));
                wurzel.append(hinweis);
                if (wahl.ohneRecht) wurzel.append(text("p", "mock-leise", texte.keinRecht));
                wurzel.append(netzleiste());

                for (const panel of panele) {
                    const karte = bau("section", "fenster-karte", "karte");
                    const titel = bau("h3", "fenster-karte__titel", "karteTitel");
                    titel.append(text("span", "", panel.titel));
                    karte.append(titel, text("p", "mock-wirkung", panel.wirkung));
                    const liste = document.createElement("div");
                    liste.className = "mock-werte";
                    for (const wert of panel.werte) {
                        if (wert.abschnitt !== undefined)
                            liste.append(text("h4", "mock-abschnitt avm-versalmitte", wert.abschnitt));
                        liste.append(wertZeile(wert));
                    }
                    karte.append(liste);
                    wurzel.append(karte);
                }

                // Kein zweiter Auslöser unten: Es gibt genau einen, und der steht oben in der Leiste.
                return wurzel;
            };

            let gewaehlt = false;
            let baut = false;

            /** Die Zeile in der Schiene, hinter „Höhenmodell“. */
            const einhaengen = (): HTMLElement | null => {
                const vorhanden = such('[data-testid="verwaltung-eintrag-wegfindung"]');
                if (vorhanden !== null) return vorhanden;
                const nachbar = such('[data-testid="verwaltung-eintrag-hoehenmodell"]');
                const liste = nachbar?.closest("li") ?? null;
                if (nachbar === null || liste === null) return null;
                const eigen = document.createElement("li");
                eigen.dataset["mockup"] = "wegfindung";
                const taste = document.createElement("button");
                taste.type = "button";
                taste.className = nachbar.className.replace("is-aktiv", "").trim();
                taste.dataset["testid"] = "verwaltung-eintrag-wegfindung";
                const name = text("span", "fenster-schiene__name avm-versalmitte", texte.reiter);
                const wert = text("span", "fenster-schiene__wert avm-versalmitte", texte.reiterWert);
                for (const attr of nachbar.getAttributeNames())
                    if (attr.startsWith("data-v-")) {
                        taste.setAttribute(attr, "");
                        name.setAttribute(attr, "");
                        wert.setAttribute(attr, "");
                    }
                taste.append(name, wert);
                taste.addEventListener("click", () => {
                    gewaehlt = true;
                    anwenden();
                });
                liste.after(eigen);
                eigen.append(taste);
                return taste;
            };

            function anwenden(): void {
                if (baut) return;
                baut = true;
                try {
                    sammleAlles();
                    const taste = einhaengen();
                    if (taste === null) return;
                    taste.classList.toggle("is-aktiv", gewaehlt);
                    if (gewaehlt) taste.setAttribute("aria-current", "page");
                    else taste.removeAttribute("aria-current");
                    if (!gewaehlt) return;
                    for (const andere of fenster()?.querySelectorAll<HTMLElement>(".fenster-schiene__eintrag") ?? [])
                        if (andere !== taste) {
                            andere.classList.remove("is-aktiv");
                            andere.removeAttribute("aria-current");
                        }
                    const inhalt = such(".verwaltung__inhalt");
                    if (inhalt !== null && inhalt.querySelector(".mock-wegfindung") === null) {
                        inhalt.replaceChildren(rumpf());
                        inhalt.dataset["testid"] = "verwaltung-wegfindung";
                    }
                    const fuss = such(".avm-fenster__fuss-hinweis");
                    if (fuss !== null && fuss.textContent !== texte.fuss) fuss.textContent = texte.fuss;
                } finally {
                    baut = false;
                }
            }

            const start = (): void => {
                const stil = document.createElement("style");
                stil.dataset["mockup"] = "wegfindung";
                stil.textContent = css;
                document.head.append(stil);
                new MutationObserver(anwenden).observe(document.body, { childList: true, subtree: true });
                anwenden();
            };
            if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
            else start();
        },
        {
            css: CSS,
            panele: gabe(),
            texte: TEXTE,
            form: {
                geaendert: form.geaendert ?? true,
                ohneRecht: form.ohneRecht ?? false,
                netz: form.netz ?? "offen",
            },
        },
    );
}
