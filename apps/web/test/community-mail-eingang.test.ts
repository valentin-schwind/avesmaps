import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MAIL_WIEDER_GEOEFFNET, anhangUrl, type MailAnhang, type VerlaufEintrag } from "@avesmaps3d/shared";
import {
    BILD_INLINE_MAX_BYTES,
    MAIL_HOEHE,
    MAIL_SANDBOX,
    anhangAdressen,
    anhangGrundSatz,
    anhangZeichen,
    baueSrcdoc,
    eingebetteteBilder,
    externSatz,
    groesseSatz,
    mailCsp,
    schaetzeHoehe,
} from "../src/community/mail-ansicht-modell";
import { verlaufZeilen } from "../src/community/meldungen-modell";
import { da } from "../src/i18n/da";
import { de } from "../src/i18n/de";
import { en } from "../src/i18n/en";
import { es } from "../src/i18n/es";
import { fr } from "../src/i18n/fr";
import { setLocale } from "../src/i18n/i18n";
import { it as itTafel } from "../src/i18n/it";
import { nl } from "../src/i18n/nl";
import { pl } from "../src/i18n/pl";
import { sv } from "../src/i18n/sv";

/**
 * Eine eingehende Mail in der Oberfläche ohne Browser (WI-0268 C6b; Bedienkonzept §3.2, Fachkonzept §3.4): die abgeschottete Fläche (Rechte der `iframe`, Inhaltsrichtlinie, „Einmal laden“), die eingebetteten
 * Bilder, die Anhänge mit ihren Verweisen und Gründen, die Verlaufszeile und die Texte in allen neun Sprachtafeln.
 */

afterEach(() => setLocale("de"));

const HERKUNFT = "https://avesmaps.test";
const lesen = (pfad: string): string => readFileSync(fileURLToPath(new URL(pfad, import.meta.url)), "utf8");
/** Der Quelltext ohne Kommentare: Die Erklärungen dürfen die verbotenen Wörter nennen, der Code nicht. */
const ohneKommentare = (pfad: string): string =>
    lesen(pfad)
        .replace(/\/\*[^]*?\*\//gu, "")
        .replace(/<!--[^]*?-->/gu, "")
        .replace(/^\s*\/\/.*$/gmu, "");

describe("die abgeschottete Fläche", () => {
    it("🔴 die Rechte des iframe: Links dürfen in einem neuen Tab aufgehen, KEIN Skript, KEINE eigene Herkunft", () => {
        expect(MAIL_SANDBOX).toBe("allow-popups allow-popups-to-escape-sandbox");
        expect(MAIL_SANDBOX).not.toContain("allow-scripts");
        expect(MAIL_SANDBOX).not.toContain("allow-same-origin");
        // Das Bauteil bindet genau diese Rechte und kein Wort mehr; nirgends steht ein Skriptrecht.
        const bauteil = lesen("../src/community/mail-ansicht.vue");
        expect(bauteil).toContain(':sandbox="MAIL_SANDBOX"');
        expect(bauteil).toContain(':srcdoc="srcdoc"');
        expect(bauteil).toContain('referrerpolicy="no-referrer"');
        for (const datei of [
            "../src/community/mail-ansicht.vue",
            "../src/community/mail-ansicht-modell.ts",
            "../src/community/vorgang-verlauf.vue",
        ]) {
            const quelle = ohneKommentare(datei);
            expect(quelle, datei).not.toContain("allow-scripts");
            expect(quelle, datei).not.toContain("allow-same-origin");
            expect(quelle, datei).not.toContain("v-html");
            expect(quelle, datei).not.toContain("innerHTML");
        }
        // Der Verlauf zeigt die Mail nur über das Bauteil, nie als gebundenes HTML.
        expect(lesen("../src/community/vorgang-verlauf.vue")).toContain("<MailAnsicht");
    });

    it("🔴 die Inhaltsrichtlinie im Dokument: nichts, außer Bildern von der eigenen Herkunft und als data:; erst „Einmal laden“ erlaubt https:", () => {
        expect(mailCsp(HERKUNFT, false)).toBe(
            "default-src 'none'; img-src https://avesmaps.test data:; style-src 'unsafe-inline'",
        );
        expect(mailCsp(HERKUNFT, true)).toBe(
            "default-src 'none'; img-src https://avesmaps.test data: https:; style-src 'unsafe-inline'",
        );
        for (const extern of [false, true]) {
            const csp = mailCsp(HERKUNFT, extern);
            expect(csp).toContain("default-src 'none'");
            expect(csp).not.toContain("script-src");
            expect(csp).not.toContain("'unsafe-eval'");
            expect(csp).not.toContain("frame-src");
            expect(csp).not.toContain("connect-src");
        }
        const doc = baueSrcdoc("<p>Hallo</p>", { herkunft: HERKUNFT, extern: false });
        expect(doc).toContain(
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src https://avesmaps.test data:; style-src 'unsafe-inline'\">",
        );
        expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<p>Hallo</p>"));
        expect(doc).not.toContain("<script");
    });

    it("🔴 externe Bilder laden nie von selbst: ohne „Einmal laden“ bleibt data-extern, mit setzt das Dokument src (nur dort) und erweitert die Richtlinie", () => {
        const html = '<p>Hallo</p><img data-extern="https://tracker.example/p.gif?a=1&amp;b=2" alt="Pixel" width="1">';
        const blockiert = baueSrcdoc(html, { herkunft: HERKUNFT, extern: false });
        expect(blockiert).toContain('data-extern="https://tracker.example/p.gif?a=1&amp;b=2"');
        expect(blockiert).not.toMatch(/\ssrc="https:/u);
        expect(blockiert).not.toContain("https: ");
        const geladen = baueSrcdoc(html, { herkunft: HERKUNFT, extern: true });
        expect(geladen).toContain(' src="https://tracker.example/p.gif?a=1&amp;b=2"');
        expect(geladen).toContain("img-src https://avesmaps.test data: https:;");
        // Der Eingabewert ändert sich nicht: „Einmal laden“ gilt für die eine Ansicht.
        expect(html).toContain("data-extern");
    });

    it("eingebettete Bilder: die Adressen der App im bereinigten HTML, als data: hineingereicht; nur die Form der App-Adresse zählt", () => {
        const html =
            '<img src="/api/community/vorgaenge/COM-000007/anhaenge/12" alt="a"><img src="/api/community/vorgaenge/COM-000007/anhaenge/12"><img src="/api/community/vorgaenge/COM-000007/anhaenge/13">' +
            '<img src="https://fremd.example/x.png"><img src="/api/community/vorgaenge/../x"><img src="/api/community/vorgaenge/COM-1/anhaenge/1/../../x">';
        expect(eingebetteteBilder(html)).toEqual([
            "/api/community/vorgaenge/COM-000007/anhaenge/12",
            "/api/community/vorgaenge/COM-000007/anhaenge/13",
        ]);
        const doc = baueSrcdoc(html, {
            herkunft: HERKUNFT,
            extern: false,
            bilder: new Map([["/api/community/vorgaenge/COM-000007/anhaenge/12", "data:image/png;base64,AAAA"]]),
        });
        expect(doc.match(/src="data:image\/png;base64,AAAA"/gu)).toHaveLength(2);
        // Ein Bild ohne geladene Daten behält seine Adresse (Anzeige leer, kein Fehler).
        expect(doc).toContain('src="/api/community/vorgaenge/COM-000007/anhaenge/13"');
        expect(BILD_INLINE_MAX_BYTES).toBe(4 * 1024 * 1024);
        expect(eingebetteteBilder("<p>nichts</p>")).toEqual([]);
    });

    it("die Höhe wird aus dem Inhalt geschätzt und bleibt zwischen Mindest- und Höchsthöhe (darüber rollt die Fläche)", () => {
        expect(schaetzeHoehe("<p>kurz</p>")).toBe(MAIL_HOEHE.min);
        expect(schaetzeHoehe(`<p>${"Wort ".repeat(2000)}</p>`)).toBe(MAIL_HOEHE.max);
        expect(schaetzeHoehe("<p>eins</p><p>zwei</p><p>drei</p><p>vier</p>")).toBeGreaterThan(MAIL_HOEHE.min);
        const mitBild = schaetzeHoehe('<p>x</p><img src="/api/community/vorgaenge/COM-000001/anhaenge/1">');
        expect(mitBild).toBeGreaterThan(schaetzeHoehe("<p>x</p>"));
        for (const html of ["", "<br><br><br>", "<table><tr><td>a</td></tr></table>".repeat(50)]) {
            const hoehe = schaetzeHoehe(html);
            expect(hoehe).toBeGreaterThanOrEqual(MAIL_HOEHE.min);
            expect(hoehe).toBeLessThanOrEqual(MAIL_HOEHE.max);
        }
    });
});

describe("Anhänge", () => {
    const anhang = (teil: Partial<MailAnhang> = {}): MailAnhang => ({
        id: 12,
        name: "Beleg.pdf",
        groesse: 14_000,
        mime: "application/pdf",
        gesperrt: false,
        grund: null,
        vorschau: true,
        ...teil,
    });

    it("Größe als kurzer Satz", () => {
        expect(groesseSatz(512)).toBe("512 B");
        expect(groesseSatz(14_000)).toBe("14 KB");
        expect(groesseSatz(1_500_000)).toBe("1,4 MB");
    });

    it("🔴 Verweise: „Ansehen“ nur bei Bild und PDF mit Datei, „Herunterladen“ bei jeder Datei; ohne Datei (gesperrt, entfernt) keiner von beiden", () => {
        expect(anhangAdressen("COM-000007", anhang())).toEqual({
            ansehen: "/api/community/vorgaenge/COM-000007/anhaenge/12?ansehen=1",
            laden: "/api/community/vorgaenge/COM-000007/anhaenge/12",
        });
        expect(anhangAdressen("COM-000007", anhang({ vorschau: false, mime: "text/plain" }))).toEqual({
            ansehen: undefined,
            laden: "/api/community/vorgaenge/COM-000007/anhaenge/12",
        });
        expect(anhangAdressen("COM-000007", anhang({ gesperrt: true, grund: "typ", vorschau: false }))).toEqual({
            ansehen: undefined,
            laden: undefined,
        });
        expect(anhangAdressen("COM-000007", anhang({ grund: "entfernt", vorschau: false }))).toEqual({
            ansehen: undefined,
            laden: undefined,
        });
        expect(anhangUrl("COM-000007", 3)).toBe("/api/community/vorgaenge/COM-000007/anhaenge/3");
    });

    it("Zeichen der Art und Satz zum Grund", () => {
        expect(anhangZeichen(anhang())).toBe("▤");
        expect(anhangZeichen(anhang({ mime: "image/png" }))).toBe("▣");
        expect(anhangZeichen(anhang({ mime: "text/plain" }))).toBe("▥");
        expect(anhangZeichen(anhang({ gesperrt: true, grund: "typ" }))).toBe("⊘");
        expect(anhangGrundSatz(null)).toBeUndefined();
        expect(anhangGrundSatz("typ")).toBe("Dateityp gesperrt, nicht übernommen");
        expect(anhangGrundSatz("grenze")).toBe("Über der Grenze von 25 MB je Mail, nicht übernommen");
        expect(anhangGrundSatz("entfernt")).toBe("Datei aus Datenschutzgründen entfernt");
    });

    it("der Satz zu blockierten Bildern: Einzahl und Mehrzahl", () => {
        expect(externSatz(1)).toContain("1 externes Bild blockiert");
        expect(externSatz(3)).toContain("3 externe Bilder blockiert");
    });

    it("die Anhänge verweisen mit rel und ohne Skript; der Name steht in voller Breite (Telefon)", () => {
        const bauteil = lesen("../src/community/mail-anhaenge.vue");
        expect(bauteil).toContain('rel="noopener noreferrer"');
        expect(bauteil).toContain("download");
        expect(bauteil).toContain("border-style: dashed");
        expect(bauteil).toContain("@media (max-width: 520px)");
        expect(bauteil).not.toContain("v-html");
    });
});

describe("Verlauf", () => {
    const mailEintrag = (teil: Partial<Extract<VerlaufEintrag, { art: "nachricht" }>> = {}): VerlaufEintrag => ({
        art: "nachricht",
        richtung: "ein",
        weg: "mail",
        text: "Hallo",
        von: null,
        at: "2026-10-31T10:00:00.000Z",
        id: 5,
        mail: { betreff: "Frage", html: "<p>Hallo</p>", externBilder: 2, hinweis: null, anhaenge: [] },
        ...teil,
    });

    it("die Zeile einer eingehenden Mail trägt Betreff, HTML und Anhänge in die Oberfläche", () => {
        const [zeile] = verlaufZeilen([mailEintrag()], () => undefined, "anfrage");
        expect(zeile).toMatchObject({
            art: "nachricht",
            richtung: "ein",
            weg: "mail",
            id: 5,
            mail: { betreff: "Frage", externBilder: 2 },
        });
        // Eine Nachricht ohne Mail (Statusseite, Formular) trägt keine.
        const statusseite = mailEintrag({ weg: "statusseite" });
        delete (statusseite as { mail?: unknown }).mail;
        const [ohne] = verlaufZeilen([statusseite], () => undefined, "anfrage");
        expect(ohne).not.toHaveProperty("mail");
    });

    it("🔴 „durch neue Nachricht wieder geöffnet“: nur das Ereignis mit dem festen Text der Datenbank; sonst bleibt es „durch Antwort“", () => {
        const wieder = (text: string | null): VerlaufEintrag => ({
            art: "ereignis",
            ereignis: "wiedereroeffnet",
            alt: "beantwortet",
            neu: "in_arbeit",
            text,
            von: null,
            vomMelder: true,
            at: "2026-10-31T11:00:00.000Z",
        });
        const satz = (text: string | null) => {
            const [zeile] = verlaufZeilen([wieder(text)], () => undefined, "anfrage");
            return zeile?.art === "ereignis" ? zeile.satz : undefined;
        };
        expect(MAIL_WIEDER_GEOEFFNET).toBe("durch neue Nachricht wieder geöffnet");
        expect(satz(MAIL_WIEDER_GEOEFFNET)).toBe("durch neue Nachricht wieder geöffnet");
        expect(satz("durch Antwort wieder geöffnet")).toBe("durch Antwort wieder geöffnet");
        expect(satz(null)).toBe("durch Antwort wieder geöffnet");
    });

    it("der Verlauf zeigt Hinweise für eine Mail, die nicht übernommen wurde, statt des Textes", () => {
        const verlauf = lesen("../src/community/vorgang-verlauf.vue");
        expect(verlauf).toContain("community.mails.hinweis.zuGross");
        expect(verlauf).toContain("community.mails.hinweis.unlesbar");
        expect(verlauf).toContain("<MailAnhaenge");
    });
});

describe("die Sprachtafeln: alle neun tragen die Texte des Mailabrufs mit denselben Platzhaltern", () => {
    const tafeln = { de, en, fr, nl, it: itTafel, es, pl, sv, da } as const;
    const MIT_PLATZHALTER: Record<string, readonly string[]> = {
        "community.mails.html.extern.eins": ["{anzahl}"],
        "community.mails.html.extern.viele": ["{anzahl}"],
    };
    const SCHLUESSEL = [
        "community.mails.html.titel",
        "community.mails.html.bereinigt",
        "community.mails.html.extern.eins",
        "community.mails.html.extern.viele",
        "community.mails.html.einmalLaden",
        "community.mails.html.externGeladen",
        "community.mails.hinweis.zuGross",
        "community.mails.hinweis.unlesbar",
        "community.mails.anhang.liste",
        "community.mails.anhang.ansehen",
        "community.mails.anhang.laden",
        "community.mails.anhang.grund.typ",
        "community.mails.anhang.grund.grenze",
        "community.mails.anhang.grund.entfernt",
        "community.mails.ereignis.durchNachricht",
        "status.kind.community_mail_abruf",
    ] as const;

    it("jeder Schlüssel steht in jeder Tafel, nicht leer, mit seinen Platzhaltern", () => {
        for (const [sprache, tafel] of Object.entries(tafeln)) {
            const lose = tafel as Record<string, string>;
            for (const key of SCHLUESSEL) {
                expect(lose[key], `${sprache} ${key}`).toBeTypeOf("string");
                expect(lose[key]!.trim().length, `${sprache} ${key}`).toBeGreaterThan(0);
                for (const platzhalter of MIT_PLATZHALTER[key] ?? [])
                    expect(lose[key], `${sprache} ${key}`).toContain(platzhalter);
            }
        }
    });

    it("die deutschen Sätze nach dem Bedienkonzept", () => {
        expect(de["community.mails.html.bereinigt"]).toBe("HTML-Mail, bereinigt dargestellt.");
        expect(de["community.mails.html.einmalLaden"]).toBe("Einmal laden");
        expect(de["community.mails.anhang.grund.typ"]).toBe("Dateityp gesperrt, nicht übernommen");
        expect(de["community.mails.ereignis.durchNachricht"]).toBe("durch neue Nachricht wieder geöffnet");
        expect(de["community.mails.html.extern.eins"]).toContain("externes Bild blockiert");
    });
});
