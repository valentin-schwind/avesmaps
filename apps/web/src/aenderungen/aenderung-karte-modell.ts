/**
 * Vorher und Nachher einer Änderung auf der Karte, ohne Vue und ohne MapLibre (WI-0265 B5b; Probierseite `review/wi-0265/aenderungen.html`,
 * Szenen 2 und 4, vom Betreiber am 2026-10-31 als Bauvorlage angenommen; WI-0265 §1.4): Aus den Feldern, die das Detail ohnehin zeigt,
 * wird, was sich auf der Karte zeichnen lässt, in Kartenkoordinaten (`aventuria-v1`, Quelle des Protokolls). Die Umrechnung in die
 * Renderprojektion und das Zeichnen besorgt `map/aenderungen-overlay.ts`; hier steht nur, WAS belegt ist.
 *
 * 🔴 **Nie ein „Vorher“ erfinden** (Fachvertrag Gate 4, U11). Das Protokoll führt die Geometrie in vier Formen (P0-Matrix, Befund 5): die volle Linie
 * oder die Ringe, nur die bewegten Stützpunkte mit Index, nur ein Wegende, nur die mitgezogenen Ecken ohne Index.
 *
 * | Form im Protokoll | Beispiel | Auf der Karte |
 * |---|---|---|
 * | volle Linie `[x,y][]` | `path.reshaped` | Linie, Vorher gestrichelt, Nachher durchgezogen |
 * | Ringe `[x,y][][][]` (Polygone) | `area.reshaped`, `territory_area.reshaped`, Anlegen | Umriss als Linie |
 * | nur bewegte Stützpunkte `{index,x,y}` | `path.carried` | Punkte, je Index vorher mit nachher verbunden |
 * | nur Wegende `{end,x,y}` | `path.endpoint_moved` | Punkte, je Ende vorher mit nachher verbunden |
 * | `position` `[x,y]` (Ort, Gipfel, Beschriftung) | `place.moved` | Punkt vorher und nachher, verbunden (die Lage ist ganz gespeichert) |
 * | mitgezogene Nachbarecken `[x,y][]` OHNE Ring- und Eckenindex (Flächen) | `area.carried` | nur Punkte, keine Verbindung |
 *
 * Dazu das Netz des Gebirges (`gebirge:netz`: Kämme als Linien, Nebengipfel
 * und Mulden als Punkte). Fehlt das `before` eines schon vorhandenen Gegenstands (`formFehlt`), gibt es für ihn KEIN Vorher und das Bild
 * sagt es; der heutige Stand tritt nie an seine Stelle. Ist das Vorher nur teilweise gespeichert (bewegte Punkte), zeigt das Bild genau
 * diese Punkte und sagt „nur teilweise“.
 */

/** Ein Punkt in Kartenkoordinaten. */
export type KartenPunkt = readonly [number, number];

/** Ein Stück des Bildes: eine Linie (Weg, Kamm, Umriss) oder ein Punkt (Ort, Gipfel, bewegter Stützpunkt, Nachbarecke). */
export type KartenTeil =
    | { readonly art: "linie"; readonly punkte: readonly KartenPunkt[] }
    | { readonly art: "punkt"; readonly punkt: KartenPunkt };

/** Die frühere und die neue Lage desselben Stützpunkts oder Wegendes (Index beziehungsweise Ende nennt das Protokoll). */
export interface KartenVerschiebung {
    readonly von: KartenPunkt;
    readonly nach: KartenPunkt;
}

/** Was das Bild über die Lücken im Protokoll sagen muss. */
export interface KartenHinweise {
    /** Zu mindestens einem Gegenstand ist die frühere Form nicht gespeichert: Für ihn gibt es kein Vorher. */
    readonly vorherFehlt: boolean;
    /** Von mindestens einem Gegenstand sind nur die bewegten Punkte als Vorher gespeichert. */
    readonly vorherTeilweise: boolean;
    /** Von mindestens einem Gegenstand sind nur die bewegten Punkte als Nachher gespeichert, das Vorher ist ganz (eine Serie, die beides verbindet). */
    readonly nachherTeilweise: boolean;
}

/**
 * Wo die Gegenstände einer Änderung HEUTE liegen, wenn das Protokoll keine Lage führt (WI-0265 B9; `aenderung-lage-modell.ts`): der Kasten, den der Server für die Gegenstände liefert
 * (`GET /api/editor/changes/:operationId/lage`), als Punkt oder Umriss. Kein Vorher und kein Nachher: Die Karte zeichnet nur den heutigen Ort, dezent, und die Leiste sagt es.
 */
export interface KartenHeute {
    readonly teile: readonly KartenTeil[];
    /** Mindestens ein Gegenstand liegt nicht mehr auf der Karte (stillgelegt oder gelöscht): Gezeigt wird seine letzte Lage. */
    readonly stillgelegt: boolean;
    /** So viele Gegenstände haben eine Lage. */
    readonly gegenstaende: number;
}

export interface KartenBild {
    readonly vorher: readonly KartenTeil[];
    readonly nachher: readonly KartenTeil[];
    readonly verschiebungen: readonly KartenVerschiebung[];
    readonly hinweise: KartenHinweise;
    /** Kleinster Kasten um alles Belegte: `[minX, minY, maxX, maxY]`; `undefined`, wenn nichts zu zeigen ist. */
    readonly grenzen: readonly [number, number, number, number] | undefined;
    /** Nur bei einer Änderung ohne Lage im Protokoll (B9): der heutige Ort statt Vorher und Nachher. */
    readonly heute?: KartenHeute | undefined;
}

/** Die Felder eines Gegenstands, wie das Detail sie führt (`DetailZeile`, `SerienZeile`): Vorher und Nachher mit dem, was das Protokoll dazu sagt. */
export interface KartenZeile {
    readonly feld: string;
    readonly vorher: unknown;
    readonly nachher: unknown;
    readonly hatVorher: boolean;
    readonly formFehlt: boolean;
    /** Der Wert ist noch nicht geladen (die Liste lässt Geometrie weg): Er gilt als nicht da, nicht als leer. */
    readonly omitted: boolean;
}

export interface KartenGegenstand {
    readonly kind: string;
    readonly zeilen: readonly KartenZeile[];
}

// --- Lesen der Protokollformen ---------------------------------------------------------------------------------------

const istZahl = (wert: unknown): wert is number => typeof wert === "number" && Number.isFinite(wert);

const istPunkt = (wert: unknown): wert is readonly [number, number, ...unknown[]] =>
    Array.isArray(wert) && wert.length >= 2 && istZahl(wert[0]) && istZahl(wert[1]);

const istObjekt = (wert: unknown): wert is Readonly<Record<string, unknown>> =>
    typeof wert === "object" && wert !== null && !Array.isArray(wert);

const punkt = (wert: readonly [number, number, ...unknown[]]): KartenPunkt => [wert[0], wert[1]];

/** Ein bewegter Punkt: `schluessel` verbindet Vorher und Nachher (`i:<index>`, `e:<start|end>`), ohne ihn gibt es keine Verbindung. */
interface BewegterPunkt {
    readonly punkt: KartenPunkt;
    readonly schluessel: string | undefined;
}

/** Eine gelesene Form: ganze Linien (eine Linie, Ringe) oder nur bewegte Punkte. */
type Gelesen =
    | { readonly form: "linien"; readonly linien: readonly (readonly KartenPunkt[])[] }
    | { readonly form: "punkte"; readonly punkte: readonly BewegterPunkt[] };

/** Ein Ring wird als geschlossene Linie gezeichnet, auch wenn der erste Punkt am Ende nicht wiederholt ist. */
function geschlossen(ring: readonly KartenPunkt[]): readonly KartenPunkt[] {
    const erster = ring[0];
    const letzter = ring[ring.length - 1];
    if (erster === undefined || letzter === undefined) return ring;
    return erster[0] === letzter[0] && erster[1] === letzter[1] ? ring : [...ring, erster];
}

function ringeAus(wert: readonly unknown[]): (readonly KartenPunkt[])[] {
    const raus: (readonly KartenPunkt[])[] = [];
    for (const ring of wert) {
        if (!Array.isArray(ring)) continue;
        const punkte = ring.filter(istPunkt).map(punkt);
        if (punkte.length >= 2) raus.push(geschlossen(punkte));
    }
    return raus;
}

/**
 * Liest den Wert eines Felds `geometry`. `art` unterscheidet die zwei Formen, die gleich aussehen: Eine Liste von `[x,y]` ist bei einem Weg
 * seine volle Linie, bei einer Fläche (Landschaft, Gebiet, Sprache) die Liste der mitgezogenen Ecken ohne Index.
 */
export function leseGeometrie(wert: unknown, art: string): Gelesen | undefined {
    if (!Array.isArray(wert) || wert.length === 0) return undefined;
    const erstes: unknown = wert[0];
    if (istObjekt(erstes)) {
        const punkte: BewegterPunkt[] = [];
        for (const eintrag of wert) {
            if (!istObjekt(eintrag) || !istZahl(eintrag["x"]) || !istZahl(eintrag["y"])) continue;
            const index = eintrag["index"];
            const ende = eintrag["end"];
            punkte.push({
                punkt: [eintrag["x"], eintrag["y"]],
                schluessel: istZahl(index)
                    ? `i:${String(index)}`
                    : ende === "start" || ende === "end"
                      ? `e:${ende}`
                      : undefined,
            });
        }
        return punkte.length > 0 ? { form: "punkte", punkte } : undefined;
    }
    if (istPunkt(erstes)) {
        const punkte = wert.filter(istPunkt).map(punkt);
        if (art === "path") return punkte.length >= 2 ? { form: "linien", linien: [punkte] } : undefined;
        return punkte.length > 0
            ? { form: "punkte", punkte: punkte.map((p): BewegterPunkt => ({ punkt: p, schluessel: undefined })) }
            : undefined;
    }
    if (!Array.isArray(erstes)) return undefined;
    // Ringe (Polygon) oder Polygone mit Ringen: eine Ebene tiefer, wenn schon der erste Eintrag eine Liste von Ringen ist.
    const zweites: unknown = erstes[0];
    if (istPunkt(zweites)) {
        const linien = ringeAus(wert);
        return linien.length > 0 ? { form: "linien", linien } : undefined;
    }
    if (Array.isArray(zweites) && istPunkt(zweites[0])) {
        const linien = wert.flatMap((polygon) => (Array.isArray(polygon) ? ringeAus(polygon) : []));
        return linien.length > 0 ? { form: "linien", linien } : undefined;
    }
    return undefined;
}

/** Das Netz eines Gebirges (`gebirge:netz`): die Kämme (und Täler) als Linien, Nebengipfel und Mulden als Punkte. */
export function leseNetz(wert: unknown): { linien: (readonly KartenPunkt[])[]; punkte: KartenPunkt[] } | undefined {
    if (!istObjekt(wert)) return undefined;
    const linien: (readonly KartenPunkt[])[] = [];
    const punkte: KartenPunkt[] = [];
    const kaemme = wert["kaemme"];
    if (Array.isArray(kaemme))
        for (const kamm of kaemme) {
            const liste = istObjekt(kamm) ? kamm["punkte"] : undefined;
            if (!Array.isArray(liste)) continue;
            const linie = liste.filter(istPunkt).map(punkt);
            if (linie.length >= 2) linien.push(linie);
        }
    for (const name of ["nebengipfel", "mulden"] as const) {
        const liste = wert[name];
        if (!Array.isArray(liste)) continue;
        for (const eintrag of liste)
            if (istObjekt(eintrag) && istZahl(eintrag["x"]) && istZahl(eintrag["y"]))
                punkte.push([eintrag["x"], eintrag["y"]]);
    }
    return linien.length > 0 || punkte.length > 0 ? { linien, punkte } : undefined;
}

// --- Das Bild ---------------------------------------------------------------------------------------------------------

/** Was eine Seite (Vorher oder Nachher) eines Felds auf die Karte bringt. */
interface Seite {
    readonly teile: KartenTeil[];
    readonly punkte: readonly BewegterPunkt[];
    /** Nur bewegte Punkte statt der ganzen Form. */
    readonly teilweise: boolean;
}

const LEER: Seite = { teile: [], punkte: [], teilweise: false };

function seiteVon(feld: string, wert: unknown, art: string): Seite {
    if (wert === null || wert === undefined) return LEER;
    if (feld === "position") {
        if (!istPunkt(wert)) return LEER;
        // Die Lage ist ganz gespeichert (kein Teil-Delta); sie trägt trotzdem einen Schlüssel, damit die frühere und die neue Lage desselben Gegenstands verbunden werden.
        const lage = punkt(wert);
        return {
            teile: [{ art: "punkt", punkt: lage }],
            punkte: [{ punkt: lage, schluessel: "position" }],
            teilweise: false,
        };
    }
    if (feld === "gebirge:netz" || feld === "gebirge") {
        const netz = leseNetz(feld === "gebirge" && istObjekt(wert) ? wert["netz"] : wert);
        if (netz === undefined) return LEER;
        return {
            teile: [
                ...netz.linien.map((punkte): KartenTeil => ({ art: "linie", punkte })),
                ...netz.punkte.map((p): KartenTeil => ({ art: "punkt", punkt: p })),
            ],
            punkte: [],
            teilweise: false,
        };
    }
    if (feld !== "geometry") return LEER;
    const gelesen = leseGeometrie(wert, art);
    if (gelesen === undefined) return LEER;
    if (gelesen.form === "linien")
        return {
            teile: gelesen.linien.map((punkte): KartenTeil => ({ art: "linie", punkte })),
            punkte: [],
            teilweise: false,
        };
    return {
        teile: gelesen.punkte.map((p): KartenTeil => ({ art: "punkt", punkt: p.punkt })),
        punkte: gelesen.punkte,
        teilweise: true,
    };
}

/** Die Felder, die sich auf der Karte zeigen lassen. */
export const KARTEN_FELDER: readonly string[] = ["geometry", "position", "gebirge", "gebirge:netz"];

/** Hat die Operation (oder Serie) Felder, die sich auf der Karte zeigen lassen, auch wenn ihr Wert noch aussteht? */
export const hatKartenFelder = (gegenstaende: readonly KartenGegenstand[]): boolean =>
    gegenstaende.some((gegenstand) => gegenstand.zeilen.some((zeile) => KARTEN_FELDER.includes(zeile.feld)));

/**
 * Das Bild einer Änderung: je Gegenstand und Feld, was das Protokoll an Lage vorher und nachher führt. Felder, die nicht Lage sind,
 * und Werte, die noch ausstehen, bleiben weg. Ein Weg mit den Punkten `{index,x,y}` zeigt nur diese Punkte, je Index mit der neuen Lage
 * verbunden; mitgezogene Ecken einer Fläche ohne Index nur als Punkte.
 */
export function kartenBild(gegenstaende: readonly KartenGegenstand[]): KartenBild {
    const vorher: KartenTeil[] = [];
    const nachher: KartenTeil[] = [];
    const verschiebungen: KartenVerschiebung[] = [];
    let vorherFehlt = false;
    let vorherTeilweise = false;
    let nachherTeilweise = false;
    for (const gegenstand of gegenstaende) {
        for (const zeile of gegenstand.zeilen) {
            if (!KARTEN_FELDER.includes(zeile.feld) || zeile.omitted) continue;
            const davor = zeile.hatVorher ? seiteVon(zeile.feld, zeile.vorher, gegenstand.kind) : LEER;
            const danach = seiteVon(zeile.feld, zeile.nachher, gegenstand.kind);
            // Fehlt die frühere Form (`formFehlt` ohne `before`), gibt es kein Vorher; was das Protokoll sonst führt, bleibt, wie es ist.
            if (zeile.formFehlt && !zeile.hatVorher) vorherFehlt = true;
            if (davor.teilweise) vorherTeilweise = true;
            else if (danach.teilweise && davor.teile.length > 0) nachherTeilweise = true;
            vorher.push(...davor.teile);
            nachher.push(...danach.teile);
            // Verbunden werden nur Punkte, die das Protokoll mit demselben Index oder Ende nennt; Ecken ohne Index nie.
            const nachLage = new Map(
                danach.punkte.flatMap((p) => (p.schluessel === undefined ? [] : [[p.schluessel, p.punkt] as const])),
            );
            for (const p of davor.punkte) {
                const nach = p.schluessel === undefined ? undefined : nachLage.get(p.schluessel);
                if (nach !== undefined) verschiebungen.push({ von: p.punkt, nach });
            }
        }
    }
    return {
        vorher,
        nachher,
        verschiebungen,
        hinweise: { vorherFehlt, vorherTeilweise, nachherTeilweise },
        grenzen: grenzenVon([...vorher, ...nachher]),
    };
}

function grenzenVon(teile: readonly KartenTeil[]): readonly [number, number, number, number] | undefined {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const nimm = ([x, y]: KartenPunkt): void => {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    };
    for (const teil of teile) {
        if (teil.art === "punkt") nimm(teil.punkt);
        else teil.punkte.forEach(nimm);
    }
    return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : undefined;
}

/** Gibt es etwas zu zeigen? */
export const hatBild = (bild: KartenBild): boolean => bild.grenzen !== undefined;
