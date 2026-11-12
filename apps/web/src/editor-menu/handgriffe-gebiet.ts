import type { EditorStatus, MapView } from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/i18n";
import type { EditorAction, EditorMenuSubject, HandgriffWahl } from "./action";
import { modusGrund } from "./handgriffe-ort";
import { GRUND_GEBIET } from "./sonderrolle-grund";
import type { AnlegenEintrag } from "./kartenmenue";

/**
 * Die Handgriffe an einem Herrschaftsgebiet im Register (WI-0209 Paket A4; EDIT-0005 §3, §9 „A4“, H3; EDIT-0003 G10, F18, T5, R3, T23
 * Frage 2). Sie stehen damit an allen drei Stellen des Registers: im Menü am Gebiet (nur, was geht), im Kartenmenü (Rechtsklick) und in
 * der Gruppe „Bearbeiten · nur Editoren“ des Infopanels, wenn dort ein Gebiet steht.
 *
 * - **Bearbeiten:** „Eigenschaften bearbeiten“ öffnet den Gebietseditor an diesem Gebiet (ohne Schreibrecht „Ansehen“, T5, H3); wie
 *   ein Klick in seiner Liste stellt das die Ansicht „Politisch“ (F17, T32). Darunter „Gebietsform bearbeiten“ (F18): Es startet den Modus
 *   „Grenzen bearbeiten“ (C1, `gebietseditor/gebietsform.ts`) und trägt den Doppelklick (R3, `doppelklick.ts`). Gesperrt ohne Recht,
 *   während ein Modus läuft und bei ausgeschaltetem Bearbeiten, wie an der Fläche; hält ein anderer das Gebiet, sagt es der Start.
 * - **Welches Gebiet:** Die Karte nimmt in jedem Band die Gebiete an, die sie dort zeigt (T23 Frage 2; `gebietseditor/gebiete-am-punkt.ts`).
 *   Ein abgeleitetes Gebiet (ohne eigene Fläche, seine Grenze kommt aus den Untergebieten) hat keine eigene Form; dort führt „Gebietsform
 *   bearbeiten“ zur Baronie unter dem Klickpunkt (der Lesepfad des Modus löst sie auf; den Punkt reicht `app.vue` herein).
 * - **„Unterpolygone löschen …“** (OPS-000075; Melder: „Beim Editieren entstandene Unterpolygone … sind nicht löschbar. Das muss über einen
 *   rechtsklick … gehen … Unterpolygone löschen -> 1, 2, 3 … und markierst die betroffenen in dem augenblick rot“): nur im Kartenmenü, nur wo die
 *   Fläche des Gebiets aus mehreren Teilen besteht. Ein Handgriff mit Auswahl (EDIT-0003 T49): das Untermenü listet die Teile, kleinster zuerst,
 *   der Teil unter dem Rechtsklick zuerst und vorgewählt; Zeigen lässt genau diesen Teil rot leuchten (`vorschau`), die Wahl löscht ihn sofort,
 *   ↺ in „Änderungen“ holt ihn zurück. Die Hauptfläche steht in der Liste, ist aber grau, solange sie der größte Teil ist. Was die Teile sind und
 *   wie sie geschrieben werden, steht in `gebietseditor/gebiet-teile.ts`; hier nur der Eintrag im Register.
 * - Die weiteren Handgriffe (Obergebiet ändern, Untergebiet anlegen, Grenze zeichnen, Gebiet entfernen, Zoombänder) kommen mit ihren
 *   Paketen (D1, C3, D3, D2) in die Gruppen nach G10, Entfernen rot zuletzt.
 * - **„Hier hinzufügen › Neues Herrschaftsgebiet“** (C3) ist kein Handgriff am Gebiet, sondern ein Eintrag des Kartenmenüs auf freier
 *   Fläche: `neuesGebietEintrag`, gereicht über `anlegenEintraege` (`kartenmenue.ts`).
 */

/** Was die Handgriffe über den Stand wissen; `app.vue` liest ihn bei jedem Öffnen frisch. */
export interface GebietLage {
    readonly rechte: readonly string[];
    /** Der Stand des Bearbeitens (`MAP_EDITING`); unbekannt zählt wie ausgeschaltet. */
    readonly bearbeiten: EditorStatus | undefined;
    /** Läuft gerade ein Modus (Grenzen, Ecken, Wegkurve, Ort verschieben …)? */
    readonly laeuft: boolean;
}

/** Was die Handgriffe tun; `app.vue` bindet es an den Gebietseditor. */
export interface GebietWirkung {
    /** Den Gebietseditor an diesem Gebiet öffnen. */
    oeffnen(territoryId: string): void;
    /** Den Modus „Grenzen bearbeiten“ an diesem Gebiet starten (C1); an einem abgeleiteten an der Baronie unter dem Klickpunkt. */
    gebietsform(territoryId: string): void;
    /**
     * „Unterpolygone löschen …“ (OPS-000075): die Teile der Fläche dieses Gebiets als Zeilen des Untermenüs, wie das Menü sie beim Öffnen gelesen hat
     * (`gebietseditor/gebiet-teile.ts`); leer, solange sie nicht gelesen sind oder die Fläche nur einen Teil hat - dann steht der Eintrag nicht da.
     */
    teile?(territoryId: string): readonly HandgriffWahl[];
    /** Den gewählten Teil löschen: sofort, EINE Operation gegen die Revision der Fläche; ↺ in „Änderungen“. */
    teilLoeschen?(territoryId: string, wahl: string): void;
}

/** Die Kennung des Handgriffs „Unterpolygone löschen …“; eine Wahl darin heißt `gebiet-unterpolygone-loeschen#<Fläche>:<Nummer>`. */
export const TEILE_GRIFF = "gebiet-unterpolygone-loeschen";

/**
 * In welchen Kartenansichten „Hier hinzufügen › Neues Herrschaftsgebiet“ steht. 🔴 Keine Regel für alle Ansichten (Betreiber 2026-10-18:
 * „ausnahmen bestätigen die regel, frag mich einfach jedesmal“): Standard hat er entschieden (Menü der Ansicht Standard, Wortlaut im Kopf
 * `project-control/discovery/wi-0209-c3-neue-flaeche-schnittstelle-2026-10-18.md`), Politisch ebenso (2026-10-18: Der Betreiber wählte
 * „A (Empfehlung, nach dem Grundsatz): nur „Neues Herrschaftsgebiet““; dort steht nur diese Zeile, ohne Ansichtswechsel). In der
 * Derographie steht sie nicht (2026-10-18, wörtlich: „hier hinzufügen: A aber gipfel setzen gehört in die topographie“, also nur
 * „Neue Fläche ›“).
 */
export const NEUES_GEBIET_ANSICHTEN: readonly MapView[] = ["standard", "political"];

/**
 * „Hier hinzufügen › Neues Herrschaftsgebiet“ (WI-0209 C3; Betreiber 2026-10-18 zum Menü der Ansicht Standard: „Neues Herrschaftsgebiet
 * (automatischer wechsel zur politischen ebene)“): ein eigener Eintrag auf oberster Ebene, nicht im Untermenü der Fläche. Der Start
 * zeichnet mit dem gemeinsamen Ablauf (`map/geometrie/neue-flaeche.ts`), der auf Politisch wechselt (in Politisch bleibt die Ansicht); die Stelle des Menüs ist die erste
 * Ecke, das Obergebiet das Gebiet, das die Karte dort im aktuellen Band zeigt (Frage 2). Gesperrt ohne beide Schreibrechte, ohne
 * `MAP_EDITING` und während ein Modus läuft, wie „Neuer Weg“.
 */
export function neuesGebietEintrag(
    lage: () => GebietLage,
    starte: (punkt: { x: number; y: number }) => void,
    ansichten: readonly MapView[] = NEUES_GEBIET_ANSICHTEN,
): AnlegenEintrag {
    return {
        id: "neues-gebiet",
        zeichen: "herrschaft",
        label: "gebietseditor.neu.menue",
        ansichten,
        sperre: (): MessageKey | undefined => {
            const jetzt = lage();
            if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
            if (!jetzt.rechte.includes("edit_territory_form")) return GRUND_GEBIET;
            if (!jetzt.rechte.includes("edit_territories")) return "ortseditor.handgriff.grund.recht";
            return modusGrund(jetzt.bearbeiten);
        },
        run: starte,
    };
}

/** Ein Gebiet als Gegenstand der Handgriffe, wo nur die Kachel es kennt (Kartenmenü, Doppelklick): Kennung, Name und Art. */
export function gebietSubjekt(gebiet: { id: string }, titel: string, art: string | undefined): EditorMenuSubject {
    return { ref: { kind: "territory", id: gebiet.id }, title: titel, art, answer: undefined };
}

const gebietId = (subject: EditorMenuSubject): string => (subject.ref.kind === "territory" ? subject.ref.id : "");

export function gebietHandgriffe(lage: () => GebietLage, wirkung: GebietWirkung): EditorAction[] {
    const schreiben = (): boolean => lage().rechte.includes("edit_territories");
    const bearbeiten: EditorAction = {
        id: "gebiet-bearbeiten",
        kinds: ["territory"],
        capability: "use_editor_menu",
        gruppe: "bearbeiten",
        zeichen: () => (schreiben() ? "bearbeiten" : "ansehen"),
        label: () => (schreiben() ? "ortseditor.handgriff.bearbeiten" : "ortseditor.handgriff.ansehen"),
        run: ({ subject }) => wirkung.oeffnen(gebietId(subject)),
    };
    const gebietsform: EditorAction = {
        id: "gebiet-gebietsform",
        kinds: ["territory"],
        capability: "edit_territory_form",
        gruppe: "bearbeiten",
        doppelklick: true,
        zeichen: "gebietsform",
        label: "landschaftseditor.griff.bearbeiten",
        sperre: (): MessageKey | undefined => {
            const jetzt = lage();
            if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
            if (!jetzt.rechte.includes("edit_territory_form")) return GRUND_GEBIET;
            return modusGrund(jetzt.bearbeiten);
        },
        run: ({ subject }) => wirkung.gebietsform(gebietId(subject)),
    };
    // „Unterpolygone löschen …“ (OPS-000075): rot und zuletzt (G10, Gruppe „Entfernen“), nur im Kartenmenü, denn gemeint ist die Fläche unter dem
    // Zeiger. Es schreibt Form und Sache (`territory.update` mit `areas`): beide Rechte, wie „Neues Herrschaftsgebiet“. Die Zeile steht nur, wo die
    // Fläche mehrere Teile hat (`auswahl` leer: kein Eintrag).
    const unterpolygone: EditorAction = {
        id: TEILE_GRIFF,
        kinds: ["territory"],
        capability: "edit_territory_form",
        gruppe: "entfernen",
        stellen: ["karte"],
        zeichen: "loeschen",
        label: "gebietseditor.griff.unterpolygone",
        danger: true,
        auswahl: (subject) => wirkung.teile?.(gebietId(subject)) ?? [],
        sperre: (): MessageKey | undefined => {
            const jetzt = lage();
            if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
            if (!jetzt.rechte.includes("edit_territory_form")) return GRUND_GEBIET;
            if (!jetzt.rechte.includes("edit_territories")) return "ortseditor.handgriff.grund.recht";
            return modusGrund(jetzt.bearbeiten);
        },
        run: ({ subject, wahl }) => {
            if (wahl !== undefined) wirkung.teilLoeschen?.(gebietId(subject), wahl);
        },
    };
    return [bearbeiten, gebietsform, unterpolygone];
}
