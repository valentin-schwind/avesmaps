import { FLAECHEN_FANG } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { bereinige, geojsonAus, polygoneVon, schluessel, type Punkt } from "./ring-form.ts";

/**
 * Die Rechnung von „Flächen vereinigen ›“ (WI-0252, Vertrag `editor-flaechen-vereinigen.ts`), gemeinsam für Landschaften
 * (`landscape-vereinigen.ts`) und Herrschaftsgebiete (`territory-vereinigen.ts`). Sie kennt nur Teilflächen mit ihrem Besitzer (Landschaft
 * oder Gebiet), Ringe ohne Schlusspunkt wie `ring-form.ts`, und schreibt nichts.
 *
 * 1. **Gruppen:** Teilflächen, die einander berühren oder überlappen (bis auf `FLAECHEN_FANG`, gemessen in PostGIS), bilden eine Gruppe,
 *    auch über mehrere Glieder. Eine Gruppe aus einer einzigen Teilfläche der Vorlage bleibt, wie sie ist.
 * 2. **Träger:** Jede Gruppe geht in die größte Teilfläche der Vorlage darin; eine Gruppe ohne Teilfläche der Vorlage in die größte
 *    Teilfläche der Vorlage überhaupt (als weiteres Polygon). Alle anderen Teilflächen der Gruppe gehen von der Karte.
 * 3. **Stoßpunkte:** Eine Ecke, die bis auf den Fangradius neben einer Ecke einer schon aufgenommenen Teilfläche liegt, rastet auf diese ein
 *    (der Träger zuerst, dann nach Größe). 🔴 Nie eine Ecke, die ein Nachbar teilt: Sie bleibt bitgenau, sonst risse die gemeinsame Kante.
 * 4. **Vereinigen** in PostGIS (`ST_Union`, gültig gemacht, nur Flächen); gemeinsame Kanten fallen dabei weg. Löcher, die nur ein schmaler
 *    Spalt zwischen den Teilflächen waren (mittlere Breite unter dem doppelten Fangradius), schließen sich.
 * 5. 🔴 **Nachbarn:** Jede Ecke eines Nachbarn, die auf einer Ecke einer aufgenommenen Teilfläche lag, muss eine Ecke des Ergebnisses sein;
 *    sonst geht es nicht (`nachbar`).
 */

export interface Teilflaeche {
    /** Die Kennung der Teilfläche (`region_area.public_id`, `territory_area.public_id`). */
    readonly id: string;
    /** Die Landschaft oder das Gebiet, dem sie gehört. */
    readonly besitzer: string;
    readonly polygone: Punkt[][][];
    readonly groesse: number;
}

export interface Traeger {
    readonly id: string;
    readonly vorher: Punkt[][][];
    readonly nachher: Punkt[][][];
    /** Die Teilflächen, die in ihm aufgehen (ohne ihn selbst). */
    readonly aufgenommen: readonly string[];
}

export type Vereinigung =
    | { readonly geht: true; readonly traeger: readonly Traeger[]; readonly weg: readonly string[] }
    | { readonly geht: false; readonly grund: "nachbar" | "leer" };

/** Die Gruppen der Teilflächen: wer wen (über Glieder) berührt. */
export function gruppen(
    flaechen: readonly Teilflaeche[],
    beruehrt: readonly (readonly [string, string])[],
): Teilflaeche[][] {
    const oben = new Map(flaechen.map((f) => [f.id, f.id] as const));
    const wurzel = (id: string): string => {
        let x = id;
        while (oben.get(x) !== x) x = oben.get(x)!;
        oben.set(id, x);
        return x;
    };
    for (const [a, b] of beruehrt) {
        if (!oben.has(a) || !oben.has(b)) continue;
        const ra = wurzel(a);
        const rb = wurzel(b);
        if (ra !== rb) oben.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
    }
    const je = new Map<string, Teilflaeche[]>();
    for (const f of flaechen) {
        const r = wurzel(f.id);
        je.set(r, [...(je.get(r) ?? []), f]);
    }
    return [...je.values()];
}

const groesser = (a: Teilflaeche, b: Teilflaeche): number => b.groesse - a.groesse || (a.id < b.id ? -1 : 1);

/** Ein Gitter der Ecken mit Zellen so groß wie der Fangradius: die nächste Ecke in Reichweite, ohne alle zu vergleichen. */
class EckenGitter {
    private readonly zellen = new Map<string, Punkt[]>();
    // 🪤 Keine Parametereigenschaft (`constructor(private readonly fang …)`): Lokal startet Node die Quelle mit Type-Stripping, das kennt
    // sie nicht, und der Server startet gar nicht (2026-10-25).
    private readonly fang: number;
    constructor(fang: number) {
        this.fang = fang;
    }
    private zelle(x: number, y: number): string {
        return `${String(Math.floor(x / this.fang))} ${String(Math.floor(y / this.fang))}`;
    }
    nimm(p: Punkt): void {
        const k = this.zelle(p[0], p[1]);
        const liste = this.zellen.get(k);
        if (liste === undefined) this.zellen.set(k, [p]);
        else liste.push(p);
    }
    naechste(p: Punkt): Punkt | undefined {
        const zx = Math.floor(p[0] / this.fang);
        const zy = Math.floor(p[1] / this.fang);
        let beste: Punkt | undefined;
        let abstand = this.fang;
        for (let dx = -1; dx <= 1; dx += 1)
            for (let dy = -1; dy <= 1; dy += 1)
                for (const q of this.zellen.get(`${String(zx + dx)} ${String(zy + dy)}`) ?? []) {
                    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
                    if (d <= abstand) {
                        abstand = d;
                        beste = q;
                    }
                }
        return beste;
    }
}

/** Die Glieder einer Gruppe eingerastet: der Träger unverändert, die übrigen mit Ecken auf den schon aufgenommenen (Schritt 3). */
export function rasteEin(
    glieder: readonly Teilflaeche[],
    nachbarEcken: ReadonlySet<string>,
    fang = FLAECHEN_FANG,
): Punkt[][][][] {
    const gitter = new EckenGitter(fang);
    const raus: Punkt[][][][] = [];
    glieder.forEach((glied, i) => {
        const gerastet =
            i === 0
                ? glied.polygone
                : glied.polygone.map((polygon) =>
                      polygon.map((ring) =>
                          ring.map((p): Punkt => {
                              if (nachbarEcken.has(schluessel(p))) return p;
                              const q = gitter.naechste(p);
                              return q === undefined ? p : q;
                          }),
                      ),
                  );
        for (const polygon of gerastet) for (const ring of polygon) for (const p of ring) gitter.nimm(p);
        raus.push(ohneKurzeRinge(bereinige(gerastet)));
    });
    return raus;
}

/** Ohne Ringe unter drei Ecken; ein Polygon, dessen Außenring so kurz wurde, fällt ganz weg. */
function ohneKurzeRinge(polygone: Punkt[][][]): Punkt[][][] {
    return polygone
        .filter((polygon) => (polygon[0]?.length ?? 0) >= 3)
        .map(([aussen, ...loecher]) => [aussen!, ...loecher.filter((ring) => ring.length >= 3)]);
}

const flaecheVon = (ring: readonly Punkt[]): number => {
    let summe = 0;
    for (let i = 0; i < ring.length; i += 1) {
        const [x1, y1] = ring[i]!;
        const [x2, y2] = ring[(i + 1) % ring.length]!;
        summe += x1 * y2 - x2 * y1;
    }
    return Math.abs(summe) / 2;
};
const umfangVon = (ring: readonly Punkt[]): number => {
    let summe = 0;
    for (let i = 0; i < ring.length; i += 1) {
        const [x1, y1] = ring[i]!;
        const [x2, y2] = ring[(i + 1) % ring.length]!;
        summe += Math.hypot(x2 - x1, y2 - y1);
    }
    return summe;
};

/** Ohne die Löcher, die nur ein schmaler Spalt waren: mittlere Breite (2 · Fläche / Umfang) unter dem doppelten Fangradius. */
export function ohneSpalten(polygone: readonly Punkt[][][], fang = FLAECHEN_FANG): Punkt[][][] {
    return polygone.map(([aussen, ...loecher]) => [
        aussen!,
        ...loecher.filter((loch) => (2 * flaecheVon(loch)) / Math.max(umfangVon(loch), Number.EPSILON) >= 2 * fang),
    ]);
}

/** Die Ecken als Schlüssel (`ring-form.ts`, fünf Nachkommastellen). */
export function eckenVon(polygone: readonly (readonly (readonly Punkt[])[])[]): Set<string> {
    const raus = new Set<string>();
    for (const polygon of polygone) for (const ring of polygon) for (const p of ring) raus.add(schluessel(p));
    return raus;
}

/**
 * Vereinigt Flächen in PostGIS: gültig gemacht, nur Flächen; `undefined`, wenn nichts bleibt.
 *
 * 🔴 Jede Teilfläche wird VOR der Vereinigung gültig gemacht (`ST_MakeValid`, nur Flächen): Die echten Landschaften haben Ränder, die sich
 * leicht berühren oder kreuzen, und das Einrasten der Ecken (Schritt 3) verschiebt sie noch. `ST_Union` bricht an so einer Fläche mit
 * „GEOSUnaryUnion: TopologyException: side location conflict“ ab (gemessen an echten Daten, Gebirge in der Wegwerf-Welt, 2026-10-25:
 * `GET …/vereinigen` antwortete 500; die Stubs und die kleinen Fälle der Servertests hatten nur saubere Flächen).
 */
export async function vereinigeIn(sql: Queryable, teile: readonly Punkt[][][][]): Promise<Punkt[][][] | undefined> {
    const geojson = teile.filter((t) => t.length > 0).map((t) => geojsonAus(t));
    const [zeile] = await sql<{ g: string | null }[]>`
        WITH e AS (
            SELECT ST_CollectionExtract(
                       ST_MakeValid(
                           ST_Union(
                               ARRAY(
                                   SELECT ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(x), 0)), 3)
                                     FROM unnest(${geojson}::text[]) AS x
                               )
                           )
                       ),
                       3
                   ) AS g
        )
        SELECT CASE WHEN ST_IsEmpty(g) THEN NULL ELSE ST_AsGeoJSON(g, 15) END AS g FROM e
    `;
    return zeile?.g === null || zeile?.g === undefined ? undefined : polygoneVon(zeile.g);
}

/**
 * Plant die Vereinigung (Schritte 1 bis 5): welche Teilflächen der Vorlage die neue Form bekommen und welche von der Karte gehen.
 * `nachbarEcken` sind die Ecken der Nachbarn (nicht der gewählten), die auf einer Ecke der gewählten Flächen liegen: Nur diese Ecken fragen
 * Schritt 3 und 5; die Abfrage liest darum keine ganzen Nachbarflächen.
 */
export async function planeVereinigung(
    sql: Queryable,
    eingabe: {
        readonly flaechen: readonly Teilflaeche[];
        readonly beruehrt: readonly (readonly [string, string])[];
        readonly vorlage: string;
        readonly nachbarEcken: ReadonlySet<string>;
        readonly fang?: number;
    },
): Promise<Vereinigung> {
    const fang = eingabe.fang ?? FLAECHEN_FANG;
    const eigene = eingabe.flaechen.filter((f) => f.besitzer === eingabe.vorlage).sort(groesser);
    const haupt = eigene[0];
    if (haupt === undefined) return { geht: false, grund: "leer" };
    // Je Träger seine Glieder: der Träger zuerst, dann nach Größe.
    const je = new Map<string, Teilflaeche[]>();
    for (const gruppe of gruppen(eingabe.flaechen, eingabe.beruehrt)) {
        const sortiert = [...gruppe].sort(groesser);
        const traeger = sortiert.find((f) => f.besitzer === eingabe.vorlage) ?? haupt;
        const glieder = je.get(traeger.id) ?? [traeger];
        for (const f of sortiert) if (f.id !== traeger.id) glieder.push(f);
        je.set(traeger.id, glieder);
    }
    const traeger: Traeger[] = [];
    const weg: string[] = [];
    const ergebnisEcken = new Set<string>();
    const gebraucht = new Set<string>();
    for (const [id, glieder] of je) {
        if (glieder.length === 1) continue;
        const gerastet = rasteEin(glieder, eingabe.nachbarEcken, fang);
        const vereinigt = await vereinigeIn(sql, gerastet);
        if (vereinigt === undefined) return { geht: false, grund: "leer" };
        const nachher = ohneKurzeRinge(bereinige(ohneSpalten(vereinigt, fang)));
        for (const k of eckenVon(nachher)) ergebnisEcken.add(k);
        for (const glied of glieder)
            for (const k of eckenVon(glied.polygone)) if (eingabe.nachbarEcken.has(k)) gebraucht.add(k);
        traeger.push({ id, vorher: glieder[0]!.polygone, nachher, aufgenommen: glieder.slice(1).map((g) => g.id) });
        weg.push(...glieder.slice(1).map((g) => g.id));
    }
    for (const k of gebraucht) if (!ergebnisEcken.has(k)) return { geht: false, grund: "nachbar" };
    // Der Träger der größten Teilfläche zuerst: An ihm hängt ↺ im Verlauf der Vorlage.
    traeger.sort((a, b) => (a.id === haupt.id ? -1 : b.id === haupt.id ? 1 : 0));
    return { geht: true, traeger, weg };
}
