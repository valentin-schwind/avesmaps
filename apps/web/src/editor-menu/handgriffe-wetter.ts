import type { EditorStatus, WetterSymbolArt } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import type { EditorAction, EditorMenuSubject } from "./action";
import { modusGrund } from "./handgriffe-ort";

/**
 * Die Handgriffe am Wetter-Icon im Register (WI-0288; Betreiber 2026-11-08: „der wettereditor ist noch nicht so wie die andern editoren“): Wie an
 * Ort, Gipfel und Fläche stehen sie im Kartenmenü (Rechtsklick auf ein Icon), im Menü am Objekt (Linksklick auf ein Icon mit Wiki-Verweis, solange
 * der Wetter-Editor zu ist) und in der Gruppe „Bearbeiten · nur Editoren“ des Infopanels, in der festen Folge der Gruppen (EDIT-0003 G10).
 *
 * - **Bearbeiten:** „Eigenschaften bearbeiten“ (ohne Schreibrecht „Ansehen“; Wort und Zeichen wie am Gipfel, T5) öffnet den Wetter-Editor mit dem
 *   Icon gewählt.
 * - **Sichtbarkeit:** „Verbergen“ und „Zurückholen“ wie am Ort und an der Fläche (R6: ein Wort, eine Bedeutung; T41 (4)), je Icon nur eines von
 *   beiden. Sie schreiben sofort wie jede Änderung im Wetter-Editor (Betreiber 2026-11-07); ein verborgenes Icon wirkt weiter aufs Wetter.
 * - **Entfernen:** „Icon entfernen …“, rot, zuletzt: öffnet den Wetter-Editor mit der Rückfrage am Icon (R6: „…“ vor einer Bestätigung).
 * - **Gesperrt** ohne Schreibrecht (`edit_weather`, über die Lage, weil der Viewer dafür keine Fähigkeit führt), bei ausgeschaltetem Bearbeiten
 *   und während ein Modus läuft (wie am Gipfel).
 * - Kein Doppelklick: Der Doppelklick in der Liste fliegt hin (G3); auf der Karte bleibt er beim Zoom der Karte.
 */

export interface WetterLage {
    /** Darf diese Sitzung das Wetter schreiben (das Verb „Wetter bearbeiten“ steht auf „bearbeiten“)? */
    readonly darf: boolean;
    readonly bearbeiten: EditorStatus | undefined;
    readonly laeuft: boolean;
    /** Ist das Icon gerade zu sehen? Ungelesen gilt es als gezeigt: Außerhalb des Editors zeichnet die Karte nur gezeigte Icons. */
    readonly sichtbar: (id: string) => boolean;
}

export interface WetterWirkung {
    /** Den Wetter-Editor öffnen, das Icon gewählt. */
    oeffnen(id: string): void;
    /** Verbergen (`false`) oder Zurückholen (`true`); schreibt sofort. */
    sichtbar(id: string, ja: boolean): void;
    /** Den Wetter-Editor öffnen mit der Rückfrage „„Name“ entfernen?“ am Icon. */
    entfernen(id: string): void;
}

/** Ein Wetter-Icon als Gegenstand des Kartenmenüs, wie die Karte es trifft (`map/wetter/wetter-treffer.ts`). */
export function wetterSubjekt(icon: { id: string; name: string; art: WetterSymbolArt }): EditorMenuSubject {
    const art = t(`wetterSymbol.art.${icon.art}`);
    return {
        ref: { kind: "wetterSymbol", id: icon.id },
        title: icon.name.trim() === "" ? art : icon.name,
        art,
        answer: undefined,
    };
}

const iconId = (subject: EditorMenuSubject): string => ("id" in subject.ref ? subject.ref.id : "");

export function wetterHandgriffe(lage: () => WetterLage, wirkung: WetterWirkung): EditorAction[] {
    const schreibGrund = () => {
        const jetzt = lage();
        if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft" as const;
        if (!jetzt.darf) return "ortseditor.handgriff.grund.recht" as const;
        return modusGrund(jetzt.bearbeiten);
    };
    const schreibt = (): boolean => schreibGrund() === undefined;
    const sichtbarkeit = (id: string, zeichen: "verbergen" | "zurueckholen", gezeigt: boolean): EditorAction => ({
        id,
        kinds: ["wetterSymbol"],
        capability: "use_editor_menu",
        gruppe: "sichtbarkeit",
        zeichen,
        label: gezeigt ? "wettereditor.griff.verbergen" : "wettereditor.griff.zeigen",
        visible: (subject) => lage().sichtbar(iconId(subject)) === gezeigt,
        sperre: schreibGrund,
        run: ({ subject }) => wirkung.sichtbar(iconId(subject), !gezeigt),
    });
    return [
        {
            id: "wetter-bearbeiten",
            kinds: ["wetterSymbol"],
            capability: "use_editor_menu",
            gruppe: "bearbeiten",
            zeichen: () => (schreibt() ? "bearbeiten" : "ansehen"),
            label: () => (schreibt() ? "wettereditor.griff.bearbeiten" : "wettereditor.griff.ansehen"),
            run: ({ subject }) => wirkung.oeffnen(iconId(subject)),
        },
        sichtbarkeit("wetter-verbergen", "verbergen", true),
        sichtbarkeit("wetter-zeigen", "zurueckholen", false),
        {
            id: "wetter-entfernen",
            kinds: ["wetterSymbol"],
            capability: "use_editor_menu",
            gruppe: "entfernen",
            zeichen: "loeschen",
            label: "wettereditor.entfernen",
            danger: true,
            sperre: schreibGrund,
            run: ({ subject }) => wirkung.entfernen(iconId(subject)),
        },
    ];
}
