import { describe, expect, it } from "vitest";
import {
    MEDIA_UPLOAD_LIMITS,
    KartenvorschlagEinreichung,
    KARTENVORSCHLAG_STATUS_PFAD,
    KARTENVORSCHLAG_TERMS_VERSION,
} from "@avesmaps3d/shared";
import { Value } from "@sinclair/typebox/value";
import { ApiFailure } from "../src/auth/api";
import { readEntry } from "../src/auth/entry";
import { neuesFormular } from "../src/community/api";
import { FEHLER_SATZ, fehlerArt, vorschlagAdresse } from "../src/kartenvorschlag/api";
import { erzeugeKartenvorschlagSteuerung } from "../src/kartenvorschlag/kartenvorschlag-besucher";
import {
    dateiProbe,
    dateityp,
    drahtBody,
    fehlendes,
    geschrieben,
    istLink,
    leererEntwurf,
    linkBereinigt,
    linkHost,
    masseProbe,
    zeichen,
} from "../src/kartenvorschlag/modell";
import { kartenvorschlagGrund } from "../src/kartenvorschlag/ablehnung";
import { de } from "../src/i18n/de";
import { formatNumber, t } from "../src/i18n/i18n";

/**
 * „Karte vorschlagen“, die Besucherseite (WI-0275 Stufe C): was das Formular rechnet (`modell.ts`), wie die Fehler des Servers zu Sätzen werden (`api.ts`), wie die Steuerung öffnet und wie der Link der
 * Statusseite gelesen wird. Das Fenster selbst prüft die Browserprobe; hier steht, was ohne Browser feststeht.
 */

const ORT = "00000000-0000-4000-8000-000000000001";
const kennung = neuesFormular();

function linkEntwurf() {
    const entwurf = leererEntwurf();
    entwurf.link = "https://www.ulisses-ebooks.de/de/product/120516/herz-des-reiches";
    entwurf.titel = "  Herz des Reiches  ";
    return entwurf;
}

describe("🔴 Pflicht: nur der Titel und (Link ODER Datei) - die Quelle sperrt nie", () => {
    it("ein leeres Formular verlangt zuerst den Link, dann den Titel", () => {
        const entwurf = leererEntwurf();
        expect(fehlendes(entwurf)).toEqual({ feld: "link", grund: "kartenvorschlag.sperre.link" });
        entwurf.link = "ulisses.de";
        expect(fehlendes(entwurf)).toEqual({ feld: "link", grund: "kartenvorschlag.sperre.linkFalsch" });
        entwurf.link = "https://www.ulisses-ebooks.de/";
        expect(fehlendes(entwurf)).toEqual({ feld: "titel", grund: "kartenvorschlag.sperre.titel" });
        entwurf.titel = "Gareth";
        expect(fehlendes(entwurf)).toBeUndefined();
    });

    it("Quelle, Beschreibung, Urheber und Name sind frei: Das Formular geht auch ohne sie", () => {
        const entwurf = linkEntwurf();
        expect(entwurf.quelle).toBe("");
        expect(fehlendes(entwurf)).toBeUndefined();
    });

    it("ein halb ausgefülltes Vorschaubild sperrt, ein leeres nicht", () => {
        const entwurf = linkEntwurf();
        entwurf.vorschauLink = "bild.jpg";
        expect(fehlendes(entwurf)?.feld).toBe("vorschau");
        entwurf.vorschauLink = "";
        expect(fehlendes(entwurf)).toBeUndefined();
    });

    it("bei einer Datei fehlen die Datei und danach das Häkchen; ein Vorschaulink zählt dort nicht", () => {
        const entwurf = leererEntwurf();
        entwurf.weg = "datei";
        entwurf.titel = "Plan";
        entwurf.vorschauLink = "kaputt";
        expect(fehlendes(entwurf)?.feld).toBe("datei");
        entwurf.datei = new File([new Uint8Array(10)], "plan.png", { type: "image/png" });
        expect(fehlendes(entwurf)).toEqual({ feld: "haken", grund: "kartenvorschlag.sperre.haken" });
        entwurf.haken = true;
        expect(fehlendes(entwurf)).toBeUndefined();
    });
});

describe("Link und Datei prüfen", () => {
    it.each([
        ["https://www.ulisses-ebooks.de/de/product/120516/", true],
        ["http://example.org/x", true],
        // WI-0291: das Muster des Servers (Schema, kein Leerraum, 8 bis 500 Zeichen), das Schema auch groß; ein Punkt im Namen bleibt Pflicht.
        ["https://localhost/x", false],
        ["HTTPS://Example.org/Karte", true],
        ["http://a.b", true],
        ["http://", false],
        ["https://exa mple.org", false],
        ["ftp://example.org/x", false],
        ["https://exa mple.org", false],
        ["www.example.org", false],
        ["", false],
    ])("istLink(%s) ist %s", (text, soll) => {
        expect(istLink(text)).toBe(soll);
    });

    it("der Rechnername ohne www für die Zeile „Karte auf …“", () => {
        expect(linkHost("https://www.ulisses-ebooks.de/x")).toBe("ulisses-ebooks.de");
        expect(linkHost("kein link")).toBeUndefined();
    });

    it("JPEG, PNG, WebP und PDF gehen, alles andere nicht; ohne Typ entscheidet die Endung", () => {
        expect(dateityp({ type: "image/jpeg", name: "a.jpg" })).toBe("image/jpeg");
        expect(dateityp({ type: "application/pdf", name: "a.pdf" })).toBe("application/pdf");
        expect(dateityp({ type: "", name: "Karte.PDF" })).toBe("application/pdf");
        expect(dateityp({ type: "image/gif", name: "a.gif" })).toBeUndefined();
        expect(dateityp({ type: "image/svg+xml", name: "a.svg" })).toBeUndefined();
        expect(dateityp({ type: "", name: "a.txt" })).toBeUndefined();
    });

    it("🔴 bis 50 MiB: eine Datei darüber wird mit dem Satz dazu abgelehnt", () => {
        const dateiMit = (size: number) => ({ type: "application/pdf", name: "a.pdf", size });
        expect(dateiProbe(dateiMit(50 * 1024 * 1024))).toEqual({ ok: true });
        expect(dateiProbe(dateiMit(50 * 1024 * 1024 + 1))).toEqual({
            ok: false,
            grund: "kartenvorschlag.datei.fehler.gross",
        });
        expect(dateiProbe(dateiMit(0))).toMatchObject({ ok: false });
        expect(dateiProbe({ type: "image/gif", name: "a.gif", size: 10 })).toEqual({
            ok: false,
            grund: "kartenvorschlag.datei.fehler.format",
        });
    });

    it("nur wer schon etwas geschrieben oder gewählt hat, gilt als „geschrieben“ (Esc schließt dann nicht)", () => {
        const entwurf = leererEntwurf();
        expect(geschrieben(entwurf)).toBe(false);
        entwurf.titel = "  ";
        expect(geschrieben(entwurf)).toBe(false);
        entwurf.beschreibung = "Ein Viertel";
        expect(geschrieben(entwurf)).toBe(true);
    });
});

describe("🔴 der Rumpf der Einreichung entspricht dem Vertrag", () => {
    it("ein Link: getrimmt, ohne leere Felder, ohne Bedingungen, mit Falle", () => {
        const entwurf = linkEntwurf();
        entwurf.quelle = " Herz des Reiches ";
        const body = drahtBody(kennung, entwurf, ORT, 4321.4);
        expect(Value.Check(KartenvorschlagEinreichung, body)).toBe(true);
        expect(body).toMatchObject({
            operationId: kennung.operationId,
            schluessel: kennung.schluessel,
            weg: "link",
            titel: "Herz des Reiches",
            link: "https://www.ulisses-ebooks.de/de/product/120516/herz-des-reiches",
            quelle: "Herz des Reiches",
            placeId: ORT,
            falle: { feld: "", dauerMs: 4321 },
        });
        expect(body).not.toHaveProperty("bedingungen");
        expect(body).not.toHaveProperty("datei");
        expect(body).not.toHaveProperty("beschreibung");
        expect(body).not.toHaveProperty("name");
        expect(body).not.toHaveProperty("spoiler");
    });

    it("🔴 „unbekannt“ wird nie als „nein“ gesendet: Eine dreiwertige Angabe fehlt, bis jemand Ja oder Nein wählt", () => {
        const entwurf = linkEntwurf();
        entwurf.offiziell = "nein";
        entwurf.spoiler = "ja";
        const body = drahtBody(kennung, entwurf, undefined, 100);
        expect(body.offiziell).toBe(false);
        expect(body.spoiler).toBe(true);
        expect(body).not.toHaveProperty("beschriftet");
        expect(body).not.toHaveProperty("mehrstoeckig");
        expect(body).not.toHaveProperty("kostenpflichtig");
        expect(body).not.toHaveProperty("placeId");
    });

    it("eine Datei: Art und Größe angekündigt, Nutzung und Fassung der Bedingungen dabei, kein Link", () => {
        const entwurf = leererEntwurf();
        entwurf.weg = "datei";
        entwurf.titel = "Gesamtplan";
        entwurf.haken = true;
        entwurf.nutzung = "cc-by-4.0";
        entwurf.quelle = "wird bei einer Datei nicht gesendet";
        entwurf.datei = new File([new Uint8Array(2048)], "gareth.pdf", { type: "application/pdf" });
        const body = drahtBody(kennung, entwurf, ORT, 5000);
        expect(Value.Check(KartenvorschlagEinreichung, body)).toBe(true);
        expect(body).toMatchObject({
            weg: "datei",
            datei: { typ: "application/pdf", groesse: 2048 },
            nutzung: "cc-by-4.0",
            bedingungen: KARTENVORSCHLAG_TERMS_VERSION,
        });
        expect(body).not.toHaveProperty("link");
        expect(body).not.toHaveProperty("quelle");
        // Der Dateiname geht nie hinaus: Der Server kennt nur Art und Größe.
        expect(JSON.stringify(body)).not.toContain("gareth.pdf");
    });

    it("Jahre, Typen und Art nur im erlaubten Bereich; eine Zeichenkette ohne Zahl fehlt", () => {
        const entwurf = linkEntwurf();
        entwurf.gueltigAb = "1027";
        entwurf.gueltigBis = "";
        entwurf.typen = ["stadtplan", "uebersicht"];
        entwurf.art = "politisch";
        entwurf.farbe = "farbig";
        const body = drahtBody(kennung, entwurf, undefined, 0);
        expect(body).toMatchObject({
            gueltigAb: 1027,
            typen: ["stadtplan", "uebersicht"],
            art: "politisch",
            farbe: "farbig",
        });
        expect(body).not.toHaveProperty("gueltigBis");
        expect(Value.Check(KartenvorschlagEinreichung, body)).toBe(true);
    });

    it("eine fremde Ortskennung geht nicht als placeId hinaus", () => {
        expect(drahtBody(kennung, linkEntwurf(), "kein-uuid", 0)).not.toHaveProperty("placeId");
    });

    it("ein unvollständiges Formular wirft, statt etwas Halbes zu senden", () => {
        expect(() => drahtBody(kennung, leererEntwurf(), undefined, 0)).toThrow("unvollständig");
    });
});

describe("Fehler des Servers werden zu Sätzen der Oberfläche (ADR-0018)", () => {
    const fehler = (status: number, code: string) => new ApiFailure(status, code, "Text des Servers");

    it.each([
        [fehler(0, "network"), "netz"],
        [fehler(429, "kartenvorschlag_rate"), "zu_viele"],
        [fehler(503, "kartenvorschlag_unavailable"), "pausiert"],
        [fehler(404, "kartenvorschlag_not_found"), "nicht_gefunden"],
        [fehler(409, "kartenvorschlag_transition"), "uebergang"],
        [fehler(409, "kartenvorschlag_key_used"), "schluessel_belegt"],
        [fehler(415, "unsupported_media_type"), "format"],
        [fehler(413, "kartenvorschlag_too_large"), "ungueltig"],
        [fehler(422, "kartenvorschlag_invalid"), "ungueltig"],
        [fehler(500, "irgendwas"), "sonst"],
        [new Error("x"), "sonst"],
    ])("%s wird zu %s", (e, art) => {
        expect(fehlerArt(e)).toBe(art);
    });

    it("jede Art hat einen Satz in der deutschen Tafel", () => {
        for (const schluessel of Object.values(FEHLER_SATZ)) expect(de).toHaveProperty([schluessel]);
    });
});

describe("die Steuerung: ein Fenster zur Zeit", () => {
    it("öffnen setzt den Ort, ein zweites Öffnen zählt hoch, schließen leert", () => {
        const steuerung = erzeugeKartenvorschlagSteuerung();
        expect(steuerung.anzeige.value).toBeUndefined();
        steuerung.oeffne({ id: ORT, name: "Gareth", hatKarten: true });
        const erste = steuerung.anzeige.value;
        expect(erste).toMatchObject({ art: "formular", ort: { id: ORT, name: "Gareth", hatKarten: true } });
        steuerung.oeffne();
        expect(steuerung.anzeige.value?.nr).toBe((erste?.nr ?? 0) + 1);
        expect(steuerung.anzeige.value).not.toHaveProperty("ort");
        steuerung.schliesse();
        expect(steuerung.anzeige.value).toBeUndefined();
    });

    it("die Statusseite nimmt nur einen gültigen Schlüssel; sonst ist er null und das Fenster sagt es ohne zu fragen", () => {
        const steuerung = erzeugeKartenvorschlagSteuerung();
        steuerung.oeffneStatus(kennung.schluessel);
        expect(steuerung.anzeige.value).toMatchObject({ art: "status", schluessel: kennung.schluessel });
        steuerung.oeffneStatus("zu-kurz");
        expect(steuerung.anzeige.value).toMatchObject({ art: "status", schluessel: null });
        steuerung.oeffneStatus(undefined);
        expect(steuerung.anzeige.value).toMatchObject({ art: "status", schluessel: null });
    });
});

describe("🔴 die Adresse der Statusseite: der Schlüssel im Fragment, nie in der Suche", () => {
    it("baut und liest `/kartenvorschlag#…`", () => {
        const adresse = vorschlagAdresse("https://avesmaps.de", kennung.schluessel);
        expect(adresse).toBe(`https://avesmaps.de${KARTENVORSCHLAG_STATUS_PFAD}#${kennung.schluessel}`);
        expect(new URL(adresse).search).toBe("");
        const entry = readEntry({ pathname: "/kartenvorschlag", search: "?lang=en", hash: `#${kennung.schluessel}` });
        expect(entry.kartenvorschlag).toBe(kennung.schluessel);
        expect(entry.status).toBeUndefined();
        expect(entry.reisebild).toBeUndefined();
        // Der Schlüssel geht aus der Adresse, die Sprache bleibt.
        expect(entry.url).toBe("/?lang=en");
    });

    it("ein verstümmelter Schlüssel wird null", () => {
        expect(readEntry({ pathname: "/kartenvorschlag", search: "", hash: "#abc" }).kartenvorschlag).toBeNull();
        expect(readEntry({ pathname: "/kartenvorschlag", search: "", hash: "" }).kartenvorschlag).toBeNull();
    });

    it("die anderen Statusseiten bleiben, wie sie waren", () => {
        expect(readEntry({ pathname: "/reisebild", search: "", hash: `#${kennung.schluessel}` }).reisebild).toBe(
            kennung.schluessel,
        );
        expect(readEntry({ pathname: "/meldung", search: "", hash: `#${kennung.schluessel}` }).status).toBe(
            kennung.schluessel,
        );
    });
});

describe("🔴 WI-0291: Vorabprüfung, damit der Knopf nicht daneben liegt", () => {
    it("Gültig ab nach Gültig bis sperrt und nennt beide Jahre; die Reihenfolge ist egal, wenn eines fehlt", () => {
        const entwurf = linkEntwurf();
        entwurf.gueltigAb = "1045";
        entwurf.gueltigBis = "1027";
        expect(fehlendes(entwurf)).toEqual({
            feld: "bis",
            grund: "kartenvorschlag.sperre.zeitraum",
            params: { ab: "1045", bis: "1027" },
        });
        entwurf.gueltigBis = "";
        expect(fehlendes(entwurf)).toBeUndefined();
        entwurf.gueltigBis = "1045";
        expect(fehlendes(entwurf)).toBeUndefined();
    });

    it("ein Jahr außerhalb des Bereichs oder keine ganze Zahl sperrt mit dem Satz zum Bereich", () => {
        const entwurf = linkEntwurf();
        entwurf.gueltigAb = "10000";
        expect(fehlendes(entwurf)).toMatchObject({ feld: "ab", grund: "kartenvorschlag.sperre.jahr" });
        entwurf.gueltigAb = "";
        entwurf.gueltigBis = "zehn";
        expect(fehlendes(entwurf)).toMatchObject({ feld: "bis", grund: "kartenvorschlag.sperre.jahr" });
    });

    it("🪤 ein Zahlenfeld liefert eine Zahl statt Text: Das darf nicht werfen", () => {
        const entwurf = linkEntwurf();
        (entwurf as { gueltigAb: unknown }).gueltigAb = 1027;
        (entwurf as { gueltigBis: unknown }).gueltigBis = 1045;
        expect(fehlendes(entwurf)).toBeUndefined();
        expect(drahtBody(kennung, entwurf, undefined, 0)).toMatchObject({ gueltigAb: 1027, gueltigBis: 1045 });
    });

    it("ein Link mit großem Schema wird mit kleinem gesendet, statt abgelehnt zu werden", () => {
        expect(linkBereinigt("  HTTPS://Example.org/Karte ")).toBe("https://Example.org/Karte");
        const entwurf = linkEntwurf();
        entwurf.link = "HTTP://www.example.org/Karte";
        entwurf.vorschauLink = "HTTPS://www.example.org/v.png";
        const body = drahtBody(kennung, entwurf, undefined, 0);
        expect(body).toMatchObject({
            link: "http://www.example.org/Karte",
            vorschauLink: "https://www.example.org/v.png",
        });
        expect(Value.Check(KartenvorschlagEinreichung, body)).toBe(true);
    });

    it("Längen zählen in Codepunkten wie am Server: ein Emoji ist ein Zeichen", () => {
        expect(zeichen("a😀b")).toBe(3);
        const entwurf = linkEntwurf();
        entwurf.titel = "😀".repeat(400);
        const body = drahtBody(kennung, entwurf, undefined, 0);
        expect(zeichen(body.titel)).toBe(300);
        expect(body.titel).toBe("😀".repeat(300));
        // (TypeBox zählt in UTF-16, ajv am Server in Codepunkten: Das Schema prüft hier nicht gegen.)
    });

    it("Bild: über 16 Megapixel oder eine Kante über 8192 Pixel wird vor dem Hochladen gesperrt, Kante zuerst", () => {
        expect(masseProbe({ breite: 4000, hoehe: 4000 })).toEqual({ ok: true });
        expect(masseProbe({ breite: 4001, hoehe: 4000 })).toEqual({ ok: false, grund: "too_many_pixels" });
        expect(masseProbe({ breite: MEDIA_UPLOAD_LIMITS.maxEdge, hoehe: 1 })).toEqual({ ok: true });
        expect(masseProbe({ breite: MEDIA_UPLOAD_LIMITS.maxEdge + 1, hoehe: 1 })).toEqual({
            ok: false,
            grund: "too_large_dimensions",
        });
        expect(masseProbe({ breite: 9000, hoehe: 9000 })).toEqual({ ok: false, grund: "too_large_dimensions" });
    });
});

describe("🔴 WI-0291: genaue Gründe der Ablehnungen von Karte vorschlagen", () => {
    const ablehnung = (status: number, code: string, details?: Record<string, unknown>) =>
        new ApiFailure(status, code, "Satz des Servers", details);
    const grund = (reason: string, weiter: Record<string, unknown> = {}) =>
        kartenvorschlagGrund(ablehnung(422, "kartenvorschlag_invalid", { reason, ...weiter }));

    it("jeder Fachcode der Einreichung hat seinen Satz mit den Angaben", () => {
        expect(grund("datei_und_link")).toBe(t("kartenvorschlag.ablehnung.dateiUndLink"));
        expect(grund("datei_angaben_fehlen", { fehlt: "datei" })).toBe(t("kartenvorschlag.ablehnung.dateiFehlt"));
        expect(grund("datei_angaben_fehlen", { fehlt: "nutzung" })).toBe(t("kartenvorschlag.ablehnung.nutzungFehlt"));
        expect(grund("datei_angaben_fehlen", { fehlt: "bedingungen" })).toBe(
            t("kartenvorschlag.ablehnung.bedingungenFehlen"),
        );
        expect(grund("link_fehlt")).toBe(t("kartenvorschlag.ablehnung.linkFehlt"));
        expect(grund("link_mit_datei")).toBe(t("kartenvorschlag.ablehnung.linkMitDatei"));
        expect(grund("zeitraum_verkehrt", { gueltigAb: 1045, gueltigBis: 1027 })).toBe(
            t("kartenvorschlag.ablehnung.zeitraum", { ab: "1045", bis: "1027" }),
        );
        expect(grund("feld_leer", { feld: "titel" })).toBe(
            t("kartenvorschlag.ablehnung.feldLeer", { feld: t("kartenvorschlag.titelfeld.label") }),
        );
        expect(grund("ort_unbekannt")).toBe(t("kartenvorschlag.ablehnung.ortUnbekannt"));
        expect(grund("angaben_passen_nicht")).toBe(t("kartenvorschlag.ablehnung.angabenPassenNicht"));
    });

    it("die Datei: leer, Art falsch, zu groß, Format, Pixel, Kante, mehrbildig, unlesbar", () => {
        expect(grund("datei_leer")).toBe(t("datei.ablehnung.leer"));
        expect(grund("datei_art_falsch", { angekuendigt: "image/jpeg", tatsaechlich: "image/png" })).toBe(
            t("kartenvorschlag.ablehnung.dateiArtFalsch", { angekuendigt: "JPEG", tatsaechlich: "PNG" }),
        );
        const gross = t("kartenvorschlag.ablehnung.zuGross", { mb: "50" });
        expect(kartenvorschlagGrund(ablehnung(413, "kartenvorschlag_too_large", { reason: "datei_zu_gross" }))).toBe(
            gross,
        );
        expect(kartenvorschlagGrund(ablehnung(415, "unsupported_media_type", { reason: "unsupported_format" }))).toBe(
            t("kartenvorschlag.ablehnung.format"),
        );
        const abgelehnt = (reason: string) => kartenvorschlagGrund(ablehnung(422, "media_file_rejected", { reason }));
        expect(abgelehnt("too_many_pixels")).toBe(
            t("datei.ablehnung.pixel", { mp: formatNumber(MEDIA_UPLOAD_LIMITS.maxPixels / 1_000_000, 0) }),
        );
        expect(abgelehnt("too_large_dimensions")).toBe(
            t("datei.ablehnung.kante", { kante: formatNumber(MEDIA_UPLOAD_LIMITS.maxEdge, 0) }),
        );
        expect(abgelehnt("animated_or_multiframe")).toBe(t("datei.ablehnung.mehrbild"));
        expect(abgelehnt("bad_header")).toBe(t("datei.ablehnung.unlesbar"));
    });

    it("413 und 415 von Fastify (ohne Fachcode) sagen, was angenommen wird", () => {
        expect(kartenvorschlagGrund(ablehnung(413, "payload_too_large"))).toBe(
            t("kartenvorschlag.ablehnung.zuGross", { mb: "50" }),
        );
        expect(kartenvorschlagGrund(ablehnung(415, "unsupported_media_type"))).toBe(
            t("kartenvorschlag.ablehnung.format"),
        );
    });

    it("Schemafehler (400) werden dem Feld des Formulars zugeordnet: Link-Muster, Längen, Jahre", () => {
        const schema = (pfad: string, rule: string) =>
            kartenvorschlagGrund(ablehnung(400, "validation_failed", { issues: [{ path: pfad, rule }] }));
        expect(schema("body/link", "pattern")).toBe(t("kartenvorschlag.ablehnung.linkFalsch", { max: "500" }));
        expect(schema("body/vorschauLink", "pattern")).toBe(
            t("kartenvorschlag.ablehnung.vorschauFalsch", { max: "500" }),
        );
        expect(schema("body/titel", "maxLength")).toBe(
            t("kartenvorschlag.ablehnung.textLang", { feld: t("kartenvorschlag.titelfeld.label"), max: "300" }),
        );
        expect(schema("body/titel", "pattern")).toBe(
            t("kartenvorschlag.ablehnung.feldLeer", { feld: t("kartenvorschlag.titelfeld.label") }),
        );
        expect(schema("body/gueltigAb", "maximum")).toBe(
            t("kartenvorschlag.ablehnung.jahr", { feld: t("kartenvorschlag.ab.label"), min: "-3000", max: "9999" }),
        );
        // Ein Feld, das das Formular nicht kennt: kein Satz, dann gilt der allgemeine des Fensters.
        expect(schema("body/falle/dauerMs", "minimum")).toBeUndefined();
    });

    it("Zurückziehen und Datei nachreichen im falschen Zustand sagen, wie es steht", () => {
        const uebergang = (reason: string) =>
            kartenvorschlagGrund(ablehnung(409, "kartenvorschlag_transition", { reason, zustand: "accepted" }));
        expect(uebergang("nicht_zurueckziehbar")).toBe(t("kartenvorschlag.ablehnung.nichtZurueckziehbar"));
        expect(uebergang("datei_nicht_mehr_gefragt")).toBe(t("kartenvorschlag.ablehnung.dateiNichtMehrGefragt"));
        expect(uebergang("kein_dateiweg")).toBe(t("kartenvorschlag.ablehnung.keinDateiweg"));
    });

    it("kein Grund, kein Satz: 429, 503, Netz und ein Fehler ohne Fachcode bleiben beim Fenster", () => {
        expect(kartenvorschlagGrund(ablehnung(429, "kartenvorschlag_rate"))).toBeUndefined();
        expect(kartenvorschlagGrund(ablehnung(503, "kartenvorschlag_unavailable"))).toBeUndefined();
        expect(kartenvorschlagGrund(new Error("x"))).toBeUndefined();
    });
});
