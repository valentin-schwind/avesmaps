import { SUBJECT_DETAIL_KINDS, type SubjectDetail, type SubjectDetailKind } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { currentPanelMode, panelRules } from "../info-panel/panel-extras";
import { subtitleOf, titleOf } from "../info-panel/panel-header";
import type { ShownSubject } from "../info-panel/subject-selection";
import type { EditorMenuSubject } from "./action";

/**
 * Wer das Menü ist: Name und Art des gewählten Subjects, mit denselben Regeln wie der Kopf des Infopanels (`panel-header.ts`,
 * Legacy `locationTypeLabelForDisplay`) - ein zweiter Weg zu „Metropole“ liefe beim nächsten Regelwechsel auseinander. Solange die
 * Antwort des Servers aussteht, steht der Name, den die Karte schon kannte; die Art kommt mit der Antwort.
 */

const isDetailKind = (kind: string): kind is SubjectDetailKind =>
    (SUBJECT_DETAIL_KINDS as readonly string[]).includes(kind);

/** Die Art in Worten: der erste Eintrag des Untertitels („Metropole“); die Herrschaft dahinter gehört dem Panel. */
function artOf(kind: SubjectDetailKind, detail: SubjectDetail, title: string): string | undefined {
    const first = subtitleOf(kind, detail, panelRules(currentPanelMode()))[0];
    const text = first?.parts.map((part) => part.text).join("") ?? "";
    // Heißt eine namenlose Fläche nach ihrer Art („Wald“, OPS-073), steht die Art nicht noch einmal als Untertitel des Menüs.
    return text === "" || text === title ? undefined : text;
}

/** Name und Art dessen, was gerade gezeigt wird. */
export function subjectOf(shown: ShownSubject): EditorMenuSubject {
    const { ref, answer } = shown;
    if (ref.kind === "mapPoint") {
        return { ref, title: t("infoPanel.mapPoint.title"), art: undefined, answer };
    }
    const known = shown.title !== undefined && shown.title !== "" ? shown.title : t("infoPanel.untitled");
    if (answer === undefined || !isDetailKind(answer.subject.kind)) {
        return { ref, title: known, art: undefined, answer };
    }
    const detail = answer as SubjectDetail;
    const kind = detail.subject.kind as SubjectDetailKind;
    const title = titleOf(kind, detail, shown.title);
    return { ref, title, art: artOf(kind, detail, title), answer };
}
