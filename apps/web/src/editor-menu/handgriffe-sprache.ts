import type { EditorStatus, LandscapeBooleanOperation, LandscapePartsOperation } from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/i18n";
import type { EditorAction, EditorMenuSubject } from "./action";
import { modusGrund } from "./handgriffe-ort";
import { GRUND_SPRACHE } from "./sonderrolle-grund";
import type { AnlegenEintrag } from "./kartenmenue";

/**
 * Die Handgriffe an einer Sprachfläche im Register (WI-0261 Stufe 1; Betreiber 2026-10-31, wörtlich: „beim editieren der sprachflächen wär es gut, wenn
 * wir die tools des flächeneditors hätten. die sachen mit den buttons unter den teilfächen zu editieren funktioniert hinten und vorne nicht und sollten
 * eigentlich im kontextmenü sein“). Sie ersetzen die Knöpfe unter der Liste der Teilflächen (`spracheditor/sprache-flaechen.vue`) und stehen NUR im
 * Kartenmenü (Rechtsklick): Sie meinen die Teilfläche unter dem Zeiger. Der Linksklick wählt sie im offenen Spracheditor, ohne Menü am Objekt.
 *
 * - **Bearbeiten:** „Eigenschaften bearbeiten“ (ohne Schreibrecht „Ansehen“; Wort und Zeichen wie an Ort und Gebiet, EDIT-0003 T5) öffnet den
 *   Spracheditor an der Sprache, Reiter „Flächen“, die Teilfläche gewählt - das ist Verhalten, nicht Wort. „Teilfläche bearbeiten“ startet den Formentwurf an
 *   ihr (Zeichen wie „Gebietsform bearbeiten“, R6). Kein „Hinfliegen“: Beim Rechtsklick steht man schon an der Fläche, und die Kamera fliegt aus der Liste
 *   (G3; Entscheidung der Editor-Orchestrierung 2026-10-31).
 * - **„Form ändern ›“** (WI-0261 Stufe 2; Betreiber 2026-10-31: „stufe 2“): „Verschieben“, „Fläche malen“, „Fläche radieren“ und „Fläche vereinfachen“,
 *   die Werkzeuge der Fläche der Derographie an der Teilfläche, mit denselben Wörtern, Zeichen und in derselben Folge (`handgriffe-flaeche.ts`; EDIT-0003
 *   T5, R6: ein Zeichen, eine Bedeutung). Sie laufen als dieselben Modi im Entwurf; erst „Fertig“ schreibt (`sprachflaeche-werkzeuge.ts`).
 * - **Stufe 3** (Betreiber 2026-10-31: „bau weiter“): „Zerschneiden“ unter „Form ändern ›“ nach „Verschieben“, dahinter „Mit anderer Fläche ›“ (die fünf
 *   Einträge) und „Unterflächen ›“ (drei), dann „Kopieren …“ - Untergruppen, Einträge, Zeichen und Folge wie an der Fläche (`handgriffe-flaeche.ts`). Sie
 *   laufen als dieselben Modi der Derographie mit der Teilfläche als Quelle (`sprachflaeche-sofort.ts`) und schreiben wie dort sofort; „Kopieren …“ ist das
 *   Blatt im Fenster der Sprache. Gesperrt wie „Teilfläche bearbeiten“.
 * - **Entfernen:** „Teilfläche entfernen …“, rot, zuletzt (Zeichen wie „Fläche entfernen …“): die Bestätigung im Fenster der Sprache; sie legt still,
 *   ↺ holt zurück (R6: „… entfernen“ als Oberbegriff, „…“ vor einer Bestätigung).
 * - **Mehrere Sprachen** unter dem Zeiger: „Hier liegen N Sprachen“, je Sprache ihr Untermenü (`kartenmenue.ts`, wie bei den Flächen, T25).
 * - **„Hier hinzufügen › Neue Teilfläche“** (`neueTeilflaecheEintrag`): an die Sprache des vordersten Sprachfensters, nur in Derographie › Sprachen.
 * - **Sperrgrund** wie die Knöpfe vorher: ohne Recht an den Sprachen (`edit_languages`, Linguist, Admins, Betreiber; der Viewer kennt dafür keine Fähigkeit, darum steht es in der
 *   Lage statt in `capability`) „nur mit der Sonderrolle Linguist“ (E17a), bei ausgeschaltetem Bearbeiten (`MAP_EDITING`) dessen Grund; während ein Modus läuft, fallen die
 *   schreibenden Handgriffe weg (EDIT-0003 T58 (3)).
 */

/** Was die Handgriffe über den Stand wissen; die Seite liest ihn bei jedem Öffnen frisch. */
export interface SpracheLage {
    /** Darf diese Sitzung Sprachen schreiben (das Verb „Sprachen bearbeiten“ steht auf „bearbeiten“)? */
    readonly darf: boolean;
    /** Der Stand des Bearbeitens (`MAP_EDITING`); unbekannt zählt wie ausgeschaltet. */
    readonly bearbeiten: EditorStatus | undefined;
    /** Läuft gerade ein Modus (auch „Teilfläche bearbeiten“ oder das Zeichnen einer neuen Teilfläche)? */
    readonly laeuft: boolean;
    /** Die Teilfläche dieser Sprache unter der Stelle des Kartenmenüs; ohne Treffer keine. */
    readonly teilflaeche: (spracheId: string) => string | undefined;
}

/** Was die Handgriffe tun; die Seite bindet es an den Spracheditor (`spracheditor/sprache-kartenmenue.ts`). */
export interface SpracheWirkung {
    /** Den Spracheditor an dieser Sprache öffnen, mit Teilfläche am Reiter „Flächen“ und dort gewählt. */
    oeffnen(spracheId: string, flaecheId: string | undefined): void;
    /** Den Formentwurf an dieser Teilfläche starten; `name` ist der Name der Sprache von der Karte. */
    bearbeiten(spracheId: string, flaecheId: string, name: string): void;
    /** Die Bestätigung „Teilfläche entfernen“ im Fenster der Sprache. */
    entfernen(spracheId: string, flaecheId: string): void;
    /** „Verschieben“ (Stufe 2): Die Teilfläche hängt ab der Stelle des Kartenmenüs an der Maus. `name` wie bei `bearbeiten`. */
    verschieben(spracheId: string, flaecheId: string, name: string): void;
    /** „Fläche malen“ und „Fläche radieren“ (Stufe 2): der Pinsel an der Teilfläche. */
    malen(spracheId: string, flaecheId: string, name: string, art: "malen" | "radieren"): void;
    /** „Fläche vereinfachen“ (Stufe 2): der Modus mit Regler an der Teilfläche. */
    vereinfachen(spracheId: string, flaecheId: string, name: string): void;
    /** „Fläche zerschneiden“ (Stufe 3): die Schnittlinie an der Teilfläche. */
    zerschneiden(spracheId: string, flaecheId: string, name: string): void;
    /** „Mit anderer Fläche ›“ (Stufe 3): die Wahl der Teilfläche einer anderen Sprache auf der Karte für diese Operation. */
    mitAnderer(spracheId: string, flaecheId: string, name: string, operation: LandscapeBooleanOperation): void;
    /** „Unterflächen ›“ (Stufe 3): vereinigen sofort, herauslösen und löschen über die Wahl eines Stücks. */
    unterflaechen(spracheId: string, flaecheId: string, name: string, operation: LandscapePartsOperation): void;
    /** „Kopieren …“ (Stufe 3): das Blatt im Fenster der Sprache für diese Teilfläche. */
    kopieren(spracheId: string, flaecheId: string): void;
}

/** Eine Sprache als Gegenstand der Handgriffe, wo nur die Kachel sie kennt (Kartenmenü): Kennung und Name. */
export function spracheSubjekt(sprache: { readonly id: string; readonly name: string }): EditorMenuSubject {
    return { ref: { kind: "sprache", id: sprache.id }, title: sprache.name, art: undefined, answer: undefined };
}

const spracheId = (subject: EditorMenuSubject): string => (subject.ref.kind === "sprache" ? subject.ref.id : "");

/** Warum ein schreibender Handgriff an einer Sprache gerade nicht geht; ohne Grund geht er. */
function schreibGrund(jetzt: Omit<SpracheLage, "teilflaeche">): MessageKey | undefined {
    if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
    if (!jetzt.darf) return GRUND_SPRACHE;
    return modusGrund(jetzt.bearbeiten);
}

export function spracheHandgriffe(lage: () => SpracheLage, wirkung: SpracheWirkung): EditorAction[] {
    const teil = (subject: EditorMenuSubject): string | undefined => lage().teilflaeche(spracheId(subject));
    /** Ein Handgriff an der Teilfläche unter dem Zeiger: Ohne sie steht er nicht da. */
    const anTeil = (tue: (sprache: string, flaeche: string, subject: EditorMenuSubject) => void) => ({
        visible: (subject: EditorMenuSubject) => teil(subject) !== undefined,
        run: ({ subject }: { subject: EditorMenuSubject }) => {
            const flaeche = teil(subject);
            if (flaeche !== undefined) tue(spracheId(subject), flaeche, subject);
        },
    });
    const oeffnen: EditorAction = {
        id: "sprache-bearbeiten",
        kinds: ["sprache"],
        capability: "use_editor_menu",
        gruppe: "bearbeiten",
        stellen: ["karte"],
        zeichen: () => (lage().darf ? "bearbeiten" : "ansehen"),
        label: () => (lage().darf ? "ortseditor.handgriff.bearbeiten" : "ortseditor.handgriff.ansehen"),
        run: ({ subject }) => wirkung.oeffnen(spracheId(subject), teil(subject)),
    };
    const form: EditorAction = {
        id: "sprache-teilflaeche-bearbeiten",
        kinds: ["sprache"],
        capability: "use_editor_menu",
        gruppe: "bearbeiten",
        stellen: ["karte"],
        zeichen: "gebietsform",
        label: "spracheditor.griff.teilflaeche",
        sperre: () => schreibGrund(lage()),
        ...anTeil((sprache, flaeche, subject) => wirkung.bearbeiten(sprache, flaeche, subject.title)),
    };
    // „Form ändern ›“ (Stufe 2 und 3): die Folge der Fläche (Zerschneiden nach „Verschieben“); gesperrt wie „Teilfläche bearbeiten“, denn sie sind Modi
    // wie er.
    const werkzeuge = (
        [
            [
                "sprache-verschieben",
                "verschieben",
                "landschaftseditor.griff.verschieben",
                (sprache: string, flaeche: string, name: string) => wirkung.verschieben(sprache, flaeche, name),
            ],
            [
                "sprache-zerschneiden",
                "zerschneiden",
                "landschaftseditor.griff.zerschneiden",
                (sprache: string, flaeche: string, name: string) => wirkung.zerschneiden(sprache, flaeche, name),
            ],
            [
                "sprache-malen",
                "malen",
                "landschaftseditor.griff.malen",
                (sprache: string, flaeche: string, name: string) => wirkung.malen(sprache, flaeche, name, "malen"),
            ],
            [
                "sprache-radieren",
                "radieren",
                "landschaftseditor.griff.radieren",
                (sprache: string, flaeche: string, name: string) => wirkung.malen(sprache, flaeche, name, "radieren"),
            ],
            [
                "sprache-vereinfachen",
                "vereinfachen",
                "landschaftseditor.griff.vereinfachen",
                (sprache: string, flaeche: string, name: string) => wirkung.vereinfachen(sprache, flaeche, name),
            ],
        ] as const
    ).map(([id, zeichen, label, tue]): EditorAction => ({
        id,
        kinds: ["sprache"],
        capability: "use_editor_menu",
        gruppe: "form",
        stellen: ["karte"],
        zeichen,
        label,
        abschnitt: "landschaftseditor.griff.abschnitt.form",
        sperre: () => schreibGrund(lage()),
        ...anTeil((sprache, flaeche, subject) => tue(sprache, flaeche, subject.title)),
    }));
    // „Mit anderer Fläche ›“ (Stufe 3): die fünf Einträge der Fläche in ihrer Folge, die „… beibehalten“ mit dem Zeichen ihres Geschwisters.
    const andere = (
        [
            ["sprache-vereinigen", "vereinigen", "landschaftseditor.griff.vereinigen", "vereinigen"],
            [
                "sprache-vereinigen-behalten",
                "vereinigen",
                "landschaftseditor.griff.vereinigenBehalten",
                "vereinigen-behalten",
            ],
            ["sprache-ausschneiden", "ausschneiden", "landschaftseditor.griff.ausschneiden", "ausschneiden"],
            [
                "sprache-ausschneiden-behalten",
                "ausschneiden",
                "landschaftseditor.griff.ausschneidenBehalten",
                "ausschneiden-behalten",
            ],
            ["sprache-neu-ausschneiden", "neu-ausschneiden", "landschaftseditor.griff.neuAusschneiden", "schnittmenge"],
        ] as const
    ).map(([id, zeichen, label, operation]): EditorAction => ({
        id,
        kinds: ["sprache"],
        capability: "use_editor_menu",
        gruppe: "form",
        stellen: ["karte"],
        zeichen,
        label,
        abschnitt: "landschaftseditor.griff.abschnitt.andere",
        sperre: () => schreibGrund(lage()),
        ...anTeil((sprache, flaeche, subject) => wirkung.mitAnderer(sprache, flaeche, subject.title, operation)),
    }));
    // „Unterflächen ›“ (Stufe 3): die drei Einträge der Fläche; die Gruppe trägt das Herauslösen (EDIT-0003 T30).
    const unter = (
        [
            ["sprache-unterflaechen-vereinigen", "vereinigen", "landschaftseditor.griff.unterVereinigen", "vereinigen"],
            [
                "sprache-unterflaeche-herausloesen",
                "herausloesen",
                "landschaftseditor.griff.unterHerausloesen",
                "herausloesen",
            ],
            ["sprache-unterflaeche-loeschen", "loeschen", "landschaftseditor.griff.unterLoeschen", "loeschen"],
        ] as const
    ).map(([id, zeichen, label, operation], i): EditorAction => ({
        id,
        kinds: ["sprache"],
        capability: "use_editor_menu",
        gruppe: "form",
        stellen: ["karte"],
        zeichen,
        label,
        abschnitt: "landschaftseditor.griff.abschnitt.unter",
        ...(i === 0 ? { abschnittZeichen: "herausloesen" as const } : {}),
        sperre: () => schreibGrund(lage()),
        ...anTeil((sprache, flaeche, subject) => wirkung.unterflaechen(sprache, flaeche, subject.title, operation)),
    }));
    // „Kopieren …“ (Stufe 3): das Blatt im Fenster; nach den Werkzeugen, vor „Teilfläche entfernen …“, wie an der Fläche.
    const kopieren: EditorAction = {
        id: "sprache-kopieren",
        kinds: ["sprache"],
        capability: "use_editor_menu",
        gruppe: "neu",
        stellen: ["karte"],
        zeichen: "kopieren",
        label: "landschaftseditor.griff.kopieren",
        sperre: () => schreibGrund(lage()),
        ...anTeil((sprache, flaeche) => wirkung.kopieren(sprache, flaeche)),
    };
    const entfernen: EditorAction = {
        id: "sprache-teilflaeche-entfernen",
        kinds: ["sprache"],
        capability: "use_editor_menu",
        gruppe: "entfernen",
        stellen: ["karte"],
        zeichen: "loeschen",
        label: "spracheditor.griff.entfernen",
        danger: true,
        sperre: () => schreibGrund(lage()),
        ...anTeil((sprache, flaeche) => wirkung.entfernen(sprache, flaeche)),
    };
    return [oeffnen, form, ...werkzeuge, ...andere, ...unter, kopieren, entfernen];
}

/**
 * „Hier hinzufügen › Neue Teilfläche“ (WI-0261 Stufe 1, statt „✚ Teilfläche zeichnen“ unter der Liste): zeichnet mit dem gemeinsamen Ablauf „Neue Fläche“
 * eine Teilfläche der Sprache, die im vordersten Sprachfenster gewählt ist; die Stelle des Menüs ist die erste Ecke. Er steht nur in Derographie ›
 * Sprachen und nur mit einer gewählten (aktiven) Sprache; gesperrt wie die Handgriffe.
 */
export function neueTeilflaecheEintrag(
    lage: () => Omit<SpracheLage, "teilflaeche">,
    /** Die Sprache des vordersten Sprachfensters, wenn sie aktiv und gelesen ist. */
    sprache: () => string | undefined,
    /** Zeigt die Karte die Ebene Sprachen? */
    gezeigt: () => boolean,
    zeichne: (spracheId: string, punkt: { x: number; y: number }) => void,
): AnlegenEintrag {
    return {
        id: "neue-teilflaeche-sprache",
        zeichen: "neue-flaeche",
        label: "spracheditor.griff.neueTeilflaeche",
        ansichten: ["landscapes"],
        steht: () => gezeigt() && sprache() !== undefined,
        sperre: () => schreibGrund(lage()),
        run: (punkt) => {
            const id = sprache();
            if (id !== undefined) zeichne(id, punkt);
        },
    };
}
