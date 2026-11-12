import type { InhalteVorkommenBedingung } from "@avesmaps3d/shared";
import { ruleKeyOf, type RuleTermKeyInput } from "../../migration/lore-keys.ts";
import type { Welt } from "./welt.ts";
import type { BedingungInnen } from "./typen.ts";

/**
 * Der Fingerabdruck einer Regel im Text (WI-0254 §13): GENAU der des Schreibers (`vorkommen-regeln-schreiben.ts`, `ruleKeyOf` über Eintragsschlüssel, Beziehung und die geordnete Kette), nicht eine eigene Rechnung.
 * Darum heißt „gibt es schon“ dasselbe wie dort `regel_besteht`: derselbe Fingerabdruck in derselben Beziehung am selben Eintrag.
 *
 * - Der **Eintragsschlüssel** ist `lore_entry.wiki_key`, ohne Wiki-Artikel `avesmaps:<public_id>`. Ein Eintrag, der erst angelegt wird (`Name (Kategorie, neu)`), hat noch keinen; für den Vergleich INNERHALB des Texts
 *   (zwei gleiche Regeln unter demselben Kopf) genügt ein fester Stellvertreter, denn dort zählt nur die Gleichheit.
 * - Die **Fläche** geht als `region.public_id` ein, eine wartende als `wiki:<Titel klein>` mit dem Titel, wie der Eintrag ihn schon trägt (der Schreiber nimmt den gespeicherten, nicht den getippten).
 */

export const eintragsSchluessel = (eintrag: { wikiKey: string | null; id: string }): string =>
    eintrag.wikiKey ?? `avesmaps:${eintrag.id}`;

/** Der Fingerabdruck einer Kette in der Form des Lesemodells (so liegen die vorhandenen Regeln und das Ergebnis des Lesers vor). */
export function schluesselAusVertrag(
    eintrag: string,
    relation: string,
    bedingungen: readonly InhalteVorkommenBedingung[],
): string {
    const terme: RuleTermKeyInput[] = bedingungen.map((b) => ({
        joinOp: b.joinOp,
        areaPublicId: b.flaeche?.kennung ?? (b.wartetAuf === undefined ? null : `wiki:${b.wartetAuf.toLowerCase()}`),
        climateFrom: b.klima?.von ?? null,
        climateTo: b.klima?.bis ?? null,
        types: b.arten.map((a) => ({ layer: a.ebene, type: a.art })),
        ...(b.lage === undefined
            ? {}
            : { lage: { richtung: b.lage.richtung, orte: b.lage.orte.map((ort) => ort.kennung) } }),
    }));
    return ruleKeyOf(eintrag, relation, terme);
}

/** Eine Bedingung des Lesers in der Form des Lesemodells (`InhalteVorkommenBedingung`); die Orte der Lage tragen Name und Stelle aus der Welt. */
export function bedingungVertrag(b: BedingungInnen, welt: Welt): InhalteVorkommenBedingung {
    return {
        joinOp: b.v,
        ...(b.flaeche === null || b.flaeche.offen
            ? {}
            : {
                  flaeche: { kennung: b.flaeche.kennung, ...(b.flaeche.name === null ? {} : { name: b.flaeche.name }) },
              }),
        ...(b.flaeche !== null && b.flaeche.offen ? { wartetAuf: b.flaeche.gespeichert ?? b.flaeche.titel } : {}),
        arten: b.arten.map((a) => ({ ebene: a.ebene, art: a.art })),
        ...(b.klima === null ? {} : { klima: { von: b.klima.von, bis: b.klima.bis } }),
        ...(b.lage === null
            ? {}
            : {
                  lage: {
                      richtung: b.lage.richtung,
                      orte: b.lage.orte.map((o) => {
                          const ort = welt.orte.get(o.id);
                          return { kennung: o.id, name: o.name, x: ort?.x ?? 0, y: ort?.y ?? 0 };
                      }),
                  },
              }),
    };
}
