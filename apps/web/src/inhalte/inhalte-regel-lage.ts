import type {
    InhalteVorkommenUmriss,
    WikisyncLageRichtung,
    WikisyncRegelBedingung,
    WikisyncRegelLage,
    WikisyncRegelLageOrt,
} from "@avesmaps3d/shared";

/**
 * Die Bedingung „Lage zu einer Linie“ im Regeleditor als reine Rechnung (WI-0254, Regelbedingung Lage; Entwurf `d-editor.js`, von Vali am 2026-10-28 abgenommen): der halb gefüllte Stand des Feldes, die
 * Linie und die Halbebene für die Skizze, die Warnung bei einer Linie quer zur Richtung. Ohne Vue, von Vitest geprüft.
 *
 * - **Die Lage gilt erst fertig:** Eine Richtung UND ein oder zwei Orte. Alles darunter ist ein Stand des Feldes (`LageEntwurf`), der die Regel nicht erreicht: Er steht in `lageEntwurf` der Bedingung des
 *   Editors (`EditorBedingung`), nie in `lage`. So kennen Satz, Fingerabdruck und Körper nur fertige Lagen, und der Editor sperrt `Regel übernehmen` mit Grund, solange eine Lage halb ist.
 * - **Die Linie:** ein Ort ergibt die waagerechte (nördlich, südlich) oder senkrechte (östlich, westlich) Linie durch ihn, zwei Orte die Linie durch beide, auf der Karte verlängert. Die Richtung sagt, auf
 *   welcher Seite sie gilt. Die Karte rechnet `y` nach Norden; der SVG-Pfad des Servers (`ST_AsSVG`) hat `y` schon umgedreht, die Skizze zeichnet die Orte darum mit `-y`.
 */

/** Wie viele Orte eine Linie hat: einen oder zwei. */
export const LAGE_ORTE_MAX = 2;

/** Der Stand des Feldes, auch halb gefüllt: eine Richtung oder Orte fehlen noch. */
export interface LageEntwurf {
    readonly richtung: WikisyncLageRichtung | null;
    readonly orte: readonly WikisyncRegelLageOrt[];
}

/** Ein fertiger Stand: Richtung und mindestens ein Ort. */
export interface LageFertig extends LageEntwurf {
    readonly richtung: WikisyncLageRichtung;
}

/**
 * Eine Bedingung im Editor: die des Wikis und der Server (`WikisyncRegelBedingung`) plus der halb gefüllte Stand der Lage. `lageEntwurf` gibt es nur, solange `lage` fehlt und das Feld etwas trägt; er geht
 * nie in eine Regel, den Fingerabdruck oder den Körper (`kettenNormal` des Modells lässt ihn weg).
 */
export interface EditorBedingung extends WikisyncRegelBedingung {
    lageEntwurf?: LageEntwurf;
}

export const LEERE_LAGE: LageEntwurf = { richtung: null, orte: [] };

export const lageFertig = (l: LageEntwurf): l is LageFertig =>
    l.richtung !== null && l.orte.length >= 1 && l.orte.length <= LAGE_ORTE_MAX;

/** Halb gefüllt: etwas gewählt, aber nicht genug. Ein leerer Stand ist nicht halb, er ist nichts. */
export const lageHalb = (l: LageEntwurf | undefined): boolean =>
    l !== undefined && !lageFertig(l) && (l.richtung !== null || l.orte.length > 0);

/** Der Stand des Feldes einer Bedingung: die fertige Lage, sonst der halbe Stand, sonst nichts. */
export const lageStand = (b: EditorBedingung): LageEntwurf => b.lage ?? b.lageEntwurf ?? LEERE_LAGE;

/** Trägt die Bedingung eine Lage, die noch nicht fertig ist? */
export const bedingungLageHalb = (b: EditorBedingung): boolean => b.lage === undefined && lageHalb(b.lageEntwurf);

const ortKopie = (o: WikisyncRegelLageOrt): WikisyncRegelLageOrt => ({
    kennung: o.kennung,
    name: o.name,
    x: o.x,
    y: o.y,
});

/**
 * Den Stand des Feldes in die Bedingung legen: fertig wird `lage`, halb `lageEntwurf`, leer oder `null` (egal) nimmt beides weg. Die Bedingung bleibt sonst, wie sie war; `lage` und `lageEntwurf` stehen
 * nie zugleich da.
 */
export function setzeLage(b: EditorBedingung, stand: LageEntwurf | null): EditorBedingung {
    const kopie: EditorBedingung = { ...b };
    delete kopie.lage;
    delete kopie.lageEntwurf;
    if (stand === null) return kopie;
    const orte = stand.orte.map(ortKopie);
    if (lageFertig(stand)) return { ...kopie, lage: { richtung: stand.richtung, orte } };
    if (lageHalb(stand)) return { ...kopie, lageEntwurf: { richtung: stand.richtung, orte } };
    return kopie;
}

/** Die Lage ohne den Rest des Editors, wie Satz, Körper und Fingerabdruck sie lesen. */
export const alsLage = (l: LageFertig): WikisyncRegelLage => ({ richtung: l.richtung, orte: l.orte.map(ortKopie) });

// ---------------------------------------------------------------------------------------------------------------------
// Linie und Halbebene
// ---------------------------------------------------------------------------------------------------------------------

export interface Punkt {
    readonly x: number;
    readonly y: number;
}

/** Warum die Richtung zur Linie nicht passt: Eine Linie, die fast von Norden nach Süden läuft, trennt Osten und Westen, nicht Norden und Süden (und umgekehrt). */
export type LageWarnung = "steil" | "flach";

export interface LageGeometrie {
    /** Die Linie als zwei weit entfernte Punkte; `null`, wo die Richtung quer zur Linie nichts trennt (die Linie läuft in der Richtung selbst). */
    readonly linie: readonly [Punkt, Punkt] | null;
    /** Die Halbebene auf der Seite der Richtung als Viereck; `null` wie bei der Linie. */
    readonly flaeche: readonly Punkt[] | null;
    readonly warnung: LageWarnung | null;
}

/** Wie weit die Linie über die Orte hinausläuft (Kartenkoordinaten); die Skizze wählt es nach dem Rahmen der Karte. */
const REICHWEITE_VORGABE = 4000;
/** Ab wie viel Grad zur Waagerechten eine Linie für Norden und Süden zu steil ist; die Grenze für Osten und Westen liegt ebenso weit von der Senkrechten (30 Grad). */
const STEIL_AB = 60;
const FLACH_BIS = 30;

/** Die Linie und die Halbebene einer fertigen Lage in Kartenkoordinaten (`y` nach Norden). */
export function lageGeometrie(l: LageFertig, reichweite: number = REICHWEITE_VORGABE): LageGeometrie {
    const a = l.orte[0];
    const b = l.orte[1];
    if (a === undefined) return { linie: null, flaeche: null, warnung: null };
    const nordSued = l.richtung === "nord" || l.richtung === "sued";
    let d: Punkt;
    if (b === undefined) d = nordSued ? { x: 1, y: 0 } : { x: 0, y: 1 };
    else {
        const lang = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        d = { x: (b.x - a.x) / lang, y: (b.y - a.y) / lang };
    }
    let n: Punkt = { x: -d.y, y: d.x };
    const seite = { nord: n.y, sued: -n.y, ost: n.x, west: -n.x }[l.richtung];
    const winkel = (Math.atan2(Math.abs(d.y), Math.abs(d.x)) * 180) / Math.PI;
    let warnung: LageWarnung | null = null;
    if (b !== undefined) {
        if (nordSued && winkel > STEIL_AB) warnung = "steil";
        else if (!nordSued && winkel < FLACH_BIS) warnung = "flach";
    }
    if (Math.abs(seite) < 1e-6)
        return { linie: null, flaeche: null, warnung: warnung ?? (nordSued ? "steil" : "flach") };
    if (seite < 0) n = { x: -n.x, y: -n.y };
    const p1 = { x: a.x - d.x * reichweite, y: a.y - d.y * reichweite };
    const p2 = { x: a.x + d.x * reichweite, y: a.y + d.y * reichweite };
    return {
        linie: [p1, p2],
        flaeche: [
            p1,
            p2,
            { x: p2.x + n.x * reichweite, y: p2.y + n.y * reichweite },
            { x: p1.x + n.x * reichweite, y: p1.y + n.y * reichweite },
        ],
        warnung,
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Skizze
// ---------------------------------------------------------------------------------------------------------------------

/** Der Rand um die Karte in der Skizze (Kartenkoordinaten). */
const SKIZZE_RAND = 14;
/** Wie weit der Name eines Ortes neben dem Punkt steht, und wie hoch darüber (Kartenkoordinaten). */
const NAME_ABSTAND_X = 20;
const NAME_ABSTAND_Y = 16;

export interface SkizzeOrt {
    readonly name: string;
    readonly cx: number;
    readonly cy: number;
    readonly tx: number;
    readonly ty: number;
    readonly anker: "start" | "end";
}

export interface Skizze {
    /** `viewBox` des SVG. */
    readonly ansicht: string;
    /** Das Rechteck der Ansicht, an dem die Linie beschnitten wird. */
    readonly rahmen: { readonly x: number; readonly y: number; readonly breite: number; readonly hoehe: number };
    /** `points` des Vierecks der Halbebene; `undefined`, wo die Lage nicht fertig ist oder nichts trennt. */
    readonly flaeche: string | undefined;
    readonly linie: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number } | undefined;
    readonly orte: readonly SkizzeOrt[];
}

const runde = (zahl: number): number => Math.round(zahl * 10) / 10;

/**
 * Die Skizze zu einem Stand des Feldes auf dem Umriss Aventuriens: die Ansicht um den Rahmen der Karte, die Halbebene (der Umriss beschneidet sie), die gestrichelte Linie und die Orte mit ihren Namen. Die
 * Orte stehen auch dann da, wenn die Richtung noch fehlt. Der Name steht auf der Seite des Ortes, die zur Mitte der Karte schaut, damit er nicht aus der Ansicht läuft.
 */
export function skizze(stand: LageEntwurf, rahmen: InhalteVorkommenUmriss["rahmen"]): Skizze {
    const x = rahmen.x0 - SKIZZE_RAND;
    const y = -rahmen.y1 - SKIZZE_RAND;
    const breite = rahmen.x1 - rahmen.x0 + 2 * SKIZZE_RAND;
    const hoehe = rahmen.y1 - rahmen.y0 + 2 * SKIZZE_RAND;
    const mitte = (rahmen.x0 + rahmen.x1) / 2;
    const g = lageFertig(stand)
        ? lageGeometrie(stand, Math.max(REICHWEITE_VORGABE, 3 * Math.hypot(breite, hoehe)))
        : undefined;
    const punkt = (q: Punkt): string => `${q.x.toFixed(1)},${(-q.y).toFixed(1)}`;
    const [p1, p2] = g?.linie ?? [];
    return {
        ansicht: `${String(x)} ${String(y)} ${String(breite)} ${String(hoehe)}`,
        rahmen: { x, y, breite, hoehe },
        flaeche: g?.flaeche == null ? undefined : g.flaeche.map(punkt).join(" "),
        linie:
            p1 === undefined || p2 === undefined
                ? undefined
                : { x1: runde(p1.x), y1: runde(-p1.y), x2: runde(p2.x), y2: runde(-p2.y) },
        orte: stand.orte.map((o) => ({
            name: o.name,
            cx: o.x,
            cy: -o.y,
            tx: o.x + (o.x > mitte ? -NAME_ABSTAND_X : NAME_ABSTAND_X),
            ty: -o.y - NAME_ABSTAND_Y,
            anker: o.x > mitte ? "end" : "start",
        })),
    };
}

/** Die Warnung zu einem Stand des Feldes: nur eine fertige Lage kann quer zu ihrer Richtung liegen. */
export const lageWarnung = (stand: LageEntwurf): LageWarnung | null =>
    lageFertig(stand) ? lageGeometrie(stand).warnung : null;
