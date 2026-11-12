/**
 * Die Regeln an Ringen für „Fertig“ der Formentwürfe, EINMAL für Server und Editor (Vali 2026-11-10 zu zwei Ablehnungen an Fläche-452:
 * „editoren werden immer wieder beim editieren gehindert. kannst du irgendwas machen, dass solche sachen nicht passieren“). Der Server
 * prüft damit die Operation (`apps/server/src/editor/ring-form.ts`, `landscape-reshape.ts`, `territory-reshape.ts`), der Editor jeden
 * Schritt des Entwurfs (`apps/web/src/map/geometrie/form-regel.ts`): Was der Editor zulässt, lehnt der Server nicht ab.
 *
 * - Ringe stehen ohne Schlusspunkt, je Polygon zuerst außen, dann die Löcher (wie `EditorLandscapeArea.polygons`).
 * - 🔴 **Keine Rundung der Koordinaten:** Unveränderte Ecken bleiben bitgenau, sonst lägen gemeinsame Ecken mit Nachbarn nicht mehr
 *   aufeinander. Verglichen wird auf fünf Nachkommastellen, wie der Client einrastet.
 * - **Aufeinanderliegende Ecken** werden eine (`bereinige`): Eine Ecke, auf ihre Nachbarin gezogen, verschwindet. Ein Ring braucht danach
 *   noch drei Ecken.
 * - **Nachbarn:** An einer mitgezogenen Fläche darf sich nur bewegen, was genau auf einer alten Ecke des bearbeiteten Objekts lag und
 *   auf eine seiner neuen Ecken geht (`mitgezogen`); Zahl und Lage aller anderen Ecken bleiben. So zeichnet keine Route eine fremde
 *   Fläche um. Dazu darf eine neue Ecke des Objekts in sie kommen (ein Punkt auf der gemeinsamen Grenze, Thomas 2026-10-19, 5.2) und eine
 *   gemeinsame Ecke wegfallen (auf ihre Nachbarin gezogen): `mitGemeinsamenEcken`.
 * - **Was der Entwurf hinterlässt** (OPS-000079, zweite Runde, 69 Ablehnungen am 2026-11-03): Die Prüfung sieht nur Anfang und Ende, der
 *   Entwurf hat Schritte dazwischen. Zieht das Objekt eine gemeinsame Ecke mit und löst sie danach mit Strg, liegt die Nachbarin dort, wo
 *   das Objekt nicht mehr ist; dasselbe gilt für einen neuen Punkt auf der gemeinsamen Kante. Maßstab bleibt: Was nie mit dem Objekt zu tun
 *   hatte, bleibt, wie es ist. Eine fremde Ecke, auf der das Objekt erst im Entwurf einrastet, ist erst gemeinsam, solange sie am Ende auf
 *   einer seiner Ecken liegt.
 * - **Doppelte Ecken der Altdaten** (OPS-000079: 133 Paare an 103 von 906 Gebietsflächen, oft an Drei-Länder-Ecken): Gelesen stehen sie noch im
 *   Ring, die neue Form ist bereinigt. Die Prüfungen vergleichen darum den bereinigten alten Ring, sonst schiene jede solche Nachbarin umgezeichnet.
 */

export type RingPunkt = readonly [number, number];
export type RingPolygone = readonly (readonly (readonly RingPunkt[])[])[];

/** So viele Ecken braucht ein Ring nach `bereinige`. */
export const RING_MINDESTENS = 3;

export const ringSchluessel = ([x, y]: RingPunkt): string => `${x.toFixed(5)} ${y.toFixed(5)}`;

/** Ein Ring ohne gleiche Ecken hintereinander und ohne den Schlusspunkt. */
export function bereinigeRing(ring: readonly RingPunkt[]): RingPunkt[] {
    const raus: RingPunkt[] = [];
    for (const p of ring) {
        const vorher = raus.at(-1);
        if (vorher && ringSchluessel(vorher) === ringSchluessel(p)) continue;
        raus.push(p);
    }
    if (raus.length > 1 && ringSchluessel(raus[0]!) === ringSchluessel(raus.at(-1)!)) raus.pop();
    return raus;
}

/** Ohne gleiche Ecken hintereinander und ohne den Schlusspunkt; eine Ecke, auf ihre Nachbarin gezogen, verschwindet. */
export function bereinigeRinge(polygone: RingPolygone): RingPunkt[][][] {
    return polygone.map((polygon) => polygon.map((ring) => bereinigeRing(ring)));
}

/** Bewegt sich an der Nachbarin nur, was auf einer alten Ecke lag und auf eine neue geht? Gibt die bewegten Ecken zurück. */
export function mitgezogeneEcken(
    alt: RingPolygone,
    neu: RingPolygone,
    eigeneAlt: ReadonlySet<string>,
    eigeneNeu: ReadonlySet<string>,
): { von: RingPunkt; nach: RingPunkt }[] | undefined {
    const sauber = bereinigeRinge(alt);
    if (sauber.length !== neu.length) return undefined;
    const bewegt: { von: RingPunkt; nach: RingPunkt }[] = [];
    for (let p = 0; p < sauber.length; p += 1) {
        if (sauber[p]!.length !== neu[p]!.length) return undefined;
        for (let r = 0; r < sauber[p]!.length; r += 1) {
            const a = sauber[p]![r]!;
            const n = neu[p]![r]!;
            if (a.length !== n.length) return undefined;
            for (let i = 0; i < a.length; i += 1) {
                if (ringSchluessel(a[i]!) === ringSchluessel(n[i]!)) continue;
                if (!eigeneAlt.has(ringSchluessel(a[i]!)) || !eigeneNeu.has(ringSchluessel(n[i]!))) return undefined;
                bewegt.push({ von: a[i]!, nach: n[i]! });
            }
        }
    }
    return bewegt;
}

/** Der gleiche Anfang und das gleiche Ende zweier Ringe (als Schlüssel) abgeschnitten: die Mitte, an der gearbeitet wurde. */
function mitten(a: readonly string[], n: readonly string[]): { vorn: number; altMitte: string[]; neuMitte: string[] } {
    let vorn = 0;
    while (vorn < a.length && vorn < n.length && a[vorn] === n[vorn]) vorn += 1;
    let hinten = 0;
    while (
        hinten < a.length - vorn &&
        hinten < n.length - vorn &&
        a[a.length - 1 - hinten] === n[n.length - 1 - hinten]
    )
        hinten += 1;
    return { vorn, altMitte: a.slice(vorn, a.length - hinten), neuMitte: n.slice(vorn, n.length - hinten) };
}

/**
 * Geht der bereinigte Ring `neu` aus dem bereinigten `alt` hervor, wenn sich nur ändert, was das Objekt berührt? Eine alte gemeinsame Ecke
 * darf wegfallen oder wandern, eine Ecke darf auf eine neue Ecke des Objekts gehen, und ein neuer Punkt darf kommen, wenn das Objekt ihn hat
 * oder er auf einer alten gemeinsamen Kante liegt. Alle anderen Ecken bleiben in ihrer Folge.
 */
export function nachbarRingFolgt(
    alt: readonly RingPunkt[],
    neu: readonly RingPunkt[],
    eigeneAlt: ReadonlySet<string>,
    eigeneNeu: ReadonlySet<string>,
): boolean {
    const a = alt.map(ringSchluessel);
    const { vorn, altMitte, neuMitte } = mitten(a, neu.map(ringSchluessel));
    const aufGemeinsamerKante = (i: number): boolean =>
        eigeneAlt.has(a[(vorn + i + a.length - 1) % a.length]!) && eigeneAlt.has(a[(vorn + i) % a.length]!);
    const breite = neuMitte.length + 1;
    const erreicht = new Uint8Array((altMitte.length + 1) * breite);
    erreicht[0] = 1;
    for (let i = 0; i <= altMitte.length; i += 1) {
        for (let j = 0; j < breite; j += 1) {
            if (erreicht[i * breite + j] !== 1) continue;
            const von = altMitte[i];
            const nach = neuMitte[j];
            if (von !== undefined && nach !== undefined && (von === nach || eigeneAlt.has(von) || eigeneNeu.has(nach)))
                erreicht[(i + 1) * breite + j + 1] = 1;
            if (von !== undefined && eigeneAlt.has(von)) erreicht[(i + 1) * breite + j] = 1;
            if (nach !== undefined && (eigeneNeu.has(nach) || aufGemeinsamerKante(i))) erreicht[i * breite + j + 1] = 1;
        }
    }
    return erreicht[altMitte.length * breite + neuMitte.length] === 1;
}

/**
 * Ändert sich an der Nachbarin auch die Zahl der Ecken, aber nur an gemeinsamen Ecken (Kopf der Datei)? Das Protokoll trägt dann ihre ganze
 * Form statt der bewegten Ecken: Eine Liste von Punkten kann keine neue Ecke zurücknehmen.
 */
export function mitGemeinsamenEcken(
    alt: RingPolygone,
    neu: RingPolygone,
    eigeneAlt: ReadonlySet<string>,
    eigeneNeu: ReadonlySet<string>,
): boolean {
    const sauber = bereinigeRinge(alt);
    return (
        sauber.length === neu.length &&
        sauber.every(
            (polygon, p) =>
                polygon.length === neu[p]!.length &&
                polygon.every((ring, r) => nachbarRingFolgt(ring, neu[p]![r]!, eigeneAlt, eigeneNeu)),
        )
    );
}

/**
 * Wo eine Nachbarin mehr als die gemeinsamen Ecken verlöre (für die Marke auf der Karte): die erste Ecke in der Mitte des Rings (`mitten`),
 * die weder alt noch eine Ecke des Objekts ist, sonst die erste alte Ecke, die fehlt und nie dem Objekt gehörte. `undefined`, wenn der Ring
 * der Regel folgt. Die Ringe sind bereinigt.
 */
export function abweichendeEcke(
    alt: readonly RingPunkt[],
    neu: readonly RingPunkt[],
    eigeneAlt: ReadonlySet<string>,
    eigeneNeu: ReadonlySet<string>,
): RingPunkt | undefined {
    if (nachbarRingFolgt(alt, neu, eigeneAlt, eigeneNeu)) return undefined;
    const a = alt.map(ringSchluessel);
    const n = neu.map(ringSchluessel);
    const { vorn, altMitte, neuMitte } = mitten(a, n);
    const altSatz = new Set(a);
    const neuSatz = new Set(n);
    // Gleich lang: Ecke für Ecke, eine fremde Ecke, die wanderte und nicht auf dem Objekt liegt (eingerastet, mitgezogen, dann gelöst).
    if (altMitte.length === neuMitte.length) {
        const i = altMitte.findIndex(
            (von, k) => von !== neuMitte[k] && !eigeneAlt.has(von) && !eigeneNeu.has(neuMitte[k]!),
        );
        if (i >= 0) return neu[vorn + i]!;
    }
    const neuIndex = neuMitte.findIndex((nach) => !altSatz.has(nach) && !eigeneNeu.has(nach));
    if (neuIndex >= 0) return neu[vorn + neuIndex]!;
    const altIndex = altMitte.findIndex((von) => !neuSatz.has(von) && !eigeneAlt.has(von));
    if (altIndex >= 0) return alt[vorn + altIndex]!;
    return neu[vorn] ?? neu[0] ?? alt[vorn] ?? alt[0];
}

/** Dieselbe Form (auf fünf Nachkommastellen)? Dann schreibt die Operation die Fläche nicht, und ihre Revision bleibt. */
export const gleicheRinge = (a: RingPolygone, b: RingPolygone): boolean =>
    JSON.stringify(a.map((p) => p.map((r) => r.map(ringSchluessel)))) ===
    JSON.stringify(b.map((p) => p.map((r) => r.map(ringSchluessel))));
