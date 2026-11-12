/**
 * Die Farben der Herrschaftsgebiete (WI-0209 D4; EDIT-0005 H2, EDIT-0003 T38): Legacys Rechnung, übernommen und nicht neu erfunden
 * (Mirror `a7f2dac86`: `js/territory/territory-editor-color-utils.js`, `js/territory/territory-editor-inheritance.js`). Jedes Gebiet trägt
 * eine feste Farbe; vererbt wird beim Schreiben im Editor.
 *
 * - **`farbhierarchie`** ist Legacys „Farbhierarchie erstellen“ (`buildColorUpdates`, `ensureUniqueColors`): Die Untergebiete werden ab
 *   der Wurzel in der Folge der Tiefe aus der Farbe ihres Obergebiets abgeleitet; die Kinder eines Gebiets der Ebene L streuen mit der
 *   Abweichung von L (0 bis 256, 0 heißt dieselbe Farbe). Ton und Helligkeit verteilt je Familie eine Mischung aus dem Seed; dieselbe
 *   Farbe zweimal dreht Legacy in kleinen Schritten weiter. Wie in Legacy rechnen Kinder mit der Farbe ihres Obergebiets VOR diesem Drehen.
 * - **`verschiebe`** ist das Mitziehen aus H2: Ändert man die Farbe eines Gebiets, verschieben sich seine Untergebiete um dieselbe
 *   Differenz in Farbton, Sättigung und Helligkeit; ihre Abweichungen untereinander bleiben.
 * - Ähnliche Geschwister sind gewollt (H2), es gibt keinen Befund dafür.
 */

export interface Hsv {
    readonly h: number;
    readonly s: number;
    readonly v: number;
}

/** Eine Farbe als `#rrggbb` in Kleinbuchstaben, sonst `undefined`. */
export function normalFarbe(farbe: string | undefined | null): string | undefined {
    const text = String(farbe ?? "")
        .replace(/\s+/gu, " ")
        .trim();
    return /^#[0-9a-fA-F]{6}$/u.test(text) ? text.toLowerCase() : undefined;
}

function rgbVon(farbe: string): [number, number, number] {
    const hex = normalFarbe(farbe);
    if (hex === undefined) return [136, 136, 136];
    return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

export function hsvVon(farbe: string): Hsv {
    const [r, g, b] = rgbVon(farbe).map((k) => k / 255) as [number, number, number];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d > 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return { h, s: max <= 0 ? 0 : d / max, v: max };
}

export function farbeAus(h: number, s: number, v: number): string {
    const c = v * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const m = v - c;
    const [r, g, b] =
        hp < 1
            ? [c, x, 0]
            : hp < 2
              ? [x, c, 0]
              : hp < 3
                ? [0, c, x]
                : hp < 4
                  ? [0, x, c]
                  : hp < 5
                    ? [x, 0, c]
                    : [c, 0, x];
    return `#${[r, g, b]
        .map((k) =>
            Math.round((k + m) * 255)
                .toString(16)
                .padStart(2, "0"),
        )
        .join("")}`;
}

/** Legacys `seededUnit` (FNV-1a): dieselbe Zahl in [0, 1] für denselben Text. */
export function einheit(text: string): number {
    let n = 2166136261;
    for (const zeichen of text) {
        n ^= zeichen.charCodeAt(0);
        n = Math.imul(n, 16777619);
    }
    return (n >>> 0) / 4294967295;
}

export interface VarianteWahl {
    /** Platz des Gebiets in der Mischung seiner Geschwister (Farbton). */
    readonly index: number;
    readonly anzahl: number;
    /** Platz in der zweiten, unabhängigen Mischung (Helligkeit). */
    readonly hellIndex: number;
    readonly seed: string;
    /** HSV-Abweichung 0 bis 256; 0 heißt die Farbe des Obergebiets. */
    readonly abweichung: number;
}

/** Legacys `createHueVariant`, so wie „Farbhierarchie erstellen“ sie ruft (Tiefe 2). */
export function farbVariante(eltern: string, wahl: VarianteWahl): string {
    if (wahl.abweichung <= 0) return normalFarbe(eltern) ?? eltern;
    const faktor = Math.min(1, wahl.abweichung / 256);
    const hsv = hsvVon(eltern);
    const spanne = faktor * 360;
    const lage = wahl.anzahl > 1 ? wahl.index / (wahl.anzahl - 1) : 0.5;
    const versatz = (lage * 2 - 1) * spanne;
    const zittern = (einheit(`${wahl.seed}:jitter`) * 2 - 1) * spanne * 0.1;
    let v = hsv.v;
    let s = hsv.s;
    if (wahl.anzahl > 1) {
        const hell = wahl.hellIndex / Math.max(1, wahl.anzahl - 1);
        v = Math.max(0.3, Math.min(0.95, v + (hell - 0.5) * faktor * 0.12));
        s = Math.max(0.06, Math.min(1, s * (1 + (einheit(`${wahl.seed}:sat`) - 0.5) * faktor * 0.9)));
    }
    const stufe = Math.min(0.2, 0.05) * faktor;
    v = Math.max(0.3, Math.min(0.95, v + (hsv.v < 0.6 ? stufe : -stufe)));
    return farbeAus((hsv.h + versatz + zittern + 360) % 360, s, v);
}

/** Legacys Bereiche der Abweichung je Ebene; die Vorgabe wird bei jedem Start daraus gezogen (tiefer heißt enger). */
export const ABWEICHUNG_BEREICHE: Readonly<Record<number, readonly [number, number]>> = {
    1: [35, 40],
    2: [30, 35],
    3: [25, 30],
    4: [20, 30],
    5: [20, 30],
    6: [20, 30],
};

/** Die Abweichungen der Ebenen 1 bis 6 (Index 0 bis 5), zufällig aus Legacys Bereichen. */
export function abweichungVorgabe(zufall: () => number = Math.random): number[] {
    return [1, 2, 3, 4, 5, 6].map((ebene) => {
        const [min, max] = ABWEICHUNG_BEREICHE[ebene]!;
        return Math.round(min + zufall() * (max - min));
    });
}

export interface FarbGebiet {
    readonly id: string;
    readonly name: string;
    /** Das Obergebiet; die Wurzel der Rechnung hat keins oder eins außerhalb. */
    readonly eltern: string | undefined;
}

export interface FarbWurzel {
    readonly id: string;
    readonly farbe: string;
    /** Die Ebene im Baum, das Reich ist 1 (Legacys „Hierarchie-Level“). */
    readonly ebene: number;
}

const nachTiefeUndName = (a: { tiefe: number; name: string }, b: { tiefe: number; name: string }): number =>
    a.tiefe - b.tiefe || a.name.localeCompare(b.name, "de");

/**
 * „Farbhierarchie erstellen“: die Farben aller Untergebiete von `wurzel` (ohne sie selbst), in der Folge der Tiefe und des Namens.
 * `abweichung[L - 1]` ist die Abweichung der Kinder eines Gebiets der Ebene L; `seed` steht für einen Druck auf den Knopf.
 */
export function farbhierarchie(
    wurzel: FarbWurzel,
    gebiete: readonly FarbGebiet[],
    abweichung: readonly number[],
    seed: number,
): { id: string; farbe: string }[] {
    const kinderVon = new Map<string, FarbGebiet[]>();
    for (const g of gebiete) {
        if (g.eltern === undefined) continue;
        const liste = kinderVon.get(g.eltern) ?? [];
        liste.push(g);
        kinderVon.set(g.eltern, liste);
    }
    // Die Nachfahren wie Legacys `findDescendants`: über einen Stapel, dann nach Tiefe und Name.
    const nachfahren: (FarbGebiet & { tiefe: number })[] = [];
    const stapel = (kinderVon.get(wurzel.id) ?? []).map((g) => ({ g, tiefe: 1 }));
    const gesehen = new Set<string>();
    while (stapel.length > 0) {
        const { g, tiefe } = stapel.pop()!;
        if (gesehen.has(g.id)) continue;
        gesehen.add(g.id);
        nachfahren.push({ ...g, tiefe });
        for (const kind of kinderVon.get(g.id) ?? []) stapel.push({ g: kind, tiefe: tiefe + 1 });
    }
    nachfahren.sort(nachTiefeUndName);

    const familie = new Map<string, (FarbGebiet & { tiefe: number })[]>();
    for (const g of nachfahren) {
        const liste = familie.get(g.eltern!) ?? [];
        liste.push(g);
        familie.set(g.eltern!, liste);
    }
    const tonIndex = new Map<string, number>();
    const hellIndex = new Map<string, number>();
    for (const [eltern, gruppe] of familie)
        for (const [art, ziel] of [
            ["hue", tonIndex],
            ["val", hellIndex],
        ] as const)
            gruppe
                .map((g) => ({ id: g.id, r: einheit(`${String(seed)}:${art}:${eltern}:${g.id}`) }))
                .sort((a, b) => a.r - b.r)
                .forEach((eintrag, i) => ziel.set(eintrag.id, i));

    const farbeVon = new Map<string, string>([[wurzel.id, wurzel.farbe]]);
    const plan: { id: string; farbe: string; tiefe: number; name: string }[] = [];
    for (const g of nachfahren) {
        const ebene = Math.max(1, Math.min(6, wurzel.ebene + g.tiefe - 1));
        const farbe = farbVariante(farbeVon.get(g.eltern!) ?? wurzel.farbe, {
            index: tonIndex.get(g.id)!,
            anzahl: familie.get(g.eltern!)!.length,
            hellIndex: hellIndex.get(g.id)!,
            seed: `${String(seed)}:${g.id}`,
            abweichung: Math.max(0, Math.min(256, abweichung[ebene - 1] ?? 30)),
        });
        farbeVon.set(g.id, farbe);
        plan.push({ id: g.id, farbe, tiefe: g.tiefe, name: g.name });
    }

    // Legacys `ensureUniqueColors`: keine Farbe zweimal; die Wurzel bleibt, wie sie ist.
    const vergeben = new Set<string>([wurzel.farbe.toLowerCase()]);
    for (const eintrag of plan) {
        const farbe = eintrag.farbe.toLowerCase();
        if (!vergeben.has(farbe)) {
            vergeben.add(farbe);
            continue;
        }
        eintrag.farbe = freieFarbe(farbe, vergeben);
        vergeben.add(eintrag.farbe);
    }
    return plan.map(({ id, farbe }) => ({ id, farbe }));
}

/** Legacys `findFreeColor`: den Ton in Schritten von 2,5° abwechselnd drehen, die Helligkeit leicht, bis die Farbe frei ist. */
function freieFarbe(farbe: string, vergeben: ReadonlySet<string>): string {
    const hsv = hsvVon(farbe);
    for (let schritt = 1; schritt <= 240; schritt += 1) {
        const dh = (schritt % 2 === 1 ? 1 : -1) * Math.ceil(schritt / 2) * 2.5;
        for (const dv of [0, 0.05, -0.05, 0.1, -0.1]) {
            const kandidat = farbeAus(
                (((hsv.h + dh) % 360) + 360) % 360,
                hsv.s,
                Math.max(0.2, Math.min(1, hsv.v + dv)),
            ).toLowerCase();
            if (!vergeben.has(kandidat)) return kandidat;
        }
    }
    return farbe;
}

/**
 * Das Mitziehen (H2): `farbe` um dieselbe Differenz verschoben, um die sich das Obergebiet von `von` nach `nach` geändert hat — der
 * Farbton gedreht, Sättigung und Helligkeit um dieselbe Strecke, begrenzt auf 0 bis 1.
 */
export function verschiebe(farbe: string, von: string, nach: string): string {
    const alt = normalFarbe(von);
    const neu = normalFarbe(nach);
    if (alt === undefined || neu === undefined || alt === neu) return normalFarbe(farbe) ?? farbe;
    const a = hsvVon(alt);
    const b = hsvVon(neu);
    const c = hsvVon(farbe);
    const grenze = (x: number): number => Math.max(0, Math.min(1, x));
    return farbeAus((((c.h + b.h - a.h) % 360) + 360) % 360, grenze(c.s + b.s - a.s), grenze(c.v + b.v - a.v));
}
