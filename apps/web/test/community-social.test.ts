import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { KanalId, SocialKanalStand, SocialVerlauf, SocialZeile, SocialZiel } from "@avesmaps3d/shared";
import { ApiFailure } from "../src/auth/api";
import { pendingConfirmation } from "../src/auth/bestaetigen";
import { BEITRAG_WERKZEUG, NEUER_BEITRAG, createRedaktion } from "../src/community/redaktion";
import {
    bestaetigeBildRechte,
    fuehreAus,
    kennung,
    kennungFrei,
    ladeBeitraege,
    legeBeitragAn,
    speichereBeitrag,
    sucheBilder,
} from "../src/community/social-api";
import { aktualisiereKanaele, liesGrenzenNeu, setzeNotschalter } from "../src/community/social-kanaele";
import { kanalStaende, kanalVerwalten } from "../src/community/social-kontext";
import {
    anfrageVon,
    bearbeitbar,
    bildRechte,
    chips,
    darfKanalZuruecknehmen,
    formularAus,
    fussVon,
    gleich,
    inhaltVon,
    kanalBildGrund,
    kanalGrund,
    kanalOffen,
    kanalStand,
    kanalZeile,
    kanalZurueckSperre,
    kreisVon,
    leeresFormular,
    legendeZahlen,
    notiz,
    passtNicht,
    pruefungAusFormular,
    segmentVon,
    sperrSatz,
    staendeVon,
    unterreiterZahl,
    urheber,
    verlaufZeilen,
    vorlageAusVorgang,
    zaehlerSatz,
    zeilenKnoepfe,
    zielAnzeige,
    zusammenfassung,
    type Formular,
} from "../src/community/social-modell";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster";
import { setLocale } from "../src/i18n/i18n.ts";

/**
 * Der Social Hub im Community-Modul (WI-0270 C11) ohne Browser: die Liste (Segmente, Urheber, Notiz, Zeilenknöpfe mit ihren Sperrgründen nach Recht, Vorlage und Zeichengrenze), das Fenster (Zähler je Kanal
 * nach der Regel des Dienstes, Fuß je Zustand und Recht, Bildrechte, Verlauf), die Steuerung der Fenster und die Schritte an der Leitung. Die Zählung selbst prüft `packages/shared/test/social-zaehlen.test.ts`,
 * die Server-Seite `apps/server/test/community-social.test.ts` gegen PostgreSQL.
 */

beforeAll(() => setLocale("de"));

const ICH = "11111111-1111-4111-8111-111111111111";
const ANDERE = "22222222-2222-4222-8222-222222222222";

const zeile = (patch: Partial<SocialZeile> = {}): SocialZeile => ({
    id: 12,
    nr: "SOC-000012",
    zustand: "entwurf",
    herkunft: "redaktion",
    vorgang: null,
    verfasser: { id: ICH, name: "Vali" },
    titel: "Die Reichsstraße ist da",
    text: "Die Reichsstraße von Gareth nach Wehrheim steht jetzt auf der Karte.",
    hashtags: ["#Aventurien"],
    rubrik: "karte",
    bild: null,
    bildBeschreibung: null,
    ki: false,
    kanaele: ["neuigkeiten"],
    ziele: [
        {
            kanal: "neuigkeiten",
            zustand: "wartet",
            adresse: null,
            fehler: null,
            versuche: 0,
            sendeAt: null,
            ausstehend: null,
        },
    ],
    papierkorb: false,
    verfallen: false,
    geaendert: false,
    revision: 2,
    angelegtAt: "2026-10-31T10:00:00.000Z",
    vorgelegtAt: null,
    veroeffentlichtAt: null,
    ...patch,
});
const betreiber = ["social_communication", "manage_news"];
const editor = ["social_communication"];

describe("Liste: Zeilen", () => {
    it("Segment, Kreis und Urheber („Vali“, „Routine“, „aus COM-…“)", () => {
        expect(segmentVon(zeile())).toBe("offen");
        expect(segmentVon(zeile({ zustand: "vorgelegt" }))).toBe("offen");
        expect(segmentVon(zeile({ zustand: "veroeffentlicht" }))).toBe("veroeffentlicht");
        expect(segmentVon(zeile({ papierkorb: true }))).toBe("papierkorb");
        expect(kreisVon("entwurf")).toBe("leer");
        expect(kreisVon("vorgelegt")).toBe("halb");
        expect(kreisVon("veroeffentlicht")).toBe("voll");
        expect(urheber(zeile())).toBe("Vali");
        expect(urheber(zeile({ herkunft: "routine", verfasser: null }))).toBe("Routine");
        expect(urheber(zeile({ herkunft: "vorgang", vorgang: "COM-000110" }))).toBe("Vali · aus COM-000110");
        expect(urheber(zeile({ verfasser: null }))).toBe("Redaktion");
    });

    it("die Zusammenfassung ist die Titelzeile, sonst der erste Satz", () => {
        expect(zusammenfassung(zeile())).toBe("Die Reichsstraße ist da");
        expect(zusammenfassung(zeile({ titel: null, text: "Neu auf der Karte. Und mehr." }))).toBe("Neu auf der Karte");
        expect(zusammenfassung(zeile({ titel: null, text: "" }))).toBe("ohne Text");
    });

    it("die Notiz in Amber steht, wo jemand handeln muss", () => {
        expect(notiz(zeile())).toBeUndefined();
        expect(notiz(zeile({ zustand: "vorgelegt", herkunft: "routine", verfasser: null }))).toBe(
            "Vorschlag der Routine: wartet auf Freigabe",
        );
        expect(notiz(zeile({ zustand: "vorgelegt" }))).toBe("wartet auf Freigabe durch einen Betreiber");
        expect(
            notiz(
                zeile({
                    zustand: "veroeffentlicht",
                    ziele: [
                        {
                            kanal: "neuigkeiten",
                            zustand: "fehler",
                            adresse: null,
                            fehler: "x",
                            versuche: 1,
                            sendeAt: null,
                            ausstehend: null,
                        },
                    ],
                }),
            ),
        ).toBe("Senden fehlgeschlagen, erneut senden");
        expect(notiz(zeile({ zustand: "veroeffentlicht", geaendert: true }))).toBe(
            "Änderung noch nicht veröffentlicht",
        );
        expect(notiz(zeile({ papierkorb: true, verfallen: true }))).toBe("nach sieben Tagen ohne Freigabe verfallen");
        expect(notiz(zeile({ papierkorb: true }))).toBeUndefined();
    });

    it("ein Statuschip je Kanal: wartet, ok, Fehler, zurückgenommen", () => {
        const ziele = (zustand: "wartet" | "ok" | "fehler" | "zurueck") => [
            {
                kanal: "neuigkeiten" as KanalId,
                zustand,
                adresse: null,
                fehler: null,
                versuche: 0,
                sendeAt: null,
                ausstehend: null,
            },
        ];
        expect(chips(zeile({ ziele: ziele("wartet") })).map((c) => c.text)).toEqual(["Neuigkeiten: wartet"]);
        expect(chips(zeile({ ziele: ziele("ok") })).map((c) => c.text)).toEqual(["Neuigkeiten ✓"]);
        expect(chips(zeile({ ziele: ziele("fehler") })).map((c) => c.text)).toEqual(["Neuigkeiten: Fehler"]);
        expect(chips(zeile({ ziele: ziele("zurueck") })).map((c) => c.text)).toEqual(["Neuigkeiten: zurückgenommen"]);
        expect(chips(zeile({ ziele: [] }))[0]?.zustand).toBe("wartet");
    });

    it("die Zahl am Unterreiter ist, was auf eine Freigabe wartet, und nur für Freigebende", () => {
        const liste = {
            zeilen: [],
            zaehler: { offen: 3, veroeffentlicht: 14, papierkorb: 1, entwurf: 2, vorgelegt: 1, wartet: 2 },
        };
        expect(unterreiterZahl(liste, betreiber)).toBe(2);
        expect(unterreiterZahl(liste, editor)).toBeUndefined();
        expect(legendeZahlen(liste.zaehler)).toEqual({ leer: 2, halb: 1, voll: 14, "halb-rechts": 0 });
    });

    it("die Anfrage: Segment, Suche (gekürzt), ein Kanal und eine Herkunft", () => {
        expect(anfrageVon("offen", "  Havena ", { kanal: ["mastodon"], herkunft: ["routine"] })).toEqual({
            segment: "offen",
            q: "Havena",
            kanal: "mastodon",
            herkunft: "routine",
        });
        expect(anfrageVon("papierkorb", "", { kanal: ["mastodon", "discord"], herkunft: ["x"] })).toEqual({
            segment: "papierkorb",
        });
        expect(anfrageVon("offen", "a".repeat(300), {}).q).toHaveLength(100);
    });
});

describe("Liste: Knöpfe rechts an der Zeile und ihre Sperrgründe", () => {
    it("🔴 unter Offen: ✓ und ✕; der Betreiber gibt Vorgelegtes und den EIGENEN Entwurf frei, den fremden Entwurf nicht", () => {
        const vorgelegt = zeilenKnoepfe(
            zeile({ zustand: "vorgelegt", verfasser: { id: ANDERE, name: "Edda" } }),
            betreiber,
            ICH,
        );
        expect(vorgelegt.freigeben).toEqual({ zeigen: true });
        expect(vorgelegt.korb).toEqual({ zeigen: true });
        expect(vorgelegt.holen.zeigen).toBe(false);
        expect(zeilenKnoepfe(zeile(), betreiber, ICH).freigeben).toEqual({ zeigen: true });
        expect(zeilenKnoepfe(zeile({ verfasser: { id: ANDERE, name: "Edda" } }), betreiber, ICH).freigeben).toEqual({
            zeigen: true,
            grund: "Noch nicht zur Freigabe vorgelegt",
        });
    });

    it("🔴 ohne manage_news ist ✓ gesperrt mit Grund, ✕ nur für den Verfasser", () => {
        const eigen = zeilenKnoepfe(zeile(), editor, ICH);
        expect(eigen.freigeben).toEqual({
            zeigen: true,
            grund: "Freigeben braucht das Recht, Neuigkeiten freizugeben (Betreiber)",
        });
        expect(eigen.korb).toEqual({ zeigen: true });
        const fremd = zeilenKnoepfe(zeile({ verfasser: { id: ANDERE, name: "Edda" } }), editor, ICH);
        expect(fremd.korb).toEqual({ zeigen: true, grund: "In den Papierkorb legt der Verfasser oder ein Betreiber" });
    });

    it("✓ ist gesperrt, wenn der Beitrag nicht passt: derselbe Satz wie im Fenster (Zeichengrenze, Kanal, Titel)", () => {
        const lang = zeilenKnoepfe(zeile({ zustand: "vorgelegt", text: "a".repeat(4003) }), betreiber, ICH);
        expect(lang.freigeben.grund).toBe(
            "Neuigkeiten: 3 Zeichen zu viel. Den Text um 3 Zeichen kürzen oder Neuigkeiten abwählen.",
        );
        const kanal = zeilenKnoepfe(
            zeile({ zustand: "vorgelegt", kanaele: ["neuigkeiten", "mastodon"] }),
            betreiber,
            ICH,
        );
        expect(kanal.freigeben.grund).toBe(
            "Mastodon ist noch nicht verbunden. Mastodon abwählen, bis der Kanal wieder sendet.",
        );
        const ohneTitel = zeilenKnoepfe(zeile({ zustand: "vorgelegt", titel: null }), betreiber, ICH);
        expect(ohneTitel.freigeben.grund).toBe(
            "Titelzeile fehlt. Oben eine Titelzeile eintragen oder „Neuigkeiten“ abwählen.",
        );
    });

    it("im Papierkorb ↺ für den Verfasser oder einen Betreiber, sonst gesperrt; veröffentlichte haben keine Knöpfe", () => {
        expect(zeilenKnoepfe(zeile({ papierkorb: true }), editor, ICH).holen).toEqual({ zeigen: true });
        expect(
            zeilenKnoepfe(zeile({ papierkorb: true, verfasser: { id: ANDERE, name: "E" } }), editor, ICH).holen.grund,
        ).toBe("Aus dem Papierkorb holt der Verfasser oder ein Betreiber");
        expect(
            zeilenKnoepfe(zeile({ papierkorb: true, verfasser: { id: ANDERE, name: "E" } }), betreiber, ICH).holen,
        ).toEqual({
            zeigen: true,
        });
        const draussen = zeilenKnoepfe(zeile({ zustand: "veroeffentlicht" }), betreiber, ICH);
        expect([draussen.freigeben.zeigen, draussen.korb.zeigen, draussen.holen.zeigen]).toEqual([false, false, false]);
    });
});

describe("Fenster: Zähler und Zählung je Kanal", () => {
    const formular = (patch: Partial<Formular> = {}): Formular => ({ ...leeresFormular(), titel: "T", ...patch });

    it("🔴 der Zähler nennt den engsten gewählten Kanal; läuft einer über, steht er vorn", () => {
        const f = formular({ text: "a".repeat(250), kanaele: ["neuigkeiten", "discord", "mastodon"] });
        expect(zaehlerSatz(f)).toBe("250 von 500 Zeichen (engster Kanal: Mastodon)");
        const zuviel = formular({ text: "a".repeat(573), kanaele: ["neuigkeiten", "mastodon"] });
        expect(zaehlerSatz(zuviel)).toBe("573 von 500 Zeichen, 73 zu viel (Mastodon)");
        expect(zaehlerSatz(formular({ text: "a".repeat(356), kanaele: ["neuigkeiten"] }))).toBe(
            "356 von 4.000 Zeichen (engster Kanal: Neuigkeiten)",
        );
        expect(zaehlerSatz(formular({ kanaele: [] }))).toBe("Kein Kanal gewählt");
    });

    it("die Titelzeile hat eine eigene Grenze und wird im Zähler genannt", () => {
        expect(zaehlerSatz(formular({ titel: "T".repeat(203), text: "Kurz.", kanaele: ["neuigkeiten"] }))).toBe(
            "Titelzeile: 203 von 200 Zeichen, 3 zu viel",
        );
    });

    it("jeder Kanal hat seine Zeile, auch ohne Verbindung: Adressen, Bytes, wegfallende Hashtags, zu viel", () => {
        const f = formular({
            text: "Hallo",
            hashtags: ["#A", "#B", "#C", "#D", "#E"],
            kanaele: ["neuigkeiten"],
        });
        const staende = staendeVon(f);
        const von = (kanal: KanalId) => kanalZeile(staende.find((s) => s.kanal === kanal)!);
        expect(von("neuigkeiten")).toBe("5 von 4.000 Zeichen · Hashtags fallen weg: 5");
        expect(von("mastodon")).toContain("von 500 Zeichen · Adressen zählen 23");
        expect(von("instagram")).toContain("von 2.200 Zeichen");
        const lang = staendeVon(formular({ text: "a".repeat(573) }));
        expect(kanalZeile(lang.find((s) => s.kanal === "mastodon")!)).toContain("73 zu viel");
        // Bluesky ist aus dem Hub entfernt (Vali 2026-11-01): keine Zeile dafür.
        expect(staende.map((s) => s.kanal as string)).not.toContain("bluesky");
    });

    it("🔴 der Satz zu jedem Sperrgrund der Zählung", () => {
        expect(sperrSatz({ art: "text_fehlt" })).toBe("Text fehlt");
        expect(sperrSatz({ art: "titel_fehlt" })).toBe("Titelzeile fehlt");
        expect(sperrSatz({ art: "kein_kanal" })).toBe("Kein Kanal gewählt");
        expect(sperrSatz({ art: "kanal_nicht_verbunden", kanal: "mastodon" })).toBe(
            "Mastodon ist noch nicht verbunden",
        );
        expect(sperrSatz({ art: "zu_lang", kanal: "mastodon", zuviel: 73, teil: "text" })).toBe(
            "Mastodon: 73 Zeichen zu viel",
        );
        expect(sperrSatz({ art: "zu_lang", kanal: "mastodon", zuviel: 600, teil: "bytes" })).toBe(
            "Mastodon: 600 Bytes zu viel",
        );
        expect(sperrSatz({ art: "zu_lang", kanal: "neuigkeiten", zuviel: 1, teil: "titel" })).toBe(
            "Titelzeile: 1 Zeichen zu viel",
        );
        expect(sperrSatz({ art: "beschreibung_fehlt" })).toBe("Bildbeschreibung fehlt");
        expect(sperrSatz({ art: "bild_nicht_geklaert" })).toBe("Die Rechte des Bildes lassen keinen Beitrag zu");
    });

    it("🔴 ein Bild ohne Bildbeschreibung sperrt, ein Bild mit ungeklärten Rechten auch; ohne Bild gibt es keinen Grund", () => {
        const bild = "33333333-3333-4333-8333-333333333333";
        expect(passtNicht(pruefungAusFormular(formular({ text: "Etwas.", bild })))).toBe(
            "Bildbeschreibung fehlt. Im Feld „Bildbeschreibung“ eintragen, was auf dem Bild zu sehen ist.",
        );
        expect(
            passtNicht(pruefungAusFormular(formular({ text: "Etwas.", bild, bildBeschreibung: "Eine Karte." }), false)),
        ).toBe(
            "Die Rechte des Bildes lassen keinen Beitrag zu. Die Rechte in der Medienverwaltung klären oder ein anderes Bild nehmen.",
        );
        expect(
            passtNicht(pruefungAusFormular(formular({ text: "Etwas.", bild, bildBeschreibung: "Eine Karte." }), true)),
        ).toBeUndefined();
        expect(passtNicht(pruefungAusFormular(formular({ text: "Etwas." })))).toBeUndefined();
    });

    it("Lizenz und Klärung aus dem Medienkern lesen sich als Satz", () => {
        expect(bildRechte("own_work", "cleared")).toBe("Rechte: Eigenes Werk · Klärung: geprüft");
        expect(bildRechte(null, null)).toBe("Rechte: unbekannt · Klärung: unbekannt");
    });

    it("das Formular: aus der Zeile und zurück, gleich/ungleich, der Rumpf an die Leitung", () => {
        const z = zeile({ bild: "33333333-3333-4333-8333-333333333333", bildBeschreibung: "Eine Karte." });
        const f = formularAus(z);
        expect(gleich(f, formularAus(z))).toBe(true);
        expect(gleich({ ...f, text: f.text + "!" }, f)).toBe(false);
        expect(gleich({ ...f, hashtags: [] }, f)).toBe(false);
        expect(inhaltVon({ ...f, titel: "  " }).titel).toBeNull();
        // Ohne Bild gibt es keine Bildbeschreibung.
        expect(inhaltVon({ ...f, bild: null }).bildBeschreibung).toBeNull();
        expect(inhaltVon(f).bildBeschreibung).toBe("Eine Karte.");
    });
});

describe("Fenster: Fuß je Zustand und Recht", () => {
    const knoepfe = (z: SocialZeile | undefined, rechte: readonly string[], ich = ICH, sperre?: string) => {
        const rolle = { freigeber: rechte.includes("manage_news"), eigen: z === undefined || z.verfasser?.id === ich };
        return fussVon(z, rolle, sperre, z === undefined ? leeresFormular() : formularAus(z));
    };
    const aktionen = (stand: ReturnType<typeof knoepfe>) => stand.knoepfe.map((k) => k.aktion);

    it("🔴 Entwurf: der Verfasser speichert und legt vor (Hauptknopf), der Betreiber gibt den eigenen allein frei", () => {
        const eigen = knoepfe(zeile(), editor);
        expect(aktionen(eigen)).toEqual(["verwerfen", "speichern", "vorlegen"]);
        expect(eigen.knoepfe.find((k) => k.aktion === "vorlegen")?.haupt).toBe(true);
        const chef = knoepfe(zeile(), betreiber);
        expect(aktionen(chef)).toEqual(["verwerfen", "speichern", "vorlegen", "freigeben"]);
        expect(chef.knoepfe.find((k) => k.aktion === "vorlegen")?.haupt).toBe(false);
        expect(chef.satz).toBe(
            "Geht an 1 Kanal: Neuigkeiten · eigener Beitrag: Freigabe ohne zweite Person steht im Verlauf",
        );
        // Ein neuer Beitrag hat nichts zu verwerfen.
        expect(aktionen(knoepfe(undefined, editor))).toEqual(["speichern", "vorlegen"]);
        // Den fremden Entwurf gibt der Betreiber noch nicht frei.
        expect(aktionen(knoepfe(zeile({ verfasser: { id: ANDERE, name: "E" } }), betreiber))).toEqual([
            "verwerfen",
            "speichern",
            "vorlegen",
        ]);
    });

    it("Entwurf: was nicht passt, sperrt Vorlegen und Freigeben mit dem Grund; Speichern bleibt", () => {
        const stand = knoepfe(zeile(), betreiber, ICH, "Bildbeschreibung fehlt");
        const von = (aktion: string) => stand.knoepfe.find((k) => k.aktion === aktion);
        expect(von("vorlegen")?.gesperrt).toBe("Bildbeschreibung fehlt");
        expect(von("freigeben")?.gesperrt).toBe("Bildbeschreibung fehlt");
        expect(von("speichern")?.gesperrt).toBeUndefined();
    });

    it("zur Freigabe: der Betreiber gibt zurück oder frei (die Routine: verwerfen), der Verfasser zieht zurück, andere lesen", () => {
        const vorgelegt = zeile({ zustand: "vorgelegt" });
        expect(aktionen(knoepfe(vorgelegt, betreiber, ANDERE))).toEqual(["zurueckgeben", "freigeben"]);
        expect(
            aktionen(knoepfe(zeile({ zustand: "vorgelegt", herkunft: "routine", verfasser: null }), betreiber)),
        ).toEqual(["verwerfen", "freigeben"]);
        expect(aktionen(knoepfe(vorgelegt, editor, ICH))).toEqual(["zurueckziehen"]);
        const fremd = knoepfe(vorgelegt, editor, ANDERE);
        expect(fremd.knoepfe).toEqual([]);
        expect(fremd.satz).toBe("Wartet auf Freigabe durch einen Betreiber.");
    });

    it("veröffentlicht: der Betreiber nimmt zurück und veröffentlicht die Änderung; zurückgenommen bleibt nur der Satz", () => {
        const draussen = zeile({
            zustand: "veroeffentlicht",
            ziele: [
                {
                    kanal: "neuigkeiten",
                    zustand: "ok",
                    adresse: "news:1",
                    fehler: null,
                    versuche: 1,
                    sendeAt: null,
                    ausstehend: null,
                },
            ],
        });
        expect(aktionen(knoepfe(draussen, betreiber))).toEqual(["zuruecknehmen"]);
        expect(aktionen(knoepfe({ ...draussen, geaendert: true }, betreiber))).toEqual(["zuruecknehmen", "aenderung"]);
        expect(knoepfe(draussen, editor).knoepfe).toEqual([]);
        expect(knoepfe(draussen, editor).satz).toBe("Veröffentlicht. Änderungen gehen über einen Betreiber.");
        const zurueck = { ...draussen, ziele: [{ ...draussen.ziele[0]!, zustand: "zurueck" as const }] };
        const stand = knoepfe(zurueck, betreiber);
        expect(stand.knoepfe).toEqual([]);
        expect(stand.satz).toBe("Zurückgenommen: die Neuigkeit ist versteckt.");
    });

    it("Papierkorb: ↺ für den Verfasser oder einen Betreiber, der Satz nennt die 30 Tage und das Verfallen", () => {
        const korb = knoepfe(zeile({ papierkorb: true }), editor);
        expect(aktionen(korb)).toEqual(["zurueckholen"]);
        expect(korb.satz).toBe("Im Papierkorb, endgültig weg nach 30 Tagen.");
        expect(knoepfe(zeile({ papierkorb: true, verfallen: true }), betreiber).satz).toContain(
            "Verfallen nach sieben Tagen",
        );
        const fremd = knoepfe(zeile({ papierkorb: true, verfasser: { id: ANDERE, name: "E" } }), editor);
        expect(fremd.knoepfe[0]?.gesperrt).toBe("Aus dem Papierkorb holt der Verfasser oder ein Betreiber");
    });

    it("bearbeiten darf der Verfasser den Entwurf; was vorgelegt oder veröffentlicht ist, nur wer freigibt; der Papierkorb niemand", () => {
        const rolle = (freigeber: boolean, eigen: boolean) => ({ freigeber, eigen });
        expect(bearbeitbar(undefined, rolle(false, true))).toBe(true);
        expect(bearbeitbar(zeile(), rolle(false, true))).toBe(true);
        expect(bearbeitbar(zeile(), rolle(false, false))).toBe(false);
        expect(bearbeitbar(zeile(), rolle(true, false))).toBe(true);
        expect(bearbeitbar(zeile({ zustand: "vorgelegt" }), rolle(false, true))).toBe(false);
        expect(bearbeitbar(zeile({ zustand: "vorgelegt" }), rolle(true, false))).toBe(true);
        expect(bearbeitbar(zeile({ zustand: "veroeffentlicht" }), rolle(true, true))).toBe(true);
        expect(bearbeitbar(zeile({ papierkorb: true }), rolle(true, true))).toBe(false);
    });
});

describe("Fenster: Verlauf und Vorlage aus dem Vorgang", () => {
    it("der Verlauf in Worten, ohne den Text des Beitrags", () => {
        const verlauf: SocialVerlauf[] = [
            { art: "angelegt", von: { id: ICH, name: "Vali" }, text: null, at: "2026-10-31T10:00:00.000Z" },
            {
                art: "freigegeben",
                von: { id: ICH, name: "Vali" },
                text: "allein freigegeben",
                at: "2026-10-31T10:05:00.000Z",
            },
            { art: "gesendet", von: { id: ICH, name: "Vali" }, text: "Neuigkeiten", at: "2026-10-31T10:05:00.000Z" },
            { art: "verfallen", von: null, text: "nach sieben Tagen ohne Freigabe", at: "2026-10-31T10:06:00.000Z" },
            { art: "in_systemsteuerung", von: null, text: "versteckt", at: "2026-10-31T10:07:00.000Z" },
        ];
        const zeilen = verlaufZeilen(verlauf, new Date("2026-10-31T10:10:00.000Z"));
        expect(zeilen.map((z) => z.text)).toEqual([
            "angelegt von Vali",
            "freigegeben von Vali allein freigegeben",
            "gesendet an Neuigkeiten",
            "verfallen nach sieben Tagen ohne Freigabe",
            "Systemsteuerung: versteckt",
        ]);
        expect(new Set(zeilen.map((z) => z.key)).size).toBe(5);
    });

    it("🔴 „Als Beitrag vorschlagen“ nimmt nur Gegenstand und Ergebnis mit, nie Namen, Kontakt oder Text des Melders", () => {
        expect(vorlageAusVorgang("Wehrheim", "Lage korrigiert")).toBe("Wehrheim: Lage korrigiert.");
        expect(vorlageAusVorgang("Wehrheim", null)).toBe("Wehrheim.");
        expect(vorlageAusVorgang(null, "Lage korrigiert")).toBe("");
        expect(vorlageAusVorgang(undefined, undefined)).toBe("");
    });
});

describe("Steuerung der Fenster", () => {
    const verbunden = () => {
        const fenster = createWerkzeugfenster(undefined);
        const redaktion = createRedaktion();
        const gezeigt: (string | undefined)[] = [];
        redaktion.verbinde({
            fenster,
            zeige: () => undefined,
            oeffneImEditor: () => undefined,
            zeigeMeldungen: (unterreiter) => void gezeigt.push(unterreiter),
        });
        return { fenster, redaktion, gezeigt };
    };

    it("Beiträge öffnen als Werkzeugfenster `beitrag`; ein zweiter ersetzt den ersten im selben Fenster; Vorgänge und Bewertungen zählen nicht mit", () => {
        const { redaktion } = verbunden();
        redaktion.oeffneBeitrag("12", "SOC-000012");
        expect(redaktion.beitragFenster.value.map((f) => [f.werkzeug, f.gegenstand])).toEqual([
            [BEITRAG_WERKZEUG, "12"],
        ]);
        expect(redaktion.vorgangFenster.value).toEqual([]);
        expect(redaktion.bewertungFenster.value).toEqual([]);
        redaktion.oeffneBeitrag("13", "SOC-000013");
        expect(redaktion.beitragFenster.value.map((f) => f.gegenstand)).toEqual(["13"]);
    });

    it("🔴 trägt das Fenster eine Eingabe, geht sie nicht verloren: Es wird abgelegt, der neue Beitrag bekommt ein eigenes", () => {
        const { redaktion, fenster } = verbunden();
        const id = redaktion.oeffneBeitrag(NEUER_BEITRAG, "Neuer Beitrag")!;
        fenster.markiere(id, { ungespeichert: true });
        redaktion.oeffneBeitrag("12", "SOC-000012");
        const alle = redaktion.beitragFenster.value;
        expect(alle.map((f) => [f.gegenstand, f.lage === "versenkt"])).toEqual([
            [NEUER_BEITRAG, true],
            ["12", false],
        ]);
    });

    it("die Vorlage von „Als Beitrag vorschlagen“ gilt genau einmal; ein Öffnen ohne Vorlage räumt eine alte weg", () => {
        const { redaktion } = verbunden();
        redaktion.oeffneBeitrag(NEUER_BEITRAG, "Neuer Beitrag", {
            text: "Wehrheim: Lage korrigiert.",
            vorgang: 110,
            rubrik: "community",
        });
        expect(redaktion.nimmBeitragVorlage()).toEqual({
            text: "Wehrheim: Lage korrigiert.",
            vorgang: 110,
            rubrik: "community",
        });
        expect(redaktion.nimmBeitragVorlage()).toBeUndefined();
        redaktion.oeffneBeitrag(NEUER_BEITRAG, "Neuer Beitrag", { text: "x", vorgang: 1, rubrik: "community" });
        redaktion.oeffneBeitrag("12", "t");
        expect(redaktion.nimmBeitragVorlage()).toBeUndefined();
    });

    it("ist der neue Beitrag gespeichert, trägt das Fenster dessen Nummer und gilt nicht mehr als ungespeichert", () => {
        const { redaktion, fenster } = verbunden();
        const id = redaktion.oeffneBeitrag(NEUER_BEITRAG, "Neuer Beitrag")!;
        fenster.markiere(id, { ungespeichert: true });
        redaktion.beitragAngelegt(id, "14", "SOC-000014 · Entwurf");
        const f = redaktion.beitragFenster.value[0]!;
        expect([f.gegenstand, f.titel, f.ungespeichert]).toEqual(["14", "SOC-000014 · Entwurf", false]);
    });

    it("der Klick in der Glocke zeigt den Social Hub und öffnet, mit SOC-Nummer, diesen Beitrag", () => {
        const { redaktion, gezeigt } = verbunden();
        expect(redaktion.oeffneSocial("SOC-000012")).toBe(true);
        expect(gezeigt).toEqual(["social"]);
        expect(redaktion.beitragFenster.value.map((f) => f.gegenstand)).toEqual(["12"]);
        expect(redaktion.oeffneSocial(null)).toBe(true);
        expect(redaktion.beitragFenster.value).toHaveLength(1);
        expect(createRedaktion().oeffneSocial("SOC-000012")).toBe(false);
        expect(createRedaktion().oeffneBeitrag("12", "t")).toBeUndefined();
    });
});

describe("Die Schritte an der Leitung", () => {
    const antwort = (status: number, body: unknown): Response =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const quittung = { id: 12, nr: "SOC-000012", revision: 3, zustand: "vorgelegt" };

    it("fragt die Liste mit Segment und den gesetzten Filtern", async () => {
        const urls: string[] = [];
        await ladeBeitraege(
            anfrageVon("papierkorb", "Havena", { kanal: ["neuigkeiten"], herkunft: ["routine"] }),
            (url) => {
                urls.push(String(url));
                return Promise.resolve(antwort(200, { zeilen: [], zaehler: {} }));
            },
        );
        const adresse = new URL(urls[0] ?? "", "https://x.test");
        expect(adresse.pathname).toBe("/api/community/social");
        expect(Object.fromEntries(adresse.searchParams)).toEqual({
            segment: "papierkorb",
            q: "Havena",
            kanal: "neuigkeiten",
            herkunft: "routine",
        });
    });

    it("🔴 dieselbe Handlung schickt dieselbe Kennung, bis sie durch ist; ein Netzfehler lässt sie stehen", async () => {
        kennungFrei("12/vorlegen");
        const erste = kennung("12/vorlegen");
        expect(kennung("12/vorlegen")).toBe(erste);
        await expect(
            fuehreAus(12, "vorlegen", 2, {}, () => Promise.reject(new TypeError("offline"))),
        ).rejects.toBeDefined();
        expect(kennung("12/vorlegen")).toBe(erste);
        const gesendet: { url: string; body: Record<string, unknown> }[] = [];
        await fuehreAus(12, "vorlegen", 2, {}, (url, init) => {
            gesendet.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
            return Promise.resolve(antwort(200, quittung));
        });
        expect(gesendet[0]?.url).toBe("/api/community/social/12/vorlegen");
        expect(gesendet[0]?.body).toMatchObject({ operationId: erste, baseRevision: 2 });
        expect(kennung("12/vorlegen")).not.toBe(erste);
        kennungFrei("12/vorlegen");
    });

    it("eine Absage des Servers (Konflikt) gibt die Kennung frei; zurückgeben trägt den Grund, erneut den Kanal", async () => {
        kennungFrei("12/zurueckgeben");
        const erste = kennung("12/zurueckgeben");
        const fehler = await fuehreAus(12, "zurueckgeben", 2, { grund: "Die Rubrik prüfen." }, () =>
            Promise.resolve(antwort(409, { error: { code: "community_conflict", message: "x", status: 409 } })),
        ).catch((e: unknown) => e);
        expect(fehler).toBeInstanceOf(ApiFailure);
        expect(kennung("12/zurueckgeben")).not.toBe(erste);
        kennungFrei("12/zurueckgeben");
        const rumpf: Record<string, unknown>[] = [];
        await fuehreAus(12, "erneut", 4, { kanal: "neuigkeiten" }, (_url, init) => {
            rumpf.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
            return Promise.resolve(antwort(200, quittung));
        });
        expect(rumpf[0]).toMatchObject({ baseRevision: 4, kanal: "neuigkeiten" });
    });

    it("Speichern und Anlegen: derselbe Inhalt schickt dieselbe Kennung (auch nach einem Netzfehler), anderer Inhalt eine neue", async () => {
        const f: Formular = { ...leeresFormular(), titel: "Titel", text: "Text" };
        const kennungen: string[] = [];
        const fetcher = (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            kennungen.push((JSON.parse(String(init?.body)) as { operationId: string }).operationId);
            return Promise.reject(new TypeError("offline"));
        };
        await legeBeitragAn(f, undefined, fetcher).catch(() => undefined);
        await legeBeitragAn(f, undefined, fetcher).catch(() => undefined);
        expect(new Set(kennungen).size).toBe(1);
        await legeBeitragAn({ ...f, text: "Anderer Text" }, undefined, fetcher).catch(() => undefined);
        expect(new Set(kennungen).size).toBe(2);
        const urls: string[] = [];
        const rumpf: Record<string, unknown>[] = [];
        await speichereBeitrag(12, 2, f, (url, init) => {
            urls.push(String(url));
            rumpf.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
            return Promise.resolve(antwort(200, quittung));
        });
        expect(urls[0]).toBe("/api/community/social/12/aendern");
        expect(rumpf[0]).toMatchObject({
            baseRevision: 2,
            titel: "Titel",
            text: "Text",
            rubrik: "community",
            kanaele: ["neuigkeiten"],
        });
        // Mit Vorgang trägt die Anlage die COM-Nummer.
        const angelegt: Record<string, unknown>[] = [];
        await legeBeitragAn({ ...f, titel: "Aus Vorgang" }, 110, (_url, init) => {
            angelegt.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
            return Promise.resolve(antwort(201, quittung));
        });
        expect(angelegt[0]).toMatchObject({ vorgang: 110 });
    });

    it("die Bilder der Medienverwaltung: Suche, nur Bilder, je Gruppe eines; Titel, Rechte und Vorschau", async () => {
        const urls: string[] = [];
        const treffer = await sucheBilder(" Karte ", {}, (url) => {
            urls.push(String(url));
            if (String(url).includes("/bilder/urteile")) {
                return Promise.resolve(
                    antwort(200, {
                        urteile: [
                            {
                                id: "33333333-3333-4333-8333-333333333333",
                                erlaubt: true,
                                grund: "rule",
                                nennung: null,
                                oeffentlich: true,
                            },
                        ],
                    }),
                );
            }
            return Promise.resolve(
                antwort(200, {
                    items: [
                        {
                            id: "33333333-3333-4333-8333-333333333333",
                            title: "Reichsstraße",
                            rightsBasis: "own_work",
                            clearance: "cleared",
                            preview: { url: "/media/sha256/ab/x.webp", width: 10, height: 10 },
                        },
                        { id: "44444444-4444-4444-8444-444444444444", title: null, rightsBasis: null, clearance: null },
                    ],
                    total: 2,
                    limit: 12,
                    offset: 0,
                }),
            );
        });
        const parameter = new URL(urls[0] ?? "", "https://x.test").searchParams;
        expect(parameter.get("kind")).toBe("image");
        expect(parameter.get("groupFiles")).toBe("true");
        expect(parameter.get("q")).toBe("Karte");
        expect(parameter.get("type")).toBeNull();
        expect(parameter.get("sort")).toBe("name");
        expect(treffer.gesamt).toBe(2);
        expect(treffer.bilder).toEqual([
            {
                id: "33333333-3333-4333-8333-333333333333",
                titel: "Reichsstraße",
                rechtsbasis: "own_work",
                klaerung: "cleared",
                vorschau: "/media/sha256/ab/x.webp",
                erlaubt: true,
                grund: "rule",
                nennung: null,
                oeffentlich: true,
            },
            // 🔴 Ohne Urteil des Servers ist nichts erlaubt.
            {
                id: "44444444-4444-4444-8444-444444444444",
                titel: null,
                rechtsbasis: null,
                klaerung: null,
                vorschau: null,
                erlaubt: false,
                grund: "rights_missing",
                nennung: null,
                oeffentlich: false,
            },
        ]);
        expect(urls[1]).toContain(
            "/bilder/urteile?ids=33333333-3333-4333-8333-333333333333,44444444-4444-4444-8444-444444444444",
        );
    });

    it("🔴 ein Bild unter Notaus zeigt keine Vorschau: Seine öffentliche Datei liegt in Quarantäne", async () => {
        const treffer = await sucheBilder("", {}, (url) =>
            Promise.resolve(
                antwort(
                    200,
                    String(url).includes("/bilder/urteile")
                        ? { urteile: [] }
                        : {
                              items: [
                                  {
                                      id: "33333333-3333-4333-8333-333333333333",
                                      title: "Gehalten",
                                      suspended: true,
                                      preview: { url: "/media/sha256/ab/x.webp", width: 10, height: 10 },
                                  },
                              ],
                              total: 1,
                              limit: 24,
                              offset: 0,
                          },
                ),
            ),
        );
        expect(treffer.bilder[0]?.vorschau).toBeNull();
    });

    it("🔴 eine leere Trefferliste fragt nicht nach Urteilen", async () => {
        const urls: string[] = [];
        const treffer = await sucheBilder("", {}, (url) => {
            urls.push(String(url));
            return Promise.resolve(antwort(200, { items: [], total: 0, limit: 24, offset: 0 }));
        });
        expect(treffer.bilder).toEqual([]);
        expect(urls).toHaveLength(1);
    });
});

// --- Fremde Kanäle (WI-0268 C12a) ---------------------------------------------------------------------------------------------------

const GRENZEN = {
    zeichen: 500,
    adresse: 23,
    bilder: 4,
    beschreibung: 1500,
    bildBytes: 16_777_216,
    bildTypen: ["image/webp"],
};
const mastodon = (patch: Partial<SocialKanalStand> = {}): SocialKanalStand => ({
    kanal: "mastodon",
    eingerichtet: true,
    freigeschaltet: true,
    freigeschaltetAt: "2026-11-01T10:00:00.000Z",
    notschalter: false,
    grenzen: GRENZEN,
    grenzenAt: "2026-11-01T09:00:00.000Z",
    bereit: true,
    sperre: null,
    ...patch,
});

describe("Fremde Kanäle: wählbar nur, wenn der Server sie bereit meldet", () => {
    afterEach(() => {
        kanalStaende.value = [];
        kanalVerwalten.value = false;
    });

    it("🔴 ohne Stand vom Server senden nur die Neuigkeiten, und Mastodon ist gesperrt wie bisher", () => {
        expect(kanalOffen("neuigkeiten")).toBe(true);
        expect(kanalOffen("mastodon")).toBe(false);
        expect(kanalGrund("mastodon")).toBe("Mastodon ist nicht verbunden, eigener Auftrag");
        expect(kanalStand("mastodon")).toBe("nicht verbunden");
        expect(kanalStand("neuigkeiten")).toBe("immer da");
    });

    it("🔴 gesperrt mit dem Grund: nicht eingerichtet, Zählregel noch nicht geprüft, Notschalter", () => {
        kanalStaende.value = [mastodon({ eingerichtet: false, bereit: false, sperre: "nicht_eingerichtet" })];
        expect(kanalOffen("mastodon")).toBe(false);
        expect(kanalGrund("mastodon")).toBe("Mastodon ist in dieser Umgebung nicht eingerichtet");
        expect(kanalStand("mastodon")).toBe("nicht eingerichtet");
        kanalStaende.value = [mastodon({ freigeschaltet: false, bereit: false, sperre: "nicht_freigeschaltet" })];
        expect(kanalGrund("mastodon")).toBe("Mastodon: Zählregel noch nicht geprüft");
        expect(kanalStand("mastodon")).toBe("Zählregel noch nicht geprüft");
        kanalStaende.value = [mastodon({ notschalter: true, bereit: false, sperre: "notschalter" })];
        expect(kanalGrund("mastodon")).toBe("Mastodon: Notschalter steht an");
        // Der Sperrgrund der Zählung sagt dasselbe wie der Tooltip der Wahl.
        const z = zeile({ zustand: "vorgelegt", kanaele: ["neuigkeiten", "mastodon"] });
        expect(zeilenKnoepfe(z, betreiber, ICH).freigeben.grund).toBe(
            "Mastodon: Notschalter steht an. Mastodon abwählen, bis der Kanal wieder sendet.",
        );
    });

    it("🔴 bereit: Mastodon ist wählbar und „verbunden“; ✓ geht, wenn der Beitrag passt", () => {
        kanalStaende.value = [mastodon()];
        expect(kanalOffen("mastodon")).toBe(true);
        expect(kanalGrund("mastodon")).toBeUndefined();
        expect(kanalStand("mastodon")).toBe("verbunden");
        const z = zeile({ zustand: "vorgelegt", kanaele: ["neuigkeiten", "mastodon"] });
        expect(zeilenKnoepfe(z, betreiber, ICH).freigeben).toEqual({ zeigen: true });
        expect(
            passtNicht(pruefungAusFormular({ ...leeresFormular(), titel: "T", text: "Hallo", kanaele: ["mastodon"] })),
        ).toBeUndefined();
    });

    it("🔴 der Zähler nimmt die Grenzen der Instanz statt fester Zahlen (Grenze 800, Adresse zählt 30)", () => {
        const f: Formular = { ...leeresFormular(), titel: "T", text: "a".repeat(600), kanaele: ["mastodon"] };
        expect(zaehlerSatz(f)).toBe("600 von 500 Zeichen, 100 zu viel (Mastodon)");
        kanalStaende.value = [mastodon({ grenzen: { ...GRENZEN, zeichen: 800, adresse: 30 } })];
        expect(zaehlerSatz(f)).toBe("600 von 800 Zeichen (engster Kanal: Mastodon)");
        const mitAdresse: Formular = { ...f, text: `Karte: https://avesmaps.de/${"x".repeat(60)}` };
        const zeileMastodon = kanalZeile(staendeVon(mitAdresse).find((st) => st.kanal === "mastodon")!);
        expect(zeileMastodon).toContain("von 800 Zeichen · Adressen zählen 30");
        // Das Fenster zeigt auch die gesperrte Zählung nach den Grenzen der Instanz.
        kanalStaende.value = [
            mastodon({
                bereit: false,
                sperre: "notschalter",
                notschalter: true,
                grenzen: { ...GRENZEN, zeichen: 800 },
            }),
        ];
        expect(zaehlerSatz(f)).toBe("600 von 800 Zeichen (engster Kanal: Mastodon)");
        expect(passtNicht(pruefungAusFormular({ ...f, kanaele: ["mastodon"] }))).toBe(
            "Mastodon: Notschalter steht an. Mastodon abwählen, bis der Kanal wieder sendet.",
        );
    });

    it("🔴 der Satz zum Sperrgrund „Kanal nicht verbunden“ nennt den Grund, wo der Server ihn kennt", () => {
        expect(sperrSatz({ art: "kanal_nicht_verbunden", kanal: "mastodon", sperre: "nicht_freigeschaltet" })).toBe(
            "Mastodon: Zählregel noch nicht geprüft",
        );
        expect(sperrSatz({ art: "kanal_nicht_verbunden", kanal: "mastodon", sperre: "nicht_eingerichtet" })).toBe(
            "Mastodon ist in dieser Umgebung nicht eingerichtet",
        );
    });
});

describe("Fremde Kanäle: der Stand je Ziel und das Zurücknehmen", () => {
    const ziel = (patch: Partial<SocialZiel> = {}): SocialZiel => ({
        kanal: "mastodon",
        zustand: "ok",
        adresse: "https://mastodon.beispiel.test/@konto/1001",
        fehler: null,
        versuche: 1,
        sendeAt: "2026-11-01T10:00:00.000Z",
        ausstehend: null,
        ...patch,
    });

    it("🔴 der Stand: wartet, ✓ gesendet mit Link, nicht gesendet mit Grund, zurückgenommen; der Link nur als https", () => {
        expect(zielAnzeige(ziel({ zustand: "wartet", adresse: null, ausstehend: "senden" }))).toEqual({
            chip: "Mastodon: wartet",
            link: null,
            grund: null,
            ausstehend: "wird gesendet …",
        });
        expect(zielAnzeige(ziel())).toEqual({
            chip: "Mastodon ✓",
            link: "https://mastodon.beispiel.test/@konto/1001",
            grund: null,
            ausstehend: null,
        });
        expect(
            zielAnzeige(ziel({ zustand: "fehler", adresse: null, fehler: "Mastodon bremst gerade (429)" })),
        ).toMatchObject({
            chip: "Mastodon: Fehler",
            link: null,
            grund: "nicht gesendet: Mastodon bremst gerade (429)",
        });
        expect(zielAnzeige(ziel({ zustand: "zurueck" }))).toMatchObject({
            chip: "Mastodon: zurückgenommen",
            link: null,
        });
        expect(zielAnzeige(ziel({ fehler: "Das Konto darf das bei Mastodon nicht (403)" })).grund).toBe(
            "Zurücknehmen gescheitert: Das Konto darf das bei Mastodon nicht (403)",
        );
        expect(zielAnzeige(ziel({ ausstehend: "zuruecknehmen" })).ausstehend).toBe("wird zurückgenommen …");
        // Nie ein Link, der nicht auf https zeigt; die Neuigkeit hat keinen (ihre Adresse ist die Kennung des Eintrags).
        expect(zielAnzeige(ziel({ adresse: "javascript:alert(1)" })).link).toBeNull();
        expect(zielAnzeige(ziel({ adresse: "http://mastodon.beispiel.test/x" })).link).toBeNull();
        expect(zielAnzeige(ziel({ kanal: "neuigkeiten", adresse: "news:12" })).link).toBeNull();
    });

    it("🔴 Zurücknehmen bei einem fremden Kanal: nur ein Betreiber, nur ein gesendetes Ziel, nicht zweimal", () => {
        const draussen = zeile({ zustand: "veroeffentlicht", kanaele: ["neuigkeiten", "mastodon"], ziele: [ziel()] });
        expect(darfKanalZuruecknehmen(draussen, "mastodon", true)).toBe(true);
        expect(darfKanalZuruecknehmen(draussen, "mastodon", false)).toBe(false);
        expect(darfKanalZuruecknehmen(draussen, "neuigkeiten", true)).toBe(false);
        expect(
            darfKanalZuruecknehmen({ ...draussen, ziele: [ziel({ ausstehend: "zuruecknehmen" })] }, "mastodon", true),
        ).toBe(false);
        expect(darfKanalZuruecknehmen({ ...draussen, ziele: [ziel({ zustand: "zurueck" })] }, "mastodon", true)).toBe(
            false,
        );
        expect(darfKanalZuruecknehmen({ ...draussen, zustand: "vorgelegt" }, "mastodon", true)).toBe(false);
        expect(darfKanalZuruecknehmen(undefined, "mastodon", true)).toBe(false);
    });

    it("🔴 der Fuß gehört der Neuigkeit: ohne sie (nur Mastodon) gibt es weder „Zurücknehmen“ noch „Änderung veröffentlichen“, und eine zurückgenommene Neuigkeit lässt sie ruhen", () => {
        const fuss = (z: SocialZeile) =>
            fussVon(z, { freigeber: true, eigen: true }, undefined, formularAus(z)).knoepfe.map((k) => k.aktion);
        const beide = zeile({
            zustand: "veroeffentlicht",
            geaendert: true,
            kanaele: ["neuigkeiten", "mastodon"],
            ziele: [
                {
                    kanal: "neuigkeiten",
                    zustand: "ok",
                    adresse: "news:1",
                    fehler: null,
                    versuche: 1,
                    sendeAt: null,
                    ausstehend: null,
                },
                ziel(),
            ],
        });
        expect(fuss(beide)).toEqual(["zuruecknehmen", "aenderung"]);
        expect(fuss({ ...beide, kanaele: ["mastodon"], ziele: [ziel()] })).toEqual([]);
        const neuigkeitZurueck = {
            ...beide,
            ziele: [{ ...beide.ziele[0]!, zustand: "zurueck" as const }, ziel()],
        };
        expect(fuss(neuigkeitZurueck)).toEqual([]);
        // Die Notiz „Änderung noch nicht veröffentlicht“ gibt es nur, wo die Neuigkeit sie veröffentlichen kann.
        expect(notiz(beide)).toBe("Änderung noch nicht veröffentlicht");
        expect(notiz({ ...beide, kanaele: ["mastodon"] })).toBeUndefined();
    });
});

describe("Fremde Kanäle: Stand und Handgriffe an der Leitung", () => {
    afterEach(() => {
        kanalStaende.value = [];
        kanalVerwalten.value = false;
    });

    const antwort = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

    it("lädt den Stand in die gemeinsame Tafel; kommt er nicht, gilt der letzte weiter", async () => {
        const urls: string[] = [];
        const ok = await aktualisiereKanaele((url) => {
            urls.push(String(url));
            return Promise.resolve(antwort({ kanaele: [mastodon()], verwalten: true }));
        });
        expect(ok).toBe(true);
        expect(urls).toEqual(["/api/community/social/kanaele"]);
        expect(kanalStaende.value).toHaveLength(1);
        expect(kanalVerwalten.value).toBe(true);
        expect(kanalOffen("mastodon")).toBe(true);
        const kaputt = await aktualisiereKanaele(() => Promise.reject(new TypeError("netz")));
        expect(kaputt).toBe(false);
        expect(kanalStaende.value).toHaveLength(1);
    });

    it("🔴 Fund eines Editors 2026-11-04: Rechte bestätigen und Freigeben fragen nach dem zweiten Faktor und wiederholen einmal mit derselben Kennung", async () => {
        const bestaetige = async <T>(lauf: Promise<T>): Promise<T> => {
            await vi.waitFor(() => {
                expect(pendingConfirmation.value?.need).toBe("second_factor");
            });
            pendingConfirmation.value?.resolve(true);
            return lauf;
        };
        const stelle = (ergebnis: unknown) => {
            const koerper: string[] = [];
            const hole = (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
                koerper.push(String(init?.body));
                return Promise.resolve(
                    koerper.length === 1
                        ? antwort(
                              {
                                  error: {
                                      code: "assurance_required",
                                      message: "x",
                                      details: { need: "second_factor" },
                                  },
                              },
                              403,
                          )
                        : antwort(ergebnis),
                );
            };
            return { koerper, hole };
        };

        const rechte = stelle({ klaerung: "cleared", geklaert: true });
        expect(await bestaetige(bestaetigeBildRechte("bild", rechte.hole))).toEqual({
            klaerung: "cleared",
            geklaert: true,
        });
        expect(rechte.koerper).toHaveLength(2);
        expect(rechte.koerper[1]).toBe(rechte.koerper[0]);

        const quittung = { id: 7, nr: "SOC-000007", revision: 2, zustand: "veroeffentlicht" };
        const schritt = stelle(quittung);
        expect(await bestaetige(fuehreAus(7, "freigeben", 1, {}, schritt.hole))).toEqual(quittung);
        expect(schritt.koerper).toHaveLength(2);
        expect(schritt.koerper[1]).toBe(schritt.koerper[0]);
    });

    it("🔴 Notschalter und Grenzen: je ein Aufruf mit dem Wunsch, der neue Stand ersetzt den alten; nie ein Schlüssel im Rumpf", async () => {
        kanalStaende.value = [mastodon()];
        const aufrufe: { url: string; body: string }[] = [];
        const hole =
            (neu: SocialKanalStand) =>
            (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
                aufrufe.push({ url: String(url), body: String(init?.body) });
                return Promise.resolve(antwort(neu));
            };
        const an = await setzeNotschalter(
            "mastodon",
            true,
            hole(mastodon({ notschalter: true, bereit: false, sperre: "notschalter" })),
        );
        expect(an.notschalter).toBe(true);
        expect(kanalOffen("mastodon")).toBe(false);
        expect(kanalGrund("mastodon")).toBe("Mastodon: Notschalter steht an");
        const gelesen = await liesGrenzenNeu("mastodon", hole(mastodon({ grenzen: { ...GRENZEN, zeichen: 800 } })));
        expect(gelesen.grenzen?.zeichen).toBe(800);
        expect(aufrufe).toEqual([
            { url: "/api/community/social/kanaele/mastodon/notschalter", body: '{"an":true}' },
            { url: "/api/community/social/kanaele/mastodon/grenzen", body: "{}" },
        ]);
    });

    it("Zurücknehmen bei einem Kanal ist ein Schritt mit dem Kanal im Rumpf und eigener Kennung", async () => {
        const gesendet: { url: string; body: Record<string, unknown> }[] = [];
        await fuehreAus(12, "kanal-zuruecknehmen", 3, { kanal: "mastodon" }, (url, init) => {
            gesendet.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
            return Promise.resolve(antwort({ id: 12, nr: "SOC-000012", revision: 4, zustand: "veroeffentlicht" }));
        });
        expect(gesendet[0]!.url).toBe("/api/community/social/12/kanal-zuruecknehmen");
        expect(gesendet[0]!.body).toMatchObject({ baseRevision: 3, kanal: "mastodon" });
    });
});

describe("Facebook und Instagram im Hub (WI-0268 C12b)", () => {
    const meta = (kanal: "facebook" | "instagram", patch: Partial<SocialKanalStand> = {}): SocialKanalStand => ({
        kanal,
        eingerichtet: true,
        freigeschaltet: true,
        freigeschaltetAt: "2026-11-02T10:00:00.000Z",
        notschalter: false,
        grenzen: {
            zeichen: kanal === "instagram" ? 2200 : 63_206,
            adresse: 0,
            bilder: 1,
            beschreibung: 1000,
            bildBytes: 4_194_304,
            bildTypen: ["image/webp"],
        },
        grenzenAt: "2026-11-02T09:00:00.000Z",
        bereit: true,
        sperre: null,
        ...patch,
    });
    const metaZiel = (kanal: "facebook" | "instagram", patch: Partial<SocialZiel> = {}): SocialZiel => ({
        kanal,
        zustand: "ok",
        adresse:
            kanal === "facebook" ? "https://www.facebook.com/100000000000001_5" : "https://www.instagram.com/p/abc/",
        fehler: null,
        versuche: 1,
        sendeAt: "2026-11-02T10:00:00.000Z",
        ausstehend: null,
        ...patch,
    });

    afterEach(() => {
        kanalStaende.value = [];
    });

    it("🔴 jeder Meta-Kanal ist erst wählbar, wenn der Server ihn bereit meldet - und jeder für sich; der Grund steht da", () => {
        expect(kanalOffen("facebook")).toBe(false);
        expect(kanalOffen("instagram")).toBe(false);
        kanalStaende.value = [
            meta("facebook"),
            meta("instagram", { freigeschaltet: false, bereit: false, sperre: "nicht_freigeschaltet" }),
        ];
        expect(kanalOffen("facebook")).toBe(true);
        expect(kanalStand("facebook")).toBe("verbunden");
        expect(kanalOffen("instagram")).toBe(false);
        expect(kanalGrund("instagram")).toBe("Instagram: Zählregel noch nicht geprüft");
        kanalStaende.value = [
            meta("facebook", { eingerichtet: false, bereit: false, sperre: "nicht_eingerichtet" }),
            meta("instagram", { notschalter: true, bereit: false, sperre: "notschalter" }),
        ];
        expect(kanalGrund("facebook")).toBe("Facebook ist in dieser Umgebung nicht eingerichtet");
        expect(kanalGrund("instagram")).toBe("Instagram: Notschalter steht an");
    });

    it("🔴 Instagram ist nur mit Bild anzuhaken, und das Bild muss öffentlich freigegeben sein; Facebook braucht keins", () => {
        expect(kanalBildGrund("instagram", null, undefined)).toBe("Instagram braucht ein Bild");
        expect(kanalBildGrund("instagram", "bild-1", false)).toBe(
            "Instagram: Das Bild ist nicht öffentlich freigegeben (Rechte nicht geklärt)",
        );
        expect(kanalBildGrund("instagram", "bild-1", true)).toBeUndefined();
        // Meta holt selbst ab: Ein Bild, das nirgends öffentlich ist, geht dort nicht; bei den anderen schon.
        expect(kanalBildGrund("instagram", "bild-1", true, false)).toBe(
            "Instagram holt das Bild selbst ab, und es ist nirgends öffentlich",
        );
        expect(kanalBildGrund("facebook", "bild-1", true, false)).toBeUndefined();
        // Solange die Rechte noch nicht gelesen sind, sperrt allein die Beschreibung (wie bei den anderen Kanälen).
        expect(kanalBildGrund("instagram", "bild-1", undefined)).toBeUndefined();
        expect(kanalBildGrund("facebook", null, undefined)).toBeUndefined();
        expect(kanalBildGrund("neuigkeiten", null, undefined)).toBeUndefined();
    });

    it("🔴 die Prüfung vor dem Freigeben nennt „Instagram sendet nur mit Bild“, wenn es fehlt", () => {
        kanalStaende.value = [meta("facebook"), meta("instagram")];
        const ohne = { ...leeresFormular(), text: "Hallo", titel: "T", kanaele: ["instagram"] as KanalId[] };
        expect(passtNicht(pruefungAusFormular(ohne))).toBe(
            "Instagram sendet nur mit Bild. Ein Bild wählen oder Instagram abwählen.",
        );
        const mit = { ...ohne, bild: "bild-1", bildBeschreibung: "Eine Karte" };
        expect(passtNicht(pruefungAusFormular(mit, true))).toBeUndefined();
        expect(passtNicht(pruefungAusFormular(mit, true, false))).toBe(
            "Instagram holt das Bild selbst ab, und es ist nirgends öffentlich. Ein Bild nehmen, das schon öffentlich ist, oder Instagram abwählen.",
        );
        expect(passtNicht(pruefungAusFormular({ ...ohne, kanaele: ["facebook"] }))).toBeUndefined();
        expect(sperrSatz({ art: "bild_fehlt", kanal: "instagram" })).toBe("Instagram sendet nur mit Bild");
    });

    it("🔴 Zurücknehmen: bei Facebook wie bei Mastodon, bei Instagram gesperrt - mit Grund, nie stumm weg", () => {
        const draussen = (kanal: "facebook" | "instagram") =>
            zeile({ zustand: "veroeffentlicht", kanaele: ["neuigkeiten", kanal], ziele: [metaZiel(kanal)] });
        expect(darfKanalZuruecknehmen(draussen("facebook"), "facebook", true)).toBe(true);
        expect(kanalZurueckSperre(draussen("facebook"), "facebook", true)).toBeUndefined();
        expect(darfKanalZuruecknehmen(draussen("instagram"), "instagram", true)).toBe(false);
        expect(kanalZurueckSperre(draussen("instagram"), "instagram", true)).toBe(
            "Instagram erlaubt kein Löschen über die Schnittstelle; nur in der App zu löschen",
        );
        // Ohne Recht, ohne gesendetes Ziel, im Papierkorb: keine Sperre zu erklären.
        expect(kanalZurueckSperre(draussen("instagram"), "instagram", false)).toBeUndefined();
        expect(
            kanalZurueckSperre(
                { ...draussen("instagram"), ziele: [metaZiel("instagram", { zustand: "fehler" })] },
                "instagram",
                true,
            ),
        ).toBeUndefined();
        expect(kanalZurueckSperre({ ...draussen("instagram"), papierkorb: true }, "instagram", true)).toBeUndefined();
        expect(kanalZurueckSperre(undefined, "instagram", true)).toBeUndefined();
    });

    it("der Stand je Ziel: Chip, Link zum Beitrag bei Meta, Grund eines Fehlers", () => {
        expect(zielAnzeige(metaZiel("facebook"))).toEqual({
            chip: "Facebook ✓",
            link: "https://www.facebook.com/100000000000001_5",
            grund: null,
            ausstehend: null,
        });
        expect(
            zielAnzeige(
                metaZiel("instagram", { zustand: "fehler", adresse: null, fehler: "Instagram sendet nur mit Bild" }),
            ),
        ).toMatchObject({
            chip: "Instagram: Fehler",
            link: null,
            grund: "nicht gesendet: Instagram sendet nur mit Bild",
        });
    });

    it("„Zugang prüfen“ und der Notschalter laufen je Meta-Kanal über dieselbe Leitung wie bei Mastodon", async () => {
        const aufrufe: { url: string; body: string }[] = [];
        const hole = (stand: SocialKanalStand) => (url: unknown, init?: RequestInit) => {
            aufrufe.push({ url: String(url), body: String(init?.body) });
            return Promise.resolve(
                new Response(JSON.stringify(stand), { status: 200, headers: { "Content-Type": "application/json" } }),
            );
        };
        const gelesen = await liesGrenzenNeu("facebook", hole(meta("facebook")) as never);
        expect(gelesen.grenzen?.zeichen).toBe(63_206);
        await setzeNotschalter(
            "instagram",
            true,
            hole(meta("instagram", { notschalter: true, bereit: false, sperre: "notschalter" })) as never,
        );
        expect(aufrufe).toEqual([
            { url: "/api/community/social/kanaele/facebook/grenzen", body: "{}" },
            { url: "/api/community/social/kanaele/instagram/notschalter", body: '{"an":true}' },
        ]);
    });
});

describe("Liste: Titel je Segment (Offen, Veröffentlicht, Papierkorb)", () => {
    it("🔴 drei Titel, in der Sprache der Oberfläche", async () => {
        const { t } = await import("../src/i18n/i18n.ts");
        expect(t("community.social.listentitel.offen")).toBe("Entwürfe");
        expect(t("community.social.listentitel.veroeffentlicht")).toBe("Abgesendete Posts");
        expect(t("community.social.listentitel.papierkorb")).toBe("Verworfene Entwürfe");
    });
});
