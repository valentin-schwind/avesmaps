/**
 * Das Bündeln der Reisebilder am Schirm (WI-0272 S4, Aufgabe 25; Vorbild die Probierseite `buendel`). Eine reine Funktion der Sicht, ohne Karte und ohne DOM.
 *
 * - **Am Schirm, nicht in der Karte:** Liegen zwei Symbole enger als der Fangradius, fallen sie zu einem mit Zahl zusammen. Weil in Bildpunkten gemessen wird, bündelt Herauszoomen von selbst
 *   immer mehr; unter dem Bezugszoom wächst der Fangradius sogar mit (`fangradius`), damit nicht alles voller Symbole ist (Vali 31.10.). MapLibres `cluster` kann das nicht (sein Radius wächst
 *   nicht beim Herauszoomen, es kennt keine Fahne, und die Bilder eines Bündels kämen nur asynchron).
 * - 🔴 **Deterministisch:** Die Eingabe wird nach der Bildkennung sortiert. Dieselben Bilder in anderer Reihenfolge ergeben dieselben Gruppen, und der Schlüssel einer Gruppe (die kleinste Kennung)
 *   bleibt, wenn ein weiteres Bild dazukommt. Sonst sprängen Gruppen beim Verschieben der Karte, und der Zustand je Schlüssel (Hover, Pulsring) träfe das falsche Symbol.
 * - **Gebundene Bilder** (mit `ortId`, bei der Freigabe an einen sichtbaren Ort gebunden) bündelt diese Funktion nie: Sie erscheinen nur in der Fahne ihres Orts (`trenne`).
 */

/** Wie groß der Fangradius in Bildpunkten ist, je Symbol (Regler melden, WI §9: Fangradius). Die Zahlen der Probierseite sind Kulisse. */
export const BUENDEL_RADIUS = { zeichen: 50, vorschau: 60 } as const;
export type BuendelSymbol = keyof typeof BUENDEL_RADIUS;
/** Ab diesem Zoom abwärts wächst der Fangradius mit; darüber bleibt er (Regler melden, WI §9: Wachsen beim Herauszoomen). */
export const BUENDEL_BEZUGSZOOM = 5;
/** Ab diesem Abstand zur Mitte (mal 4) lohnt es, in ein Bündel hineinzuzoomen; darunter liegen die Bilder an einer Stelle. */
const LOHNT_PX = 58;

/** Der Fangradius des Symbols bei diesem Zoom, in Bildpunkten. */
export function fangradius(zoom: number, symbol: BuendelSymbol): number {
    return BUENDEL_RADIUS[symbol] * Math.max(1, 2 ** ((BUENDEL_BEZUGSZOOM - zoom) / 2));
}

/** Ein Bild als Punkt: `x`, `y` am Schirm, `lng`, `lat` in Renderkoordinaten der Karte, `ortId` des Orts, an den es gebunden ist (sichtbarer Ort). */
export interface BildPunkt {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly lng: number;
    readonly lat: number;
    readonly ortId?: string;
}

/** Eine Gruppe: ein Symbol mit Zahl. `schluessel` ist die kleinste Bildkennung, `x`/`y` der Mittelpunkt am Schirm, `lng`/`lat` der Mittelpunkt in der Karte. */
export interface Gruppe {
    readonly schluessel: string;
    readonly ids: readonly string[];
    readonly x: number;
    readonly y: number;
    readonly lng: number;
    readonly lat: number;
    readonly ortId?: string;
}

const nachId = (a: BildPunkt, b: BildPunkt): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const mittel = (werte: readonly number[]): number => werte.reduce((summe, wert) => summe + wert, 0) / werte.length;

/**
 * Fasst die Punkte zusammen, die enger als `radius` Bildpunkte beieinanderliegen: der erste (nach Kennung) nimmt jeden noch freien Punkt unter dem Radius zu sich, so wie die Probierseite.
 * Gruppen stehen in der Reihenfolge ihres Schlüssels.
 */
export function buendele(punkte: readonly BildPunkt[], radius: number): Gruppe[] {
    const frei = [...punkte].sort(nachId);
    const genommen = new Set<string>();
    const gruppen: Gruppe[] = [];
    for (const p of frei) {
        if (genommen.has(p.id)) continue;
        genommen.add(p.id);
        const mitglieder: BildPunkt[] = [p];
        for (const q of frei) {
            if (genommen.has(q.id)) continue;
            if (Math.hypot(q.x - p.x, q.y - p.y) < radius) {
                genommen.add(q.id);
                mitglieder.push(q);
            }
        }
        mitglieder.sort(nachId);
        const orte = new Set(mitglieder.map((m) => m.ortId));
        const ortId = orte.size === 1 ? mitglieder[0]?.ortId : undefined;
        gruppen.push({
            schluessel: p.id,
            ids: mitglieder.map((m) => m.id),
            x: mittel(mitglieder.map((m) => m.x)),
            y: mittel(mitglieder.map((m) => m.y)),
            lng: mittel(mitglieder.map((m) => m.lng)),
            lat: mittel(mitglieder.map((m) => m.lat)),
            ...(ortId === undefined ? {} : { ortId }),
        });
    }
    return gruppen;
}

/** Trennt die freien Bilder von den gebundenen: Mit `ortId` erscheint ein Bild nur über die Fahne seines Orts, je Ort eine Liste (nach Kennung). */
export function trenne(punkte: readonly BildPunkt[]): { frei: BildPunkt[]; gebunden: Map<string, BildPunkt[]> } {
    const frei: BildPunkt[] = [];
    const gebunden = new Map<string, BildPunkt[]>();
    for (const p of [...punkte].sort(nachId)) {
        if (p.ortId === undefined) {
            frei.push(p);
            continue;
        }
        const liste = gebunden.get(p.ortId);
        if (liste === undefined) gebunden.set(p.ortId, [p]);
        else liste.push(p);
    }
    return { frei, gebunden };
}

/**
 * Bringt Hineinzoomen etwas? Nur wenn die Bilder der Gruppe am Schirm nach einem Zoom um eine Stufe auch wirklich auseinanderliegen (größter Abstand zur Mitte mal 4 über 58 Bildpunkte) und
 * die Karte nicht schon am höchsten Zoom steht. Liegen sie an derselben Stelle, zeigt nur die Leiste sie einzeln (Probierseite `TATEN.marke`).
 */
export function lohntHineinzoomen(
    gruppe: Gruppe,
    punkte: readonly BildPunkt[],
    zoom: number,
    hoechsterZoom: number,
): boolean {
    const dabei = punkte.filter((p) => gruppe.ids.includes(p.id));
    if (dabei.length < 2) return false;
    const mx = mittel(dabei.map((p) => p.x));
    const my = mittel(dabei.map((p) => p.y));
    const spanne = Math.max(...dabei.map((p) => Math.hypot(p.x - mx, p.y - my)));
    return spanne * 4 > LOHNT_PX && zoom < hoechsterZoom - 0.05;
}
