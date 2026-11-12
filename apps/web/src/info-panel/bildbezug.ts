import type { PhotoboxOrtEingaenge } from "@avesmaps3d/shared";
import type { AnsichtBild } from "../controls/avm-bildansicht-modell";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import { ohneKiZeigbar } from "../photobox/ohne-ki";
import type { HeaderImage } from "./panel-types";

/**
 * Der Bildbezug auf dem Kopfbild (Betreiber 2026-10-11, wörtlich „1A … 2 B … 3 A ja das gilt für alle“; Arbeitsanweisung
 * `project-control/work-items/bildbezug-ortsansicht-typbild-2026-10-11.md`, Mockup `project-control/mockups/bildbezug-2026-10-11.html`).
 *
 * Jedes sichtbare Kopfbild trägt unten rechts eine kleine Beschriftung (3: für ALLE Objekte):
 * - **Ortsansicht** (`place_view`): das Bild stellt den Ort dar. Bildsymbol und kleine Plakette; klickbar, öffnet die Bildansicht mit
 *   den Ortsansichten der Folge. **Ortsansichten**, wenn die gelieferte Folge mehr als eine trägt: die Anzahl der Ortsansichten
 *   entscheidet, nicht, ob der Ort bedeutend ist.
 * - **Typbild** (`type_image`): das Bild veranschaulicht nur. Nur die Schrift, halb durchsichtig mit Schatten; nicht klickbar.
 * - **Reisebild** (`reisebild`, WI-0272 S5): das freigegebene Bild eines Besuchers. Plakette „Reisebild von {Name}“, ohne freiwilligen Namen „anonym“ (die Nennung der Karte, WI §12 Frage 2);
 *   klickbar wie eine Ortsansicht, die Bildansicht zeigt Ortsansichten UND Reisebilder der Folge.
 * - **Eingang** (nur für Editoren, WI-0272 S5): ein offener, noch nicht geprüfter Beitrag zu diesem Ort. Gestrichelt „Eingang · wartet auf Prüfung“; nicht klickbar, nicht in der Bildansicht.
 * - **Die Grafik der Art** (Kopfgrafik ohne eigene Bilder: Orte, Wege, Flächen, Gipfel, Gebiete, Etappen, Kraftlinien) ist immer Typbild.
 *
 * 🔴 Die Oberfläche liest den Bezug aus dem Feld `relation` des Servers und schließt nie aus der Zahl der Bilder darauf. Ein fehlendes
 * oder unbekanntes Feld ist Typbild, nie Ortsansicht und nie Reisebild („Fehlende oder unsichere fachliche Zuordnung nicht als
 * bestätigte Ortsansicht ausgeben“).
 */

export type Bildbezug = "ortsansicht" | "typbild" | "reisebild" | "eingang";

export interface Plakette {
    bezug: Bildbezug;
    /** Der Sprachschlüssel der Beschriftung: Ortsansicht, Ortsansichten, Typbild, Reisebild oder Eingang. */
    text: MessageKey;
    /** Nur beim Reisebild: der genannte Name, ohne Angabe „anonym“ (`nennungsName`). */
    name?: string;
    /** Öffnet ein Klick die Bildansicht? Eine Ortsansicht und ein Reisebild. */
    klickbar: boolean;
}

/** Stellt dieses Bild den Ort ausdrücklich dar? Nur mit dem Feld des Servers; alles andere ist Typbild. */
export const istOrtsansicht = (bild: HeaderImage | undefined): boolean => bild?.relation === "place_view";

/** Ist dies ein freigegebenes Reisebild? Nur mit dem Feld des Servers; ein Eingang ist keines. */
export const istReisebild = (bild: HeaderImage | undefined): boolean =>
    bild?.relation === "reisebild" && bild.eingang !== true;

/** Ist dies ein offener Eingang (nur Editoren)? */
export const istEingang = (bild: HeaderImage | undefined): boolean => bild?.eingang === true;

/** Die Ortsansichten einer Folge, in ihrer Reihenfolge. */
export const ortsansichten = (bilder: readonly HeaderImage[]): HeaderImage[] => bilder.filter(istOrtsansicht);

/** Die Bilder der Bildansicht: Ortsansichten und Reisebilder der Folge, in ihrer Reihenfolge (ein Eingang und die Grafik der Art gehören nicht dazu). */
export const ansichtsbilder = (bilder: readonly HeaderImage[]): HeaderImage[] =>
    bilder.filter((bild) => istOrtsansicht(bild) || istReisebild(bild));

/**
 * Darf ein Typbild eines Ortes bei „Ohne KI“ stehen bleiben? Wie eine Ortsansicht: nur ein als KI-generiert gekennzeichnetes fällt (Vali 2026-11-05: „die leute sind
 * nur allergisch gegen die KI-generierten“). Die Ohne-KI-Variante der KATEGORIE bleibt strenger: Sie gilt nur mit einer als ohne KI eingetragenen Entstehung
 * (`typbilder-quelle.ts`).
 */
const typbildOhneKi = (bild: HeaderImage): boolean => bild.ki !== true;

/**
 * Der Kopf bei „Ohne KI“ (Vali 2026-11-03: „muss auch die KI-bilder in den infoboxen filtern -> wenn keins mehr da ist, rückfall auf die typbilder wie bisher“): Reisebilder nach ihrer Entstehung (nur bekannte
 * Angaben ohne KI), Ortsansichten, die als KI-generiert gekennzeichnet sind. Bleibt nichts, kommen die zurückgehaltenen Typbilder; bleibt auch davon nichts, die Grafik der Art (leere Folge, wie bei jedem Ort
 * ohne eigenes Bild), im Modus „Ohne KI“ also die Ohne-KI-Variante der Kategorie oder der Platzhalter (`artgrafikVon`).
 *
 * 🔴 Seit WI-0281 (Betreiber 2026-11-05) gilt das auch für Typbilder: Ein als KI gekennzeichnetes Typbild eines Ortes fällt, vorn wie im Rückfall (vorher fiel ein Typbild nie); eines unbekannter Herkunft
 * bleibt wie eine Ortsansicht unbekannter Herkunft (Vali: „die leute sind nur allergisch gegen die KI-generierten“). Die Vorrangregel bleibt: Ortsansichten und Reisebilder vor Typbildern des Ortes, diese vor
 * der Grafik der Art.
 */
export function kopfOhneKi(bilder: readonly HeaderImage[], typbilder: readonly HeaderImage[]): HeaderImage[] {
    const bleiben = bilder.filter((bild) =>
        istReisebild(bild)
            ? ohneKiZeigbar(bild.reisebild?.entstehung)
            : istOrtsansicht(bild)
              ? bild.ki !== true
              : typbildOhneKi(bild),
    );
    return bleiben.length > 0 ? bleiben : typbilder.filter(typbildOhneKi);
}

/** Der Name der Nennung: der freiwillige Name des Einreichers, sonst „anonym“ (wie die Karte, `photobox.karte.anonym`). */
export function nennungsName(bild: HeaderImage): string {
    const name = bild.reisebild?.name?.trim();
    return name === undefined || name === "" ? t("photobox.karte.anonym") : name;
}

const TYPBILD: Plakette = { bezug: "typbild", text: "infoPanel.header.bildbezug.typbild", klickbar: false };
const EINGANG: Plakette = { bezug: "eingang", text: "infoPanel.header.bildbezug.eingang", klickbar: false };

/**
 * Die Beschriftung des sichtbaren Bildes. `bild` ist das gezeigte eigene Bild (`undefined`: es steht die Grafik der Art da),
 * `folge` die gelieferte Folge (nur die, die geladen werden konnten), die Mehrzahl zählt ihre Ortsansichten.
 */
export function plaketteFuer(bild: HeaderImage | undefined, folge: readonly HeaderImage[]): Plakette {
    if (bild !== undefined && istEingang(bild)) return EINGANG;
    if (bild !== undefined && istReisebild(bild)) {
        return {
            bezug: "reisebild",
            text: "infoPanel.header.bildbezug.reisebild",
            name: nennungsName(bild),
            klickbar: true,
        };
    }
    if (!istOrtsansicht(bild)) return TYPBILD;
    return {
        bezug: "ortsansicht",
        text:
            ortsansichten(folge).length > 1
                ? "infoPanel.header.bildbezug.ortsansichten"
                : "infoPanel.header.bildbezug.ortsansicht",
        klickbar: true,
    };
}

/**
 * Ein Bild des Kopfes als Bild der Bildansicht (eine Bildansicht für alle, `controls/avm-bildansicht.vue`). Eine Ortsansicht trägt den Namen des Ortes und, wo verlangt, ihre Nennung. Ein Reisebild
 * trägt seine Bildbeschreibung als Titel und darunter die Nennung wie auf der Karte: „Bild von {Name}“ (ohne Namen „anonym“), bei einem KI-Bild dazu „KI-Bild“, bei CC BY dazu der Name der Lizenz.
 */
export function ansichtBild(bild: HeaderImage, ortName: string): AnsichtBild {
    if (!istReisebild(bild)) {
        return { url: bild.url, breite: bild.width, hoehe: bild.height, titel: ortName, nennung: bild.credit };
    }
    const nennung = [
        t("photobox.karte.bildVon", { name: nennungsName(bild) }),
        ...(bild.credit === undefined ? [] : [bild.credit]),
    ].join(" · ");
    return {
        url: bild.url,
        breite: bild.width,
        hoehe: bild.height,
        titel: bild.reisebild?.beschreibung ?? ortName,
        nennung,
        ki: bild.reisebild?.entstehung === "ai_generated",
    };
}

/** Ein offener Eingang als Bild des Kopfes: gestrichelt, nur für Editoren, die private Vorschau statt einer öffentlichen Datei. */
export const eingangsbild = (eingang: PhotoboxOrtEingaenge["eingaenge"][number]): HeaderImage => ({
    id: eingang.publicId,
    url: eingang.url,
    width: eingang.breite,
    height: eingang.hoehe,
    eingang: true,
});

/**
 * Die Folge des Kopfes: die öffentlichen Bilder, für Editoren dahinter die offenen Eingänge (Probierseite 7.1, `kopfFolge`).
 *
 * 🔴 Reisebilder ersetzen das Typbild nicht, sie reihen sich dahinter ein (Vali 2026-11-09: „man will nicht dass reisebilder typbilder plötzlich ersetzen, sondern
 * einfach nur die galerie extended“). Hat der Ort vorn kein eigenes Bild (keine Ortsansicht, kein gebundenes Typbild), führt darum die Grafik der Art (`grafik`, das
 * ★-Typbild seiner Kategorie) die Folge an, vor Reisebildern wie vor Eingängen. Ohne Reisebild und ohne Eingang bleibt die Folge leer: Dann steht die Grafik der
 * Art wie bei jedem Ort ohne Bild, nicht als Glied. Fehlt die Grafik (Platzhalter bei „Ohne KI“, noch nicht geladen), bleiben die Reisebilder allein.
 */
export function folgeMitEingaengen(
    bilder: readonly HeaderImage[],
    eingaenge: readonly HeaderImage[],
    grafik: HeaderImage | undefined,
): HeaderImage[] {
    if (bilder.length === 0 && eingaenge.length === 0) return [];
    const eigenesVorn = bilder.some((bild) => !istReisebild(bild));
    return eigenesVorn || grafik === undefined ? [...bilder, ...eingaenge] : [grafik, ...bilder, ...eingaenge];
}

/** Kam nur etwas hinten dazu? Dann bleibt das gezeigte Bild stehen (ein neu freigegebenes Reisebild erscheint leise). Die Schlüssel sind die durch Komma getrennten Kennungen der Folge. */
export const istFortsetzung = (alt: string, neu: string): boolean => neu.startsWith(`${alt},`);
