import type { MapHistoryEntry } from "@avesmaps3d/shared";
import { formatNumber, t, tPlural } from "../i18n/i18n";
import { buendelZaehlung, type Buendel } from "./aenderung-gruppen";
import { zeilenFeldNamen } from "./aenderung-felder";
import {
    eintragsKreis,
    serienGroesse,
    serienName,
    serienEnden,
    serienZustand,
    type Kreis,
    type SerienZeile,
} from "./aenderung-modell";
import { kreisName, kreisTitel, kurzesDatum, objekteText, quelle, uhrzeit, wer } from "./aenderung-text";
import { eintragsTitel } from "./aenderung-titel";

/**
 * Was eine Zeile der Liste von „Änderungen“ sagt, ohne Vue (WI-0265 B10; Vorlage `review/wi-0265/aenderungen-neu.html`): HÖCHSTENS ZWEI ZEILEN, alle gleich gebaut.
 *
 * - **Zeile 1:** Kreis (der Zustand, im EINEN Wortschatz als Tooltip), Titel mit Auslassung, Uhrzeit ohne Zeitzone (die Zeitzone steht nur im Detail).
 * - **Zeile 2:** die Person (ihr Anzeigename, auch bei der eigenen Änderung; unter „Meine“ weggelassen), die Quelle nur wenn nicht der Editor (ein Etikett), die Felder in einer Zeile mit Auslassung, „n Objekte“ nur bei mehr als einem.
 *   ⊕ und ▸ am Ende zeichnet das Bauteil.
 *
 * Eine Operation, eine Arbeitsserie und ein Bündel gleichen Läufe sind dieselbe Zeile; sie unterscheiden sich in dem, was sie hier sagen.
 */

export interface ZeilenAngaben {
    readonly kreis: Kreis | undefined;
    /** Der Name des Kreises (Tooltip und Vorleser) im Wortschatz des Zustands. */
    readonly kreisName: string;
    readonly titel: string;
    /** Die Uhrzeit rechts in Zeile 1 (leer, wo der Tag sie schon trägt, etwa beim Bündel). */
    readonly zeit: string;
    /** Der Anzeigename der Person; fehlt unter „Meine“, beim System und wo die Zeile ihn nicht braucht. */
    readonly person: string | undefined;
    /** Die Spanne einer Serie („16:05–17:12“). */
    readonly bereich: string | undefined;
    /** Die Quelle als Etikett, wo sie nicht der Editor ist. */
    readonly etikett: string | undefined;
    readonly felder: string;
    readonly objekte: string | undefined;
    /** Ein Zusatz am Ende der Zeile (bei einer Serie: wie viele ihrer Mitglieder zum Filter passen). */
    readonly hinweis: string | undefined;
}

export interface ZeilenOptionen {
    /** Die Liste zeigt nur eigene Änderungen („Meine“): Dann steht die Person nirgends. */
    readonly meine: boolean;
    /** Ein anderer Titel als der der Operation (ein Mitglied einer Serie: „Schritt 3/8: Kamm 2 verschoben“). */
    readonly titel?: string | undefined;
    /** Wie die Uhrzeit aussieht; ohne Angabe nur die Uhrzeit. */
    readonly zeit?: ((at: string) => string) | undefined;
    /** Die Person weglassen (die Mitglieder einer Serie: die Kopfzeile nennt sie). */
    readonly ohnePerson?: boolean | undefined;
    /** Das Etikett der Quelle weglassen (die Läufe eines Bündels, die Mitglieder einer Serie). */
    readonly ohneEtikett?: boolean | undefined;
}

/**
 * Wer in der Zeile steht: der Anzeigename der Person, auch bei der eigenen Änderung (keine Anrede, Guide §24; WI-0265 B10c) und ohne den Zusatz „(eigene Änderung)“ von `wer`; das System nicht.
 * Ein Agent steht mit seiner Freigabe da.
 */
export function personKurz(actor: MapHistoryEntry["actor"]): string | undefined {
    if (actor.kind === "system") return undefined;
    if (actor.kind === "person") return actor.name ?? t("verlauf.jemand");
    return wer(actor);
}

/**
 * Die Quelle als Etikett: nichts für den Editor, sonst ihr Wort (Wiki, Import, Rücknahme …). Eine Änderung des Editors, die aus einem Community-Vorgang geöffnet wurde, trägt dessen Nummer; der Link dazu steht im Detail
 * (hier wäre es ein Knopf im Knopf).
 */
export function quelleEtikett(eintrag: {
    readonly source: MapHistoryEntry["source"];
    readonly communityVorgang?: string | undefined;
}): string | undefined {
    if (eintrag.source !== "editor") return quelle(eintrag.source);
    return eintrag.communityVorgang;
}

/** Die geänderten Felder einer Operation in einer Zeile: bei einem Ort seine Felder, sonst alle der Gegenstände, jedes einmal. */
export function feldAngabe(eintrag: Pick<MapHistoryEntry, "objects">): string {
    const ort = eintrag.objects.find((gegenstand) => gegenstand.kind === "place");
    const quellen = ort === undefined ? eintrag.objects : [ort];
    return [
        ...new Set(quellen.flatMap((gegenstand) => zeilenFeldNamen(gegenstand.kind, Object.keys(gegenstand.changes)))),
    ].join(", ");
}

/** „Schritt 3/8: Kamm 2 verschoben“: der Gegenstand steht schon in der Kopfzeile der Serie. */
export function mitgliedTitel(eintrag: MapHistoryEntry): string {
    const text = eintragsTitel(eintrag).replace(/^[^:]+:\s*/, "");
    return eintrag.series === undefined
        ? text
        : `${t("aenderungen.serie.schritt", { nr: eintrag.series.position, gesamt: eintrag.series.size })}: ${text}`;
}

export function eintragsAngaben(eintrag: MapHistoryEntry, optionen: ZeilenOptionen): ZeilenAngaben {
    const kreis = eintragsKreis(eintrag.status);
    return {
        kreis,
        kreisName: kreis === undefined ? "" : kreisTitel(kreis),
        titel: optionen.titel ?? eintragsTitel(eintrag),
        zeit: (optionen.zeit ?? uhrzeit)(eintrag.at),
        person: optionen.meine || optionen.ohnePerson === true ? undefined : personKurz(eintrag.actor),
        bereich: undefined,
        etikett: optionen.ohneEtikett === true ? undefined : quelleEtikett(eintrag),
        felder: feldAngabe(eintrag),
        objekte: objekteText(eintrag.objects.length),
        hinweis: undefined,
    };
}

/** Die Spanne einer Serie: „16:05–17:12“; reicht sie über einen Tag, mit Datum. */
function spanne(erstes: string, letztes: string): string {
    const gleicherTag = new Date(erstes).toDateString() === new Date(letztes).toDateString();
    const kurz = (at: string): string => (gleicherTag ? uhrzeit(at) : `${kurzesDatum(at)} ${uhrzeit(at)}`);
    return `${kurz(erstes)}–${kurz(letztes)}`;
}

export function serienAngaben(zeile: SerienZeile, optionen: Pick<ZeilenOptionen, "meine">): ZeilenAngaben {
    const enden = serienEnden(zeile);
    const groesse = serienGroesse(zeile);
    const zustand = serienZustand(zeile);
    return {
        kreis: zustand.kreis,
        kreisName: kreisTitel(zustand.kreis, { zurueck: zustand.zurueck, gesamt: zeile.mitglieder.length }),
        titel: tPlural("aenderungen.serie.kopf", groesse, {
            name: serienName(zeile) ?? "–",
            n: formatNumber(groesse, 0),
        }),
        zeit: uhrzeit(enden.letztes.at),
        person: optionen.meine ? undefined : personKurz(enden.letztes.actor),
        bereich: spanne(enden.erstes.at, enden.letztes.at),
        etikett: quelleEtikett(enden.letztes),
        felder: [
            ...new Set(zeile.mitglieder.flatMap((mitglied) => feldAngabe(mitglied).split(", ").filter(Boolean))),
        ].join(", "),
        objekte: undefined,
        hinweis:
            zeile.mitglieder.length < groesse
                ? t("aenderungen.serie.imFilter", {
                      n: formatNumber(zeile.mitglieder.length, 0),
                      gesamt: formatNumber(groesse, 0),
                  })
                : undefined,
    };
}

/** „Wiki-Abgleich · 2 Läufe · 610 Felder“ / „Import · 1 Lauf · 18 Objekte“: die gedämpfte Zeile eines Tages. */
export function buendelTitel(buendel: Buendel): string {
    const z = buendelZaehlung(buendel);
    const name = t(buendel.quelle === "wikisync" ? "aenderungen.buendel.wiki" : "aenderungen.buendel.import");
    const laeufe = tPlural("aenderungen.buendel.laeufe", z.laeufe, { n: formatNumber(z.laeufe, 0) });
    const summe =
        buendel.quelle === "wikisync"
            ? tPlural("aenderungen.buendel.felder", z.felder, { n: formatNumber(z.felder, 0) })
            : tPlural("aenderungen.zeile.objekte", z.objekte, { n: formatNumber(z.objekte, 0) });
    return `${name} · ${laeufe} · ${summe}`;
}

export function buendelAngaben(buendel: Buendel): ZeilenAngaben {
    return {
        kreis: "gesperrt",
        kreisName: kreisName("gesperrt"),
        titel: buendelTitel(buendel),
        zeit: "",
        person: undefined,
        bereich: undefined,
        etikett: undefined,
        felder: "",
        objekte: undefined,
        hinweis: undefined,
    };
}

/**
 * Steht das ↺ beim Überfahren am Zeilenende (Vorlage Variante B, vom Betreiber am 2026-11-01 gewählt: „↺ in der Zeile -> B“)? Nur wo es etwas zurückzunehmen gibt (ein Angebot ohne Sperre), und am Telefon nie:
 * Dort gibt es kein Überfahren, und die Zeile hat keinen Platz. Das ↺ schreibt nie selbst; es öffnet die Zeile und die Rückfrage darin.
 */
export function zeigtRueckAmEnde(optionen: {
    readonly phone: boolean;
    readonly hatAngebot: boolean;
    readonly gesperrt: boolean;
}): boolean {
    return !optionen.phone && optionen.hatAngebot && !optionen.gesperrt;
}

/** Das ⊕ am Ende der Zeile: wohin es führt, steht beim Aufrufer; hier nur, wie es heißt und ob die Überlagerung der Zeile gerade auf der Karte liegt. */
export interface ZeilenOrt {
    /** Der Name des Knopfs (Tooltip und Vorleser). */
    readonly titel: string;
    readonly gedrueckt: boolean;
    /** Was ⊕ kurz sagt („Keine Lage bekannt“). */
    readonly status: string | undefined;
    readonly testid: string;
}

/**
 * Genau ein Ort und kein Löschen: Dann bleibt das ⊕ der Zeile, was es seit E17 war (es wählt den Ort und zeigt ihn); ⚙ „Den Ort im Ortseditor öffnen“ ist im Detail aufgegangen (⚙ „Im Objektverlauf zeigen“ öffnet denselben Ort).
 * Jede andere Zeile mit gelieferten Gegenständen führt ⊕ „Auf der Karte zeigen“ (B9, `aenderung-karte-zeigen.ts`), auch die mit mehreren Orten (ein Wiki-Lauf): Es fliegt auf den Kasten um alle.
 * Ein „Ganz löschen“ (`place.delete`, E22) trägt das Zeichen des Ortes nicht (der Ort liegt dann nicht mehr auf der Karte), wohl aber das ⊕ „Auf der Karte zeigen“.
 */
export function einzelnerOrt(
    eintrag: Pick<MapHistoryEntry, "operation" | "objects">,
): MapHistoryEntry["objects"][number] | undefined {
    if (eintrag.operation === "place.delete") return undefined;
    const orte = eintrag.objects.filter((gegenstand) => gegenstand.kind === "place");
    return orte.length === 1 ? orte[0] : undefined;
}
