import { describe, expect, it, vi } from "vitest";
import {
    MEDIA_HEADER_SET_URL,
    MEDIA_UPLOAD_URL,
    mediaKarteStilllegenUrl,
    mediaKarteZurueckholenUrl,
    type MediaSubjectSlots,
    type MediaUploadForm,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { ApiFailure, getJson } from "../src/auth/api.ts";
import { t } from "../src/i18n/i18n.ts";
import { medienFehler } from "../src/medien/medien-client.ts";
import {
    alsBase64,
    anzeigeDateiname,
    assetDerQuittung,
    ausgangUnklar,
    bindeAsset,
    bindungAusPlaetzen,
    createMedienOperationen,
    Handlung,
    hochladenUndBinden,
    neuerAblauf,
    operationsFehler,
    vorschauAdresse,
    type MedienOperationen,
} from "../src/medien/medien-operationen.ts";

/**
 * Der Schreibpfad der Medienverwaltung im Browser (WI-0068 P4b, Paket 1): eine Kennung je Handlung, Hochladen-dann-Binden ohne zweites
 * Hochladen, die Fehler einer Operation nach ihrem Code.
 */

const ASSET = "6dcf1e76-4c1a-4b0e-9a6e-2f1d3c4b5a69";
const ORT = "0b7d7c43-6d7e-4f55-9a35-2a3f0d1e9b11";

const FORM: MediaUploadForm = {
    title: "Wappen von Gareth",
    role: "coat",
    creationMethod: "drawing",
    rights: { basis: "own_work" },
};

function quittung(affected: OperationReceipt["affected"] = []): OperationReceipt {
    return {
        operationId: "11111111-2222-4333-8444-555555555555",
        status: "applied",
        environment: "development",
        affected,
        derivedWork: [],
        warnings: [],
    };
}

interface Aufruf {
    url: string;
    body: Record<string, unknown>;
}

/** Ein Fetcher, der die Aufrufe mitschreibt und je Aufruf die nächste Antwort aus der Liste gibt. */
function aufzeichner(antworten: (() => Response)[]): { fetcher: typeof fetch; aufrufe: Aufruf[] } {
    const aufrufe: Aufruf[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
        aufrufe.push({ url, body: init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Aufruf["body"]) });
        const naechste = antworten.shift();
        if (naechste === undefined) throw new Error("keine Antwort mehr");
        return naechste();
    }) as typeof fetch;
    return { fetcher, aufrufe };
}

const json = (status: number, body: unknown) => () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fehler = (status: number, code: string, details?: Record<string, unknown>) =>
    json(status, { error: { code, message: code, ...(details === undefined ? {} : { details }) } });

describe("Handlung: eine Kennung je Benutzerhandlung", () => {
    it("behält die Kennung, solange der Ausgang unklar ist (Netz, 5xx), und verbraucht sie nach einer Antwort", async () => {
        const handlung = new Handlung();
        const erste = handlung.id;
        await expect(handlung.fuehreAus(() => Promise.reject(new ApiFailure(0, "network", "")))).rejects.toThrow();
        expect(handlung.id).toBe(erste);
        await expect(
            handlung.fuehreAus(() => Promise.reject(new ApiFailure(503, "unavailable", ""))),
        ).rejects.toThrow();
        expect(handlung.id).toBe(erste);

        const gesendet: string[] = [];
        await handlung.fuehreAus((id) => {
            gesendet.push(id);
            return Promise.resolve(quittung());
        });
        expect(gesendet).toEqual([erste]);
        expect(handlung.id).not.toBe(erste);
    });

    it("nimmt nach einer klaren Ablehnung eine neue Kennung (sonst 409 idempotency_key_reused beim geänderten Inhalt)", async () => {
        const handlung = new Handlung();
        const erste = handlung.id;
        await expect(
            handlung.fuehreAus(() => Promise.reject(new ApiFailure(400, "validation_failed", ""))),
        ).rejects.toThrow();
        expect(handlung.id).not.toBe(erste);
        expect(ausgangUnklar(new ApiFailure(409, "edit_conflict", ""))).toBe(false);
        expect(ausgangUnklar(new Error("kaputt"))).toBe(true);
    });
});

describe("Client der Operationen", () => {
    it("sendet jede Operation an ihre Adresse, mit Umschlag, und liest das Asset aus der Quittung", async () => {
        const { fetcher, aufrufe } = aufzeichner([
            json(200, quittung([{ kind: "media_asset", id: ASSET, revision: 1 }])),
            json(200, quittung()),
        ]);
        const ops = createMedienOperationen({ fetcher });
        const datei = { name: "gareth.png", dataBase64: "iVBORw0KGgo=" };
        const antwort = await ops.hochladen("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", datei, FORM);
        expect(assetDerQuittung(antwort)).toBe(ASSET);
        await ops.rechte(ASSET, {
            operationId: "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff",
            baseRevision: 2,
            rights: { basis: "unknown" },
        });
        expect(aufrufe.map((a) => a.url)).toEqual([MEDIA_UPLOAD_URL, `${MEDIA_UPLOAD_URL}/${ASSET}/rights`]);
        expect(aufrufe[0]!.body).toEqual({
            operationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            file: datei,
            form: FORM,
        });
        expect(aufrufe[1]!.body["baseRevision"]).toBe(2);
    });

    it("🔴 Eintrag der Kartensammlung entfernen und zurückholen (WI-0287): eigene Adresse, gesehener Stand; ein doppelter Aufruf sagt es", async () => {
        const karte = "7e570000-0000-4000-8000-000000000061";
        const { fetcher, aufrufe } = aufzeichner([
            json(200, quittung([{ kind: "citymap", id: karte, revision: 5 }])),
            json(200, quittung([{ kind: "citymap", id: karte, revision: 6 }])),
            fehler(409, "citymap_not_retired"),
        ]);
        const ops = createMedienOperationen({ fetcher });
        const kennung = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
        await ops.karteEntfernen(karte, { operationId: kennung, baseRevision: 4 });
        await ops.karteZurueckholen(karte, { operationId: kennung, baseRevision: 5 });
        expect(aufrufe.map((a) => a.url)).toEqual([mediaKarteStilllegenUrl(karte), mediaKarteZurueckholenUrl(karte)]);
        expect(aufrufe[0]!.body).toEqual({ operationId: kennung, baseRevision: 4 });
        const doppelt = await ops.karteZurueckholen(karte, { operationId: kennung, baseRevision: 6 }).catch((e) => e);
        expect(operationsFehler(doppelt).text).toBe(t("medien.op.karteNichtEntfernt"));
    });

    it("fragt bei reauth_required nach und wiederholt einmal mit DERSELBEN Kennung", async () => {
        const { fetcher, aufrufe } = aufzeichner([
            fehler(403, "reauth_required", { need: "confirmation" }),
            json(200, quittung()),
        ]);
        const gefragt: string[] = [];
        const ops = createMedienOperationen({
            fetcher,
            ask: (need) => {
                gefragt.push(need);
                return Promise.resolve(true);
            },
        });
        await ops.wappenBewusstOhne({
            operationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            subject: { kind: "place", id: ORT },
            baseRevision: 4,
        });
        expect(gefragt).toEqual(["confirmation"]);
        expect(aufrufe).toHaveLength(2);
        expect(aufrufe[0]!.body["operationId"]).toBe(aufrufe[1]!.body["operationId"]);
    });

    it("baut die Vorschau-Adresse nur aus gesetzten Feldern", () => {
        expect(vorschauAdresse({ role: "coat", basis: "license", licenseKey: "cc-by-4.0" })).toBe(
            `${MEDIA_UPLOAD_URL}/publication-preview?role=coat&basis=license&licenseKey=cc-by-4.0`,
        );
        expect(vorschauAdresse({ role: "header", basis: "own_work", licenseKey: "" })).toBe(
            `${MEDIA_UPLOAD_URL}/publication-preview?role=header&basis=own_work`,
        );
        // Die Entstehung geht mit: die KI-Regel für eigene Werke hängt an ihr (Betreiber 2026-10-10).
        expect(vorschauAdresse({ role: "coat", basis: "own_work", creation: "ai_generated" })).toBe(
            `${MEDIA_UPLOAD_URL}/publication-preview?role=coat&basis=own_work&creation=ai_generated`,
        );
    });
});

describe("Hochladen, dann binden (WI-0126 §11j)", () => {
    function attrappe(bindenAntworten: (() => Promise<OperationReceipt>)[]) {
        const hochgeladen: string[] = [];
        const gebunden: { operationId: string; baseRevision?: number }[] = [];
        const ops = {
            hochladen: (id: string) => {
                hochgeladen.push(id);
                return Promise.resolve(quittung([{ kind: "media_asset", id: ASSET, revision: 1 }]));
            },
            wappenSetzen: (body: { operationId: string; baseRevision?: number }) => {
                gebunden.push(body);
                return bindenAntworten.shift()!();
            },
        } as unknown as MedienOperationen;
        return { ops, hochgeladen, gebunden };
    }
    const datei = () => Promise.resolve({ name: "w.png", dataBase64: "AAAA" });

    it("lädt nach einem gescheiterten Binden NICHT noch einmal hoch, sondern bindet nur, mit neuer Kennung", async () => {
        const { ops, hochgeladen, gebunden } = attrappe([
            () => Promise.reject(new ApiFailure(409, "edit_conflict", "", { currentRevision: 5 })),
            () => Promise.resolve(quittung()),
        ]);
        const ablauf = neuerAblauf();
        const bindung = { rolle: "coat" as const, subject: { kind: "place" as const, id: ORT }, baseRevision: 4 };
        await expect(hochladenUndBinden(ops, ablauf, datei, FORM, bindung)).rejects.toThrow();
        expect(ablauf.assetId).toBe(ASSET);

        const ergebnis = await hochladenUndBinden(ops, ablauf, datei, FORM, { ...bindung, baseRevision: 5 });
        expect(hochgeladen).toHaveLength(1);
        expect(gebunden).toHaveLength(2);
        expect(gebunden[0]!.operationId).not.toBe(gebunden[1]!.operationId);
        expect(gebunden[1]!.baseRevision).toBe(5);
        expect(ergebnis.assetId).toBe(ASSET);
        expect(ergebnis.gebunden).toBeDefined();
    });

    it("bindet ohne Bindungswunsch nicht (Hochladen im MAM-Fenster)", async () => {
        const { ops, hochgeladen, gebunden } = attrappe([]);
        const ergebnis = await hochladenUndBinden(ops, neuerAblauf(), datei, FORM, undefined);
        expect(hochgeladen).toHaveLength(1);
        expect(gebunden).toHaveLength(0);
        expect(ergebnis.gebunden).toBeUndefined();
    });
});

describe("Fehler einer Operation nach dem Code (ADR-0018)", () => {
    it("nennt beim Konflikt die Person aus dem Fachprotokoll und bietet keinen blinden zweiten Versuch", () => {
        const f = operationsFehler(
            new ApiFailure(409, "edit_conflict", "", {
                currentRevision: 7,
                changedAt: "2026-10-10T10:00:00.000Z",
                changedBy: { id: "p1", displayName: "Hesindiane" },
            }),
        );
        expect(f.text).toContain("Hesindiane");
        expect(f.erneut).toBe(false);
        expect(f.konflikt?.currentRevision).toBe(7);
    });

    it("reicht die Befunde des Formulars durch, nie einen eingegebenen Wert", () => {
        const f = operationsFehler(
            new ApiFailure(400, "validation_failed", "", {
                issues: [{ path: "rights.licenseKey", rule: "required" }, { kaputt: true }],
            }),
        );
        expect(f.befunde).toEqual([{ path: "rights.licenseKey", rule: "required" }]);
    });

    it("sagt bei einer abgewiesenen Datei den Grund der Pipeline", () => {
        expect(
            operationsFehler(new ApiFailure(422, "media_file_rejected", "", { reason: "svg_has_text" })).text,
        ).toContain("Pfade");
        expect(operationsFehler(new ApiFailure(422, "media_file_rejected", "", { reason: "decode_failed" })).text).toBe(
            "Die Datei ist kein lesbares Bild.",
        );
        expect(operationsFehler(new ApiFailure(413, "payload_too_large", "")).text).toContain("6 MB");
    });

    it("🔴 Endgültig löschen nennt den genauen Grund des Servers (WI-0291, WI-0272); ohne bekannten Grund den Sammelsatz ohne Notaus", () => {
        expect(
            operationsFehler(new ApiFailure(409, "media_not_deletable", "", { reason: "einreichung_offen" })).text,
        ).toBe("Erst freigeben oder ablehnen.");
        expect(operationsFehler(new ApiFailure(409, "media_not_deletable", "", { reason: "erzeugt" })).text).toBe(
            t("medien.loeschen.hindernis.erzeugt"),
        );
        const sammel = operationsFehler(new ApiFailure(409, "media_not_deletable", "", { reason: "suspension" }));
        expect(sammel.text).toBe(t("medien.op.nichtLoeschbar"));
        expect(sammel.text).not.toContain("Notaus");
    });

    it("trennt Sperre, fehlendes Recht, Netz und Server", () => {
        expect(operationsFehler(new ApiFailure(423, "map_locked", "")).ton).toBe("warnung");
        expect(operationsFehler(new ApiFailure(403, "forbidden", "")).text).toBe("Dafür fehlt das Recht.");
        expect(operationsFehler(new ApiFailure(403, "community_license_locked", "")).text).toContain("Betreiber");
        expect(operationsFehler(new ApiFailure(0, "network", "")).erneut).toBe(true);
        expect(operationsFehler(new ApiFailure(503, "unavailable", "")).erneut).toBe(true);
        expect(operationsFehler(new ApiFailure(409, "gallery_full", "")).erneut).toBe(false);
    });

    it("🪤 ein Fehler in der Seite heißt nicht Netz und steht in der Konsole (WI-0202, W5-05)", () => {
        const konsole = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const programmfehler = new TypeError("Cannot read properties of undefined (reading 'items')");
        const f = operationsFehler(programmfehler);
        expect(f.code).toBe("client");
        expect(f.text).toBe(t("medien.fehler.client"));
        expect(f.text).not.toBe(t("medien.fehler.netz"));
        expect(medienFehler(programmfehler).code).toBe("client");
        expect(konsole).toHaveBeenCalledWith("Medien: unerwarteter Fehler", programmfehler);
        // Was vom Netz kommt, bleibt Netz und landet nicht in der Konsole.
        konsole.mockClear();
        expect(medienFehler(new ApiFailure(0, "network", "")).text).toBe(t("medien.fehler.netz"));
        expect(konsole).not.toHaveBeenCalled();
        konsole.mockRestore();
    });

    it("eine Verbindung, die beim Lesen des Rumpfs abbricht, ist Netz, kein Fehler in der Seite", async () => {
        const abgerissen = (() =>
            Promise.resolve({
                ok: true,
                status: 200,
                statusText: "OK",
                text: () => Promise.reject(new TypeError("network error")),
            } as unknown as Response)) as typeof fetch;
        const fehler: unknown = await getJson("/api/x", abgerissen).catch((grund: unknown) => grund);
        expect(fehler).toBeInstanceOf(ApiFailure);
        expect((fehler as ApiFailure).code).toBe("network");
    });
});

describe("Datei in die Anfrage", () => {
    it("kodiert Bytes als Base64 und kürzt den Namen auf eine Anzeige ohne Pfad", async () => {
        expect(await alsBase64(new Blob([new Uint8Array([0, 1, 2, 250, 251, 252])]))).toBe("AAEC+vv8");
        expect(anzeigeDateiname("C:\\fake\\pfad\\wappen.png")).toBe("wappen.png");
        expect(anzeigeDateiname("   ")).toBe("datei");
        expect(anzeigeDateiname("x".repeat(300))).toHaveLength(255);
    });
});

describe("Das Titelbild: EIN Bild ODER EINE Galerie (WI-0219)", () => {
    const stand = (header: object): MediaSubjectSlots =>
        ({
            subject: { kind: "place", id: ORT, name: "Gareth", active: true },
            coat: { state: "undecided", origin: null, revision: null, asset: null },
            header: { gallery: null, image: null, items: [], max: 10, suppressed: false, ...header },
        }) as unknown as MediaSubjectSlots;

    it("🔴 der gesehene Stand: die Revision des Einzelbilds, die der Galerie oder der Zustand des Platzes", () => {
        expect(bindungAusPlaetzen(stand({ image: { revision: 3 } }), "header")).toEqual({
            rolle: "header",
            placeId: ORT,
            baseRevision: 3,
        });
        expect(bindungAusPlaetzen(stand({ gallery: { id: ORT, revision: 7, origin: "legacy" } }), "header")).toEqual({
            rolle: "header",
            placeId: ORT,
            galleryRevision: 7,
        });
        expect(bindungAusPlaetzen(stand({}), "header")).toEqual({
            rolle: "header",
            placeId: ORT,
            baseState: "undecided",
        });
        expect(bindungAusPlaetzen(stand({ suppressed: true }), "header")).toEqual({
            rolle: "header",
            placeId: ORT,
            baseState: "none",
        });
    });

    it("🔴 gebunden wird über header.set, mit genau diesem Stand", async () => {
        const { fetcher, aufrufe } = aufzeichner([json(200, quittung())]);
        const ops = createMedienOperationen({ fetcher });
        await bindeAsset(
            ops,
            bindungAusPlaetzen(stand({ gallery: { id: ORT, revision: 7, origin: "legacy" } }), "header"),
            ASSET,
            "op-1",
        );
        expect(aufrufe).toEqual([
            {
                url: MEDIA_HEADER_SET_URL,
                body: { operationId: "op-1", placeId: ORT, assetId: ASSET, galleryRevision: 7 },
            },
        ]);
    });
});
