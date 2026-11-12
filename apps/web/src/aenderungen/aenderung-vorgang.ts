import { isMessageKey, t, type MessageKey } from "../i18n/i18n";
import { artName } from "./aenderung-text";

/**
 * Die Vorgangsnamen der Liste, der Serie und des Details (WI-0265 B5c): Aus `path.reshape`, `place.move` und `landscape.reshape` wird
 * „Kurve geändert“, „Verschoben“ und „Form geändert“. Der Schlüssel der Operation ist ein Name für den Server, kein Wort für Menschen; er
 * steht nur noch im `title` (`vorgangSchluessel`).
 *
 * - **Die Tafel** (`aenderungen.vorgang.*`, in allen neun Sprachtafeln): ein Wort je Handlung (`create`, `move`, `reshape` …) für alle Arten,
 *   dazu die Arten, die ein eigenes Wort brauchen (der Weg hat eine Kurve, die Fläche eine Form: `path.reshape`). Gesucht wird erst der
 *   ganze Schlüssel, dann die Handlung.
 * - **Der Rückfall** für alles, was die Tafel nicht kennt: „Änderung: Weg“ aus der Art vor dem Punkt, oder nur „Änderung“. Nie der Schlüssel.
 */

const SONSTIGE = new Map<string, string>([["remove", "retire"]]);

/** Der Schlüssel der Tafel zu einer Operation, oder `undefined`, wenn die Tafel sie nicht kennt. */
export function vorgangTafelSchluessel(operation: string): MessageKey | undefined {
    const ganz = `aenderungen.vorgang.${operation}`;
    if (isMessageKey(ganz)) return ganz;
    const punkt = operation.indexOf(".");
    const handlung = punkt < 0 ? operation : operation.slice(punkt + 1);
    const eigene = `aenderungen.vorgang.${SONSTIGE.get(handlung) ?? handlung}`;
    return isMessageKey(eigene) ? eigene : undefined;
}

/** Die Art vor dem Punkt (`path` aus `path.reshape`), wenn die Tafel der Arten sie kennt. */
function artVor(operation: string): string | undefined {
    const punkt = operation.indexOf(".");
    if (punkt <= 0) return undefined;
    const art = operation.slice(0, punkt);
    return isMessageKey(`aenderungen.art.${art}`) ? art : undefined;
}

/**
 * Der Name einer Operation, wie Menschen ihn lesen („Verschoben“, „Kurve geändert“); nie ihr Schlüssel. Nennt der Aufrufer die Aktionen ihrer Protokolleinträge
 * (`aktionen`), heißt eine reine Änderung am Gebirge „Gebirge geändert“ statt „Eigenschaften geändert“: Das Gebirge ist eine Teilfläche der Landschaft. Ebenso heißt
 * `territory.retire` „Gelöscht“, wenn das Gebiet selbst still gelegt wurde, und „Von der Karte genommen“, wenn nur seine Flächen gingen (WI-0265 B6b).
 */
export function vorgangName(operation: string, aktionen: readonly string[] = []): string {
    if (aktionen.length > 0 && aktionen.every((aktion) => aktion === "area.gebirge") && operation.endsWith(".update"))
        return t("aenderungen.vorgang.gebirge");
    // Eine Kurve am Weg ist ein `path.update` mit Kurve (früher `path.reshape`): „Kurve geändert“ statt „Eigenschaften geändert“.
    if (operation === "path.update" && aktionen.includes("path.reshaped")) return t("aenderungen.vorgang.path.reshape");
    if (operation === "territory.retire" && aktionen.length > 0)
        return t(
            aktionen.includes("territory.retired") ? "aenderungen.vorgang.delete" : "aenderungen.vorgang.take_off_map",
        );
    // Dasselbe an der Fläche (WI-0265 B6c): Eine Form (mit den Ecken, die Nachbarn mitzog) ist ein `landscape.update` mit `area.reshaped`; allein die Beschriftungen heißen „Beschriftung geändert“.
    if (
        operation === "landscape.update" &&
        aktionen.length > 0 &&
        aktionen.every((aktion) => aktion === "area.reshaped" || aktion === "area.carried")
    )
        return t("aenderungen.vorgang.reshape");
    if (
        operation === "landscape.update" &&
        aktionen.length > 0 &&
        aktionen.every((aktion) => aktion.startsWith("label."))
    )
        return t("aenderungen.vorgang.label");
    const schluessel = vorgangTafelSchluessel(operation);
    if (schluessel !== undefined) return t(schluessel);
    const art = artVor(operation);
    return art === undefined
        ? t("aenderungen.vorgang.unbekannt")
        : t("aenderungen.vorgang.sonst", { art: artName(art) });
}

/** Der Name eines Eintrags: seine Operation, mit den Aktionen seiner Gegenstände. */
export const vorgangVon = (eintrag: {
    readonly operation: string;
    readonly objects: readonly { readonly action: string }[];
}): string =>
    vorgangName(
        eintrag.operation,
        eintrag.objects.map((gegenstand) => gegenstand.action),
    );

/** Der Schlüssel der Operation für den `title`: wer genau wissen will, welche es war, findet ihn dort. */
export const vorgangSchluessel = (operation: string): string => operation;
