import {
    PATH_WEITERE_MAX,
    pathReaderName,
    type EditorPathAttachment,
    type EditorPathEnds,
    type PathCreateArt,
} from "@avesmaps3d/shared";
import { locale, t, type MessageKey } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { unnamedPathLabel } from "../i18n/unnamed";
import type { AnlegenGrund, AnlegenZeiger } from "../map/geometrie/anlegen";
import type { NeuerWegLauf, NeuerWegMeldung } from "./neuer-weg";
import type { WegkurveMeldung } from "./wegkurve";

/**
 * Die Sätze des Wegeditors (WI-0177). 🔴 Ein Weg heißt nie nach seinem Griff („Weg-6029“): Ob der gespeicherte Name einer ist,
 * entscheidet `pathReaderName`, sonst steht der Satz für einen Weg ohne Namen da (WI-0105).
 */

export function wegName(weg: { readonly name: string; readonly subtype: string; readonly isBach: boolean }): string {
    return pathReaderName(weg.name, weg.subtype) ?? unnamedPathLabel(weg.subtype, weg.isBach);
}

const anschlussName = (anschluss: EditorPathAttachment): string | undefined =>
    anschluss.kind === "free" ? undefined : anschluss.kind === "place" ? anschluss.name : wegName(anschluss);

/** Woran die beiden Enden hängen, als EIN Satz je Fall (Blatt B4; Entscheid 2026-10-10 „sichtbar bestätigen“). */
export function endenText(enden: EditorPathEnds): string {
    const anfang = anschlussName(enden.start);
    const ende = anschlussName(enden.end);
    if (anfang !== undefined && ende !== undefined) return t("wegeditor.wegkurve.enden.anAn", { anfang, ende });
    if (anfang !== undefined) return t("wegeditor.wegkurve.enden.anFrei", { anfang });
    if (ende !== undefined) return t("wegeditor.wegkurve.enden.freiAn", { ende });
    return t("wegeditor.wegkurve.enden.freiFrei");
}

/**
 * Die Meldung der Wegkurve: gespeichert samt Anschlüssen (aus der Quittung) und Mitgezogenen, gesperrt, verworfen, die Kurve eines
 * anderen Abschnitts im Entwurf; nach „Hier teilen“ der Konflikt mit wer und wann und die Ablehnung.
 */
export function meldungText(meldung: WegkurveMeldung, jetzt = new Date()): string {
    if (meldung.art === "verworfen") return t("wegeditor.wegkurve.verworfen", { name: meldung.name });
    if (meldung.art === "gesperrt") return t("wegeditor.wegkurve.gesperrt", { name: meldung.name, wer: meldung.wer });
    if (meldung.art === "sperrfehler") return t("wegeditor.wegkurve.sperrfehler", { name: meldung.name });
    if (meldung.art === "verloren") return t("wegeditor.wegkurve.verloren", { name: meldung.name });
    if (meldung.art === "geteilt") return t("wegeditor.wegkurve.geteilt", { name: meldung.name });
    if (meldung.art === "andere") return t("wegeditor.wegkurve.andere", { name: meldung.name });
    if (meldung.art === "gespeichert") {
        const teile = [t("wegeditor.wegkurve.gespeichert", { name: meldung.name })];
        if (meldung.stuetzpunkte !== undefined)
            teile.push(
                t("wegeditor.vereinfachen.ergebnis", {
                    vorher: String(meldung.stuetzpunkte.vorher),
                    nachher: String(meldung.stuetzpunkte.nachher),
                }),
            );
        if (meldung.enden !== undefined) teile.push(endenText(meldung.enden));
        if (meldung.mitgezogen.length > 0) {
            const namen = new Intl.ListFormat(locale.value, { type: "conjunction" }).format(meldung.mitgezogen);
            teile.push(t("wegeditor.wegkurve.mitgezogen", { namen }));
        }
        return teile.join(" ");
    }
    if (meldung.art === "konflikt") {
        const wann =
            meldung.wann === undefined
                ? t("ortseditor.konflikt.gerade")
                : relativeTime(new Date(meldung.wann), jetzt, locale.value);
        return meldung.wer === undefined
            ? t("wegeditor.wegkurve.konflikt.jemand", { wann })
            : t("wegeditor.wegkurve.konflikt.wer", { wer: meldung.wer, wann });
    }
    return meldung.satz;
}

/**
 * Die Sätze von „Neuer Weg“, die nennen, was entsteht (Plan Fluss/Bach; Befund der Hauptorchestrierung auf der Stage, 2026-10-20: die
 * Leiste sagte auch beim Fluss „Neuer Weg“ und „Ein Weg braucht …“). Je Art ein ganzer Satz in jeder Sprache, nie ein eingesetztes Wort:
 * Geschlecht und Fall wechseln mit der Art („nouvelle rivière“, „nowy strumień“).
 */
const NEU_SAETZE = {
    weg: {
        titel: "wegeditor.neu",
        frage: "wegeditor.neu.frage",
        zuWenig: "wegeditor.neu.grund.zuWenig",
        ende: "wegeditor.neu.schild.ende",
        gespeichert: "wegeditor.neu.gespeichert",
        verworfen: "wegeditor.neu.verworfen",
        serverfehler: "wegeditor.neu.serverfehler",
    },
    fluss: {
        titel: "wegeditor.neu.fluss",
        frage: "wegeditor.neu.fluss.frage",
        zuWenig: "wegeditor.neu.fluss.zuWenig",
        ende: "wegeditor.neu.fluss.ende",
        gespeichert: "wegeditor.neu.fluss.gespeichert",
        verworfen: "wegeditor.neu.fluss.verworfen",
        serverfehler: "wegeditor.neu.fluss.serverfehler",
    },
    bach: {
        titel: "wegeditor.neu.bach",
        frage: "wegeditor.neu.bach.frage",
        zuWenig: "wegeditor.neu.bach.zuWenig",
        ende: "wegeditor.neu.bach.ende",
        gespeichert: "wegeditor.neu.bach.gespeichert",
        verworfen: "wegeditor.neu.bach.verworfen",
        serverfehler: "wegeditor.neu.bach.serverfehler",
    },
} as const satisfies Record<PathCreateArt, Record<string, MessageKey>>;

/** Ein Satz von „Neuer Weg“ für das, was entsteht (Weg, Fluss, Bach). */
export const neuerWegSatz = (art: PathCreateArt, satz: keyof (typeof NEU_SAETZE)["weg"]): MessageKey =>
    NEU_SAETZE[art][satz];

/** Woher der neue Weg kommt, als Objekt der Leiste („ab Gareth“, „ab einem Wegknoten“, „ab freier Stelle“). */
export function neuerWegVon(von: NeuerWegLauf["von"]): string {
    if (von === undefined || von.art === "frei") return t("wegeditor.neu.abFrei");
    if (von.art === "ort") return t("wegeditor.neu.ab", { name: von.name });
    const name = pathReaderName(von.name, "");
    return name === null ? t("wegeditor.neu.abKnoten") : t("wegeditor.neu.ab", { name });
}

/** Eine Ecke oder Kante einer Fläche, an der ein neuer Fluss einrastet (Vali 2026-11-08): wie das Schild von „Neue Fläche“. */
function flaechenZiel(ziel: AnlegenZeiger["treffer"]["ziel"]): string {
    const kante = ziel.art === "kante";
    return ziel.name.trim() === ""
        ? t(kante ? "neueFlaeche.schild.kanteOhneName" : "neueFlaeche.schild.eckeOhneName")
        : t(kante ? "neueFlaeche.schild.kante" : "neueFlaeche.schild.ecke", { name: ziel.name });
}

/** Das Schild am Ziel beim Zeichnen: oben das Ziel, darunter, was der Klick dort tut (R9, R12); an einer Fläche wie „Neue Fläche“. */
export function neuerWegSchild(zeiger: AnlegenZeiger, art: PathCreateArt = "weg"): { name: string; tut: string } {
    const { ziel } = zeiger.treffer;
    const hatNamen = ziel.art === "ort" || ziel.art === "gipfel";
    const wegName = hatNamen ? null : pathReaderName(ziel.name, "");
    const name = hatNamen
        ? ziel.name
        : ziel.stelle === undefined
          ? flaechenZiel(ziel)
          : ziel.art === "kante"
            ? t("neueFlaeche.schild.kante", { name: wegName ?? t("infoPanel.unnamed.Flussweg") })
            : wegName === null
              ? t("wegeditor.neu.schild.knoten")
              : t("wegeditor.neu.schild.stuetzpunkt", { name: wegName });
    const tut =
        zeiger.lage === "anfang"
            ? t("wegeditor.neu.schild.anfang")
            : zeiger.tut === "beenden"
              ? t(neuerWegSatz(art, "ende"))
              : t("wegeditor.neu.schild.anschluss");
    return { name, tut };
}

/** Warum „Fertig“ beim neuen Weg, Fluss oder Bach nicht geht. */
export const neuerWegGrund = (grund: AnlegenGrund, art: PathCreateArt = "weg"): string =>
    grund === "zuWenig" ? t(neuerWegSatz(art, "zuWenig")) : t("wegeditor.neu.grund.aufeinander");

/** Die Meldung nach dem Anlegen: angelegt samt Anschlüssen (aus der Quittung), abgelehnt, abgewiesen, verworfen. */
export function neuerWegMeldungText(meldung: NeuerWegMeldung): string {
    const art = meldung.anlage ?? "weg";
    if (meldung.art === "gespeichert") return `${t(neuerWegSatz(art, "gespeichert"))} ${endenText(meldung.enden)}`;
    if (meldung.art === "abgewiesen") return neuerWegGrund(meldung.grund, art);
    if (meldung.art === "verworfen") return t(neuerWegSatz(art, "verworfen"));
    if (meldung.art === "ladefehler") return t("wegeditor.neu.ladefehler");
    if (meldung.art === "serverfehler")
        return meldung.status === 0
            ? t("wegeditor.neu.keineAntwort")
            : t(neuerWegSatz(art, "serverfehler"), { status: String(meldung.status) });
    return meldung.satz;
}

/**
 * Eine Absage des Servers zu den weiteren Straßennamen (WI-0302) als Satz in der Sprache der Seite: ein Name ist der Hauptartikel des Wegs
 * (`ist_hauptartikel`), oder die Liste ist so nicht zu speichern (`validation_failed` am Feld `weitere`: ein Artikel, den es nicht gibt, zu viele).
 * `undefined`: eine andere Absage, ihr Satz bleibt.
 */
export function weitereAbsageSatz(fehler: {
    readonly code: string;
    readonly details?: Readonly<Record<string, unknown>> | undefined;
}): string | undefined {
    if (fehler.code === "ist_hauptartikel") return t("wegeditor.weitere.fehler.hauptartikel");
    const feld = fehler.details?.["field"];
    if (fehler.code === "validation_failed" && typeof feld === "string" && /(^|\.)weitere$/u.test(feld))
        return t("wegeditor.weitere.fehler.ungueltig", { n: PATH_WEITERE_MAX });
    return undefined;
}

/**
 * Die weiteren Straßennamen eines Abschnitts im Verlauf (WI-0302; Protokollfeld `weitere`, vorher und nachher als Liste `[{ key, name }]`): die
 * Namen mit Komma, ohne Namen der Schlüssel; eine leere Liste heißt „keine“.
 */
export function weitereNamenText(liste: readonly unknown[]): string {
    const namen = liste.flatMap((eintrag) => {
        const { key, name } = (eintrag ?? {}) as { key?: unknown; name?: unknown };
        if (typeof name === "string" && name.trim() !== "") return [name];
        return typeof key === "string" ? [key] : typeof eintrag === "string" ? [eintrag] : [];
    });
    return namen.length === 0 ? t("wegeditor.weitere.keine") : namen.join(", ");
}
