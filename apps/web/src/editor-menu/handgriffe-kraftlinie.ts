import type { EditorLock, EditorStatus } from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/i18n";
import type { EditorAction, EditorMenuSubject } from "./action";
import { modusGrund } from "./handgriffe-ort";

/**
 * Die Handgriffe der Kraftlinien im Register (WI-0205 Paket K3; EDIT-0003 T39, Betreiber 2026-10-17).
 *
 * In der Ansicht „Kraftlinien“ steht an einem Nodix-Ort in der Karte der Editoren nur, was dort Sinn hat (Betreiber: „im kraftlinien
 * modus ist es nicht sinnvoll, dass man orte bearbeiten kann“; „"Eigenschaften bearbeiten" kannst du aber lassen, weil da die "Nodix"
 * einstellung drin ist“): „Eigenschaften bearbeiten“ des Orts, „Neue Kraftlinie“ (ab hier) und „Kraftlinie entfernen ›“ mit der Auswahl
 * der Linien, die an diesem Nodix hängen. Welche Ort-Handgriffe dort wegfallen, sagt das Register (`HANDGRIFFE_JE_ANSICHT`); diese
 * beiden stehen nur in dieser Ansicht (`ansichten`).
 *
 * - **„Neue Kraftlinie“** (K9) startet den Modus „Anlegen“ an diesem Nodix (`kraftlinieneditor/neue-kraftlinie.ts`); wie ein neuer Weg
 *   braucht sie beide Rechte.
 * - **„Kraftlinie entfernen“** legt die gewählte Linie still (`powerline.retire`), nach einer Nachfrage im Kraftlinien-Fenster.
 *
 * **An der Linie selbst** (K3; WI-0205 R8, R10; EDIT-0003 T25, R3), nur im Rechtsklick (R10: „Handgriffe nur im Rechtsklick“; der
 * Linksklick öffnet das Kraftlinien-Fenster): „Eigenschaften bearbeiten“ (ohne Schreibrecht „Ansehen“) öffnet das Fenster an der Linie,
 * „Kurve bearbeiten“ startet den Modus der Form und ist der Doppelklick, „Kraftlinie entfernen“ fragt im Fenster nach. Gemeint ist der
 * getroffene Abschnitt (`anchor`); liegen mehrere Linien dort, steht „Hier laufen N Kraftlinien“ mit je Linie ihrem Untermenü.
 *
 * **Nodix anfügen und herausnehmen** (Blatt Kraftlinien E und G; T28 (5), R5): „Nodix anfügen“ an der Linie öffnet ihr Fenster mit dem
 * Kasten „✚ Nodix anfügen“ und hängt die Kurve an; „Aus der Linie nehmen ›“ am Nodix (Ansicht Kraftlinien) nimmt ihn aus der gewählten
 * Linie, die Nachbarn verbinden sich. Beides ist ein Schritt im Entwurf der Linie, wie die Kurve; darum braucht es `edit_map_geometry`.
 *
 * **Am Kraftlinienpunkt** (EDIT-0003 T52; ein Nodix ohne Ort, Gegenstand nur des Editor-Menüs, `KraftlinienpunktRef`): dieselben Griffe
 * wie am Nodix-Ort („Aus der Linie nehmen ›“, „Neue Kraftlinie“, „Kraftlinie entfernen ›“), dazu „Kraftlinienpunkt verschieben“ (K5,
 * `nodix.move` auf der Punkt-Art des Geometrie-Moduls, die Bahnen folgen) und „Kraftlinienpunkt entfernen“ (`nodix.retire`,
 * weich), gesperrt mit „Hier enden noch Kraftlinien“, solange eine gezeichnete Linie an ihm endet; wie das Anlegen braucht es beide Rechte.
 *
 * **Fremde Sperre** (EDIT-0003 §4, F10; WI-0205 K11): Bearbeitet ein anderer die Linie (`sperreVon`, am getroffenen Abschnitt über
 * `sections`), sind „Kurve bearbeiten“, „Nodix anfügen“ und „Kraftlinie entfernen“ an ihr gesperrt mit „wird gerade bearbeitet“; wer
 * und seit wann steht im Kasten darüber. „Eigenschaften bearbeiten“ bleibt (das Fenster zeigt die Sperre). In den Untermenüs am Nodix
 * wählt man die Linie erst dort: Am Eintrag steht keine Sperre, wie bei den Wegen; der Schreibweg weist eine gesperrte Linie ab.
 */

export interface KraftlinienLage {
    readonly rechte: readonly string[];
    readonly bearbeiten: EditorStatus | undefined;
    readonly laeuft: boolean;
    /** Die Kraftlinien an diesem Knoten, je Linie mit Anker und Namen (aus dem Netz der Bögen). */
    readonly linienAm: (knoten: string) => readonly { anker: string; name: string }[];
    /** Die Sperre eines anderen an der Linie dieses Abschnitts (EDIT-0003 §4; WI-0205 K11): Dann geht die Linie nicht. */
    readonly sperreVon?: ((abschnitt: string) => EditorLock | undefined) | undefined;
}

export interface KraftlinienWirkung {
    /** Die Nachfrage zum Entfernen dieser Linie (das Kraftlinien-Fenster öffnet sich an ihr). */
    entfernen(anker: string): void;
    /** Das Kraftlinien-Fenster an dieser Linie öffnen. */
    eigenschaften(anker: string): void;
    /** Den Modus „Kurve bearbeiten“ an dieser Linie starten. */
    kurve(anker: string): void;
    /** „Neue Kraftlinie“ an diesem Nodix beginnen (K9). */
    neu(knoten: string): void;
    /** „Nodix anfügen“ an dieser Linie: ihr Fenster mit dem Kasten zum Anfügen. */
    anfuegen(anker: string): void;
    /** Diesen Nodix aus der gewählten Linie nehmen (R5). */
    herausnehmen(anker: string, knoten: string): void;
    /** Diesen Kraftlinienpunkt entfernen (K10, `nodix.retire`). */
    punktEntfernen(knoten: string): void;
    /** Diesen Kraftlinienpunkt verschieben (K5, `nodix.move`). */
    punktVerschieben(knoten: string): void;
}

const knotenVon = (subject: EditorMenuSubject): string => ("id" in subject.ref ? subject.ref.id : "");
/** Der getroffene Abschnitt einer Linie (`powerline.public_id`). */
const ankerVon = (subject: EditorMenuSubject): string => (subject.ref.kind === "powerline" ? subject.ref.anchor : "");

export function kraftlinieHandgriffe(lage: () => KraftlinienLage, wirkung: KraftlinienWirkung): EditorAction[] {
    const sperre =
        (recht: string) =>
        (subject?: EditorMenuSubject): MessageKey | undefined => {
            const jetzt = lage();
            if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
            const anker = subject === undefined ? "" : ankerVon(subject);
            if (anker !== "" && jetzt.sperreVon?.(anker) !== undefined) return "sperre.grund";
            if (!jetzt.rechte.includes(recht)) return "ortseditor.handgriff.grund.recht";
            return modusGrund(jetzt.bearbeiten);
        };
    const schreiben = (): boolean => lage().rechte.includes("edit_map_objects");
    return [
        {
            id: "kraftlinie-eigenschaften",
            kinds: ["powerline"],
            capability: "use_editor_menu",
            gruppe: "bearbeiten",
            stellen: ["karte"],
            zeichen: () => (schreiben() ? "bearbeiten" : "ansehen"),
            label: () => (schreiben() ? "kraftlinieneditor.knopf.felder" : "ortseditor.handgriff.ansehen"),
            run: ({ subject }) => wirkung.eigenschaften(ankerVon(subject)),
        },
        {
            id: "kraftlinie-kurve",
            kinds: ["powerline"],
            capability: "edit_map_geometry",
            gruppe: "form",
            stellen: ["karte"],
            // Der Doppelklick auf eine Linie startet ihre Kurve (EDIT-0003 R3); Zeichen wie „Wegkurve bearbeiten“ (F21, W1).
            doppelklick: true,
            zeichen: "kurve-bearbeiten",
            label: "kraftlinieneditor.knopf.form",
            sperre: sperre("edit_map_geometry"),
            run: ({ subject }) => wirkung.kurve(ankerVon(subject)),
        },
        {
            id: "kraftlinie-anfuegen",
            kinds: ["powerline"],
            capability: "edit_map_geometry",
            gruppe: "form",
            stellen: ["karte"],
            zeichen: "neue-kraftlinie",
            label: "kraftlinieneditor.griff.anfuegen",
            sperre: sperre("edit_map_geometry"),
            run: ({ subject }) => wirkung.anfuegen(ankerVon(subject)),
        },
        {
            id: "kraftlinie-linie-entfernen",
            kinds: ["powerline"],
            capability: "edit_map_objects",
            gruppe: "entfernen",
            stellen: ["karte"],
            zeichen: "entfernen",
            label: "kraftlinieneditor.griff.entfernen",
            danger: true,
            sperre: sperre("edit_map_objects"),
            run: ({ subject }) => wirkung.entfernen(ankerVon(subject)),
        },
        {
            id: "kraftlinie-neu",
            kinds: ["place", "kraftlinienpunkt"],
            capability: "edit_map_geometry",
            gruppe: "neu",
            stellen: ["karte"],
            ansichten: ["powerlines"],
            zeichen: "neue-kraftlinie",
            // Derselbe Text wie „Neue Kraftlinie“ des Orts im Infopanel (`ort-kraftlinie`).
            label: "ortseditor.handgriff.kraftlinie",
            // Wie ein neuer Weg beide Rechte: die Sache und die Lage.
            sperre: () => sperre("edit_map_objects")() ?? sperre("edit_map_geometry")(),
            run: ({ subject }) => wirkung.neu(knotenVon(subject)),
        },
        {
            id: "kraftlinienpunkt-verschieben",
            kinds: ["kraftlinienpunkt"],
            capability: "edit_map_geometry",
            gruppe: "form",
            stellen: ["karte"],
            ansichten: ["powerlines"],
            zeichen: "verschieben",
            label: "kraftlinieneditor.punkt.verschieben",
            // Wie das Anlegen beide Rechte: Die Lage ist Geometrie, der Punkt eine Sache der Karte.
            sperre: () => sperre("edit_map_objects")() ?? sperre("edit_map_geometry")(),
            run: ({ subject }) => wirkung.punktVerschieben(knotenVon(subject)),
        },
        {
            id: "kraftlinie-herausnehmen",
            kinds: ["place", "kraftlinienpunkt"],
            capability: "edit_map_geometry",
            gruppe: "form",
            stellen: ["karte"],
            ansichten: ["powerlines"],
            zeichen: "entfernen",
            label: "kraftlinieneditor.griff.herausnehmen",
            auswahl: (subject) =>
                lage()
                    .linienAm(knotenVon(subject))
                    .map((linie) => ({ id: linie.anker, text: linie.name === "" ? "…" : linie.name })),
            sperre: sperre("edit_map_geometry"),
            run: ({ subject, wahl }) => {
                if (wahl !== undefined) wirkung.herausnehmen(wahl, knotenVon(subject));
            },
        },
        {
            id: "kraftlinie-entfernen",
            kinds: ["place", "kraftlinienpunkt"],
            capability: "edit_map_objects",
            gruppe: "entfernen",
            stellen: ["karte"],
            ansichten: ["powerlines"],
            zeichen: "entfernen",
            label: "kraftlinieneditor.griff.entfernen",
            danger: true,
            auswahl: (subject) =>
                lage()
                    .linienAm(knotenVon(subject))
                    .map((linie) => ({ id: linie.anker, text: linie.name === "" ? "…" : linie.name })),
            sperre: sperre("edit_map_objects"),
            run: ({ wahl }) => {
                if (wahl !== undefined) wirkung.entfernen(wahl);
            },
        },
        {
            id: "kraftlinienpunkt-entfernen",
            kinds: ["kraftlinienpunkt"],
            capability: "edit_map_geometry",
            gruppe: "entfernen",
            stellen: ["karte"],
            ansichten: ["powerlines"],
            zeichen: "entfernen",
            label: "kraftlinieneditor.punkt.entfernen",
            danger: true,
            // Wie das Anlegen beide Rechte; nur ohne Linie (der Schreibweg weist auch eine abgenommene ab).
            sperre: (subject) =>
                sperre("edit_map_objects")() ??
                sperre("edit_map_geometry")() ??
                (lage().linienAm(knotenVon(subject)).length > 0 ? "kraftlinieneditor.punkt.mitLinie" : undefined),
            run: ({ subject }) => wirkung.punktEntfernen(knotenVon(subject)),
        },
    ];
}
