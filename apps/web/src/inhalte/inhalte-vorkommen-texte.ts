import {
    type InhalteVorkommenArt,
    type InhalteVorkommenBeziehung,
    type InhalteVorkommenZiel,
    type SourceReferenceKind,
    type WikisyncOrtsrolle,
} from "@avesmaps3d/shared";
import { t, type MessageKey } from "../i18n/i18n";

/**
 * Die Worte des Reiters „Vorkommen“, die mehrere Bauteile brauchen (WI-0254, Runde 3): die Art eines Eintrags, die Beziehung einer Ortszeile,
 * die Art eines Kartenobjekts und die Art eines Belegs. Die Tafeln stehen in `i18n/*.ts`; hier steht nur, welcher Schlüssel zu welchem Wert
 * gehört. Die Arten tragen die Worte des Infopanels (`infoPanel.lore.*`: Fauna, Flora, Waren, Spezies).
 */

const ARTEN: Readonly<Record<InhalteVorkommenArt, MessageKey>> = {
    fauna: "infoPanel.lore.fauna",
    flora: "infoPanel.lore.flora",
    ware: "infoPanel.lore.ware",
    spezies: "infoPanel.lore.spezies",
};
export const artName = (art: InhalteVorkommenArt): string => t(ARTEN[art]);

const BEZIEHUNGEN: Readonly<Record<InhalteVorkommenBeziehung, MessageKey>> = {
    verbreitung: "inhalte.vorkommen.beziehung.verbreitung",
    herkunft: "inhalte.vorkommen.beziehung.herkunft",
    regionen: "inhalte.vorkommen.beziehung.regionen",
    vorkommen: "inhalte.vorkommen.beziehung.vorkommen",
};
export const beziehungName = (beziehung: InhalteVorkommenBeziehung): string => t(BEZIEHUNGEN[beziehung]);

/**
 * Der Name der Rolle einer Ortszeile (Migration 0247, `WIKISYNC_ORTSROLLEN`): dieselben Worte wie im Bericht des WikiSync (`admin.wikisync.rolle.*`), keine zweite
 * Wortliste. Nur `ort` trifft auf der Karte; die anderen sieben stehen als Pille an der Zeile.
 */
export const rolleName = (rolle: WikisyncOrtsrolle): string => t(`admin.wikisync.rolle.${rolle}`);

const KIND_NAMEN: Readonly<Record<string, MessageKey>> = {
    place: "inhalte.kind.place",
    territory: "inhalte.kind.territory",
    area: "inhalte.kind.area",
    peak: "inhalte.kind.peak",
    path: "inhalte.kind.path",
};
export const kindName = (kind: string): string => t(KIND_NAMEN[kind] ?? "inhalte.kind.place");

/** Der Name der Art eines Ziels: ein Kartenobjekt nennt seine Art, ein Kontinentbegriff heißt „Kontinent“. */
export const zielArtName = (ziel: InhalteVorkommenZiel): string =>
    "kontinent" in ziel ? t("inhalte.vorkommen.kontinent") : kindName(ziel.kind);

/** Eine Kennung des Ziels für die Liste der Vorschläge. */
export const zielKennung = (ziel: InhalteVorkommenZiel): string =>
    "kontinent" in ziel ? `kontinent:${ziel.kontinent}` : `${ziel.kind}:${ziel.carrierId}`;

export const BEZUG_NAMEN: Readonly<Record<SourceReferenceKind, MessageKey>> = {
    ausfuehrlich: "inhalte.bezug.ausfuehrlich",
    ergaenzend: "inhalte.bezug.ergaenzend",
    erwaehnung: "inhalte.bezug.erwaehnung",
};
