import type { ContextTerritories, ContextTerritory } from "@avesmaps3d/shared";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import { percentOf } from "./panel-text";
import type { LiesInModel, StairRow } from "./panel-types";

/**
 * „Liegt in“ als Treppe (WI-0063 5.4, Design Guide §16; Legacy `buildSettlementHierarchyMarkup`, `js/ui/popups.js`): Die Herrschaftskette
 * steht von der Wurzel zum Blatt, das äußerste Reich oben in voller Breite, jede innere Stufe einen Schritt eingerückt.
 *
 * Eine Fläche oder ein Weg liegt in mehreren Ketten zugleich (Waldwildnis in Nostria und Andergast, eine Straße in Dutzenden Baronien):
 * Die Ketten werden zu EINEM Baum zusammengelegt, gemeinsame Vorfahren stehen einmal, und die Treppe läuft den Baum in Tiefe zuerst
 * ab. Bei einer Überlappung steht der Anteil dabei, sonst sagt er nichts.
 *
 * Ab mehr als so vielen Zeilen wird aus der Treppe ein Deckel, der zuerst nur seine Zusammenfassung zeigt (Guide §16.3): Eine Treppe von
 * 40 Gebieten schöbe sonst alles darunter aus dem Blick. Die Beziehung steht dann im Kopf des Deckels, nicht als eigene Überschrift
 * („Erstreckt sich über 19 politische Gebiete“); bis dahin steht die Treppe offen unter ihrer kurzen Überschrift. Betreiber 2026-10-04:
 * „"Überlappt" als überschrift weg und "Überlappt mit 19 politischen Gebieten" in den header der klappbox. Klappbox erscheint schon
 * bei >4“; zum Wortlaut: „"Erstreckt sich über" <- schön!“.
 */
export const STAIR_LID_FROM = 4;

interface Node {
    member: ContextTerritory;
    children: Map<string, Node>;
}

function treeOf(chains: ContextTerritories["chains"]): Map<string, Node> {
    const roots = new Map<string, Node>();
    for (const chain of chains) {
        let level = roots;
        for (const member of chain) {
            let node = level.get(member.ref.id);
            if (node === undefined) {
                node = { member, children: new Map() };
                level.set(member.ref.id, node);
            }
            level = node.children;
        }
    }
    return roots;
}

export function liesInOf(context: ContextTerritories | undefined): LiesInModel | undefined {
    if (context === undefined || context.chains.length === 0) return undefined;
    const rows: StairRow[] = [];
    const walk = (level: Map<string, Node>, depth: number): void => {
        for (const node of level.values()) {
            const share = context.relation === "overlaps" ? percentOf(node.member.share) : "";
            // Das Wappen kommt fertig entschieden aus dem Lesevertrag (Media Core); hier wird nur noch genommen, was das Bild
            // braucht. Ohne Wappen fehlt das Feld - die Zeile bekommt keinen Platzhalter (Legacy `settlementTerritoryCoatThumbMarkup`).
            const coat = node.member.coat;
            rows.push({
                depth,
                name: node.member.name,
                ref: node.member.ref,
                ...(share === "" ? {} : { share }),
                ...(coat === undefined ? {} : { coat: { url: coat.url, width: coat.width, height: coat.height } }),
            });
            walk(node.children, depth + 1);
        }
    };
    walk(treeOf(context.chains), 0);
    return {
        heading: t(`infoPanel.relation.${context.relation}` as MessageKey),
        rows,
        ...(rows.length > STAIR_LID_FROM
            ? {
                  lid: {
                      summary: t(`infoPanel.relation.${context.relation}.lid` as MessageKey, {
                          n: formatNumber(rows.length, 0),
                      }),
                  },
              }
            : {}),
    };
}
