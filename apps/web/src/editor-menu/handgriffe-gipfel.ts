import { formtGelaende, type EditorLock, type EditorStatus } from "@avesmaps3d/shared";
import { landmarkenartName } from "../landschaftseditor/landschaften-liste";
import type { EditorAction, EditorMenuSubject } from "./action";
import { modusGrund } from "./handgriffe-ort";
import { GRUND_GEBIRGE } from "./sonderrolle-grund";

/**
 * Die Handgriffe am Gipfel und Vulkan im Register (WI-0178 P2; Fassung 16 des Gebirge-Entwurfs: „Rechtsklick öffnet das Kartenmenü mit
 * „Gipfel“ und „Hier hinzufügen › ▲ Gipfel setzen …““, dort mit „Eigenschaften bearbeiten“ und „Auf der Karte verschieben“ samt
 * „Doppelklick“).
 *
 * - **„Eigenschaften bearbeiten“** (ohne Schreibrecht „Ansehen“) öffnet das Derographie-Fenster am Gipfel.
 * - **„Auf der Karte verschieben“** öffnet es und startet den Modus mit EINEM Punkt (`landschaftseditor/gipfel-ziehen.ts`); der
 *   Doppelklick auf das ▲ tut dasselbe. Wie am Ort braucht es `edit_map_geometry`, dazu `edit_map_objects` (der Gipfel ist eine Sache der
 *   Karte); gesperrt, während ein Modus läuft, bei ausgeschaltetem Bearbeiten und solange ein anderer den Gipfel hält.
 * - **„Gipfel entfernen …“** (Editor-Orchestrierung 2026-10-19, wie „Fläche entfernen …“): rot, zuletzt; öffnet das Fenster mit der
 *   Rückfrage samt Folgen. Gesperrt wie das Verschieben. An einer Landmarke ohne Gelände „Landmarke entfernen …“ (WI-0271 L4).
 * - **Jede Landmarkenart** (WI-0271 L4): dieselben Handgriffe; die Art im Kopf des Menüs aus `peak.<art>`.
 */
export interface GipfelLage {
    readonly rechte: readonly string[];
    readonly bearbeiten: EditorStatus | undefined;
    readonly laeuft: boolean;
    /** Die Sperre eines anderen an diesem Gipfel (EDIT-0003 §4): Dann geht das Verschieben nicht. */
    readonly sperreVon?: ((id: string) => EditorLock | undefined) | undefined;
}

export interface GipfelWirkung {
    /** Das Derographie-Fenster an diesem Gipfel öffnen. */
    eigenschaften(id: string, name: string): void;
    /** Das Fenster öffnen und „Auf der Karte verschieben“ starten. */
    verschieben(id: string, name: string): void;
    /** Das Fenster öffnen mit der Rückfrage „„Name“ entfernen?“. */
    entfernen(id: string, name: string): void;
}

/** Die Art je Gipfel, wie die Karte sie zuletzt traf: Der Name des Handgriffs „… entfernen …“ hängt an ihr. */
const ARTEN = new Map<string, string>();

/** Ein Gipfel als Gegenstand des Kartenmenüs, wie die Karte ihn trifft (`gipfel-besitzer.ts`). */
export function gipfelSubjekt(gipfel: { id: string; name: string; subtype: string }): EditorMenuSubject {
    ARTEN.set(gipfel.id, gipfel.subtype);
    return {
        ref: { kind: "peak", id: gipfel.id },
        title: gipfel.name,
        art: landmarkenartName(gipfel.subtype),
        answer: undefined,
    };
}

const gipfelId = (subject: EditorMenuSubject): string => ("id" in subject.ref ? subject.ref.id : "");

export function gipfelHandgriffe(lage: () => GipfelLage, wirkung: GipfelWirkung): EditorAction[] {
    const darf = (recht: string): boolean => lage().rechte.includes(recht);
    /**
     * Berggipfel und Vulkan gehören dem Topographen, alle anderen Landmarken jedem Editor, ohne Grundrolle dem Derographen (WI-0279, E2a, E12). Das Recht hängt also an der
     * Art des Punkts; deshalb steht am Eintrag nur `use_editor_menu`, und die Sperre entscheidet.
     */
    const darfPunkt = (subject: EditorMenuSubject, lageAendern: boolean): boolean => {
        if (formtGelaende(ARTEN.get(gipfelId(subject)) ?? "berggipfel")) return darf("edit_mountains");
        const sache = darf("edit_map_objects") || darf("edit_landscapes");
        return sache && (!lageAendern || darf("edit_map_geometry") || darf("edit_landscape_form"));
    };
    const schreiben = (subject: EditorMenuSubject): boolean =>
        darfPunkt(subject, false) && modusGrund(lage().bearbeiten) === undefined;
    /** Wie am Ort: ein laufender Modus, fehlende Rechte, die Sperre eines anderen, ausgeschaltetes Bearbeiten. */
    const geometrieGrund = (subject: EditorMenuSubject) => {
        const jetzt = lage();
        if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft" as const;
        if (!darfPunkt(subject, true))
            return formtGelaende(ARTEN.get(gipfelId(subject)) ?? "berggipfel")
                ? GRUND_GEBIRGE
                : ("ortseditor.handgriff.grund.recht" as const);
        // F10: 🔒 „wird gerade bearbeitet“; wer und seit wann steht im Kasten darüber.
        if (jetzt.sperreVon?.(gipfelId(subject)) !== undefined) return "sperre.grund" as const;
        return modusGrund(jetzt.bearbeiten);
    };
    return [
        {
            id: "gipfel-bearbeiten",
            kinds: ["peak"],
            capability: "use_editor_menu",
            gruppe: "bearbeiten",
            stellen: ["karte"],
            zeichen: (subject) => (schreiben(subject) ? "bearbeiten" : "ansehen"),
            label: (subject) =>
                schreiben(subject) ? "landschaftseditor.griff.oeffnen" : "landschaftseditor.griff.ansehen",
            run: ({ subject }) => wirkung.eigenschaften(gipfelId(subject), subject.title),
        },
        {
            id: "gipfel-verschieben",
            kinds: ["peak"],
            capability: "use_editor_menu",
            gruppe: "form",
            stellen: ["karte"],
            zeichen: "verschieben",
            label: "landschaftseditor.beschriftung.verschieben",
            doppelklick: true,
            sperre: geometrieGrund,
            run: ({ subject }) => wirkung.verschieben(gipfelId(subject), subject.title),
        },
        {
            id: "gipfel-entfernen",
            kinds: ["peak"],
            capability: "use_editor_menu",
            gruppe: "entfernen",
            stellen: ["karte"],
            zeichen: "loeschen",
            label: (subject) =>
                formtGelaende(ARTEN.get(gipfelId(subject)) ?? "berggipfel")
                    ? "landschaftseditor.gipfel.entfernen"
                    : "landschaftseditor.landmarke.entfernen",
            danger: true,
            sperre: geometrieGrund,
            run: ({ subject }) => wirkung.entfernen(gipfelId(subject), subject.title),
        },
    ];
}
