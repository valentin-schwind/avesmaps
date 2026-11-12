import { INHALTE_WERK_TYPEN, type InhalteWerkRolle, type InhalteWerkZielart } from "@avesmaps3d/shared";
import { t, type MessageKey } from "../i18n/i18n";

/**
 * Die Worte des Reiters „Literatur“, die mehrere Bauteile brauchen (WI-0254, Runde 2): die Art eines Werks, die Rolle einer Ortszeile und
 * die Art ihres Ziels. Die Tafeln stehen in `i18n/*.ts`; hier steht nur, welcher Schlüssel zu welchem Wert gehört.
 */

/** Der Name der Art in den Worten des Infopanels; ein Wort außerhalb der Liste (offenes Vokabular) steht groß geschrieben da. */
export function typName(typ: string): string {
    const bekannt = (INHALTE_WERK_TYPEN as readonly string[]).includes(typ);
    return bekannt ? t(`infoPanel.literature.type.${typ}` as MessageKey) : typ.charAt(0).toUpperCase() + typ.slice(1);
}

const ROLLEN: Readonly<Record<InhalteWerkRolle, MessageKey>> = {
    start: "inhalte.rolle.start",
    play: "inhalte.rolle.play",
    covers: "inhalte.rolle.covers",
};

export const rolleName = (rolle: InhalteWerkRolle): string => t(ROLLEN[rolle]);

export const zielartName = (kind: InhalteWerkZielart): string => t(`inhalte.kind.${kind}` as MessageKey);
