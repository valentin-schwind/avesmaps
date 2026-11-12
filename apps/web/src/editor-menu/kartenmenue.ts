import { LANDMARKEN_ARTEN, subjectKey, type LandmarkenArt, type MapView, formtGelaende } from "@avesmaps3d/shared";
import type { EditorZeichenName } from "../controls/editor-zeichen.vue";
import type { MessageKey } from "../i18n/i18n";
import {
    FLACH_BIS,
    MODUS_LAEUFT,
    WAHL_TRENNER,
    griffZeilen,
    handgriffZeilen,
    type EditorAction,
    type EditorMenuSubject,
    type HandgriffWahl,
    type MenuSubjectKind,
} from "./action";
import type { VereinigenEintrag } from "../map/flaechen-vereinigen";
import { modusGrund, type OrtLage } from "./handgriffe-ort";
import { GRUND_GEBIRGE } from "./sonderrolle-grund";

/**
 * Die Abschnitte für Editoren im Kartenmenü (EDIT-0002 §6 Nr. 3, EDIT-0003 G10; Schritt O1): der Abschnitt des Objekts aus dem Register
 * und „Anlegen · Hier hinzufügen ›“, das in jedem Kartenmenü steht (EDIT-0002 §4.6), auf einem Objekt unter dessen Abschnitt. Das
 * Kartenmenü bekommt nur noch fertige Zeilen und kennt keine Objektart.
 *
 * Mehr als `FLACH_BIS` Handgriffe stehen hinter EINEM Eintrag „… ›“ mit Untermenü; im Untermenü trennen Zwischenüberschriften
 * (`abschnitt`) die Gruppen wie in Legacys Flächenmenü.
 *
 * **Flächen** (WI-0178 A4; EDIT-0003 T27 (2): „Bei mehreren Flächen beginnt die Editor-Karte mit der Liste „Hier liegen N Flächen“,
 * bei einer gleich mit ihrem Menü“): Liegt eine Fläche unter dem Punkt, stehen ihre Handgriffe gleich in der Karte; liegen mehrere,
 * steht je Fläche ein Eintrag mit Name und Art, und ihr Untermenü trägt ihre Handgriffe (T25). In beiden Fällen nach Abschnitten
 * gruppiert wie Legacys Flächenmenü (`NACH_ABSCHNITTEN`: „Form ändern ›“, „Mit anderer Fläche ›“, „Unterflächen ›“, „Reihenfolge und
 * Sperren ›“); flach mit Zwischenüberschriften wären es rund zwanzig Zeilen und mehr, als ein Fenster hoch ist. Die Kennung eines
 * Handgriffs im Untermenü nennt die Fläche mit (`<region>|<handgriff>`, `griffAn`).
 */

/** Ein Eintrag eines Abschnitts: Zeichen, Text und, wenn er (noch) nicht geht, der Grund; mit `unter` ein Untermenü. */
export interface EditorEintrag {
    id: string;
    /** Das gezeichnete Zeichen, einfarbig (Blatt „Zeichen in allen Menüs“, Betreiber 2026-10-11). */
    zeichen: EditorZeichenName | undefined;
    text: string;
    grund?: string | undefined;
    /** Der Grund steht als Zeile unter dem grauen Eintrag (sonst nur als Tooltip), wo ein grauer Eintrag sonst nach „tut nichts“ aussähe. */
    grundSichtbar?: boolean | undefined;
    gefahr?: boolean | undefined;
    /** Kürzel rechts, etwa „Doppelklick“. */
    hinweis?: string | undefined;
    /** Zwischenüberschrift im Untermenü vor diesem Eintrag, wenn eine neue Gruppe beginnt. */
    abschnitt?: string | undefined;
    unter?: readonly EditorEintrag[] | undefined;
    /** Zeigen lässt ihn auf der Karte leuchten (`HandgriffWahl.vorschau`); am Finger leuchtet das erste Tippen, das zweite wählt. */
    vorschau?: boolean | undefined;
}

/**
 * Der Kasten zur Sperre über den Einträgen (EDIT-0003 §4): wer, seit wann, wann frei; für Admins die Nachfrage zum Aufheben; für jeden
 * Editor der Knopf „Freigabe erbitten“ mit dem Stand der Anfrage (WI-0262).
 */
export interface SperrKastenInhalt {
    kopf: string;
    detail: string;
    /** Die Anfrage um Freigabe: der Satz zu ihrem Stand und der Knopf; ohne diese Angabe gibt es beides nicht. */
    freigabe?: { status?: string | undefined; knopf: boolean; sendet: boolean } | undefined;
    /** Nur für Admins: der Satz der Nachfrage. */
    frage?: string | undefined;
    /** Was aufgehoben würde. */
    ziel: { kind: "landscape" | "place" | "path" | "territory" | "powerline"; id: string };
}

export interface EditorAbschnitt {
    /** `objekt` oder `anlegen`; steht im `data-testid`. */
    id: string;
    titel: string;
    pille: string;
    eintraege: readonly EditorEintrag[];
    /** Hält ein anderer den Gegenstand, steht sein Kasten über den Einträgen. */
    sperre?: SperrKastenInhalt | undefined;
}

/** Was „Hier hinzufügen ›“ anbietet: Eintrag des Registers für die angeklickte Stelle der Karte. */
export interface AnlegenEintrag {
    /** Steht im `data-testid` (`context-editor-<id>`). */
    readonly id: string;
    readonly zeichen: EditorZeichenName | undefined;
    readonly label: MessageKey;
    /** Warum es gerade nicht geht; ohne Grund geht es. */
    readonly sperre: () => MessageKey | undefined;
    readonly run: (punkt: { x: number; y: number }) => void;
    /** Rechts im Eintrag, etwa „zuletzt“ an der Ebene, in der zuletzt gezeichnet wurde (T47). */
    readonly hinweis?: (() => MessageKey | undefined) | undefined;
    /** Ein Untermenü statt einer Handlung (T47: „Neue Fläche ›“ mit den Ebenen); `run` gilt dann nicht. */
    readonly unter?: readonly AnlegenEintrag[] | undefined;
    /**
     * In welchen Kartenansichten der Eintrag steht; ohne Angabe in allen. 🔴 Keine Regel für alle Ansichten (Betreiber 2026-10-18:
     * „ausnahmen bestätigen die regel, frag mich einfach jedesmal“): Jede Zeile wird je Ansicht ein- oder ausgeschaltet, nach dem, was
     * die Editor-Orchestrierung je Ansicht vorlegt.
     */
    readonly ansichten?: readonly MapView[] | undefined;
    /** Nur auf freier Fläche der Karte: Liegt unter dem Rechtsklick ein Gegenstand, fehlt der Eintrag (F21, „Neuer Kraftlinienpunkt“). */
    readonly nurFrei?: true | undefined;
    /**
     * Steht der Eintrag gerade, innerhalb seiner Ansichten (etwa „▲ Landmarke setzen ›“ nur in den Ebenen, in denen die Karte Landmarken
     * zeichnet)? Ohne Angabe immer.
     */
    readonly steht?: (() => boolean) | undefined;
}

/** Steht der Eintrag in dieser Ansicht? Ohne Ansicht (etwa im Test) stehen alle. */
const inAnsicht = (eintrag: AnlegenEintrag, ansicht: MapView | undefined): boolean =>
    (eintrag.steht?.() ?? true) &&
    (ansicht === undefined || eintrag.ansichten === undefined || eintrag.ansichten.includes(ansicht));

/**
 * In welchen Ansichten Neuer Ort, Neuer Weg, Neue Fläche, Neue Kraftlinie und Neuer Kraftlinienpunkt stehen (ein Schreiber dieser
 * Angaben). Der Betreiber hat am 2026-10-18 jede Ansicht einzeln entschieden: Standard (wörtlich, mit „Neue Kraftlinie (automatischer
 * Wechsel zur kraftlnie)“), Kraftlinien (F21: „im kraftlinienmodus braucht es bei "Hier hinzufügen" keinen neuen ort, keinen neuen weg,
 * keine neue kraftlinie (die ist schon unter "bearbeiten") und keine neue fläche - nur neuer kraftlinienpunkt (wenn man rechts auf eine
 * freie fläche geklickt hat)“), Politisch (er wählte „A (Empfehlung, nach dem Grundsatz): nur „Neues Herrschaftsgebiet““) und
 * Derographie (nur „Neue Fläche ›“). Mehr ändert sich an diesen Angaben nicht (Editor-Orchestrierung).
 */
const NUR_STANDARD: readonly MapView[] = ["standard"];
const FLAECHE_ANSICHTEN: readonly MapView[] = ["standard", "landscapes"];
const NUR_KRAFTLINIEN: readonly MapView[] = ["powerlines"];
/** „▲ Landmarke setzen ›“: die Ansichten, in denen die Karte Landmarken zeichnet; die Ebene prüft `sichtbar` (OPS-000111, 2026-11-11). */
const LANDMARKEN_ANSICHTEN: readonly MapView[] = ["standard", "landscapes"];

/**
 * Der Grund eines Eintrags mit Untermenü: Geht keiner darin, steht er gesperrt mit dem Grund des ersten; ohne Einträge „Kommt
 * später.“. Geht einer, öffnet er sein Untermenü, und die übrigen stehen darin mit ihrem Grund.
 */
function unterGrund(unter: readonly AnlegenEintrag[] | undefined): MessageKey | undefined {
    if (unter === undefined || unter.length === 0) return "editorPanel.spaeter.satz";
    const gruende = unter.map((eintrag) => eintrag.sperre());
    return gruende.every((grund) => grund !== undefined) ? gruende[0] : undefined;
}

/**
 * „Anlegen · Hier hinzufügen ›“ (E16 Teil b; Betreiber 2026-10-11: „"Neuer Ort" ist eigentlich im Untermenü von "Hier hinzufügen". wie
 * in legacy“). Neue Fläche · Neuer Ort · Neuer Weg; was es bei uns noch nicht gibt, steht gesperrt mit „Kommt später.“ (Betreiber
 * 2026-09-23, D16). 🔴 Keine Kreuzung und kein freies Label, Betreiber 2026-10-17: „kein freies label, keine kreuzung, beides gibts
 * nicht mehr bei uns“. „Neuer Ort“ und „Neuer Weg“ (WI-0177, das Zeichnen ab der Stelle) brauchen beide Schreibrechte. Weg und
 * Fläche schalten ihre Einträge hier frei, wenn sie es können. „Neue Fläche“ steht zuerst wie im Probierblatt Landschaften (WI-0178 A4) und
 * wird mit dem Zeichnen frei (C3). „Neue Kraftlinie“ (WI-0205 K9) steht nur in der Ansicht Standard (Betreiber 2026-10-18: „Neue
 * Kraftlinie (automatischer Wechsel zur kraftlnie)“): Sie stellt auf die Kraftlinien und beginnt am Nodix im Fangradius der Stelle; liegt
 * dort keiner, setzt der erste Klick auf einen Nodix den Anfang. In der Ansicht Kraftlinien steht sie unter „Bearbeiten“ am Nodix, und
 * „Hier hinzufügen“ trägt dort nur „Neuer Kraftlinienpunkt“ (F21, P1), nur auf freier Fläche (`nurFrei`).
 */
export function anlegenEintraege(
    lage: () => OrtLage,
    neuerOrt: (punkt: { x: number; y: number }) => void,
    neuerWeg?: (punkt: { x: number; y: number }) => void,
    /** „Neue Kraftlinie“: der Start an der Stelle des Menüs (am Nodix im Fangradius dort, sonst ohne Anfang). */
    neueKraftlinie?: (punkt: { x: number; y: number }) => void,
    /** „Neuer Kraftlinienpunkt“: nur, wo die Kraftlinien gezeichnet sind; setzt ihn an der Stelle des Menüs. */
    neuerKraftlinienpunkt?: {
        readonly sichtbar: () => boolean;
        readonly setze: (punkt: { x: number; y: number }) => void;
    },
    /**
     * „Neue Fläche ›“ (T47, Betreiber 2026-10-18: „neue fläche als untermenü der ebenen“): die Ebenen der Derographie; ohne Einträge
     * gesperrt mit „Kommt später.“. „Neues Herrschaftsgebiet“ steht nicht darin, sondern auf oberster Ebene (Menü der Ansicht Standard,
     * Betreiber 2026-10-18, EDIT-0003 §6).
     */
    neueFlaeche?: readonly AnlegenEintrag[],
    /** „Neues Herrschaftsgebiet“ (WI-0209 C3, `handgriffe-gebiet.ts`): ein eigener Eintrag nach „Neuer Weg“, Folge nach dem Betreiber. */
    neuesGebiet?: AnlegenEintrag,
    /**
     * „▲ Landmarke setzen ›“ (WI-0271 L4, Kartenmenü A: EIN Eintrag, die Gipfel darin; löst „▲ Gipfel setzen …“ aus WI-0178 P7 ab): im
     * Untermenü jede Landmarkenart in der Folge des Katalogs. Die Art startet das Setzen; gespeichert wird mit „Fertig“ (G4).
     *
     * Wo der Eintrag steht: überall, wo die Karte Landmarken zeichnet (`sichtbar`, aus `composeView(…).peaks`), also in Standard und in
     * der Derographie bei Alle, Topographie und Regionen. Bis 2026-11-11 stand er nur in der Ebene Topographie (Betreiber 2026-10-18,
     * EDIT-0003 §6, wörtlich: „hier hinzufügen: A aber gipfel setzen gehört in die topographie“; Legacy `addHereMenuVisibility`). Am
     * 2026-11-11 fragte die Hauptorchestrierung den Betreiber „Sollen Landmarken in jeder Ansicht setzbar sein, nicht nur in der
     * Topographie?“; er antwortete mit dem Knopf „Ja, überall“ (OPS-000111). In Politisch, Kraftlinien, Nur Karte und den Ebenen
     * Vegetation, Klimazonen und Sprachen zeichnet die Karte keine Landmarken; dort bliebe eine gesetzte unsichtbar. Darauf fragte die
     * Hauptorchestrierung am selben Tag „Wie soll ‚Landmarke setzen‘ in Ansichten ohne Landmarken funktionieren?“, und der Betreiber
     * antwortete mit dem Knopf „A: nur wo sichtbar“: Dort fehlt der Eintrag.
     */
    landmarkeSetzen?: {
        readonly sichtbar: () => boolean;
        readonly setze: (art: LandmarkenArt, punkt: { x: number; y: number }) => void;
    },
    /**
     * „Neuer Fluss/Bach ›“ (WI-0177, Plan Fluss/Bach; Betreiber 2026-10-19: „hier hinzufügen in standard und in landschaft - im prinzip
     * dasselbe menü wie wege“; Form am Entwurf gewählt: Knopf „A · Untermenü“): das Zeichnen von „Neuer Weg“ mit der Art Fluss oder Bach.
     */
    neuerFluss?: (punkt: { x: number; y: number }, art: "fluss" | "bach") => void,
): AnlegenEintrag[] {
    const spaeter = (): MessageKey => "editorPanel.spaeter.satz";
    /** Wann Weg, Fluss oder Bach nicht angelegt werden können: Ein Modus läuft, das Recht fehlt, Bearbeiten ist aus. */
    const zeichnenGrund = (): MessageKey | undefined => {
        const jetzt = lage();
        if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
        const recht = !jetzt.rechte.includes("edit_map_objects") || !jetzt.rechte.includes("edit_map_geometry");
        return recht ? "ortseditor.handgriff.grund.recht" : modusGrund(jetzt.bearbeiten);
    };
    /**
     * Wann eine Landmarke nicht gesetzt werden kann: Ein Modus läuft, das Recht fehlt, Bearbeiten ist aus. Berggipfel und Vulkan gehören dem Topographen, alle anderen Landmarken
     * jedem Editor, ohne Grundrolle dem Derographen (WI-0279, E2a, E12).
     */
    const setzenGrund = (art: LandmarkenArt): MessageKey | undefined => {
        const jetzt = lage();
        if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
        const hat = (recht: string): boolean => jetzt.rechte.includes(recht);
        const darf = formtGelaende(art)
            ? hat("edit_mountains")
            : (hat("edit_map_objects") || hat("edit_landscapes")) &&
              (hat("edit_map_geometry") || hat("edit_landscape_form"));
        if (darf) return modusGrund(jetzt.bearbeiten);
        return formtGelaende(art) ? GRUND_GEBIRGE : "ortseditor.handgriff.grund.recht";
    };
    const landmarken: readonly AnlegenEintrag[] | undefined =
        landmarkeSetzen === undefined
            ? undefined
            : LANDMARKEN_ARTEN.map((art) => ({
                  id: `landmarke-setzen-${art}`,
                  zeichen: undefined,
                  label: `peak.${art}` as const,
                  sperre: () => setzenGrund(art),
                  run: (punkt: { x: number; y: number }) => landmarkeSetzen.setze(art, punkt),
              }));
    const fluesse: readonly AnlegenEintrag[] | undefined =
        neuerFluss === undefined
            ? undefined
            : (["fluss", "bach"] as const).map((art) => ({
                  id: `neuer-fluss-${art}`,
                  zeichen: "neuer-weg",
                  label: art === "fluss" ? "wegeditor.anlegen.fluss" : "wegeditor.anlegen.bach",
                  sperre: zeichnenGrund,
                  run: (punkt: { x: number; y: number }) => neuerFluss(punkt, art),
              }));
    return [
        {
            id: "neue-flaeche",
            zeichen: "neue-flaeche",
            label: "landschaftseditor.anlegen.neueFlaeche",
            sperre: () => unterGrund(neueFlaeche),
            run: () => undefined,
            unter: neueFlaeche,
            ansichten: FLAECHE_ANSICHTEN,
        },
        // Ohne Setzer (etwa im Test) fehlt die Zeile ganz: gebaut ist sie, „Kommt später“ wäre falsch.
        ...(landmarkeSetzen === undefined
            ? []
            : [
                  {
                      id: "landmarke-setzen",
                      zeichen: "neuer-gipfel",
                      label: "landschaftseditor.landmarke.setzen",
                      ansichten: LANDMARKEN_ANSICHTEN,
                      steht: () => landmarkeSetzen.sichtbar(),
                      sperre: () => unterGrund(landmarken),
                      run: () => undefined,
                      unter: landmarken,
                  } satisfies AnlegenEintrag,
              ]),
        {
            id: "neuer-ort",
            zeichen: "neuer-ort",
            label: "ortseditor.anlegen.neuerOrt",
            sperre: () => {
                const jetzt = lage();
                const recht = !jetzt.rechte.includes("edit_map_objects") || !jetzt.rechte.includes("edit_map_geometry");
                return recht ? "ortseditor.handgriff.grund.recht" : modusGrund(jetzt.bearbeiten);
            },
            run: neuerOrt,
            ansichten: NUR_STANDARD,
        },
        {
            id: "neuer-weg",
            zeichen: "neuer-weg",
            label: "ortseditor.anlegen.weg",
            sperre: () => {
                if (neuerWeg === undefined) return spaeter();
                const jetzt = lage();
                if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
                const recht = !jetzt.rechte.includes("edit_map_objects") || !jetzt.rechte.includes("edit_map_geometry");
                return recht ? "ortseditor.handgriff.grund.recht" : modusGrund(jetzt.bearbeiten);
            },
            run: (punkt) => neuerWeg?.(punkt),
            ansichten: NUR_STANDARD,
        },
        {
            id: "neuer-fluss",
            zeichen: "neuer-weg",
            label: "wegeditor.anlegen.neuerFluss",
            sperre: () => (fluesse === undefined ? spaeter() : unterGrund(fluesse)),
            run: () => undefined,
            unter: fluesse,
            ansichten: FLAECHE_ANSICHTEN,
        },
        ...(neuesGebiet === undefined ? [] : [neuesGebiet]),
        {
            id: "neue-kraftlinie",
            zeichen: "neue-kraftlinie",
            label: "ortseditor.handgriff.kraftlinie",
            sperre: () => {
                if (neueKraftlinie === undefined) return spaeter();
                const jetzt = lage();
                if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
                const recht = !jetzt.rechte.includes("edit_map_objects") || !jetzt.rechte.includes("edit_map_geometry");
                return recht ? "ortseditor.handgriff.grund.recht" : modusGrund(jetzt.bearbeiten);
            },
            run: (punkt) => neueKraftlinie?.(punkt),
            ansichten: NUR_STANDARD,
        },
        {
            id: "neuer-kraftlinienpunkt",
            zeichen: "neuer-kraftlinienpunkt",
            label: "kraftlinieneditor.punkt.neu",
            sperre: () => {
                if (neuerKraftlinienpunkt === undefined) return spaeter();
                const jetzt = lage();
                if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
                const recht = !jetzt.rechte.includes("edit_map_objects") || !jetzt.rechte.includes("edit_map_geometry");
                if (recht) return "ortseditor.handgriff.grund.recht";
                return (
                    modusGrund(jetzt.bearbeiten) ??
                    (neuerKraftlinienpunkt.sichtbar() ? undefined : "kraftlinieneditor.punkt.nurAnsicht")
                );
            },
            run: (punkt) => neuerKraftlinienpunkt?.setze(punkt),
            ansichten: NUR_KRAFTLINIEN,
            nurFrei: true,
        },
    ];
}

/** Das Wort des einen Eintrags „… ›“, hinter dem mehr als `FLACH_BIS` Handgriffe einer Art stehen (EDIT-0003 T5). */
const UNTERMENUE_WORT: Partial<Record<MenuSubjectKind, MessageKey>> = {};

/**
 * Arten, deren Handgriffe nach Abschnitten gruppiert stehen: was ohne Abschnitt ist, flach; je Abschnitt EIN Eintrag „… ›“ mit seinen
 * Handgriffen, an der Stelle seines ersten (Legacys Flächenmenü). Nie alles hinter einem Eintrag (T27 (2): „gleich mit ihrem Menü“). Die
 * Sprachfläche wie die Fläche, seit sie „Form ändern ›“ hat (WI-0261 Stufe 2).
 */
const NACH_ABSCHNITTEN: ReadonlySet<MenuSubjectKind> = new Set(["area", "sprache"]);

/** Trennt die Fläche vom Handgriff in der Kennung eines Eintrags aus „Hier liegen N Flächen“. */
const TRENNER = "|";

/** Die Kennung eines Gegenstands im Eintrag: bei der Fläche `region.public_id`, sonst sein Schlüssel. */
const kennung = (subject: EditorMenuSubject): string =>
    "id" in subject.ref ? subject.ref.id : subjectKey(subject.ref);

export interface KartenAbschnitteEingabe {
    actions: readonly EditorAction[];
    /** Der Gegenstand unter dem Rechtsklick; auf freier Karte keiner. */
    subject: EditorMenuSubject | undefined;
    /**
     * Mehrere Gegenstände einer Art unter dem Rechtsklick (EDIT-0003 T25, Regel 7): „Hier liegen N Flächen“ (Landschaften oder die
     * Herrschaftsgebiete, die das Band dort zeigt), „Hier laufen N Wege“, „Hier laufen N Kraftlinien“, je Gegenstand Name, Art und sein
     * Untermenü. Ist es nur einer, steht er wie `subject`. `titel` nimmt
     * `{n}`.
     */
    liste?: KartenListe;
    anlegen: readonly AnlegenEintrag[];
    uebersetze: (key: MessageKey, params?: Record<string, string>) => string;
    /** Der Kasten zur Sperre eines anderen am Gegenstand, wenn es sie gibt (EDIT-0003 §4). */
    sperreVon?: (subject: EditorMenuSubject) => SperrKastenInhalt | undefined;
    /** Die Kartenansicht (`view`): Was dort nicht steht, sagt das Register (`HANDGRIFFE_JE_ANSICHT`, EDIT-0003 T39). */
    ansicht?: MapView | undefined;
    /**
     * Ist die Stelle frei für Einträge mit `nurFrei`? Ohne Angabe: kein Gegenstand unter dem Rechtsklick. Die Seite sagt es genauer, wo
     * nur bestimmte Gegenstände eine Stelle belegen (Ansicht Kraftlinien: kein Nodix, keine Linie; ein Weg oder eine Fläche dort nicht).
     */
    frei?: boolean | undefined;
    /**
     * „Flächen vereinigen ›“ (WI-0252): Bei einer Mehrfachauswahl von Flächen steht der Eintrag direkt unter „Hier hinzufügen ›“, sein
     * Untermenü nennt die Vorlagen (`flaechen-vereinigen.ts`); geht es nicht, grau mit dem Grund.
     */
    vereinigen?: VereinigenEintrag | undefined;
}

export interface KartenListe {
    /** Die Kennung des Abschnitts (`flaechen`, `wege`, …). */
    readonly id: string;
    readonly titel: MessageKey;
    readonly gegenstaende: readonly EditorMenuSubject[];
}

/** Wie ein Eintrag der Liste heißt: `flaeche-<Kennung>`, `weg-<Kennung>` … */
const EINTRAG: Partial<Record<string, string>> = {
    area: "flaeche",
    path: "weg",
    powerline: "kraftlinie",
    territory: "gebiet",
};

/** Wer mit einer Kennung aus dem Kartenmenü gemeint ist: der Gegenstand aus der Liste („Hier liegen N …“), sonst der eine. */
export function griffAn(
    id: string,
    gegenstaende: readonly EditorMenuSubject[],
): { griff: string; gegenstand: EditorMenuSubject | undefined } {
    const stelle = id.indexOf(TRENNER);
    if (stelle < 0) return { griff: id, gegenstand: gegenstaende.length === 1 ? gegenstaende[0] : undefined };
    const gemeint = id.slice(0, stelle);
    return { griff: id.slice(stelle + 1), gegenstand: gegenstaende.find((g) => kennung(g) === gemeint) };
}

/**
 * Das Untermenü eines Eintrags mit Wahl (EDIT-0003 T39): je Wahl ein Eintrag `<id>#<wahl>`. Dasselbe Bauteil für die Handgriffe mit
 * `auswahl` („Wege verbinden ›“, „Wegkurve bearbeiten ›“ …) und „Flächen vereinigen ›“ (WI-0252): Zeigen meldet die Wahl (`vorschau`).
 */
export function wahlenAlsUnter(
    id: string,
    wahlen: readonly HandgriffWahl[],
    gefahr?: boolean,
    uebersetze?: KartenAbschnitteEingabe["uebersetze"],
): EditorEintrag[] {
    return wahlen.map((wahl) => ({
        id: `${id}${WAHL_TRENNER}${wahl.id}`,
        zeichen: undefined,
        text: wahl.text,
        gefahr,
        hinweis: wahl.hinweis,
        // Eine Wahl mit Grund steht grau da (Tooltip mit dem Grund) und zeigt nichts auf der Karte.
        ...(wahl.grund === undefined
            ? { vorschau: wahl.vorschau === true }
            : { grund: uebersetze === undefined ? wahl.grund : uebersetze(wahl.grund), vorschau: false }),
    }));
}

/** Die Zeilen eines Gegenstands als Einträge; eine Zwischenüberschrift nur dort, wo eine neue Gruppe beginnt. */
function eintraegeVon(
    actions: readonly EditorAction[],
    subject: EditorMenuSubject,
    uebersetze: KartenAbschnitteEingabe["uebersetze"],
    praefix = "",
    ansicht?: MapView,
): EditorEintrag[] {
    let vorher: string | undefined;
    return handgriffZeilen(actions, subject, "karte", ansicht).map((zeile): EditorEintrag => {
        const abschnitt = zeile.abschnitt === undefined ? undefined : uebersetze(zeile.abschnitt);
        const neu = abschnitt !== vorher ? abschnitt : undefined;
        vorher = abschnitt;
        return {
            id: `${praefix}${zeile.id}`,
            zeichen: zeile.zeichen,
            text: uebersetze(zeile.text),
            grund: zeile.grund === undefined ? undefined : uebersetze(zeile.grund),
            gefahr: zeile.gefahr,
            hinweis: zeile.hinweis === undefined ? undefined : uebersetze(zeile.hinweis),
            abschnitt: neu,
            // Ein Handgriff mit Auswahl (EDIT-0003 T39): sein Untermenü listet die Wahlen; ein gesperrter hat keins.
            ...(zeile.auswahl !== undefined && zeile.grund === undefined
                ? { unter: wahlenAlsUnter(`${praefix}${zeile.id}`, zeile.auswahl, zeile.gefahr, uebersetze) }
                : {}),
        };
    });
}

/**
 * Die Einträge nach Abschnitten gruppiert (`NACH_ABSCHNITTEN`); der Eintrag eines Abschnitts trägt sein eigenes Zeichen
 * (`abschnittZeichen`) oder das seines ersten Handgriffs.
 */
function nachAbschnitten(
    actions: readonly EditorAction[],
    subject: EditorMenuSubject,
    uebersetze: KartenAbschnitteEingabe["uebersetze"],
    praefix = "",
    ansicht?: MapView,
): EditorEintrag[] {
    const aus: EditorEintrag[] = [];
    let gruppe: { schluessel: string; unter: EditorEintrag[] } | undefined;
    for (const zeile of handgriffZeilen(actions, subject, "karte", ansicht)) {
        const eintrag: EditorEintrag = {
            id: `${praefix}${zeile.id}`,
            zeichen: zeile.zeichen,
            text: uebersetze(zeile.text),
            grund: zeile.grund === undefined ? undefined : uebersetze(zeile.grund),
            gefahr: zeile.gefahr,
            hinweis: zeile.hinweis === undefined ? undefined : uebersetze(zeile.hinweis),
            // Wie in `eintraegeVon`: Auch in der Liste „Hier liegen N Flächen“ hat ein Handgriff mit Auswahl sein Untermenü („Unterpolygone löschen …“).
            ...(zeile.auswahl !== undefined && zeile.grund === undefined
                ? { unter: wahlenAlsUnter(`${praefix}${zeile.id}`, zeile.auswahl, zeile.gefahr, uebersetze) }
                : {}),
        };
        if (zeile.abschnitt === undefined) {
            gruppe = undefined;
            aus.push(eintrag);
            continue;
        }
        if (gruppe?.schluessel !== zeile.abschnitt) {
            gruppe = { schluessel: zeile.abschnitt, unter: [] };
            aus.push({
                id: `${praefix}gruppe-${zeile.abschnitt.slice(zeile.abschnitt.lastIndexOf(".") + 1)}`,
                zeichen: zeile.abschnittZeichen ?? zeile.zeichen,
                text: uebersetze(zeile.abschnitt),
                unter: gruppe.unter,
            });
        }
        gruppe.unter.push(eintrag);
    }
    return aus;
}

export function kartenAbschnitte({
    actions,
    subject: einer,
    liste,
    anlegen,
    uebersetze,
    sperreVon,
    ansicht,
    frei: freiGesagt,
    vereinigen,
}: KartenAbschnitteEingabe): EditorAbschnitt[] {
    const pille = uebersetze("ortseditor.gruppe.nurEditoren");
    const abschnitte: EditorAbschnitt[] = [];
    const gegenstaende = liste?.gegenstaende ?? [];
    const subject = einer ?? (gegenstaende.length === 1 ? gegenstaende[0] : undefined);
    if (subject === undefined && liste !== undefined && gegenstaende.length > 1) {
        abschnitte.push({
            id: liste.id,
            titel: uebersetze(liste.titel, { n: String(gegenstaende.length) }),
            pille,
            eintraege: gegenstaende.map((g) => ({
                id: `${EINTRAG[g.ref.kind] ?? g.ref.kind}-${kennung(g)}`,
                zeichen: undefined,
                text: g.title,
                hinweis: g.art,
                unter: nachAbschnitten(actions, g, uebersetze, `${kennung(g)}${TRENNER}`, ansicht),
            })),
        });
    }
    if (subject !== undefined) {
        const gruppiert = NACH_ABSCHNITTEN.has(subject.ref.kind as MenuSubjectKind);
        const zeilen = gruppiert
            ? nachAbschnitten(actions, subject, uebersetze, "", ansicht)
            : eintraegeVon(actions, subject, uebersetze, "", ansicht);
        if (zeilen.length > 0) {
            const wort = UNTERMENUE_WORT[subject.ref.kind as MenuSubjectKind] ?? "ortseditor.gruppe";
            abschnitte.push({
                id: "objekt",
                titel: uebersetze("ortseditor.gruppe"),
                pille,
                sperre: sperreVon?.(subject),
                eintraege: gruppiert
                    ? zeilen
                    : zeilen.length > FLACH_BIS
                      ? [
                            {
                                id: `${subject.ref.kind}-handgriffe`,
                                zeichen: zeilen[0]?.zeichen,
                                text: uebersetze(wort),
                                unter: zeilen,
                            },
                        ]
                      : zeilen.map((zeile) => ({ ...zeile, abschnitt: undefined })),
            });
        }
    }
    // Frei ist die Stelle, wenn unter dem Rechtsklick kein Gegenstand liegt (`nurFrei`).
    const frei = freiGesagt ?? (subject === undefined && gegenstaende.length === 0);
    const anlegenHier = anlegenZeilen(anlegen, uebersetze, ansicht, frei);
    // „Flächen vereinigen ›“ direkt unter „Hier hinzufügen ›“ (WI-0252, Betreiber 2026-10-24); ein gesperrter ohne Untermenü.
    const vereinigenHier: EditorEintrag[] =
        vereinigen === undefined
            ? []
            : [
                  {
                      id: vereinigen.id,
                      zeichen: "vereinigen",
                      text: uebersetze(vereinigen.text),
                      grund: vereinigen.grund === undefined ? undefined : uebersetze(vereinigen.grund),
                      // 🔴 Der Grund steht unter dem grauen Eintrag, nicht nur im Tooltip: Am Finger gibt es keinen, und mit der Maus sah ein
                      // grauer Eintrag aus wie einer, der nichts tut („wenn ich zwei Flächen vereinige, passiert nichts“, WI-0252). Echte
                      // Flächen berühren oft Nachbarn (an echten Daten gehen rund ein Drittel der Paare nicht), das Grau ist hier der Regelfall.
                      ...(vereinigen.grund === undefined
                          ? { unter: wahlenAlsUnter(vereinigen.id, vereinigen.wahlen) }
                          : { grundSichtbar: true }),
                  },
              ];
    if (anlegenHier.length > 0 || vereinigenHier.length > 0) {
        abschnitte.push({
            id: "anlegen",
            titel: uebersetze("ortseditor.anlegen"),
            pille,
            eintraege: [
                ...(anlegenHier.length > 0
                    ? [
                          {
                              id: "hier-hinzufuegen",
                              zeichen: "hinzufuegen" as const,
                              text: uebersetze("ortseditor.anlegen.hier"),
                              unter: anlegenHier,
                          },
                      ]
                    : []),
                ...vereinigenHier,
            ],
        });
    }
    return abschnitte;
}

/**
 * Die Einträge aus „Hier hinzufügen ›“ als Zeilen in dieser Ansicht (`ansichten`); ein gesperrter ohne Untermenü. Ein Eintrag mit
 * Untermenü, dessen Zeilen in dieser Ansicht alle fehlen, fehlt mit; sein Grund kommt aus den Zeilen, die stehen.
 */
function anlegenZeilen(
    eintraege: readonly AnlegenEintrag[],
    uebersetze: KartenAbschnitteEingabe["uebersetze"],
    ansicht: MapView | undefined,
    frei = true,
): EditorEintrag[] {
    const aus: EditorEintrag[] = [];
    for (const eintrag of eintraege) {
        if (!inAnsicht(eintrag, ansicht)) continue;
        if (eintrag.nurFrei === true && !frei) continue;
        // Im laufenden Modus fällt weg, was nicht geht (EDIT-0003 T58 (3)), auch in einem Untermenü.
        const unter = eintrag.unter?.filter((zeile) => inAnsicht(zeile, ansicht) && zeile.sperre() !== MODUS_LAEUFT);
        if (eintrag.unter !== undefined && eintrag.unter.length > 0 && unter?.length === 0) continue;
        const grund = unter === undefined ? eintrag.sperre() : unterGrund(unter);
        if (grund === MODUS_LAEUFT) continue;
        const hinweis = eintrag.hinweis?.();
        aus.push({
            id: eintrag.id,
            zeichen: eintrag.zeichen,
            text: uebersetze(eintrag.label),
            grund: grund === undefined ? undefined : uebersetze(grund),
            hinweis: hinweis === undefined ? undefined : uebersetze(hinweis),
            ...(unter !== undefined && grund === undefined
                ? { unter: anlegenZeilen(unter, uebersetze, ansicht, frei) }
                : {}),
        });
    }
    return aus;
}

/**
 * Ein Eintrag aus „Hier hinzufügen ›“ an der angeklickten Stelle, auch aus einem Untermenü; ein gesperrter nie. `false`, wenn es
 * keiner war.
 */
export function legeAn(anlegen: readonly AnlegenEintrag[], id: string, punkt: { x: number; y: number }): boolean {
    for (const eintrag of anlegen) {
        if (eintrag.sperre() !== undefined || eintrag.steht?.() === false) continue;
        if (eintrag.unter !== undefined) {
            if (legeAn(eintrag.unter, id, punkt)) return true;
            continue;
        }
        if (eintrag.id !== id) continue;
        eintrag.run(punkt);
        return true;
    }
    return false;
}

/**
 * Das Kartenmenü am Griff eines laufenden Modus (Festlegung der Editor-Orchestrierung 2026-10-17, EDIT-0003 R7): EIN Abschnitt mit den
 * Handgriffen des Griffs (`griffZeilen`), angezeigt in der Form „nur Editor-Karte“ (`map-context-menu.vue`, `nurEditor`). Gilt für jeden
 * Modus der Form (Stützpunkte, Ecken, Grenzen, Nodices); `titel` nennt den Griff („Stützpunkt 3“).
 */
export function griffAbschnitte(
    actions: readonly EditorAction[],
    subject: EditorMenuSubject,
    titel: string,
    uebersetze: KartenAbschnitteEingabe["uebersetze"],
): EditorAbschnitt[] {
    const eintraege = griffZeilen(actions, subject).map((zeile): EditorEintrag => ({
        id: zeile.id,
        zeichen: zeile.zeichen,
        text: uebersetze(zeile.text),
        grund: zeile.grund === undefined ? undefined : uebersetze(zeile.grund),
        gefahr: zeile.gefahr,
        hinweis: zeile.hinweis === undefined ? undefined : uebersetze(zeile.hinweis),
    }));
    if (eintraege.length === 0) return [];
    return [{ id: "griff", titel, pille: uebersetze("ortseditor.gruppe.nurEditoren"), eintraege }];
}
