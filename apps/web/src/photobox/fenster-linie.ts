/**
 * Die Linie vom Fensterkopf zur Stelle (WI-0272 S2b, Aufgabe 12; Vali 2026-10-31: „Cool wärs wenn der titel des fensters (oben links) mit einer linie
 * mit dem icon auf der karte verbunden wär (wie die linien zwischen photobox und icons), damit man nochmal sieht wo platziert wird“).
 *
 * - **Von der zugewandten Kante, auf Höhe des Titels.** Liegt die Stelle seitlich vom Fenster, beginnt die Linie an dessen linker oder rechter Kante in
 *   der Höhe des Titels; liegt sie darüber oder darunter, an der Ober- oder Unterkante, am Punkt entlang (12 px innerhalb der Ecken).
 * - **Sie endet am Rand des Symbols**, nicht in seiner Mitte (`SYMBOL_RADIUS`).
 * - **Sie entfällt, wo es nichts zu verbinden gibt:** Verdeckt das Fenster die Stelle (am Telefon das Blatt), oder ist die Strecke kürzer als `LINIE_MINDEST`.
 * - **Sie folgt der Karte und dem Fenster** (`folgeFensterLinie`): Die Stelle kommt von der Karte (Bildschirmpunkt), das Fenster wird beim Ziehen, in der
 *   Größe und im Wechsel der Lage nachgemessen. Gerechnet wird in Bildschirmkoordinaten der Seite (`position: fixed`), nicht in denen der Karte.
 *
 * Die Geometrie steht als reine Funktion hier (`fensterLinie`), damit Vitest sie ohne Browser prüft; das Zeichnen (SVG, einmal Zeichnen beim Öffnen) macht
 * `reisebild-besucher.vue`.
 */

export interface Punkt {
    readonly x: number;
    readonly y: number;
}

/** Ein Rechteck in Bildschirmkoordinaten. */
export interface Rechteck {
    readonly links: number;
    readonly oben: number;
    readonly rechts: number;
    readonly unten: number;
}

export interface FensterLinie {
    readonly von: Punkt;
    readonly bis: Punkt;
}

/** Wie weit das Symbol der Stelle reicht: Die Linie endet so weit vor seiner Mitte (Bildpunkte). */
export const SYMBOL_RADIUS = 17;
/** Kürzer als das ist nichts zu verbinden. */
export const LINIE_MINDEST = 24;
/** Der Testkennzeichen des Fensters der Reisebilder (`data-testid` des `<dialog>`): Die Linie und die Kamera finden es darüber. */
export const REISEBILD_FENSTER = "reisebild-fenster";
/** Dasselbe für die Statusseite: Auch sie steht auf der Karte im Weg, wenn die Kamera zu einer Stelle fliegt. */
export const REISEBILD_STATUS_FENSTER = "reisebild-status-fenster";
/** Das Fenster „Meine Reisebilder“ (Entwurf 9): ohne Linie und ohne Stelle auf der Karte. */
export const REISEBILD_MEINE_FENSTER = "reisebild-meine-fenster";
/** Wie weit der Anfang an der Ober- oder Unterkante von den Ecken wegbleibt. */
const ECKABSTAND = 12;

const innen = (fenster: Rechteck, stelle: Punkt): boolean =>
    stelle.x > fenster.links && stelle.x < fenster.rechts && stelle.y > fenster.oben && stelle.y < fenster.unten;

/**
 * Die Linie vom Fenster zur Stelle, oder `undefined`, wo es keine gibt (Fenster verdeckt die Stelle, Strecke zu kurz).
 * `kopfY` ist die Höhe der Mitte des Titels.
 */
export function fensterLinie(fenster: Rechteck, kopfY: number, stelle: Punkt): FensterLinie | undefined {
    if (innen(fenster, stelle)) return undefined;
    const klemmX = Math.min(fenster.rechts - ECKABSTAND, Math.max(fenster.links + ECKABSTAND, stelle.x));
    let von: Punkt;
    if (stelle.x < fenster.links) von = { x: fenster.links, y: kopfY };
    else if (stelle.x > fenster.rechts) von = { x: fenster.rechts, y: kopfY };
    else if (stelle.y < fenster.oben) von = { x: klemmX, y: fenster.oben };
    else von = { x: klemmX, y: fenster.unten };
    const laenge = Math.hypot(stelle.x - von.x, stelle.y - von.y);
    if (laenge < LINIE_MINDEST) return undefined;
    const anteil = (laenge - SYMBOL_RADIUS) / laenge;
    return { von, bis: { x: von.x + (stelle.x - von.x) * anteil, y: von.y + (stelle.y - von.y) * anteil } };
}

/** So viel Breite braucht die freie Fläche neben dem Fenster mindestens (Bildpunkte): Symbol der Stelle, ein Stück Linie und Luft. Schmaler ist keine Seite mehr „frei“. */
export const FREI_MINDEST = 120;

/**
 * Wohin die Kamera die Stelle bringt, wenn das Fenster in der Mitte steht (WI-0272, Entwurf 8; Betreiber 2026-11-01): in die Mitte der freien Fläche NEBEN dem Fenster, damit Platzhalter und Linie
 * zu sehen sind. Links, sonst rechts: Bleibt links mindestens `FREI_MINDEST` Platz (zwischen dem Rand der Karte oder dem Planer und dem Fenster), geht sie dorthin; sonst nach rechts, sonst
 * `undefined` (dann zielt die Kamera wie ohne `free`). Das Ergebnis ist die Breite, die nach der Fahrt gedeckt ist (`free` der Kamera): `right` für die Fläche links vom Fenster, `left` für die
 * rechts davon. `belegt` nennt, wo Panels die Karte schon decken (die rechte Kante des Planers links, die linke Kante des Info- oder Editorpanels rechts, in Bildschirmkoordinaten);
 * `rand` ist die Luft zwischen Fenster und Fläche.
 */
export function freiNebenMitte(
    fenster: Rechteck,
    karte: Rechteck,
    belegt: { readonly links?: number | undefined; readonly rechts?: number | undefined } = {},
    rand = 24,
): { readonly left: number } | { readonly right: number } | undefined {
    const linkerRand = Math.max(karte.links, belegt.links ?? karte.links);
    const rechterRand = Math.min(karte.rechts, belegt.rechts ?? karte.rechts);
    if (fenster.links - linkerRand - rand >= FREI_MINDEST)
        return { right: Math.round(karte.rechts - fenster.links + rand) };
    if (rechterRand - fenster.rechts - rand >= FREI_MINDEST)
        return { left: Math.round(fenster.rechts - karte.links + rand) };
    return undefined;
}

/** Der Pfad (SVG) einer Linie. */
export const linienPfad = (linie: FensterLinie): string =>
    `M${String(linie.von.x)} ${String(linie.von.y)}L${String(linie.bis.x)} ${String(linie.bis.y)}`;

const rechteckVon = (element: Element): Rechteck => {
    const r = element.getBoundingClientRect();
    return { links: r.left, oben: r.top, rechts: r.right, unten: r.bottom };
};

export interface LinienFolger {
    /** Neu messen (im nächsten Bild; mehrere Aufrufe in einem Bild zählen als einer). */
    aktualisiere(): void;
    stop(): void;
}

/**
 * Hält die Linie aktuell: Sie rechnet neu, wenn sich die Stelle ändert (`aktualisiere`), wenn das Fenster seine Größe oder seinen Stil ändert (Zug am Kopf, Lage)
 * und wenn die Seite ihre Größe ändert. `zeichne` bekommt die Linie, oder `undefined`, wenn es keine gibt (`aktiv` falsch, kein Fenster, keine Stelle).
 */
export function folgeFensterLinie(umfeld: {
    /** Die Stelle in Bildschirmkoordinaten der Seite, oder `undefined`, solange sie nicht zu sehen ist. */
    readonly stelle: () => Punkt | undefined;
    /** Das Fenster (das `<dialog>` der Hülle), oder `null`, solange es nicht dasteht. */
    readonly fenster: () => HTMLDialogElement | null;
    /** Soll es überhaupt eine Linie geben (nicht im Wählmodus, nur beim Formular)? */
    readonly aktiv: () => boolean;
    readonly zeichne: (linie: FensterLinie | undefined) => void;
}): LinienFolger {
    let beobachtet: HTMLDialogElement | null = null;
    let groesse: ResizeObserver | undefined;
    let stil: MutationObserver | undefined;
    let bild = 0;
    let aus = false;

    const loese = (): void => {
        groesse?.disconnect();
        stil?.disconnect();
        beobachtet = null;
    };
    const binde = (element: HTMLDialogElement | null): void => {
        if (element === beobachtet) return;
        loese();
        if (element === null) return;
        beobachtet = element;
        groesse ??= typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => aktualisiere());
        stil ??= typeof MutationObserver === "undefined" ? undefined : new MutationObserver(() => aktualisiere());
        groesse?.observe(element);
        stil?.observe(element, { attributes: true, attributeFilter: ["style", "class", "open"] });
    };

    const rechne = (): void => {
        bild = 0;
        if (aus) return;
        const element = umfeld.fenster();
        binde(element);
        const stelle = umfeld.stelle();
        const titel = element?.querySelector(".avm-fenster__titel") ?? null;
        if (!umfeld.aktiv() || element === null || titel === null || stelle === undefined || !element.open) {
            umfeld.zeichne(undefined);
            return;
        }
        const kopf = rechteckVon(titel);
        umfeld.zeichne(fensterLinie(rechteckVon(element), (kopf.oben + kopf.unten) / 2, stelle));
    };

    function aktualisiere(): void {
        if (bild !== 0 || aus) return;
        bild = requestAnimationFrame(rechne);
    }

    const aufGroesse = (): void => aktualisiere();
    globalThis.addEventListener("resize", aufGroesse);

    return {
        aktualisiere,
        stop() {
            aus = true;
            if (bild !== 0) cancelAnimationFrame(bild);
            bild = 0;
            globalThis.removeEventListener("resize", aufGroesse);
            loese();
        },
    };
}
