import type { EditorLock, EditorStatus, LandscapeBooleanOperation, LandscapePartsOperation } from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/i18n";
import type { AreaCandidate } from "../map/area-candidates";
import type { EditorAction, EditorMenuSubject } from "./action";
import { modusGrund } from "./handgriffe-ort";
import { GRUND_FLAECHE, GRUND_GEBIRGE } from "./sonderrolle-grund";

/**
 * Die Handgriffe an einer Landschaftsfläche im Register (WI-0178 A4; EDIT-0004 §2.1; EDIT-0003 G10, T25, T27; Legacys Flächenmenü,
 * `project-control/discovery/wi-0178-flaechenmenue-legacy-2026-10-16.md`). Folge und Wörter wie im Probierblatt Landschaften, das der
 * Betreiber mit dem Blatt und dem Startsignal gesehen hat:
 *
 * - **Bearbeiten:** „Eigenschaften bearbeiten“ öffnet das Fenster an der Landschaft wie am Ort (T34 (1), T5: „das jetztige
 *   "Bearbeiten" soll zu "Eigenschaften bearbeiten"“),
 *   „Gebietsform bearbeiten“ startet den Modus „Ecken bearbeiten“ (F18, T27 (13)), dazu „Beschriftung …“. Der Doppelklick auf die
 *   Fläche startet ihn ebenso und trägt darum das Kürzel „Doppelklick“ (EDIT-0003 R3, `doppelklick: true`, `doppelklick.ts`).
 * - **Form:** unter „Form ändern“, „Mit anderer Fläche“ und „Unterflächen“ Legacys Werkzeuge; sie stehen nur im Kartenmenü. Malen und
 *   Radieren sind zwei Einträge wie in Legacy (T34 (4)).
 * - **Sichtbarkeit:** „Verbergen“ an sichtbaren, „Zurückholen“ an verborgenen Landschaften, flach vor „Reihenfolge und Sperren ›“; beide
 *   schreiben sofort wie am Ort (T41 (4); Blatt „Landschaften verbergen und Ebenen“, B und C).
 * - **Reihenfolge und Sperren:** nach vorn, nach hinten, für Klicks sperren.
 * - **Neues von hier aus:** „Kopieren …“; **Entfernen:** „Fläche entfernen …“, rot, zuletzt.
 *
 * Es gehen „Eigenschaften bearbeiten“, „Gebietsform bearbeiten“ (C1; gespeichert wird mit C2), „Beschriftung …“ (das Fenster der
 * Landschaft am Reiter „Beschriftungen“) und Reihenfolge und Sperren (D1): Sie öffnen das Fenster am Reiter „Eigenschaften“ mit der
 * Änderung im Entwurf, geschrieben wird mit „Fertig“. Alles andere steht mit „Kommt später.“ da und wird mit seinem Paket frei (C3
 * und C4 Zeichnen und Unterflächen, D2 Entfernen); was gar nicht im Bauplan steht (zerschneiden, malen, vereinfachen, mit anderer
 * Fläche, kopieren), bleibt so stehen, bis der Betreiber es will.
 */

/** Was die Handgriffe über den Stand wissen; `app.vue` liest ihn bei jedem Öffnen frisch. */
export interface FlaecheLage {
    readonly rechte: readonly string[];
    /** Der Stand des Bearbeitens (`MAP_EDITING`, E9); unbekannt zählt wie ausgeschaltet. */
    readonly bearbeiten: EditorStatus | undefined;
    /** Läuft gerade ein Modus (Ecken bearbeiten, Ort verschieben …)? */
    readonly laeuft: boolean;
    /**
     * Läuft an dieser Landschaft ein Modus der Form im Entwurf (Gebietsform bearbeiten, Verschieben, Malen, Radieren, Vereinfachen)? Dann
     * gehen diese weiter: Der Wechsel beendet den laufenden, ohne zu verwerfen, und ↶ ↷ gehen über ihn hinweg (EDIT-0003 T58 (3)).
     */
    readonly formmodusAn?: (regionId: string) => boolean;
    /** Die Sperre eines anderen an dieser Landschaft (EDIT-0003 §4); dann geht die Form nicht. */
    readonly sperreVon?: (regionId: string) => EditorLock | undefined;
    /** Ist diese Landschaft für Besucher verborgen (T41)? Dann steht „Zurückholen“ statt „Verbergen“, wie am Ort. */
    readonly verborgen?: (regionId: string) => boolean;
    /** Warum an dieser Landschaft keine neue Beschriftung geht (etwa „entlang der Fläche“, F7); `undefined`: es geht. */
    readonly beschriftungGrund?: (regionId: string) => MessageKey | undefined;
    /** Ist diese Landschaft ein Gebirge (Topographie, Art Gebirge)? Nur dort steht „Kämme zeichnen“ (WI-0245 D2). */
    readonly gebirge?: (regionId: string) => boolean;
}

/** Was die Handgriffe tun; `app.vue` bindet es an den Landschaftseditor. */
export interface FlaecheWirkung {
    /** Das Fenster an dieser Landschaft öffnen (die Lasche „Editor“ kommt nach vorn, wie am Ort). */
    oeffnen(regionId: string): void;
    /** Das Fenster an dieser Landschaft öffnen, am Reiter „Beschriftungen“. */
    beschriftung(regionId: string): void;
    /** Den Modus „Ecken bearbeiten“ an dieser Landschaft starten (C1). */
    ecken(regionId: string): void;
    /** Ganz nach vorn oder ganz nach hinten in den Entwurf (D1). */
    platz(regionId: string, wohin: "vorn" | "hinten"): void;
    /** „Für Klicks gesperrt“ in den Entwurf (D1). */
    klicksperre(regionId: string): void;
    /** „Verbergen“ (`true`) und „Zurückholen“ (`false`, T41): schreiben sofort, wie `ort-verbergen` und `ort-zeigen`. */
    verbergen(regionId: string, ja: boolean): void;
    /** Das Blatt „Fläche entfernen …“ im Fenster der Fläche (D2). */
    entfernen(regionId: string): void;
    /**
     * „Neue Beschriftung hier“ (Werkzeug 2 im Plan der Editor-Orchestrierung 2026-10-19, Thomas 4.1; baut die Topographie): an der Stelle
     * des Kartenmenüs, die die Seite kennt. Ohne sie steht der Eintrag mit „Kommt später.“.
     */
    beschriftungNeu?(regionId: string): void;
    /** „Fläche vereinfachen“ (Werkzeug 4, baut die Kraftlinien-Sitzung): der Modus mit Regler. Ohne ihn „Kommt später.“. */
    vereinfachen?(regionId: string): void;
    /** „Zerschneiden“ (Werkzeug 5): die Schnittlinie an der Teilfläche unter dem Klick. Ohne sie „Kommt später.“. */
    zerschneiden?(regionId: string): void;
    /** „Verschieben“ (Werkzeug 7): die Teilfläche unter dem Klick hängt an der Maus, im Entwurf. Ohne sie „Kommt später.“. */
    verschieben?(regionId: string): void;
    /** „Kopieren …“ (Werkzeug 8): das Blatt im Fenster für die Teilfläche unter dem Klick. Ohne es „Kommt später.“. */
    kopieren?(regionId: string): void;
    /** „Fläche malen“ und „Fläche radieren“ (Werkzeug 6): der Pinsel an der Teilfläche unter dem Klick. Ohne ihn „Kommt später.“. */
    malen?(regionId: string, art: "malen" | "radieren"): void;
    /** „Mit anderer Fläche ›“ (Werkzeug 1): die Wahl der anderen Fläche auf der Karte für diese Operation. Ohne sie „Kommt später.“. */
    mitAnderer?(regionId: string, operation: LandscapeBooleanOperation): void;
    /** „Unterflächen ›“ (Werkzeug 3): vereinigen sofort, herauslösen und löschen über die Wahl eines Stücks. Ohne sie „Kommt später.“. */
    unterflaechen?(regionId: string, operation: LandscapePartsOperation): void;
    /** „Kämme zeichnen“ an einem Gebirge (WI-0245 D2): das Netz im Entwurf der Landschaft. Ohne sie steht der Eintrag nicht. */
    kaemme?(regionId: string): void;
}

/**
 * Eine Landschaft als Gegenstand der Handgriffe, wo nur die Kachel sie kennt (Kartenmenü): Kennung, Name und Art, beide schon in der
 * Sprache der Seite (eine namenlose heißt nach ihrer Art, WI-0105).
 */
export function flaecheSubjekt(flaeche: AreaCandidate, titel: string, art: string | undefined): EditorMenuSubject {
    return { ref: { kind: "area", id: flaeche.id }, title: titel, art, answer: undefined };
}

const flaecheId = (subject: EditorMenuSubject): string => (subject.ref.kind === "area" ? subject.ref.id : "");

export function flaecheHandgriffe(lage: () => FlaecheLage, wirkung: FlaecheWirkung): EditorAction[] {
    /** Ohne Recht sein Grund, sonst „Kommt später.“ (die Schreibwege kommen mit ihren Paketen). */
    const spaeter = (recht: string) => (): MessageKey => {
        if (lage().rechte.includes(recht)) return "editorPanel.spaeter.satz";
        return recht === "edit_landscape_form" ? GRUND_FLAECHE : "ortseditor.handgriff.grund.recht";
    };
    const schreiben = (): boolean => lage().rechte.includes("edit_landscapes");
    // „Eigenschaften bearbeiten“ öffnet das Fenster wie am Ort (`ort-bearbeiten`, T5), ohne Schreibrecht „Ansehen“.
    const bearbeiten: EditorAction = {
        id: "flaeche-bearbeiten",
        kinds: ["area"],
        capability: "use_editor_menu",
        gruppe: "bearbeiten",
        zeichen: () => (schreiben() ? "bearbeiten" : "ansehen"),
        label: () => (schreiben() ? "landschaftseditor.griff.oeffnen" : "landschaftseditor.griff.ansehen"),
        run: ({ subject }) => wirkung.oeffnen(flaecheId(subject)),
    };
    // „Gebietsform bearbeiten“ startet den Modus „Ecken bearbeiten“ (C1, F18, T27 (13)); wie am Ort ohne Recht, bei ausgeschaltetem
    // Bearbeiten und während ein Modus läuft gesperrt.
    const gebietsform: EditorAction = {
        id: "flaeche-gebietsform",
        kinds: ["area"],
        capability: "edit_landscape_form",
        gruppe: "bearbeiten",
        doppelklick: true,
        zeichen: "gebietsform",
        label: "landschaftseditor.griff.bearbeiten",
        sperre: (subject) => formGrund(subject, true),
        run: ({ subject }) => wirkung.ecken(flaecheId(subject)),
    };
    /**
     * Der Grund der Form-Handgriffe. Läuft ein Modus, gehen nur die Modi der Form im Entwurf weiter, und nur an derselben Landschaft
     * (`imEntwurf`, T58 (3)); was sofort schreibt oder einen eigenen Modus braucht (Zerschneiden, Mit anderer Fläche, Unterflächen),
     * bleibt im Modus gesperrt und steht damit nicht im Menü.
     */
    function formGrund(subject: EditorMenuSubject, imEntwurf: boolean): MessageKey | undefined {
        const jetzt = lage();
        if (jetzt.laeuft && !(imEntwurf && jetzt.formmodusAn?.(flaecheId(subject)) === true))
            return "ortseditor.handgriff.grund.laeuft";
        // F10: 🔒 „wird gerade bearbeitet“; wer und seit wann steht im Kasten darüber.
        if (jetzt.sperreVon?.(flaecheId(subject)) !== undefined) return "sperre.grund";
        if (!jetzt.rechte.includes("edit_landscape_form")) return GRUND_FLAECHE;
        return modusGrund(jetzt.bearbeiten);
    }
    // „Kämme zeichnen“ (WI-0245 D2, EDIT-0003 §6 „Gebirgsnetz“): nur an Gebirgen; gesperrt wie die Gebietsform.
    const kaemme: EditorAction = {
        id: "flaeche-kaemme",
        kinds: ["area"],
        capability: "edit_mountains",
        gruppe: "bearbeiten",
        zeichen: "gebietsform",
        label: "landschaftseditor.griff.kaemme",
        visible: (subject) => wirkung.kaemme !== undefined && lage().gebirge?.(flaecheId(subject)) === true,
        sperre: (subject) => {
            const jetzt = lage();
            return !jetzt.laeuft && !jetzt.rechte.includes("edit_mountains")
                ? GRUND_GEBIRGE
                : formGrund(subject, false);
        },
        run: ({ subject }) => wirkung.kaemme?.(flaecheId(subject)),
    };
    const beschriftung: EditorAction = {
        id: "flaeche-beschriftung",
        kinds: ["area"],
        capability: "use_editor_menu",
        gruppe: "bearbeiten",
        zeichen: "neues-label",
        label: "landschaftseditor.griff.beschriftung",
        run: ({ subject }) => wirkung.beschriftung(flaecheId(subject)),
    };
    // Reihenfolge und Sperren (D1): das Fenster mit der Änderung im Entwurf. Gesperrt wie das Fenster: ohne Recht, bei ausgeschaltetem
    // Bearbeiten, während ein Modus läuft und solange ein anderer die Landschaft hält.
    const wieDasFenster = (subject: EditorMenuSubject): MessageKey | undefined => {
        const jetzt = lage();
        if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
        if (jetzt.sperreVon?.(flaecheId(subject)) !== undefined) return "sperre.grund";
        if (!jetzt.rechte.includes("edit_landscapes")) return "ortseditor.handgriff.grund.recht";
        return modusGrund(jetzt.bearbeiten);
    };
    // „Verbergen“ und „Zurückholen“ (T41 (4)): je Landschaft nur eines von beiden, wie `ort-verbergen` und `ort-zeigen`.
    const verborgen = (subject: EditorMenuSubject): boolean => lage().verborgen?.(flaecheId(subject)) === true;
    const sichtbarkeit = (
        [
            ["flaeche-verbergen", "verbergen", "landschaftseditor.griff.verbergen", true],
            ["flaeche-zurueckholen", "zurueckholen", "landschaftseditor.griff.zurueckholen", false],
        ] as const
    ).map(([id, zeichen, label, ja]): EditorAction => ({
        id,
        kinds: ["area"],
        capability: "edit_landscapes",
        gruppe: "sichtbarkeit",
        zeichen,
        label,
        visible: (subject) => verborgen(subject) !== ja,
        sperre: wieDasFenster,
        run: ({ subject }) => wirkung.verbergen(flaecheId(subject), ja),
    }));
    const reihe = (
        [
            ["flaeche-vorn", "nach-vorn", "landschaftseditor.griff.vorn", (id: string) => wirkung.platz(id, "vorn")],
            [
                "flaeche-hinten",
                "nach-hinten",
                "landschaftseditor.griff.hinten",
                (id: string) => wirkung.platz(id, "hinten"),
            ],
            ["flaeche-klicks", "klick-sperre", "landschaftseditor.griff.klicksSperren", wirkung.klicksperre],
        ] as const
    ).map(([id, zeichen, label, tue]): EditorAction => ({
        id,
        kinds: ["area"],
        capability: "edit_landscapes",
        gruppe: "sichtbarkeit",
        zeichen,
        label,
        abschnitt: "landschaftseditor.griff.abschnitt.reihenfolge",
        sperre: wieDasFenster,
        run: ({ subject }) => tue(flaecheId(subject)),
    }));
    // Wie am Ort das Fenster zuerst, dann die Form (T25 „✎ Fläche bearbeiten“ zuerst, nach F18 unter neuem Namen) und die Beschriftung.
    // „Fläche entfernen …“ (D2): das Blatt im Fenster; gesperrt wie Reihenfolge und Sperren, dazu ohne Recht an der Geometrie (die
    // Teilflächen gehen mit).
    const entfernen: EditorAction = {
        id: "flaeche-entfernen",
        kinds: ["area"],
        capability: "edit_landscapes",
        gruppe: "entfernen",
        zeichen: "loeschen",
        label: "landschaftseditor.griff.entfernen",
        danger: true,
        sperre: (subject) => {
            const jetzt = lage();
            if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
            if (jetzt.sperreVon?.(flaecheId(subject)) !== undefined) return "sperre.grund";
            if (!jetzt.rechte.includes("edit_landscape_form")) return GRUND_FLAECHE;
            if (!jetzt.rechte.includes("edit_landscapes")) return "ortseditor.handgriff.grund.recht";
            return modusGrund(jetzt.bearbeiten);
        },
        run: ({ subject }) => wirkung.entfernen(flaecheId(subject)),
    };
    // „Neue Beschriftung hier“ (Werkzeug 2): nach „Beschriftung …“, nur im Kartenmenü (die Stelle des Rechtsklicks); sofort geschrieben,
    // darum gesperrt wie das Fenster, dazu der Grund der Seite (etwa F7 „entlang der Fläche“).
    const beschriftungNeu: EditorAction = {
        id: "flaeche-beschriftung-neu",
        kinds: ["area"],
        capability: "edit_landscapes",
        gruppe: "bearbeiten",
        zeichen: "neues-label",
        label: "landschaftseditor.griff.beschriftungNeu",
        stellen: ["karte"],
        sperre: (subject) =>
            wirkung.beschriftungNeu === undefined
                ? spaeter("edit_landscapes")()
                : (wieDasFenster(subject) ?? lage().beschriftungGrund?.(flaecheId(subject))),
        run: ({ subject }) => wirkung.beschriftungNeu?.(flaecheId(subject)),
    };
    // „Fläche vereinfachen“ (Werkzeug 4): ein Modus der Form wie „Gebietsform bearbeiten“, darum gesperrt wie er; zuletzt unter
    // „Form ändern ›“, wie in Legacy.
    const vereinfachen: EditorAction = {
        id: "flaeche-vereinfachen",
        kinds: ["area"],
        capability: "edit_landscape_form",
        gruppe: "form",
        zeichen: "vereinfachen",
        label: "landschaftseditor.griff.vereinfachen",
        abschnitt: "landschaftseditor.griff.abschnitt.form",
        stellen: ["karte"],
        sperre: (subject) =>
            wirkung.vereinfachen === undefined ? spaeter("edit_landscape_form")() : gebietsform.sperre?.(subject),
        run: ({ subject }) => wirkung.vereinfachen?.(flaecheId(subject)),
    };
    // „Zerschneiden“ (Werkzeug 5, Betreiber 2026-10-19): die Schnittlinie im Modus „Anlegen“, gesperrt wie „Gebietsform bearbeiten“;
    // unter „Form ändern ›“ nach „Verschieben“, wie in Legacy.
    const zerschneiden: EditorAction = {
        id: "flaeche-zerschneiden",
        kinds: ["area"],
        capability: "edit_landscape_form",
        gruppe: "form",
        zeichen: "zerschneiden",
        label: "landschaftseditor.griff.zerschneiden",
        abschnitt: "landschaftseditor.griff.abschnitt.form",
        stellen: ["karte"],
        sperre: (subject) =>
            wirkung.zerschneiden === undefined ? spaeter("edit_landscape_form")() : formGrund(subject, false),
        run: ({ subject }) => wirkung.zerschneiden?.(flaecheId(subject)),
    };
    // „Verschieben“ (Werkzeug 7, Betreiber 2026-10-19 „A“): ein Modus der Form im Entwurf, gesperrt wie „Gebietsform bearbeiten“; zuerst
    // unter „Form ändern ›“, wie in Legacy.
    const verschieben: EditorAction = {
        id: "flaeche-verschieben",
        kinds: ["area"],
        capability: "edit_landscape_form",
        gruppe: "form",
        zeichen: "verschieben",
        label: "landschaftseditor.griff.verschieben",
        abschnitt: "landschaftseditor.griff.abschnitt.form",
        stellen: ["karte"],
        sperre: (subject) =>
            wirkung.verschieben === undefined ? spaeter("edit_landscape_form")() : gebietsform.sperre?.(subject),
        run: ({ subject }) => wirkung.verschieben?.(flaecheId(subject)),
    };
    // „Mit anderer Fläche ›“ (Werkzeug 1, Thomas 4.1): Legacys fünf Einträge in seiner Folge (`TARGET_OPERATIONS`); die „… beibehalten“
    // tragen das Zeichen ihres Geschwisters (Editor-Orchestrierung 2026-10-19). Gesperrt wie „Gebietsform bearbeiten“; sie schreiben
    // sofort, nachdem auf der Karte die andere Fläche gewählt ist.
    const andere = (
        [
            ["flaeche-vereinigen", "vereinigen", "landschaftseditor.griff.vereinigen", "vereinigen"],
            [
                "flaeche-vereinigen-behalten",
                "vereinigen",
                "landschaftseditor.griff.vereinigenBehalten",
                "vereinigen-behalten",
            ],
            ["flaeche-ausschneiden", "ausschneiden", "landschaftseditor.griff.ausschneiden", "ausschneiden"],
            [
                "flaeche-ausschneiden-behalten",
                "ausschneiden",
                "landschaftseditor.griff.ausschneidenBehalten",
                "ausschneiden-behalten",
            ],
            ["flaeche-neu-ausschneiden", "neu-ausschneiden", "landschaftseditor.griff.neuAusschneiden", "schnittmenge"],
        ] as const
    ).map(([id, zeichen, label, operation]): EditorAction => ({
        id,
        kinds: ["area"],
        capability: "edit_landscape_form",
        gruppe: "form",
        zeichen,
        label,
        abschnitt: "landschaftseditor.griff.abschnitt.andere",
        stellen: ["karte"],
        sperre: (subject) =>
            wirkung.mitAnderer === undefined ? spaeter("edit_landscape_form")() : formGrund(subject, false),
        run: ({ subject }) => wirkung.mitAnderer?.(flaecheId(subject), operation),
    }));
    // „Unterflächen ›“ (Werkzeug 3, Thomas 4.1): Legacys drei Einträge an der Teilfläche unter dem Klick, gesperrt wie „Gebietsform
    // bearbeiten“. Die Gruppe trägt das Herauslösen, damit sie sich von „Mit anderer Fläche ›“ unterscheidet (EDIT-0003 T30; der
    // Betreiber antwortete „Ja, passen - sehr hübsch“).
    const unter = (
        [
            ["unterflaechen-vereinigen", "vereinigen", "landschaftseditor.griff.unterVereinigen", "vereinigen"],
            ["unterflaeche-herausloesen", "herausloesen", "landschaftseditor.griff.unterHerausloesen", "herausloesen"],
            ["unterflaeche-loeschen", "loeschen", "landschaftseditor.griff.unterLoeschen", "loeschen"],
        ] as const
    ).map(([id, zeichen, label, operation], i): EditorAction => ({
        id,
        kinds: ["area"],
        capability: "edit_landscape_form",
        gruppe: "form",
        zeichen,
        label,
        abschnitt: "landschaftseditor.griff.abschnitt.unter",
        ...(i === 0 ? { abschnittZeichen: "herausloesen" as const } : {}),
        stellen: ["karte"],
        sperre: (subject) =>
            wirkung.unterflaechen === undefined ? spaeter("edit_landscape_form")() : formGrund(subject, false),
        run: ({ subject }) => wirkung.unterflaechen?.(flaecheId(subject), operation),
    }));
    // „Fläche malen“ und „Fläche radieren“ (Werkzeug 6; T34 (4) zwei Einträge, jeder mit eigenem Zeichen; T41 (5) Alt gibt im Modus das
    // Gegenwerkzeug): ein Modus der Form im Entwurf, gesperrt wie „Gebietsform bearbeiten“; nach „Zerschneiden“, wie in Legacy.
    const pinsel = (
        [
            ["flaeche-malen", "malen", "landschaftseditor.griff.malen"],
            ["flaeche-radieren", "radieren", "landschaftseditor.griff.radieren"],
        ] as const
    ).map(([id, art, label]): EditorAction => ({
        id,
        kinds: ["area"],
        capability: "edit_landscape_form",
        gruppe: "form",
        zeichen: art,
        label,
        abschnitt: "landschaftseditor.griff.abschnitt.form",
        stellen: ["karte"],
        sperre: (subject) =>
            wirkung.malen === undefined ? spaeter("edit_landscape_form")() : gebietsform.sperre?.(subject),
        run: ({ subject }) => wirkung.malen?.(flaecheId(subject), art),
    }));
    // Die Reihenfolge des Probierblatts: Reihenfolge und Sperren nach den Unterflächen, vor „Kopieren …“ und „Fläche entfernen …“.
    const vorReihe = [verschieben, zerschneiden, ...pinsel, vereinfachen, ...andere, ...unter];
    // „Kopieren …“ (Werkzeug 8, Betreiber 2026-10-19 „wie legacy B mit haken“): das Blatt im Fenster; es schreibt neue Geometrie und mit
    // dem Haken nimmt es die Quelle weg, darum gesperrt wie „Gebietsform bearbeiten“. Nach „Reihenfolge und Sperren ›“, wie in Legacy.
    const kopieren: EditorAction = {
        id: "flaeche-kopieren",
        kinds: ["area"],
        capability: "edit_landscape_form",
        gruppe: "neu",
        zeichen: "kopieren",
        label: "landschaftseditor.griff.kopieren",
        stellen: ["karte"],
        sperre: (subject) =>
            wirkung.kopieren === undefined ? spaeter("edit_landscape_form")() : gebietsform.sperre?.(subject),
        run: ({ subject }) => wirkung.kopieren?.(flaecheId(subject)),
    };
    return [
        bearbeiten,
        gebietsform,
        kaemme,
        beschriftung,
        beschriftungNeu,
        ...vorReihe,
        ...sichtbarkeit,
        ...reihe,
        kopieren,
        entfernen,
    ];
}
