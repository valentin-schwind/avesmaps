import { describe, expect, it } from "vitest";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";

/**
 * Nie Anrede, app-weit (WI-0076 Folge; Betreiber 2026-10-04: „Insgesamt will ich nicht, dass man die spieler mit "Du"
 * oder "Sie" anspricht, sondern einfach die regeln formuliert. ich mag das überhaupt nicht, wenn ich auf einer webseite
 * angesprochen werde“). Guide §24 „Grundton“.
 *
 * Geprüft wird JEDER Text der Sprachtafeln: kein Du, kein Sie, kein „you“, keine Bitte und keine Aufforderung an den
 * Leser in einem Satz. Aufschriften von Knöpfen und Menüs bleiben, was sie sind (deutsch Infinitiv „Ziel hinzufügen“,
 * englisch „Add destination“); sie sprechen niemanden an, sie benennen eine Handlung (§24 „Knöpfe und Menüeinträge“).
 */

/**
 * Ausnahmen, je mit Präfix und Grund; erlaubt sind nur zitierte fremde Texte (Wiki, Rechtstexte, die der Betreiber
 * abnimmt), und eine Ausnahme fällt, sobald sie nicht mehr nötig ist. Heute keine: Die zwei englischen Fußnoten des
 * Kostenkastens mit „You sleep …“ hat dessen Sitzung am 2026-10-04 umformuliert (`759cc523`, WI-0065 Nachtrag 4).
 */
const AUSNAHMEN: readonly { prefix: string; grund: string }[] = [];

const ausgenommen = (key: string): boolean => AUSNAHMEN.some((ausnahme) => key.startsWith(ausnahme.prefix));
const plain = (text: string): string =>
    text
        .replace(/\{\w+\}/g, "")
        .replace(/\]\(https?:[^)]*\)/g, "]")
        .replace(/\*\*/g, "");

const DE_ANREDE = /\b(du|dich|dir|dein\w*|euch|euer\w*|Ihnen)\b/i;
/** „Sie“ und „Ihr“ großgeschrieben mitten im Satz sind die Höflichkeitsform; am Satzanfang ist „Sie“ oft „die Suche“. */
const DE_HOEFLICH = /[a-zäöüß,;]\s+(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)\b/;
const DE_AUFFORDERUNG =
    /\bbitte\b|(^|[.!?:;–—]\s+|- )(Klicke|Klick|Wähle|Tippe|Drücke|Ziehe|Zieh|Nimm|Gib|Schau|Probiere|Versuche|Prüfe|Wechsle|Öffne|Setze|Lege|Halte|Achte|Beachte)\b/i;
const EN_ANREDE = /\b(you|your|yours|yourself)\b/i;
/** „please“ überall; eine Aufforderung hinter einem Gedankenstrich („– set a route first“) ist ein Satz an den Leser. */
const EN_AUFFORDERUNG =
    /\bplease\b|[—–;]\s+(now\s+)?(set|choose|pick|select|click|tap|try|check|use|drag|open|enter)\b/i;

describe("Nie Anrede, app-weit", () => {
    const keys = Object.keys(de) as (keyof typeof de)[];

    it("prüft alle Schlüssel beider Tafeln", () => {
        expect(keys.length).toBeGreaterThan(500);
        expect(Object.keys(en).sort()).toEqual([...keys].sort());
    });

    it("🔴 deutsch: kein Du, kein Sie, keine Bitte, keine Aufforderung", () => {
        for (const key of keys.filter((key) => !ausgenommen(key))) {
            const text = plain(de[key]);
            expect(text, key).not.toMatch(DE_ANREDE);
            expect(text, key).not.toMatch(DE_HOEFLICH);
            expect(text, key).not.toMatch(DE_AUFFORDERUNG);
        }
    });

    it("🔴 englisch: kein „you“, kein „please“", () => {
        for (const key of keys.filter((key) => !ausgenommen(key))) {
            const text = plain(en[key]);
            expect(text, key).not.toMatch(EN_ANREDE);
            expect(text, key).not.toMatch(EN_AUFFORDERUNG);
        }
    });

    it("die Prüfung schlägt an: Gegenproben mit Anrede", () => {
        expect("Wie schnell du vorankommst").toMatch(DE_ANREDE);
        expect("Dein Routenplaner").toMatch(DE_ANREDE);
        expect("Hier können Sie wählen").toMatch(DE_HOEFLICH);
        expect("Bitte den Reisebeginn prüfen.").toMatch(DE_AUFFORDERUNG);
        expect("Kein Landweg – bitte einen Punkt wählen.").toMatch(DE_AUFFORDERUNG);
        expect("Nichts zu teilen – setze zuerst eine Route.").toMatch(DE_AUFFORDERUNG);
        expect("Nothing to share yet – set a route first.").toMatch(EN_AUFFORDERUNG);
        expect("Map point set — now pick a destination.").toMatch(EN_AUFFORDERUNG);
        expect("Fertig. Klicke auf den Knopf").toMatch(DE_AUFFORDERUNG);
        expect("Your route planner").toMatch(EN_ANREDE);
        expect("Please try again later.").toMatch(EN_AUFFORDERUNG);
        // Keine Anrede: die Suche als „Sie“ am Satzanfang, „ihr“ als Besitz, ein Knopf im Infinitiv.
        expect("- Sie meidet Wege").not.toMatch(DE_HOEFLICH);
        expect("Jede Wegart behält ihr Tempo.").not.toMatch(DE_ANREDE);
        expect("Ziel hinzufügen").not.toMatch(DE_AUFFORDERUNG);
    });
});
