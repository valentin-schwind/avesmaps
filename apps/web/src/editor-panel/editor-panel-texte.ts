import type { EDITORPANEL } from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/de";

/**
 * Die Namen der Register-Einträge des Editorpanels (EDIT-0001 §3.2: Namen stehen nicht im Register, sondern in der Sprachtafel
 * unter `nav.<tafel>.<id>`). 🔴 `satisfies Record<…>`: Eine neue Zeile im Register ohne Namen ist ein Typfehler, kein leerer
 * Reiter.
 */
type Eintrag = (typeof EDITORPANEL)["eintraege"][number];
export type EditorpanelId = Eintrag["id"];
type VerbId = Extract<Eintrag, { verb: unknown }>["verb"]["id"];

export const NAV_NAMEN = {
    community: "nav.editorpanel.community",
    meldungen: "nav.editorpanel.meldungen",
    mails: "nav.editorpanel.mails",
    bewertungen: "nav.editorpanel.bewertungen",
    social: "nav.editorpanel.social",
    aenderungen: "nav.editorpanel.aenderungen",
    karteninhalte: "nav.editorpanel.karteninhalte",
    orte: "nav.editorpanel.orte",
    ortseditor: "nav.editorpanel.ortseditor",
    territorien: "nav.editorpanel.territorien",
    gebietseditor: "nav.editorpanel.gebietseditor",
    regionen: "nav.editorpanel.regionen",
    landschaftseditor: "nav.editorpanel.landschaftseditor",
    wege: "nav.editorpanel.wege",
    kraftlinien: "nav.editorpanel.kraftlinien",
    kraftlinieneditor: "nav.editorpanel.kraftlinieneditor",
    wegeditor: "nav.editorpanel.wegeditor",
    sprachen: "nav.editorpanel.sprachen",
    spracheditor: "nav.editorpanel.spracheditor",
    wetter: "nav.editorpanel.wetter",
    wettereditor: "nav.editorpanel.wettereditor",
    literatur: "nav.editorpanel.literatur",
    vorkommen: "nav.editorpanel.vorkommen",
    quellen: "nav.editorpanel.quellen",
    korpora: "nav.editorpanel.korpora",
    inhalteeditor: "nav.editorpanel.inhalteeditor",
    status: "nav.editorpanel.status",
    besucher: "nav.editorpanel.besucher",
    editoren: "nav.editorpanel.editoren",
    api: "nav.editorpanel.api",
    server: "nav.editorpanel.server",
} as const satisfies Record<EditorpanelId, MessageKey>;

export const VERB_NAMEN = {
    "orte-bearbeiten": "nav.editorpanel.verb.orte-bearbeiten",
    "landschaften-bearbeiten": "nav.editorpanel.verb.landschaften-bearbeiten",
    "herrschaftsgebiete-bearbeiten": "nav.editorpanel.verb.herrschaftsgebiete-bearbeiten",
    "kraftlinien-bearbeiten": "nav.editorpanel.verb.kraftlinien-bearbeiten",
    "wege-bearbeiten": "nav.editorpanel.verb.wege-bearbeiten",
    "sprachen-bearbeiten": "nav.editorpanel.verb.sprachen-bearbeiten",
    "wetter-bearbeiten": "nav.editorpanel.verb.wetter-bearbeiten",
    "quellen-bearbeiten": "nav.editorpanel.verb.quellen-bearbeiten",
    "literatur-bearbeiten": "nav.editorpanel.verb.literatur-bearbeiten",
    "vorkommen-bearbeiten": "nav.editorpanel.verb.vorkommen-bearbeiten",
    "korpora-bearbeiten": "nav.editorpanel.verb.korpora-bearbeiten",
} as const satisfies Record<VerbId, MessageKey>;

/** Der Sprachschlüssel eines Eintrags; eine Kennung außerhalb der Tafel gibt es nicht (Typ). */
export const navName = (id: EditorpanelId): MessageKey => NAV_NAMEN[id];
export const verbName = (id: VerbId): MessageKey => VERB_NAMEN[id];
