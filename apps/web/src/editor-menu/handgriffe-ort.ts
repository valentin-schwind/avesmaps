import type { EditorLock, EditorStatus } from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/i18n";
import type { SubjectAnswer } from "../info-panel/subject-client";
import { bitteEntfernen } from "../ortseditor/ort-entfernen";
import { bitteUmwandeln } from "../ortseditor/ort-umwandeln";
import type { EditorAction, EditorMenuSubject } from "./action";

/**
 * Die Handgriffe am Ort im Register (WI-0128 E15; EDIT-0001 D7, D16, D20; EDIT-0002 §5 „Ort“; EDIT-0003 G10, T5; Schritt O1). Bis O1
 * standen sie als eigene Liste in `ortseditor/ort-handgriffe.ts`; jetzt sind sie Einträge des Registers wie die von Weg und Fläche.
 *
 * - **Doppelklick** auf den Ort öffnet „Eigenschaften bearbeiten“ (EDIT-0003 R3, `editor-menu/doppelklick.ts`), daher dort das Kürzel.
 * - **Wörter (T5):** „Eigenschaften bearbeiten“ (ohne Schreibrecht „Ansehen“) öffnet den Ort im Ortseditor; „Ort verschieben“ startet
 *   den Modus (E12); „Verbergen“ bzw. „Zurückholen“ wirkt sofort als `place.update` (D20); „Ort entfernen“ öffnet das Blatt (E22).
 * - **Folge (G10):** Bearbeiten · Form · Sichtbarkeit · Neues von hier aus · Entfernen.
 * - **„Neue Kraftlinie“** steht nur in der Gruppe des Infopanels, mit „kommt später“ (D16). „Neuer Weg ab hier“ gehört dem Weg
 *   (`handgriffe-weg.ts`, WI-0177).
 * - **Sperrgrund:** ohne Recht „ohne Recht“, mit ausgeschaltetem Bearbeiten (`MAP_EDITING`) „ausgeschaltet“, während ein Verschiebemodus
 *   läuft „läuft gerade“. Das Menü am Objekt zeigt nur, was ohne Grund geht.
 * - **Sperre eines anderen** (EDIT-0003 §4, WI-0215): „Ort verschieben“ steht dann gesperrt mit „Wird gerade bearbeitet.“; wer und seit
 *   wann, sagt der Kasten über den Einträgen. Wie an der Fläche „Gebietsform bearbeiten“.
 */

/** Was die Handgriffe über den Stand wissen; `app.vue` liest ihn bei jedem Öffnen frisch. */
export interface OrtLage {
    readonly rechte: readonly string[];
    /** Der Stand des Bearbeitens (E9); unbekannt zählt wie ausgeschaltet. */
    readonly bearbeiten: EditorStatus | undefined;
    /** Läuft gerade ein Verschiebemodus? */
    readonly laeuft: boolean;
    /** Die Sperre eines anderen an diesem Ort (EDIT-0003 §4); dann geht die Form nicht. */
    readonly sperreVon?: ((publicId: string) => EditorLock | undefined) | undefined;
}

/** Was die Handgriffe tun; `app.vue` bindet es an Ortseditor, Verschiebemodus und Schreibweg. */
export interface OrtWirkung {
    bearbeiten(publicId: string): void;
    verschieben(publicId: string): void;
    verbergen(publicId: string, verborgen: boolean): void;
}

/** Warum ein schreibender Handgriff wegen des Bearbeitens nicht geht; ohne Grund ist es an (`MAP_EDITING=testwelt`). */
export function modusGrund(stand: EditorStatus | undefined): MessageKey | undefined {
    if (stand?.mapEditing === "testwelt") return undefined;
    return stand?.environment === "production"
        ? "ortseditor.handgriff.grund.umstieg"
        : "ortseditor.handgriff.grund.aus";
}

export const istVerborgen = (answer: unknown): boolean => (answer as { hidden?: boolean } | undefined)?.hidden === true;

/** Die Ortsart: aus der Antwort des Servers (der Teil `type` der Unterzeile) oder aus der Kachel (`ortSubjekt`). */
function ortsart(answer: unknown): string | undefined {
    const ort = answer as { subtype?: string; subtitle?: readonly { part: string; key?: string }[] } | undefined;
    return ort?.subtype ?? ort?.subtitle?.find((teil) => teil.part === "type")?.key;
}

const ortId = (subject: EditorMenuSubject): string => (subject.ref.kind === "place" ? subject.ref.id : "");

/**
 * Ein Ort als Gegenstand der Handgriffe, wo nur Kennung, Name und „verborgen“ bekannt sind (das Kartenmenü kennt den Ort aus der Kachel,
 * nicht aus der Antwort des Servers).
 */
export function ortSubjekt(ort: {
    id: string;
    name?: string | undefined;
    hidden?: boolean | undefined;
    subtype?: string | undefined;
}): EditorMenuSubject {
    return {
        ref: { kind: "place", id: ort.id },
        title: ort.name ?? "",
        art: undefined,
        answer: {
            hidden: ort.hidden === true,
            ...(ort.subtype === undefined ? {} : { subtype: ort.subtype }),
        } as unknown as SubjectAnswer,
    };
}

export function ortHandgriffe(lage: () => OrtLage, wirkung: OrtWirkung): EditorAction[] {
    const schreiben = (): boolean => lage().rechte.includes("edit_map_objects");
    /** Ohne Recht „ohne Recht“, sonst der Grund des Bearbeitens; mit `laeuftAuch` sperrt zuerst ein laufender Modus. */
    const sperre =
        (recht: string, laeuftAuch = false) =>
        (): MessageKey | undefined => {
            const jetzt = lage();
            if (laeuftAuch && jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
            if (!jetzt.rechte.includes(recht)) return "ortseditor.handgriff.grund.recht";
            return modusGrund(jetzt.bearbeiten);
        };
    const spaeter = (): MessageKey => "ortseditor.handgriff.grund.spaeter";
    return [
        {
            id: "ort-bearbeiten",
            kinds: ["place"],
            capability: "use_editor_menu",
            gruppe: "bearbeiten",
            doppelklick: true,
            zeichen: () => (schreiben() ? "bearbeiten" : "ansehen"),
            label: () => (schreiben() ? "ortseditor.handgriff.bearbeiten" : "ortseditor.handgriff.ansehen"),
            run: ({ subject }) => wirkung.bearbeiten(ortId(subject)),
        },
        {
            id: "ort-verschieben",
            kinds: ["place"],
            capability: "edit_map_geometry",
            gruppe: "form",
            zeichen: "verschieben",
            label: "ortseditor.handgriff.verschieben",
            sperre: (subject) => {
                const jetzt = lage();
                if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
                // F10: 🔒 „wird gerade bearbeitet“; wer und seit wann steht im Kasten darüber.
                if (jetzt.sperreVon?.(ortId(subject)) !== undefined) return "sperre.grund";
                return sperre("edit_map_geometry")();
            },
            run: ({ subject }) => wirkung.verschieben(ortId(subject)),
        },
        {
            id: "ort-verbergen",
            kinds: ["place"],
            capability: "edit_map_objects",
            gruppe: "sichtbarkeit",
            zeichen: "verbergen",
            label: "ortseditor.handgriff.verbergen",
            visible: (subject) => !istVerborgen(subject.answer),
            sperre: sperre("edit_map_objects"),
            run: ({ subject }) => wirkung.verbergen(ortId(subject), true),
        },
        {
            id: "ort-zeigen",
            kinds: ["place"],
            capability: "edit_map_objects",
            gruppe: "sichtbarkeit",
            zeichen: "zurueckholen",
            label: "ortseditor.handgriff.zeigen",
            visible: (subject) => istVerborgen(subject.answer),
            sperre: sperre("edit_map_objects"),
            run: ({ subject }) => wirkung.verbergen(ortId(subject), false),
        },
        {
            id: "ort-kraftlinie",
            kinds: ["place"],
            capability: "use_editor_menu",
            gruppe: "neu",
            stellen: ["infopanel"],
            zeichen: "neue-kraftlinie",
            label: "ortseditor.handgriff.kraftlinie",
            sperre: spaeter,
            run: () => undefined,
        },
        {
            // „In Landmarke umwandeln …“ (WI-0271 L8): an jedem Bauwerk; welches natürlich ist, entscheidet der Editor. Vor dem Cutoff der Orte steht der Griff in Production gesperrt mit Grund.
            id: "ort-umwandeln",
            kinds: ["place"],
            capability: "edit_map_objects",
            gruppe: "entfernen",
            zeichen: "verlagern",
            label: "ortseditor.handgriff.umwandeln",
            visible: (subject) => ortsart(subject.answer) === "gebaeude",
            sperre: () => {
                const grund = sperre("edit_map_objects", true)();
                if (grund !== undefined) return grund;
                return lage().bearbeiten?.umwandelnFrei === false ? "ortseditor.handgriff.grund.vorCutoff" : undefined;
            },
            run: ({ subject }) => bitteUmwandeln(ortId(subject)),
        },
        {
            id: "ort-entfernen",
            kinds: ["place"],
            capability: "edit_map_objects",
            gruppe: "entfernen",
            // Die Nadel mit Minus: Meist wird ein Ort nur von der Karte genommen; der Eimer steht im Blatt bei „Ganz löschen“.
            zeichen: "abnehmen",
            label: "ortseditor.handgriff.entfernen",
            danger: true,
            sperre: sperre("edit_map_objects", true),
            run: ({ subject }) => bitteEntfernen(ortId(subject)),
        },
    ];
}
