import { EDITORPANEL } from "./editorpanel.ts";
import { GEBIETSEDITOR } from "./gebietseditor.ts";
import { INHALTEEDITOR } from "./inhalteeditor.ts";
import { KONTENVERWALTUNG } from "./kontenverwaltung.ts";
import { KRAFTLINIENEDITOR } from "./kraftlinieneditor.ts";
import { LANDSCHAFTSEDITOR } from "./landschaftseditor.ts";
import type { NavTafel } from "./navigation.ts";
import { ORTSEDITOR } from "./ortseditor.ts";
import { SPRACHEDITOR } from "./spracheditor.ts";
import { SYSTEMSTEUERUNG } from "./systemsteuerung.ts";
import { WEGEDITOR } from "./wegeditor.ts";
import { WETTEREDITOR } from "./wettereditor.ts";

/**
 * Alle Tafeln nach Kennung. Jedes Werkzeug hat eine Tafel gleicher Kennung (Test T1.3); die Systemsteuerung steht seit E2 hier.
 */
export const NAV_TAFELN: Readonly<Record<string, NavTafel>> = {
    [EDITORPANEL.id]: EDITORPANEL,
    [ORTSEDITOR.id]: ORTSEDITOR,
    [LANDSCHAFTSEDITOR.id]: LANDSCHAFTSEDITOR,
    [GEBIETSEDITOR.id]: GEBIETSEDITOR,
    [KRAFTLINIENEDITOR.id]: KRAFTLINIENEDITOR,
    [WEGEDITOR.id]: WEGEDITOR,
    [SPRACHEDITOR.id]: SPRACHEDITOR,
    [WETTEREDITOR.id]: WETTEREDITOR,
    [INHALTEEDITOR.id]: INHALTEEDITOR,
    [SYSTEMSTEUERUNG.id]: SYSTEMSTEUERUNG,
    [KONTENVERWALTUNG.id]: KONTENVERWALTUNG,
};
