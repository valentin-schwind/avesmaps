import { afterEach, describe, expect, it } from "vitest";
import {
    capabilitiesFor,
    istMailAdresse,
    type GesendetZeile,
    type VerlaufEintrag,
    type VorgangZeile,
} from "@avesmaps3d/shared";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster";
import { ladeModulStand } from "../src/community/api";
import {
    NACHFRAGE_HOECHSTENS_MS,
    NACHFRAGE_TAKT_MS,
    antwortAnText,
    antwortGrund,
    antwortKnopfKey,
    antwortWeg,
    gesendetAn,
    gesendetBetreff,
    gesendetZustellung,
    istBegonnen,
    leereNeueMail,
    mailEingangName,
    mailMeta,
    neueMailAdresseGueltig,
    neueMailBody,
    neueMailHatEntwurf,
    neueMailKnopfGrund,
    neueMailSperre,
    nutzbareWege,
    wartetAufVersand,
    zustellSatz,
} from "../src/community/mails-modell";
import { verlaufZeilen, type VorgangLage } from "../src/community/meldungen-modell";
import { NEUE_MAIL_WERKZEUG, createRedaktion } from "../src/community/redaktion";
import {
    antworteAnfrage,
    redaktionFehler,
    REDAKTION_FEHLER_SATZ,
    sendeErneut,
    sendeNeueMail,
} from "../src/community/redaktion-api";
import { ApiFailure } from "../src/auth/api";
import { da } from "../src/i18n/da";
import { de } from "../src/i18n/de";
import { en } from "../src/i18n/en";
import { es } from "../src/i18n/es";
import { fr } from "../src/i18n/fr";
import { setLocale, t } from "../src/i18n/i18n";
import { it as itTafel } from "../src/i18n/it";
import { nl } from "../src/i18n/nl";
import { pl } from "../src/i18n/pl";
import { sv } from "../src/i18n/sv";

/**
 * Der Mailweg in der Oberfläche ohne Browser (WI-0268 C6a; Bedienkonzept WI-0263 §3.3 bis §3.5): wohin eine Antwort geht, die Zeile „An: …“ und der Knopf, der Zustellstand im Verlauf und in Gesendet,
 * ✚ Neue Mail mit ihren Sperrgründen, die Aufrufe an der Leitung und das Fenster in der Fensterverwaltung.
 */

afterEach(() => setLocale("de"));

const operator = [...capabilitiesFor("operator")];
const admin = [...capabilitiesFor("admin")];
const MAIL = "alrike@example.org";

const anfrage = (teil: Partial<VorgangZeile> = {}): VorgangZeile => ({
    nummer: "COM-000124",
    art: "anfrage",
    kategorie: "frage",
    zustand: "neu",
    ergebnis: null,
    prioritaet: "normal",
    eingang: "kontakt",
    bezugName: null,
    bezugArt: null,
    zustaendig: null,
    ohneQuelle: false,
    moeglicheDublette: null,
    eingegangenAt: "2026-10-31T10:00:00.000Z",
    aktivAt: "2026-10-31T10:00:00.000Z",
    revision: 1,
    absender: "Alrike",
    betreff: "Darf die Karte gedruckt werden?",
    beantwortet: false,
    ...teil,
});

const lage = (rueckwege: string[], teil: Partial<VorgangLage> = {}): VorgangLage => ({
    zeile: anfrage(),
    papierkorb: false,
    archiviert: false,
    rueckwege,
    entfernt: false,
    bezug: null,
    ...teil,
});

describe("🔴 wohin eine Antwort geht", () => {
    it("Mail, wenn der Mailweg an ist UND der Absender eine einzelne gültige Adresse hat; sonst Statusseite; sonst nirgends", () => {
        expect(antwortWeg(["statusseite", "mail"], true, MAIL)).toBe("mail");
        expect(antwortWeg(["mail"], true, MAIL)).toBe("mail");
        // Ohne Mailweg bleibt die Statusseite.
        expect(antwortWeg(["statusseite", "mail"], false, MAIL)).toBe("statusseite");
        // Ohne Adresse (oder mit einer, die nicht genau eine ist) auch.
        expect(antwortWeg(["statusseite"], true, null)).toBe("statusseite");
        expect(antwortWeg(["statusseite", "mail"], true, "a@b.de,c.de")).toBe("statusseite");
        expect(antwortWeg(["statusseite", "mail"], true, "Alrike <a@b.de>")).toBe("statusseite");
        // Eine Anfrage der Redaktion ohne Statusseite und ohne Mailweg: keinen Weg.
        expect(antwortWeg(["mail"], false, MAIL)).toBeUndefined();
        expect(antwortWeg([], true, MAIL)).toBe("mail");
        expect(antwortWeg([], false, null)).toBeUndefined();
    });

    it("🔴 aus Discord ohne Statuslink und Adresse (WI-0297): Discord, mit eigenem Knopf und eigener Zeile; Statusseite und Mail gehen vor", () => {
        expect(antwortWeg(["discord"], true, null)).toBe("discord");
        expect(antwortWeg(["statusseite", "discord"], false, null)).toBe("statusseite");
        expect(antwortWeg(["discord", "mail"], true, MAIL)).toBe("mail");
        expect(antwortKnopfKey("discord")).toBe("community.mails.antwort.sendenDiscord");
        expect(antwortAnText("discord", null)).toBe("An: Discord. Der Absender liest die Antwort mit /offen.");
    });

    it("die Adresse prüft dasselbe Muster wie der Server: genau eine, kein Komma, kein Name, kein Umbruch", () => {
        for (const gut of [MAIL, "a.b+c@sub.example.org", "x@y.de"]) expect(istMailAdresse(gut), gut).toBe(true);
        for (const schlecht of [
            "",
            "a@b",
            "a@b.de,c@d.de",
            "a@b.de;c@d.de",
            "Alrike <a@b.de>",
            '"a"@b.de',
            "a b@c.de",
            "a@b.de\nBcc: x@y.de",
            "a@.de",
            "a@b..de",
        ])
            expect(istMailAdresse(schlecht), schlecht).toBe(false);
        expect(neueMailAdresseGueltig(`  ${MAIL}  `)).toBe(true);
    });

    it("die nutzbaren Wege: `mail` zählt nur mit Mailweg und gültiger Adresse; daraus rechnet `antwortGrund`", () => {
        expect(nutzbareWege(["statusseite", "mail"], true, MAIL)).toEqual(["statusseite", "mail"]);
        expect(nutzbareWege(["statusseite", "mail"], false, MAIL)).toEqual(["statusseite"]);
        expect(nutzbareWege(["statusseite", "mail"], true, "a@b.de,c.de")).toEqual(["statusseite"]);
        // Mit Mailweg geht die Antwort an einen Absender ohne Statusseite; ohne Mailweg hat er keinen Rückweg.
        expect(antwortGrund(lage(nutzbareWege(["mail"], true, MAIL)), operator)).toBeUndefined();
        expect(antwortGrund(lage(nutzbareWege(["mail"], false, MAIL)), operator)).toBe(
            "community.mails.grund.keinRueckweg",
        );
        expect(antwortGrund(lage(nutzbareWege(["statusseite", "mail"], false, MAIL)), operator)).toBeUndefined();
        expect(antwortGrund(lage(["mail"]), admin)).toBe("community.mails.grund.antwortRecht");
    });

    it("der Knopf heißt mit Mail „Antworten“, sonst „Antworten (Statusseite)“; die Zeile darüber nennt die Adresse", () => {
        expect(t(antwortKnopfKey("mail"))).toBe("Antworten");
        expect(t(antwortKnopfKey("statusseite"))).toBe("Antworten (Statusseite)");
        expect(t(antwortKnopfKey(undefined))).toBe("Antworten (Statusseite)");
        expect(antwortAnText("mail", ` ${MAIL} `)).toBe(`An: ${MAIL}`);
        expect(antwortAnText("statusseite", MAIL)).toBe("An: Statusseite des Absenders");
        expect(antwortAnText("mail", null)).toBe("An: Statusseite des Absenders");
    });
});

describe("der Zustellstand ausgehender Mails", () => {
    it("„wird gesendet …“, „✓ zugestellt“, „nicht zugestellt: Grund“", () => {
        expect(zustellSatz({ zustand: "wartet", grund: null })).toBe("wird gesendet …");
        expect(zustellSatz({ zustand: "gesendet", grund: null })).toBe("✓ zugestellt");
        expect(zustellSatz({ zustand: "fehler", grund: "Der Mailserver hat die Anmeldung abgelehnt" })).toBe(
            "nicht zugestellt: Der Mailserver hat die Anmeldung abgelehnt",
        );
        // Ein vorläufiger Fehler bei einer Mail, die noch wartet, zeigt nur „wird gesendet“.
        expect(zustellSatz({ zustand: "wartet", grund: "Der Mailserver ist nicht erreichbar" })).toBe(
            "wird gesendet …",
        );
    });

    it("der Verlauf trägt Kennung und Zustellstand der Mail, eine Antwort auf die Statusseite nichts davon", () => {
        const verlauf: VerlaufEintrag[] = [
            {
                art: "nachricht",
                richtung: "ein",
                weg: "formular",
                text: "Frage",
                von: null,
                at: "2026-10-31T10:00:00Z",
            },
            {
                art: "nachricht",
                richtung: "aus",
                weg: "mail",
                text: "Antwort",
                von: { id: "p", name: "Olaf" },
                at: "2026-10-31T10:05:00Z",
                id: 17,
                zustellung: {
                    zustand: "fehler",
                    grund: "Der Mailserver hat die Mail abgelehnt (554)",
                    an: MAIL,
                    betreff: "Re: Frage [COM-000124]",
                },
            },
            {
                art: "nachricht",
                richtung: "aus",
                weg: "statusseite",
                text: "Noch eine",
                von: null,
                at: "2026-10-31T10:06:00Z",
            },
        ];
        const zeilen = verlaufZeilen(verlauf, () => undefined, "anfrage");
        const mail = zeilen[1];
        expect(mail).toMatchObject({
            art: "nachricht",
            weg: "mail",
            id: 17,
            zustellung: { zustand: "fehler", an: MAIL },
        });
        expect(zeilen[0]).not.toHaveProperty("zustellung");
        expect(zeilen[2]).not.toHaveProperty("zustellung");
        expect(zeilen[2]).not.toHaveProperty("id");
        expect(wartetAufVersand(verlauf)).toBe(false);
    });

    it("das Fenster fragt nach, solange eine Mail wartet - und nur dann, höchstens zehn Minuten", () => {
        const wartet: VerlaufEintrag = {
            art: "nachricht",
            richtung: "aus",
            weg: "mail",
            text: "x",
            von: null,
            at: "2026-10-31T10:00:00Z",
            id: 1,
            zustellung: { zustand: "wartet", grund: null, an: MAIL, betreff: "Re: x [COM-000001]" },
        };
        expect(wartetAufVersand([wartet])).toBe(true);
        expect(wartetAufVersand([{ ...wartet, zustellung: { ...wartet.zustellung!, zustand: "gesendet" } }])).toBe(
            false,
        );
        expect(wartetAufVersand([{ ...wartet, zustellung: { ...wartet.zustellung!, zustand: "fehler" } }])).toBe(false);
        expect(wartetAufVersand([])).toBe(false);
        expect(NACHFRAGE_TAKT_MS).toBeLessThanOrEqual(5000);
        expect(NACHFRAGE_HOECHSTENS_MS).toBe(600_000);
    });

    it("Gesendet: bei einer Mail die Adresse, der Betreff mit Nummer und der Zustellstand; bei der Statusseite nichts davon", () => {
        const mail: GesendetZeile = {
            nummer: "COM-000124",
            an: MAIL,
            betreff: "Darf die Karte gedruckt werden?",
            text: "Gern.",
            at: "2026-10-31T10:00:00Z",
            von: null,
            weg: "mail",
            zustellung: {
                zustand: "gesendet",
                grund: null,
                an: MAIL,
                betreff: "Re: Darf die Karte gedruckt werden? [COM-000124]",
            },
        };
        expect(gesendetAn(mail)).toBe(`An: ${MAIL}`);
        expect(gesendetBetreff(mail)).toBe("Re: Darf die Karte gedruckt werden? [COM-000124]");
        expect(gesendetZustellung(mail)).toBe("✓ zugestellt");
        const status: GesendetZeile = { ...mail, an: null, weg: "statusseite" };
        delete (status as { zustellung?: unknown }).zustellung;
        expect(gesendetAn(status)).toBe("An: Statusseite");
        expect(gesendetBetreff(status)).toBe("Re: Darf die Karte gedruckt werden?");
        expect(gesendetZustellung(status)).toBeUndefined();
        // Nach der Frist fiel die Adresse weg: Die Mail ging nie auf die Statusseite.
        expect(gesendetAn({ ...mail, an: null })).toBe("An: Adresse nicht mehr gespeichert");
    });

    it("eine Anfrage, die die Redaktion begonnen hat, heißt „von Avesmaps begonnen“ und trägt das Abzeichen, solange sie auf Antwort wartet", () => {
        const begonnen = anfrage({ eingang: "redaktion", zustand: "rueckfrage", beantwortet: true });
        expect(istBegonnen(begonnen)).toBe(true);
        expect(istBegonnen(anfrage({ eingang: "redaktion", zustand: "in_arbeit" }))).toBe(false);
        expect(istBegonnen(anfrage({ eingang: "kontakt", zustand: "rueckfrage" }))).toBe(false);
        expect(mailEingangName("redaktion")).toBe("von Avesmaps begonnen");
        expect(mailEingangName("kontakt")).toBe("Kontaktformular");
        expect(mailMeta(begonnen)).toBe("COM-000124 · von Avesmaps begonnen · niemand zuständig");
        expect(t("community.mails.begonnen")).toBe("gesendet, wartet auf Antwort");
    });
});

describe("✚ Neue Mail", () => {
    it("🔴 der Knopf: ohne `send_new_mail` gesperrt mit „nur Betreiber“, ohne Mailweg mit „noch nicht eingerichtet“, sonst frei", () => {
        expect(neueMailKnopfGrund(operator, true)).toBeUndefined();
        expect(neueMailKnopfGrund(admin, true)).toBe("community.mails.neu.grund.recht");
        expect(t("community.mails.neu.grund.recht")).toBe("Neue Mails schreiben nur Betreiber");
        expect(neueMailKnopfGrund(operator, false)).toBe("community.mails.neu.grund.mailweg");
        expect(t("community.mails.neu.grund.mailweg")).toBe("Der Mailweg ist noch nicht eingerichtet");
        // Das Recht geht vor: Wer es nicht hat, erfährt nichts über den Mailweg.
        expect(neueMailKnopfGrund(admin, false)).toBe("community.mails.neu.grund.recht");
        // Solange der Stand fehlt, steht der Knopf nicht mit dem falschen Satz da.
        expect(neueMailKnopfGrund(operator, undefined)).toBeUndefined();
    });

    it("„Senden“ ist gesperrt, solange etwas fehlt, mit dem Grund in der Reihenfolge des Fensters", () => {
        const e = leereNeueMail();
        expect(neueMailSperre(e, admin, true)).toBe("community.mails.neu.grund.recht");
        expect(neueMailSperre(e, operator, false)).toBe("community.mails.neu.grund.mailweg");
        expect(neueMailSperre(e, operator, true)).toBe("community.mails.neu.grund.an");
        expect(neueMailSperre({ ...e, an: "keine-adresse" }, operator, true)).toBe(
            "community.mails.neu.grund.anUngueltig",
        );
        expect(neueMailSperre({ ...e, an: "a@b.de,c@d.de" }, operator, true)).toBe(
            "community.mails.neu.grund.anUngueltig",
        );
        expect(neueMailSperre({ ...e, an: MAIL }, operator, true)).toBe("community.mails.neu.grund.betreff");
        expect(neueMailSperre({ ...e, an: MAIL, betreff: "  " }, operator, true)).toBe(
            "community.mails.neu.grund.betreff",
        );
        expect(neueMailSperre({ ...e, an: MAIL, betreff: "Hallo" }, operator, true)).toBe(
            "community.mails.neu.grund.text",
        );
        expect(neueMailSperre({ an: MAIL, betreff: "Hallo", text: "Guten Tag." }, operator, true)).toBeUndefined();
        // Solange der Mailweg unbekannt ist, geht es nur über die anderen Gründe weiter (das Fenster sperrt dann selbst).
        expect(neueMailSperre({ an: MAIL, betreff: "Hallo", text: "Guten Tag." }, operator, undefined)).toBeUndefined();
    });

    it("der Rumpf ist getrimmt, der Betreff eine Zeile; ein Entwurf ist, was geschrieben wurde", () => {
        expect(neueMailBody({ an: `  ${MAIL} `, betreff: "  Zusammen \n arbeit  ", text: "  Guten Tag.  " })).toEqual({
            an: MAIL,
            betreff: "Zusammen arbeit",
            text: "Guten Tag.",
        });
        expect(neueMailHatEntwurf(leereNeueMail())).toBe(false);
        expect(neueMailHatEntwurf({ ...leereNeueMail(), text: "x" })).toBe(true);
        expect(neueMailHatEntwurf({ ...leereNeueMail(), an: "  " })).toBe(false);
    });
});

describe("die Aufrufe an der Leitung", () => {
    interface Aufruf {
        url: string;
        methode: string;
        body: Record<string, unknown> | undefined;
    }
    function holer(antworten: (Response | Error)[]) {
        const aufrufe: Aufruf[] = [];
        const fetcher = ((url: string, init?: RequestInit) => {
            aufrufe.push({
                url,
                methode: init?.method ?? "GET",
                body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
            });
            const antwort = antworten.shift();
            if (antwort === undefined) throw new Error("keine Antwort vorbereitet");
            return antwort instanceof Error ? Promise.reject(antwort) : Promise.resolve(antwort);
        }) as typeof fetch;
        return { fetcher, aufrufe };
    }
    const json = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const quittung = { nummer: "COM-000124", revision: 5 };

    async function mitFetch<T>(fetcher: typeof fetch, lauf: () => Promise<T>): Promise<T> {
        const alt = globalThis.fetch;
        globalThis.fetch = fetcher;
        try {
            return await lauf();
        } finally {
            globalThis.fetch = alt;
        }
    }

    it("`antworten` trägt den Weg, wenn er gewählt ist, und lässt ihn sonst weg", async () => {
        const { fetcher, aufrufe } = holer([json(quittung), json(quittung)]);
        await mitFetch(fetcher, async () => {
            await antworteAnfrage("COM-000124", 3, "Ja, gern.", false, "mail");
            await antworteAnfrage("COM-000124", 3, "Ja, gern.", true);
        });
        expect(aufrufe[0]!.body).toMatchObject({ baseRevision: 3, text: "Ja, gern.", archivieren: false, weg: "mail" });
        expect(aufrufe[1]!.body).not.toHaveProperty("weg");
        // Der Rumpf trägt keine Adresse: Der Empfänger ist immer der des Vorgangs.
        for (const a of aufrufe) {
            expect(a.body).not.toHaveProperty("an");
            expect(a.body).not.toHaveProperty("to");
        }
    });

    it("Erneut senden geht an die Mail dieses Vorgangs; dieselbe Kennung nach einem Netzfehler, eine neue nach der Antwort", async () => {
        const { fetcher, aufrufe } = holer([new TypeError("offline"), json(quittung), json(quittung)]);
        await mitFetch(fetcher, async () => {
            await expect(sendeErneut("COM-000124", 17)).rejects.toBeInstanceOf(ApiFailure);
            await sendeErneut("COM-000124", 17);
            await sendeErneut("COM-000124", 17);
        });
        const urls = aufrufe.map((a) => `${a.methode} ${a.url}`);
        expect(urls).toEqual(Array(3).fill("POST /api/community/vorgaenge/COM-000124/nachrichten/17/erneut-senden"));
        expect(aufrufe[0]!.body?.["operationId"]).toBe(aufrufe[1]!.body?.["operationId"]);
        expect(aufrufe[2]!.body?.["operationId"]).not.toBe(aufrufe[1]!.body?.["operationId"]);
    });

    it("eine neue Mail geht an `/api/community/mails` mit der Kennung des Fensters", async () => {
        const { fetcher, aufrufe } = holer([json({ nummer: "COM-000130" }, 201)]);
        const antwort = await mitFetch(fetcher, () =>
            sendeNeueMail({
                operationId: "11111111-2222-4333-8444-555555555555",
                an: MAIL,
                betreff: "Hallo",
                text: "Guten Tag.",
            }),
        );
        expect(antwort.nummer).toBe("COM-000130");
        expect(`${aufrufe[0]!.methode} ${aufrufe[0]!.url}`).toBe("POST /api/community/mails");
        expect(aufrufe[0]!.body).toEqual({
            operationId: "11111111-2222-4333-8444-555555555555",
            an: MAIL,
            betreff: "Hallo",
            text: "Guten Tag.",
        });
    });

    it("der Stand des Moduls: `mailweg` nur, wenn der Server es ausdrücklich meldet; eine fehlende Antwort ist ein Nein", async () => {
        expect(await ladeModulStand(holer([json({ meldungen: true, mailweg: true })]).fetcher)).toEqual({
            meldungen: true,
            mailweg: true,
            discord: false,
        });
        expect(await ladeModulStand(holer([json({ meldungen: true, mailweg: false })]).fetcher)).toEqual({
            meldungen: true,
            mailweg: false,
            discord: false,
        });
        // Ein älterer Server kennt das Feld nicht.
        expect(await ladeModulStand(holer([json({ meldungen: true })]).fetcher)).toEqual({
            meldungen: true,
            mailweg: false,
            discord: false,
        });
        expect(await ladeModulStand(holer([new TypeError("offline")]).fetcher)).toEqual({
            meldungen: false,
            mailweg: false,
            discord: false,
        });
    });

    it("die Tagesgrenze der neuen Mails hat einen eigenen Satz", () => {
        const fehler = new ApiFailure(429, "community_mail_grenze", "x");
        expect(redaktionFehler(fehler)).toBe("mail_grenze");
        expect(t(REDAKTION_FEHLER_SATZ.mail_grenze)).toBe("Die Grenze für neue Mails an einem Tag ist erreicht.");
        expect(redaktionFehler(new ApiFailure(429, "community_rate", "x"))).toBe("zu_viele");
    });
});

describe("das Fenster „Neue Mail“ in der Fensterverwaltung", () => {
    function verbunden() {
        const redaktion = createRedaktion();
        redaktion.verbinde({
            fenster: createWerkzeugfenster(undefined),
            zeigeMeldungen: () => undefined,
            zeige: () => undefined,
            oeffneImEditor: () => undefined,
        });
        return redaktion;
    }

    it("öffnet angedockt, höchstens eins; ein zweiter Aufruf holt es nach vorn", () => {
        const redaktion = verbunden();
        const erste = redaktion.oeffneNeueMail();
        const zweite = redaktion.oeffneNeueMail();
        expect(erste).toBeDefined();
        expect(zweite).toBe(erste);
        const fenster = redaktion.neueMailFenster.value;
        expect(fenster).toHaveLength(1);
        expect(fenster[0]).toMatchObject({ werkzeug: NEUE_MAIL_WERKZEUG, lage: "angedockt", titel: "Neue Mail" });
        // Es ist kein Vorgangsfenster und keins der anderen Redaktionsfenster.
        expect(redaktion.vorgangFenster.value).toEqual([]);
        expect(redaktion.beitragFenster.value).toEqual([]);
        expect(redaktion.bewertungFenster.value).toEqual([]);
    });

    it("trägt es einen Entwurf, bleibt es beim Schließen unter „Offene Bearbeitungen“ (nie verworfen)", () => {
        const redaktion = verbunden();
        const id = redaktion.oeffneNeueMail()!;
        redaktion.fenster.value!.markiere(id, { ungespeichert: true });
        redaktion.fenster.value!.schliesse(id);
        expect(redaktion.neueMailFenster.value).toHaveLength(1);
        expect(redaktion.neueMailFenster.value[0]!.lage).toBe("versenkt");
        redaktion.fenster.value!.markiere(id, { ungespeichert: false });
        redaktion.fenster.value!.schliesse(id);
        expect(redaktion.neueMailFenster.value).toHaveLength(0);
    });

    it("ohne Verbindung (kein Editor) öffnet nichts", () => {
        expect(createRedaktion().oeffneNeueMail()).toBeUndefined();
    });
});

describe("die Sprachtafeln: alle neun tragen die Texte des Mailwegs mit denselben Platzhaltern", () => {
    const tafeln = { de, en, fr, nl, it: itTafel, es, pl, sv, da } as const;
    const MIT_PLATZHALTER: Record<string, readonly string[]> = {
        "community.mails.antwort.anMail": ["{adresse}"],
        "community.mails.zustellung.fehler": ["{grund}"],
        "community.mails.neu.fertig": ["{nummer}"],
        "notify.text.community_mail_fehler": ["{text}"],
    };
    const SCHLUESSEL = [
        "community.mails.gesendet.anAbgelaufen",
        "community.mails.antwort.sendenMail",
        "community.mails.zustellung.wartet",
        "community.mails.zustellung.gesendet",
        "community.mails.zustellung.erneut",
        "community.mails.eingang.redaktion",
        "community.mails.begonnen",
        "community.mails.neu",
        "community.mails.neu.titel",
        "community.mails.neu.grund.recht",
        "community.mails.neu.grund.mailweg",
        "community.mails.neu.senden",
        "community.mails.neu.oeffnen",
        "community.redaktion.fehler.mailGrenze",
        "auth.capability.send_new_mail",
        "admin.capability.send_new_mail",
        "status.kind.community_mail_versand",
        ...Object.keys(MIT_PLATZHALTER),
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

    it("das Recht `send_new_mail` ist beschriftet und gilt ab Betreiber", () => {
        expect(de["auth.capability.send_new_mail"]).toBe("Neue Mails schreiben");
        expect(capabilitiesFor("operator").has("send_new_mail")).toBe(true);
        expect(capabilitiesFor("admin").has("send_new_mail")).toBe(false);
        expect(capabilitiesFor("reviewer").has("send_new_mail")).toBe(false);
    });
});
