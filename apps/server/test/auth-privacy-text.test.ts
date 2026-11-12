import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    BESUCH_METRIKEN,
    KANAL_AUFBEWAHRUNG_TAGE,
    LEGAL_NOTICES,
    RESPONSIBILITY_MAX,
    WETTER_GERAETE,
    WETTER_GPU_FAMILIEN,
    WETTER_METRIKEN,
} from "@avesmaps3d/shared";
import { AUDIT_DETAIL_KEYS } from "../src/auth/audit.ts";
import { DEFAULT_SESSION, sessionCookieName } from "../src/auth/config.ts";
import { FLOW_MINUTES } from "../src/auth/discord-flow.ts";
import { SESSION_COOKIE_MAX_AGE_S } from "../src/auth/plugin.ts";
import { DEPARTED_NAME } from "../src/auth/dissolve.ts";
import { truncatedAddress } from "../src/log-address.ts";
import { TEST_AUTH } from "./support/auth-fixture.ts";

/**
 * Der Datenschutztext beschreibt, was der Code tut (WI-0120 A12, Entwurf `WI-0120-datenschutz-entwurf.md`: „Jede Zahl steht im
 * Code. Ändert sich eine davon, ändert sich dieser Text mit.“). Wer eine Laufzeit, eine Frist oder den Namen des Cookies ändert,
 * kommt hier vorbei, und der Text geht mit der Änderung zur Abnahme an den Betreiber. Geprüft wird die maßgebliche deutsche Fassung
 * der Hinweise als fortlaufender Text; ihre Übersetzungen tragen dieselben Zahlen (Probe beim Zusammenbau, `hinweise-sprachen.test.ts`).
 */

const WORDS: Record<number, string> = { 7: "sieben", 10: "zehn" };

function texteVon(wert: unknown): string[] {
    if (typeof wert === "string") return [wert];
    if (Array.isArray(wert)) return wert.flatMap(texteVon);
    if (wert !== null && typeof wert === "object") return Object.values(wert).flatMap(texteVon);
    return [];
}

/** Der ganze Text der Hinweise, ohne Auszeichnung: Ein Satz darf einen Verweis tragen und zählt trotzdem als Satz. */
const roh = texteVon(LEGAL_NOTICES.hinweise).join(" ");
const de = roh
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replaceAll("**", "")
    .replaceAll(" ", " ");

describe("Datenschutz: Zahlen und Namen aus dem Code", () => {
    it("🔴 Sitzungs-Cookie und Discord-Umweg: Name und Laufzeit wie in `config.ts` und `discord-flow.ts`", () => {
        const cookie = sessionCookieName({ ...TEST_AUTH, insecureCookie: false });
        expect(de).toContain(`(${cookie})`);
        expect(de).toContain(`höchstens ${WORDS[FLOW_MINUTES]!} Minuten`);
    });

    /**
     * Hotfix 2026-10-10: Eine Sitzung hat keine Frist mehr (`session-store.ts` `SESSION_UNBOUNDED`), das Cookie lebt höchstens so
     * lange, wie der Browser es lässt (`SESSION_COOKIE_MAX_AGE_S`). Text vom Betreiber abgenommen 2026-10-10, wörtlich: „1 A“.
     */
    it("🔴 Laufzeit der Sitzung: keine Frist, das Cookie höchstens `SESSION_COOKIE_MAX_AGE_S` (400 Tage)", () => {
        const days = SESSION_COOKIE_MAX_AGE_S / (24 * 60 * 60);
        expect(de).toContain("eine feste Laufzeit hat sie nicht");
        expect(de).toContain(`höchstens ${days} Tage`);
    });
    it("der Notzugang bleibt 60 Minuten (`recoveryMinutes`), die Sitzung hat keine Frist mehr in `config.ts`", () => {
        expect(DEFAULT_SESSION.recoveryMinutes).toBe(60);
        expect(Object.keys(DEFAULT_SESSION)).not.toContain("maxDays");
        expect(Object.keys(DEFAULT_SESSION)).not.toContain("idleDays");
    });

    it("🔴 Fristen der Aufbewahrung, wie `purge_expired()` sie löscht (Migration 0082)", () => {
        const purge = readFileSync(new URL("../migrations/0082_auth_retention.sql", import.meta.url), "utf8");
        const days = (pattern: RegExp): string => pattern.exec(purge)?.[1] ?? "fehlt";
        const events = days(/AND at < now\(\) - interval '(\d+) days'/u);
        const ips = days(/ip_prefix IS NOT NULL AND at < now\(\) - interval '(\d+) days'/u);
        const expired = days(/oauth_flow WHERE expires_at < now\(\) - interval '(\d+) days'/u);
        expect(de).toContain(`Fehlversuche im Protokoll werden nach ${events} Tagen gelöscht`);
        expect(de).toContain(`IP-Adresse nach ${ips} Tagen geleert`);
        expect(de).toContain(`werden ${expired} Tage nach ihrem Ende gelöscht`);
    });

    /**
     * WI-0063 Restauftrag 2026-10-13 Abschnitt D, nachgezogen 2026-11-04 (Claudio): Nginx, Journal, syslog und die Sperrliste sind auf 14 Tage begrenzt, Pino kürzt die Adresse (`log-address.ts`).
     */
    it("🔴 Logaufbewahrung: rund 14 Tage, die Kürzung wie `truncatedAddress`", () => {
        expect(de).toContain("werden nach rund 14 Tagen gelöscht");
        expect(de).not.toMatch(/nach kurzer Zeit/u);
        // Die Form der Kürzung ist keine Behauptung: `log-address.ts` kürzt genau so.
        expect(truncatedAddress("203.0.113.42")).toBe("203.0.113.0");
        expect(truncatedAddress("2001:db8:1234:5678::1")).toBe("2001:db8:1234::");
        expect(de).toContain("IPv4 ohne das letzte Byte, IPv6 auf die ersten 48 Bit");
    });

    /**
     * Dieselbe Prüfung für die Fristen, die kein Anmeldeprotokoll sind: der Betreiber-Kanal (WI-0124, Migration 0106) und die
     * Benachrichtigungen (WI-0136, Migration 0107). Sie standen im Text bisher nicht, obwohl sie Personenbezug tragen.
     */
    it("🔴 Redaktionsprotokoll, Kanal und Benachrichtigungen: die Fristen aus Code und Migration 0107", () => {
        const melden = readFileSync(new URL("../migrations/0107_benachrichtigung.sql", import.meta.url), "utf8");
        const gelesen = /COALESCE\(beantwortet_at, gelesen_at\) < now\(\) - interval '(\d+) days'/u.exec(melden)?.[1];
        const erstellt = /erstellt_at < now\(\) - interval '(\d+) days'/u.exec(melden)?.[1];
        expect(de).toContain("Redaktionsprotokoll");
        expect(de).toContain(`${KANAL_AUFBEWAHRUNG_TAGE} Tage nach ihrer Abnahme gelöscht`);
        expect(de).toContain(
            `${gelesen} Tage nach dem Lesen oder Beantworten gelöscht, in jedem Fall nach ${erstellt} Tagen`,
        );
        // Was der Text verspricht, tut `redact_person_media()`: Freitext und Dateinamen, nicht die Person selbst.
        const media = readFileSync(new URL("../migrations/0088_media_redact_person.sql", import.meta.url), "utf8");
        expect(media).toContain("UPDATE public.media_audit_event e");
        expect(media).toMatch(/legacy_file_name|file_name|dateiname/iu);
        expect(de).toContain("Begründungen der Person darin geschwärzt");
        expect(de).toContain("Dateinamen ihrer Hochladungen entfernt");
    });

    it("🔴 Discord: nur `identify`, der Verweis auf Discords eigene Erklärung, Anmeldung auch ohne Discord", () => {
        expect(de).toContain("Berechtigung identify");
        // Anbieter laut discord.com/privacy (Text abgenommen 2026-11-05): in der EU Discord Netherlands BV, Daten auch in die USA.
        expect(de).toContain("Discord Netherlands BV");
        expect(de).toContain("Discord Inc. in die USA");
        expect(de).toContain("auch ohne Discord");
        // Discords Zwei-Faktor-Angabe wird nicht gespeichert (Betreiber 2026-10-10: „B: nicht mehr speichern“, Text abgenommen).
        expect(de).toContain("übernimmt davon nur diese drei");
        expect(de).not.toMatch(/Zwei-Faktor/u);
        expect(roh).toContain("https://discord.com/privacy");
    });

    it("🔴 Konto auflösen: verspricht nur, was `auth aufloesen` tut, und das Protokoll trägt keinen Namen", () => {
        expect(de).toContain("Platzhalter");
        expect(de).toContain("Verwaltungshandlungen bleiben im Protokoll stehen");
        // Der Eintrag „Konto aufgelöst“ zählt nur; ein Name, alt oder neu, steht nie in seinen Einzelheiten.
        for (const key of AUDIT_DETAIL_KEYS["person.departed"]) expect(key).not.toMatch(/name|from|to$|label/iu);
    });

    it("🔴 „Verantwortlich für“ (WI-0133, Text abgenommen 2026-10-10: „datenschutztext passt“): Länge aus der Regel, Auflösen leert", () => {
        expect(de).toContain(`höchstens ${RESPONSIBILITY_MAX} Zeichen`);
        expect(de).toContain("nicht ihren Inhalt");
        expect(de).toContain("die Angabe „Verantwortlich für“");
        // Das Protokoll trägt nie den Text (WI-0133).
        for (const key of AUDIT_DETAIL_KEYS["person.responsibility_changed"])
            expect(key).not.toMatch(/text|value|responsible_for/iu);
    });

    /**
     * Bauschritt B (Betreiber 2026-10-09: „1 B, englisch passt, Ehemalige Person lassen“): Was `redact_person_events()` schwärzt,
     * nennt der Text, Art für Art, und nichts darüber hinaus. Kommt eine Art in die Tafel der Funktion, fällt dieser Test, bis der
     * Text sie nennt (und der Betreiber den geänderten Text abgenommen hat).
     */
    it("🔴 Schwärzen beim Auflösen: jede Art aus Migration 0083 steht im Text", () => {
        const redact = readFileSync(new URL("../migrations/0083_auth_redact_person.sql", import.meta.url), "utf8");
        const table = /personal \(action, key\) AS \(\s*VALUES([\s\S]*?)\n\s*\),/u.exec(redact)?.[1] ?? "";
        const actions = [...new Set([...table.matchAll(/\('([a-z_.]+)', '[A-Za-z]+'\)/gu)].map((match) => match[1]!))];
        const wording: Record<string, string> = {
            "person.renamed": "frühere Anzeigenamen",
            "discord.linked": "der Discord-Name",
            "passkey.registered": "Bezeichnungen der Passkeys",
            "passkey.revoked": "Bezeichnungen der Passkeys",
            "passkey.counter_regression": "Bezeichnungen der Passkeys",
            "invitation.created": "die Notiz zu ihrer Einladung",
            "person.locked": "Gründe einer Sperre",
            "capability.granted": "eines Sonderrechts",
            "capability.revoked": "eines Sonderrechts",
            "legacy.mapped": "Legacy-Name samt Begründung",
            "legacy.unmapped": "Legacy-Name samt Begründung",
        };
        expect(actions.sort()).toEqual(Object.keys(wording).sort());
        for (const action of actions) expect(de, action).toContain(wording[action]!);
        // Gerät und IP gehen an ihren eigenen Einträgen, nicht an denen anderer, die an ihr handelten.
        expect(redact).toContain("client_label = CASE WHEN p.trace THEN NULL");
        expect(redact).toContain("ip_prefix = CASE WHEN p.trace THEN NULL");
        expect(de).toContain("in ihren eigenen Einträgen außerdem Gerätebezeichnung und gekürzte IP-Adresse");
        // Der Platzhalter bleibt „Ehemalige Person“ („Ehemalige Person lassen“), auch neben dem englischen Text.
        expect(DEPARTED_NAME).toBe("Ehemalige Person");
    });

    /**
     * WI-0288 (Betreiber 2026-11-08: „bisschen was zur nutzung und bisschen was zur performacnce des experimentellen wetters“): Der Satz
     * über das experimentelle Wetter nennt, was `besucher-wetter.ts` wirklich sendet - Gerät Rechner oder Telefon, die Familie der Grafikkarte
     * mit den beiden Beispielen, die es als Familie gibt, und keinen Namen der Karte.
     */
    it("🔴 Wetterstatistik: der Satz nennt, was der Browser meldet, und nur Gerät, Klassen und Familie", () => {
        expect(de).toContain("Wer das experimentelle Wetter benutzt, dessen Browser meldet anonym und in Summen");
        expect(de).toContain("welche Wetterschalter ein- oder ausgeschaltet werden");
        expect(de).toContain("ob es ein Rechner oder ein Telefon ist");
        expect(de).toContain("„NVIDIA“ oder „Adreno“");
        expect(de).toContain("ohne Bezug zur Person");
        expect([...WETTER_GERAETE]).toEqual(["rechner", "telefon"]);
        expect(WETTER_GPU_FAMILIEN).toContain("nvidia");
        expect(WETTER_GPU_FAMILIEN).toContain("adreno");
        // Die Zeilen tragen nur diese sieben Metriken; eine achte bräuchte einen neuen Satz.
        expect(WETTER_METRIKEN).toHaveLength(7);
        for (const metrik of WETTER_METRIKEN) expect(BESUCH_METRIKEN).toContain(metrik);
    });
});
