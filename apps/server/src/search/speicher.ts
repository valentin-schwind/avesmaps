import { leereVorkommenSpeicher } from "../vorkommen/index.ts";
import { leereBeispiele } from "./beispiele.ts";
import { leereSprachIndex } from "./sprachen-index.ts";
import { leereVorkommenIndex } from "./vorkommen-index.ts";
import { leereZielSpeicher } from "./vorkommen-suche.ts";
import { leereZielKatalog } from "./ziele-katalog.ts";

/**
 * Leert alle Zwischenspeicher der Vorkommen und Sprachen in der Suche (WI-0257, S3a; WI-0261 S5c): den Index der Einträge und der Sprachen, den Katalog der Ziele, die Antworten der kurzen Anfragen, die Beispiele und das,
 * was darunter liegt (Treffer je Eintrag, Leuchten, Regeln im Prozess). Für Tests und für einen Betrieb, der nach einem Eingriff an der Datenbank neu rechnen will.
 */
export function leereSuchSpeicher(): void {
    leereVorkommenSpeicher();
    leereVorkommenIndex();
    leereSprachIndex();
    leereZielKatalog();
    leereZielSpeicher();
    leereBeispiele();
}
