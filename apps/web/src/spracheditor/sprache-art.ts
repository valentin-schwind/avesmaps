import type { OperationReceipt, SpracheAendernBody, SpracheEditorDetail, SpracheWikiBody } from "@avesmaps3d/shared";
import type { BearbeitungsArt, Stand } from "../fenster/bearbeitung";
import type { SchreibAntwort } from "../fenster/entwurf-senden";
import { t } from "../i18n/i18n";
import { farbeNormal, felderAus, felderGrund, gleicheFolge, unterschiede, type SpracheFelder } from "./sprache-felder";
import { revisionDerSprache, type SprachenDaten } from "./sprachen-daten";

/**
 * Die Sprache als Art des Fensterrumpfs (WI-0261 S5d2; Rumpf `fenster/bearbeitung.ts`, Muster `landschaftseditor/gipfel-art.ts`): Name,
 * Legende, Farbe und die Wiki-Artikel sind Felder des EINEN Entwurfs der Sprache. Die erste Änderung nimmt die Sperre (Teil `felder`),
 * „Fertig“ schreibt.
 *
 * - 🔴 **Zwei Schreibwege, nacheinander:** Der Vertrag trennt `sprache.wiki` (die Pillen) von `sprache.update` (Name, Legende, Farbe), und
 *   beide gehen gegen die Revision der Sprache; das Zuordnen zählt sie hoch. „Fertig“ schreibt darum erst die Pillen (die eher scheitern:
 *   ein Artikel einer fremd gesperrten Sprache, ein im Wiki verschwundener), dann die Felder gegen die Revision aus der ersten Quittung.
 *   Scheitert schon der erste Weg, ist nichts geschrieben. Die Sperre hält die Bearbeitung über beide Wege, ein Dritter schreibt nicht
 *   dazwischen.
 * - **Leere Legende** heißt „keine“ (`null`): Die Legende zeigt dann den Namen.
 * - **Teilflächen** gehören nicht in diesen Entwurf: Ihre Form schreibt „◇ Fläche bearbeiten“ für sich (`sprachflaeche-form.ts`), gegen die
 *   Revision der Teilfläche, und sie zählt die Revision der Sprache nicht hoch. Felder und Form stören sich also nicht.
 */

/** Was „Fertig“ schreibt: höchstens zwei Operationen, die Pillen zuerst. */
export interface SpracheSchreiben {
    readonly baseRevision: number;
    readonly wiki?: Omit<SpracheWikiBody, "baseRevision">;
    readonly felder?: Omit<SpracheAendernBody, "baseRevision">;
}

export type SpracheStand = Stand<SpracheFelder, never>;

/** Der Körper zu „Fertig“ aus Start und Entwurf; `undefined`: nichts zu schreiben. */
export function schreibenAus(
    d: Pick<SpracheEditorDetail, "revision">,
    start: SpracheFelder,
    jetzt: SpracheFelder,
    operationId: string,
    zweiteKennung: () => string,
): SpracheSchreiben | undefined {
    const felder: { -readonly [K in keyof SpracheAendernBody]?: SpracheAendernBody[K] } = {};
    if (jetzt.name.trim() !== start.name.trim()) felder.name = jetzt.name.trim();
    if (jetzt.legende.trim() !== start.legende.trim())
        felder.legende = jetzt.legende.trim() === "" ? null : jetzt.legende.trim();
    if (farbeNormal(jetzt.farbe) !== farbeNormal(start.farbe)) felder.farbe = farbeNormal(jetzt.farbe);
    const mitFeldern = Object.keys(felder).length > 0;
    const mitWiki = !gleicheFolge(jetzt.wiki, start.wiki);
    if (!mitFeldern && !mitWiki) return undefined;
    return {
        baseRevision: d.revision,
        ...(mitWiki ? { wiki: { operationId, artikel: [...jetzt.wiki] } } : {}),
        ...(mitFeldern ? { felder: { operationId: mitWiki ? zweiteKennung() : operationId, ...felder } } : {}),
    };
}

/** Schreibt die Pillen, dann die Felder gegen die Revision der ersten Quittung; die Antwort ist die letzte. */
export async function schreibeSprache(
    daten: Pick<SprachenDaten, "aendere" | "setzeWiki">,
    id: string,
    body: SpracheSchreiben,
): Promise<SchreibAntwort> {
    let revision = body.baseRevision;
    let letzte: SchreibAntwort<OperationReceipt> | undefined;
    if (body.wiki !== undefined) {
        letzte = await daten.setzeWiki(id, { ...body.wiki, baseRevision: revision });
        if (!letzte.ok) return letzte;
        revision = revisionDerSprache(letzte.quittung, id) ?? revision + 1;
    }
    if (body.felder !== undefined) {
        const zweite = await daten.aendere(id, { ...body.felder, baseRevision: revision });
        // Die Karte lädt mit der jüngsten Kachelrevision; kam sie mit den Pillen, gilt sie weiter.
        const frueher = letzte?.ok === true ? letzte.quittung.mapRevision : undefined;
        if (zweite.ok && zweite.quittung.mapRevision === undefined && frueher !== undefined)
            return { ok: true, quittung: { ...zweite.quittung, mapRevision: frueher } };
        return zweite;
    }
    return letzte!;
}

export function createSpracheArt(
    daten: Pick<SprachenDaten, "sprache" | "aendere" | "setzeWiki">,
    lauf?: string,
    neueKennung: () => string = () => crypto.randomUUID(),
): BearbeitungsArt<SpracheEditorDetail, SpracheFelder, never, SpracheSchreiben> {
    return {
        sperrArt: "sprache",
        lade: (id, signal) => daten.sprache(id, signal, lauf),
        felder: felderAus,
        operation: (d, start, jetzt, operationId) =>
            schreibenAus(d, start.felder, jetzt.felder, operationId, neueKennung),
        schreibe: (id, body) => schreibeSprache(daten, id, body),
        geaendert: (d, stand) => unterschiede(felderAus(d), stand.felder),
        fremde: (vorher, jetzt) => unterschiede(felderAus(vorher), felderAus(jetzt)),
        aufNeuenStand(vorher, jetzt, stand) {
            const alt = felderAus(vorher);
            const neu = felderAus(jetzt);
            const eigen = stand.felder;
            const eigene = new Set(unterschiede(alt, eigen));
            return {
                felder: {
                    name: eigene.has("name") ? eigen.name : neu.name,
                    legende: eigene.has("legende") ? eigen.legende : neu.legende,
                    farbe: eigene.has("farbe") ? eigen.farbe : neu.farbe,
                    wiki: eigene.has("wiki") ? eigen.wiki : neu.wiki,
                },
                form: undefined,
            };
        },
        pruefe(_d, stand) {
            const grund = felderGrund(stand.felder);
            return grund === undefined ? undefined : t(grund);
        },
        sicherung: {
            version: 1,
            aus: (stand) => stand,
            ein(wert) {
                const s = wert as Partial<SpracheStand> | null;
                const f = s?.felder;
                if (f === undefined || typeof f.name !== "string" || typeof f.legende !== "string") return undefined;
                if (typeof f.farbe !== "string" || !Array.isArray(f.wiki)) return undefined;
                if (!f.wiki.every((x) => typeof x === "string")) return undefined;
                return { felder: f, form: undefined };
            },
        },
    };
}
