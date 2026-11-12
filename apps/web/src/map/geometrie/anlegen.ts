import type { Pixel, Punkt, Treffer, Ziel, Zielart } from "./geometrie";
import { deckungsgleich } from "./rechnung";

/**
 * Der Modus „Anlegen“ des Geometrie-Moduls: ein neues Objekt Punkt für Punkt auf der Karte zeichnen, für jede Art gleich (WI-0177;
 * EDIT-0003 T40 (3), G4, G11, G13, R3, R5, R7, R12, §3a Zeile „Anlegen“; Probierentwurf P5). Der Weg ist die erste Art („Neuer Weg“);
 * Fläche (WI-0178 C3), Herrschaftsgebiet und Kraftlinie docken als Art an, ohne Umbau. Gegenstück zu `modus.ts` („Geometrie
 * bearbeiten“, ein vorhandenes Objekt formen); beide sind derselbe Besitzer `geometry-edit` im Koordinator, nie zugleich.
 *
 * ## Die Schnittstelle
 *
 * **Eine Art** (`AnlegenArt`) sagt, was gezeichnet wird und wann es fertig ist. Alles andere ist für alle Arten gleich.
 *
 * | Feld | Bedeutung | Weg | Fläche | Gebiet | Kraftlinie |
 * |---|---|---|---|---|---|
 * | `teilart` | was entsteht | `linie` | `ring` | `ring` | `linie` |
 * | `rundung` | wie der Entwurf gezeichnet wird | Catmull-Rom wie die Karte | Chaikin wie die Karte | wie Fläche | Legacys Bogen, gerade |
 * | `ziele(lage)` | woran ein Klick einrastet: der erste Punkt (`anfang`), jeder weitere (`weiter`) | Orte und Stützpunkte anderer Wege | Ecken und Kanten anderer Flächen | Ecken und Kanten der Nachbarn | nur Nodices (`ort`, `label`) |
 * | `amZiel` | was ein Klick auf ein Ziel tut: `einrasten` oder `beenden` (R12, artgerecht) | am Ort beenden, am Stützpunkt einrasten | am eigenen ersten Punkt beenden | wie Fläche | am Nodix beenden |
 * | `zielErlaubt` | welches einzelne Ziel nicht in Frage kommt | der eigene Anfang (Anfang ≠ Ende) | – | – | der Start-Nodix |
 * | `schliesst` | der eigene erste Punkt ist ab `mindestens` Punkten ein Ziel, das schließt | – | ja | ja | – |
 * | `nurZiele` | ein Klick neben jedem Ziel setzt nichts (keine Zwischenpunkte, kein freies Ende) | – | – | – | ja |
 * | `mindestens` | Punkte, ab denen „Fertig“ geht | 2 | 3 | 3 | 2 |
 * | `pruefe` | warum der Entwurf so nicht fertig werden kann | zu wenig, Anfang auf Ende | zu wenig | zu wenig | zu wenig |
 * | `loesen` | Strg (am Finger: der lange Druck tut es nicht, er nimmt zurück) löst das Einrasten für diesen Klick | ja | ja | ja | **nein** |
 *
 * **Die Gesten** sind für alle Arten gleich (G13, R3, R7; T24 (4) entschieden 2026-10-16):
 *
 * - **Klick** setzt einen Punkt, eingerastet am besten Ziel im Fangradius (Karteneinstellung `fangradius`, Bildschirmmaß, G12). Am
 *   artgerechten Ziel beendet er (`amZiel` = `beenden`), sonst rastet er nur ein. Ein Klick in drei Bildpunkten um den letzten Punkt
 *   setzt nichts (ein gezitterter Doppelklick setzt keinen Doppelpunkt).
 * - **Klicktoleranz höher** (G13, Legacy `AVESMAPS_WERKZEUG_KLICK_TOLERANZ_PX`, 12 statt 3 Bildpunkte): Ein verwackelter Klick setzt
 *   einen Punkt, statt die Karte zu schieben (`klicktoleranz.ts`). Weiter gezogen schiebt die Karte wie sonst; nichts setzt einen Punkt.
 *   Mit `einzeln` (gehaltene Leertaste) ist das Schieben gesperrt und die Toleranz fällt weg: Jeder Druck setzt beim Loslassen einen Punkt,
 *   auch wenn die Hand beim schnellen Klicken weiterzieht (Legacy, Register 2026-10-19 „jeder Klick eine Ecke“).
 * - **Gummiband:** vom letzten Punkt zum Zeiger, gestrichelt, eingerastet wie der nächste Klick; um das Ziel der Kringel, darüber ein
 *   Schild, was der Klick dort tut (R9, R12): `schild` liefert den Satz (Weg: „Weg hier abschließen · Gareth“, „Hier anschließen ·
 *   Stützpunkt von Reichsstraße 1“).
 * - **Doppelklick** beendet (R3): Der erste Klick hat den Punkt gesetzt, der zweite beendet, sobald `mindestens` Punkte stehen.
 * - **Rechtsklick und ⌫** nehmen den letzten Punkt zurück, ohne Menü (T24 (4), R7); ↶ ↷ in der Leiste und Strg+Z, Strg+Y ebenso
 *   (R5). Den Anfang, an dem das Anlegen begann (`anfang`, etwa „Neuer Weg ab hier“ am Ort), nimmt nichts zurück. Am Finger ist der
 *   lange Druck der Rechtsklick (Koordinator), also auch „zurück“.
 * - **Enter** und **„Fertig“** beenden; **Esc** fragt beim Aufrufer, sobald ein Abschnitt steht, sonst endet der Modus (R2).
 *   **„Verwerfen“** stellt den Beginn her, der Modus bleibt (wie die Wegkurve, F20). Die Tasten trägt der Aufrufer (die Seite hat
 *   EINE Kaskade für Esc), der Modus bietet `zurueck`, `wieder`, `verwerfen`, `fertig`.
 * - 🔴 **Eine Operation:** Beenden meldet den geprüften Entwurf EINMAL an den Aufrufer (`fertig`); der schreibt ihn als EINE Operation
 *   seiner Art (Weg: `path.create`) und beendet den Modus nach der Quittung. Ein Zurücknehmen-Feld danach gibt es nicht (T24, R9 nach
 *   seiner Rückmeldung); was entstand, zeigen die Marken an den Enden, das Fenster und der Verlauf.
 * - 🔴 Während des Zeichnens fragt nichts den Server (AGENTS „Beim Ziehen wird nicht nachgeschlagen“): Ziele liest der Aufrufer zwischen
 *   den Gesten (beim Start und wenn die Karte zur Ruhe kommt) und ruft danach `aktualisiere`.
 *
 * **Tasten:** Es kommt keine neue hinzu. Esc, Enter, ⌫, Strg+Z, Strg+Y stehen in der Tafel R5; eine weitere erst nach T20.
 *
 * **Farben** wie „Geometrie bearbeiten“: was entsteht, Knallrot (`editEdge`); der Kringel ebenso; Marken des Aufrufers nach dem
 * Schreiben (bestätigt `success`, frei `warningSoftBorder`).
 *
 * Dateien: `anlegen.ts` (die Schnittstelle und die reine Rechnung des Entwurfs), `anlegen-modus.ts` (der Besitzer am Koordinator),
 * `anlegen-schild.vue` (das Schild am Ziel), `klicktoleranz.ts`; die Arten in `arten.ts` (`WEG_ANLEGEN`).
 */

/** Was der Klick an diesem Punkt tut: der erste Punkt (`anfang`) oder jeder weitere (`weiter`). */
export type AnlegenLage = "anfang" | "weiter";

/** Warum ein Entwurf so nicht fertig werden kann; den Satz bildet der Aufrufer. */
export type AnlegenGrund = "zuWenig" | "aufeinander";

/** Die Kennung, unter der der eigene erste Punkt als Ziel erscheint (Ring schließen, `schliesst`). */
export const ANLEGEN_ANFANG = "anlegen:anfang";

/** Die Art eines Objekts, das man zeichnen kann (Tafel oben). */
export interface AnlegenArt {
    readonly id: string;
    readonly teilart: "linie" | "ring";
    /** Wie der Entwurf gezeichnet wird; bei einem Ring sind die Punkte schon geschlossen (der erste am Ende wiederholt). */
    rundung(punkte: readonly Punkt[]): Punkt[];
    ziele(lage: AnlegenLage): readonly Zielart[];
    /** Was ein Klick auf dieses Ziel tut, wenn schon `punkte` stehen (nie für den ersten Punkt gefragt). */
    amZiel(ziel: Ziel, punkte: readonly Punkt[]): "einrasten" | "beenden";
    zielErlaubt?(ziel: Ziel, punkte: readonly Punkt[]): boolean;
    readonly schliesst?: true;
    readonly nurZiele?: true;
    readonly mindestens: number;
    pruefe(punkte: readonly Punkt[]): AnlegenGrund | undefined;
    readonly loesen?: false;
}

/** Ein gesetzter Punkt und woran er eingerastet ist. */
export interface AnlegenPunkt {
    readonly at: Punkt;
    readonly ziel: Ziel | undefined;
}

/** Der Entwurf: die gesetzten Punkte, was ↷ wiederholen kann, und wie viele vorne fest sind (der Anfang, an dem es begann). */
export interface AnlegenEntwurf {
    readonly punkte: readonly AnlegenPunkt[];
    readonly wieder: readonly AnlegenPunkt[];
    readonly fest: number;
}

/** Was der Modus dem Aufrufer meldet, wenn sich der Entwurf ändert (Leiste, Zählung, Schild). */
export interface AnlegenStand {
    readonly punkte: number;
    /** Strecken zwischen den Punkten: was „ungespeichert“ heißt (Esc fragt ab einer). */
    readonly abschnitte: number;
    readonly zurueck: boolean;
    readonly wieder: boolean;
    /** Ob „Fertig“ jetzt ginge; sonst der Grund. */
    readonly fertig: AnlegenGrund | undefined;
}

/** Das Ziel unter dem Zeiger, für das Schild: was ein Klick dort täte, und wo das Ziel am Schirm steht (Bildpunkte der Karte). */
export interface AnlegenZeiger {
    readonly treffer: Treffer;
    readonly lage: AnlegenLage;
    readonly tut: "einrasten" | "beenden";
    readonly schirm: Pixel;
}

/** Was der Aufrufer dem Modus gibt (Weg: `wegeditor/neuer-weg.ts`). */
export interface AnlegenEingabe {
    readonly art: AnlegenArt;
    /** Der erste Punkt, wenn das Anlegen an einer Stelle beginnt („Neuer Weg ab hier“); sonst setzt ihn der erste Klick. */
    readonly anfang?: AnlegenPunkt | undefined;
    /** Woran eingerastet werden kann; gelesen zwischen den Gesten, nie während eines Zugs. */
    ziele(): readonly Ziel[];
    /** Der Fangradius in Bildpunkten (Karteneinstellung `fangradius`). */
    fangradius(): number;
    /** Nach jeder Änderung des Entwurfs. */
    stand(stand: AnlegenStand): void;
    /** Das Ziel unter dem Zeiger hat sich geändert (für das Schild); `undefined`: keins. */
    zeiger?(zeiger: AnlegenZeiger | undefined): void;
    /** Beenden verlangt und geprüft: Der Aufrufer schreibt EINE Operation und beendet danach den Modus (`aus`). */
    fertig(punkte: readonly AnlegenPunkt[]): void;
    /** Beenden verlangt, aber so nicht möglich (zu wenig Punkte, Anfang auf Ende): Der Entwurf bleibt. */
    abgewiesen(grund: AnlegenGrund): void;
    /**
     * Solange wahr, ist jeder Klick eine Ecke: Zwei schnelle Klicks dicht beieinander sind kein Doppelklick und beenden nichts
     * („Neue Fläche“ mit gehaltener Leertaste, OPS-000040, Betreiber „A unbedingt“). Ohne Angabe gilt der Doppelklick.
     */
    einzeln?(): boolean;
}

/** Zwei Klicks in dieser Zeit und Nähe sind ein Doppelklick (wie `modus.ts` und `editor-menu/doppelklick.ts`). */
export const DOPPELKLICK_MS = 400;
export const DOPPELKLICK_PX = 6;

/**
 * Ist dieser Klick der zweite eines Doppelklicks? Nie mit `einzeln` (gehaltene Leertaste bei „Neue Fläche“, OPS-000040; Legacy
 * `map-features-ecosystem-draw.js`): Dann ist jeder Klick eine Ecke, auch zwei schnelle dicht beieinander.
 */
export function istDoppelklick(
    vorher: { readonly zeit: number; readonly at: { readonly x: number; readonly y: number } } | undefined,
    jetzt: number,
    at: { readonly x: number; readonly y: number },
    einzeln: boolean,
): boolean {
    return (
        !einzeln &&
        vorher !== undefined &&
        jetzt - vorher.zeit <= DOPPELKLICK_MS &&
        Math.hypot(at.x - vorher.at.x, at.y - vorher.at.y) <= DOPPELKLICK_PX
    );
}

/** Was der Aufrufer am laufenden Modus tun kann. */
export interface AnlegenModus {
    zurueck(): void;
    wieder(): void;
    /** Zurück zum Beginn (nur der feste Anfang, wenn es einen gibt); der Modus bleibt (wie „Verwerfen“ der Wegkurve, F20). */
    verwerfen(): void;
    /** Wie Enter: beenden, wenn der Entwurf es erlaubt, sonst `abgewiesen`. */
    fertig(): void;
    /** Während der Aufrufer schreibt, setzt kein Klick einen Punkt und keine Geste ändert den Entwurf. */
    sperre(gesperrt: boolean): void;
    /** Nach neu gelesenen Zielen: neu zeichnen. */
    aktualisiere(): void;
    entwurf(): AnlegenEntwurf;
    aus(): void;
}

/** Der Entwurf zu Beginn: leer oder mit dem festen Anfang. */
export function anlegenStart(anfang?: AnlegenPunkt): AnlegenEntwurf {
    return { punkte: anfang ? [anfang] : [], wieder: [], fest: anfang ? 1 : 0 };
}

export const anlegenPunkte = (entwurf: AnlegenEntwurf): Punkt[] => entwurf.punkte.map((p) => p.at);

/** Die Lage des nächsten Klicks. */
export const naechsteLage = (entwurf: AnlegenEntwurf): AnlegenLage =>
    entwurf.punkte.length === 0 ? "anfang" : "weiter";

/** Darf dieses Ziel jetzt einrasten? Die Art entscheidet, dazu: nie ein Punkt, der schon im Entwurf steht (außer dem schließenden Anfang). */
export function zielZulassen(art: AnlegenArt, punkte: readonly Punkt[], ziel: Ziel): boolean {
    if (ziel.objekt === ANLEGEN_ANFANG) return true;
    if (punkte.some((p) => deckungsgleich(p, ziel.at))) return false;
    return art.zielErlaubt?.(ziel, punkte) ?? true;
}

/** Die Ziele des nächsten Klicks: die des Aufrufers und, bei einer Art, die schließt, der eigene Anfang ab `mindestens` Punkten. */
export function anlegenZiele(art: AnlegenArt, entwurf: AnlegenEntwurf, ziele: readonly Ziel[]): Ziel[] {
    const anfang = entwurf.punkte[0];
    const schliessen =
        art.schliesst === true && anfang !== undefined && entwurf.punkte.length >= art.mindestens
            ? [{ art: "ecke" as const, at: anfang.at, objekt: ANLEGEN_ANFANG, name: "" }]
            : [];
    const punkte = anlegenPunkte(entwurf);
    return [...schliessen, ...ziele].filter((ziel) => zielZulassen(art, punkte, ziel));
}

/** Die Zielarten des nächsten Klicks; der schließende Anfang ist eine `ecke`. */
export function anlegenZielarten(art: AnlegenArt, entwurf: AnlegenEntwurf): readonly Zielart[] {
    const arten = art.ziele(naechsteLage(entwurf));
    return art.schliesst === true && !arten.includes("ecke") ? [...arten, "ecke"] : arten;
}

/** Was ein Klick auf dieses Ziel jetzt täte. */
export function anlegenTut(art: AnlegenArt, entwurf: AnlegenEntwurf, ziel: Ziel): "einrasten" | "beenden" {
    if (entwurf.punkte.length === 0) return "einrasten";
    if (ziel.objekt === ANLEGEN_ANFANG) return "beenden";
    return art.amZiel(ziel, anlegenPunkte(entwurf));
}

/**
 * Ein Klick: setzt den Punkt (eingerastet am Treffer, sonst an `at`) und sagt, ob er beendet. Am schließenden Anfang kommt kein Punkt
 * dazu, der Ring schließt sich. Eine Art mit `nurZiele` setzt neben einem Ziel nichts; `undefined` heißt: nichts geschehen.
 */
export function setze(
    art: AnlegenArt,
    entwurf: AnlegenEntwurf,
    at: Punkt,
    treffer: Treffer | undefined,
): { entwurf: AnlegenEntwurf; beenden: boolean } | undefined {
    if (treffer === undefined && art.nurZiele === true) return undefined;
    const tut = treffer ? anlegenTut(art, entwurf, treffer.ziel) : "einrasten";
    if (treffer?.ziel.objekt === ANLEGEN_ANFANG) return { entwurf, beenden: true };
    const punkt: AnlegenPunkt = { at: treffer?.at ?? at, ziel: treffer?.ziel };
    const letzter = entwurf.punkte.at(-1);
    if (letzter !== undefined && deckungsgleich(letzter.at, punkt.at)) return undefined;
    return { entwurf: { ...entwurf, punkte: [...entwurf.punkte, punkt], wieder: [] }, beenden: tut === "beenden" };
}

/** Nimmt den letzten Punkt zurück; den festen Anfang nie. */
export function zurueck(entwurf: AnlegenEntwurf): AnlegenEntwurf {
    const letzter = entwurf.punkte.at(-1);
    if (letzter === undefined || entwurf.punkte.length <= entwurf.fest) return entwurf;
    return { ...entwurf, punkte: entwurf.punkte.slice(0, -1), wieder: [...entwurf.wieder, letzter] };
}

/** Holt den zuletzt zurückgenommenen Punkt wieder. */
export function wieder(entwurf: AnlegenEntwurf): AnlegenEntwurf {
    const punkt = entwurf.wieder.at(-1);
    if (punkt === undefined) return entwurf;
    return { ...entwurf, punkte: [...entwurf.punkte, punkt], wieder: entwurf.wieder.slice(0, -1) };
}

/** Der Stand für Leiste und Zählung. */
export function anlegenStand(art: AnlegenArt, entwurf: AnlegenEntwurf): AnlegenStand {
    const n = entwurf.punkte.length;
    return {
        punkte: n,
        abschnitte: Math.max(0, n - 1),
        zurueck: n > entwurf.fest,
        wieder: entwurf.wieder.length > 0,
        fertig: art.pruefe(anlegenPunkte(entwurf)),
    };
}
