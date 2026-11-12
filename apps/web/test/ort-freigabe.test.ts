import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorMoveTargets, EditorPlaceDetail, EditorPlaceRow, OperationReceipt } from "@avesmaps3d/shared";
import { EDITOR_LOCKS_URL } from "@avesmaps3d/shared";
import { createEditorSperre } from "../src/editor-sperre/sperre.ts";
import { setzeText } from "../src/ortseditor/entwurf.ts";
import { createOrtBearbeitung, type BearbeitungsSperre, type OrtApi } from "../src/ortseditor/ort-bearbeitung.ts";
import { createOrtSetzen, type SetzenApi, type SetzKarte } from "../src/ortseditor/ort-setzen.ts";
import { createOrtSperre } from "../src/ortseditor/ort-sperre.ts";
import { createOrtVerschieben, type VerschiebeApi, type VerschiebeKarte } from "../src/ortseditor/ort-verschieben.ts";
import type { Zug } from "../src/ortseditor/verschieben.ts";

/**
 * Der Ort an der Freigabe auf Bitte (WI-0262, OPS-000059): Ortseditor-Fenster, „Ort verschieben“ und „Ort setzen“ halten dieselbe Sperre.
 * Mit dem echten Baustein der Sperre (`editor-sperre/sperre.ts`) und einem Ersatz für den Server geprüft: Eine Bitte beendet ALLE Halter,
 * der Entwurf des Fensters wird zuerst gespeichert, und erst dann geht die Sperre zurück.
 *
 * Problemfälle: Das Fenster mit Entwurf gibt ab, ohne zu speichern; „Ort verschieben“ bleibt hängen oder bricht einen laufenden Zug ab;
 * das Speichern scheitert (Konflikt, 400), und die Sperre geht trotzdem; nach dem Schließen des Fensters bleibt ein Angebot für einen Ort
 * stehen, den niemand mehr hält.
 */
const ORT = "7527ed5b-303a-57af-926e-ed41a8b82dfc";
const LAUF = "d5d5d5d5-0000-4000-8000-000000000001";

function ort(revision = 7): EditorPlaceDetail {
    return {
        publicId: ORT,
        revision,
        name: "Gratenfels",
        subtype: "stadt",
        kind: null,
        position: { x: 450.2, y: 535.64 },
        active: true,
        hidden: false,
        ruined: false,
        nodix: false,
        seaport: false,
        underground: false,
        withdrawn: false,
        approximate: false,
        sourceSystem: "legacy",
        fields: {
            description: { value: null, origin: null, wiki: null },
            einwohner: { value: null, origin: null, wiki: "2.200" },
            lage: { value: null, origin: null, wiki: null },
            oberhaupt: { value: null, origin: null, wiki: null },
        },
        wiki: null,
        pathEnds: [],
    };
}
const quittung = (revision: number): OperationReceipt => ({
    operationId: "00000000-0000-4000-8000-000000000001",
    status: "applied",
    environment: "development",
    affected: [{ kind: "place", id: ORT, revision }],
    derivedWork: [],
    warnings: [],
    mapRevision: 57,
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

afterEach(() => {
    vi.useRealTimers();
});

function aufbau() {
    const aufrufe: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request) => {
        aufrufe.push(String(url).replace(EDITOR_LOCKS_URL, "locks"));
        return String(url).endsWith("/release")
            ? json(204, null)
            : json(200, {
                  lock: {
                      kind: "place",
                      id: ORT,
                      part: "felder",
                      person: { id: "d5d5d5d5-0000-4000-8000-0000000000f1", name: "Ich" },
                      since: "2026-10-30T10:00:00.000Z",
                      heartbeatAt: "2026-10-30T10:00:00.000Z",
                      own: true,
                  },
              });
    });
    vi.useFakeTimers();
    const baustein = createEditorSperre({ fetcher: fetcher as unknown as typeof fetch, lauf: LAUF });
    const ortSperre = createOrtSperre(baustein);
    const saetze: BearbeitungsSperre = {
        ort: ortSperre,
        gesperrt: () => "gesperrt",
        fehler: "nicht gesperrt",
        verloren: "Sperre abgelaufen",
        freigabeKonflikt: "Konflikt",
    };
    const gesendet: unknown[] = [];
    const antworten: Awaited<ReturnType<OrtApi["speichereOrt"]>>[] = [];
    let revision = 7;
    const api: OrtApi = {
        ort: () => Promise.resolve(ort(revision)),
        speichereOrt: (_id, body) => {
            gesendet.push(body);
            const antwort = antworten.shift();
            if (antwort !== undefined) return Promise.resolve(antwort);
            revision += 1;
            return Promise.resolve({ ok: true, quittung: quittung(revision) });
        },
    };
    return { baustein, ortSperre, saetze, api, aufrufe, gesendet, antworten };
}

describe("Ort: Freigabe auf Bitte", () => {
    it("🔴 das Fenster mit Entwurf speichert, DANN geht die Sperre zurück", async () => {
        const t = aufbau();
        const bearbeitung = createOrtBearbeitung(ORT, t.api, () => "op-3", t.saetze);
        await vi.waitFor(() => expect(bearbeitung.zustand.value.art).toBe("bereit"));
        bearbeitung.aendere((e) => setzeText(e, "einwohner", "2.5"));
        await vi.waitFor(() => expect(t.baustein.haelt({ kind: "place", id: ORT })).toBe(true));
        await vi.waitFor(() => expect(t.baustein.titelVon({ kind: "place", id: ORT })).toBe("Gratenfels"));

        expect(await t.baustein.gibFreiAufBitte({ kind: "place", id: ORT })).toEqual({ ok: true });
        expect(t.gesendet).toHaveLength(1);
        expect(t.baustein.haelt({ kind: "place", id: ORT })).toBe(false);
        expect(t.aufrufe.at(-1)).toBe("locks/release");
        expect(bearbeitung.ungespeichert.value).toBe(false);
        // Nichts bleibt angemeldet.
        expect(t.baustein.titelVon({ kind: "place", id: ORT })).toBeUndefined();
        bearbeitung.destroy();
    });

    it("🔴 scheitert das Speichern (Konflikt, 400), bleibt die Sperre, der Entwurf steht, und der Grund geht zurück", async () => {
        const t = aufbau();
        const bearbeitung = createOrtBearbeitung(ORT, t.api, () => "op-3", t.saetze);
        await vi.waitFor(() => expect(bearbeitung.zustand.value.art).toBe("bereit"));
        bearbeitung.aendere((e) => setzeText(e, "einwohner", "2.5"));
        await vi.waitFor(() => expect(t.baustein.haelt({ kind: "place", id: ORT })).toBe(true));

        t.antworten.push({
            ok: false,
            status: 409,
            fehler: { code: "edit_conflict", message: "geändert", details: { changedBy: { displayName: "Thomas" } } },
        });
        expect(await t.baustein.gibFreiAufBitte({ kind: "place", id: ORT })).toEqual({ ok: false, grund: "Konflikt" });
        expect(t.baustein.haelt({ kind: "place", id: ORT })).toBe(true);
        expect(bearbeitung.ungespeichert.value).toBe(true);

        // Abgelehnt: der Satz des Servers ist der Grund.
        bearbeitung.fremdenUebernehmen();
        await vi.waitFor(() => expect(t.baustein.haelt({ kind: "place", id: ORT })).toBe(false));
        bearbeitung.aendere((e) => setzeText(e, "einwohner", "2.6"));
        await vi.waitFor(() => expect(t.baustein.titelVon({ kind: "place", id: ORT })).toBe("Gratenfels"));
        const freigegeben = t.aufrufe.filter((a) => a === "locks/release").length;
        t.antworten.push({ ok: false, status: 400, fehler: { code: "validation_failed", message: "Zu lang." } });
        expect(await t.baustein.gibFreiAufBitte({ kind: "place", id: ORT })).toEqual({ ok: false, grund: "Zu lang." });
        expect(t.baustein.haelt({ kind: "place", id: ORT })).toBe(true);
        expect(t.aufrufe.filter((a) => a === "locks/release")).toHaveLength(freigegeben);
        bearbeitung.destroy();
    });

    it("🔴 Fenster UND „Ort verschieben“ halten den Ort: Beide enden, erst dann geht die Sperre zurück", async () => {
        const t = aufbau();
        const bearbeitung = createOrtBearbeitung(ORT, t.api, () => "op-3", t.saetze);
        await vi.waitFor(() => expect(bearbeitung.zustand.value.art).toBe("bereit"));
        bearbeitung.aendere((e) => setzeText(e, "einwohner", "2.5"));
        await vi.waitFor(() => expect(t.baustein.haelt({ kind: "place", id: ORT })).toBe(true));

        const verschiebeApi: VerschiebeApi = {
            ort: () => Promise.resolve(ort(7)),
            ziele: () => Promise.resolve({ radius: 50, freeEnds: [] } satisfies EditorMoveTargets),
            verschiebe: () => Promise.resolve({ ok: true, quittung: quittung(8) }),
        };
        const abbrechen = vi.fn(() => true);
        let losgelassen: ((zug: Zug) => void) | undefined;
        const karte: VerschiebeKarte = {
            zeige: vi.fn(),
            ein: vi.fn((_start, los: (zug: Zug) => void) => {
                losgelassen = los;
                return { abbrechen, setze: vi.fn(), sperre: vi.fn(), aus: vi.fn() };
            }),
            geaendert: vi.fn(),
        };
        const verschieben = createOrtVerschieben({
            api: verschiebeApi,
            karte,
            ladefehler: "x",
            neueKennung: () => "op-9",
            sperre: t.saetze,
        });
        await verschieben.starte("f1", ORT);
        expect(verschieben.laufend.value?.art).toBe("zieht");

        expect(await t.baustein.gibFreiAufBitte({ kind: "place", id: ORT })).toEqual({ ok: true });
        // Das Fenster hat gespeichert, der Modus ist zu, und die Sperre ist zurück (genau EINMAL).
        expect(t.gesendet).toHaveLength(1);
        expect(verschieben.laufend.value).toBeUndefined();
        expect(abbrechen).toHaveBeenCalled();
        expect(t.aufrufe.filter((a) => a === "locks/release")).toHaveLength(1);
        expect(t.baustein.haelt({ kind: "place", id: ORT })).toBe(false);
        expect(losgelassen).toBeDefined();
        verschieben.destroy();
        bearbeitung.destroy();
    });

    it("🔴 ein laufendes Schreiben von „Ort verschieben“ wird nicht abgebrochen: Die Sperre bleibt", async () => {
        const t = aufbau();
        let freigabe!: () => void;
        const verschiebeApi: VerschiebeApi = {
            ort: () => Promise.resolve(ort(7)),
            ziele: () => Promise.resolve({ radius: 50, freeEnds: [] } satisfies EditorMoveTargets),
            verschiebe: () =>
                new Promise((fertig) => {
                    freigabe = () => fertig({ ok: true, quittung: quittung(8) });
                }),
        };
        let losgelassen: ((zug: Zug) => void) | undefined;
        const karte: VerschiebeKarte = {
            zeige: vi.fn(),
            ein: vi.fn((_start, los: (zug: Zug) => void) => {
                losgelassen = los;
                return { abbrechen: () => false, setze: vi.fn(), sperre: vi.fn(), aus: vi.fn() };
            }),
            geaendert: vi.fn(),
        };
        const verschieben = createOrtVerschieben({
            api: verschiebeApi,
            karte,
            ladefehler: "x",
            neueKennung: () => "op-9",
            sperre: t.saetze,
        });
        await verschieben.starte("f1", ORT);
        losgelassen?.({ ort: { x: 430, y: 520 }, getrennt: false, eingerastet: undefined });
        // Loslassen ist ein Schritt im Entwurf (EDIT-0003 G4); erst „Fertig“ schreibt.
        expect(verschieben.laufend.value?.art).toBe("zieht");
        void verschieben.fertig();
        expect(verschieben.laufend.value?.art).toBe("speichert");
        expect(await t.baustein.gibFreiAufBitte({ kind: "place", id: ORT })).toEqual({ ok: false, grund: undefined });
        expect(t.baustein.haelt({ kind: "place", id: ORT })).toBe(true);
        freigabe();
        verschieben.destroy();
    });

    it("„Ort setzen“ (wartet auf den Klick) endet auf die Bitte; ohne Halter bleibt kein Angebot", async () => {
        const t = aufbau();
        const setzKarte: SetzKarte = { ein: vi.fn(() => ({ aus: vi.fn() })) } as unknown as SetzKarte;
        const setzApi = {
            ort: () => Promise.resolve(ort(7)),
            verschiebe: () => Promise.resolve({ ok: true, quittung: quittung(8) }),
            lege: () => Promise.resolve({ ok: true, quittung: quittung(8) }),
        } as unknown as SetzenApi;
        const setzen = createOrtSetzen({
            api: setzApi,
            karte: setzKarte,
            gesetzt: vi.fn(),
            ladefehler: "x",
            neueKennung: () => "op-2",
            sperre: t.saetze,
        });
        const zeile = { key: ORT, origin: "ohne-lage", name: "Gratenfels" } as unknown as EditorPlaceRow;
        setzen.starte("f1", zeile);
        await vi.waitFor(() => expect(t.baustein.haelt({ kind: "place", id: ORT })).toBe(true));
        expect(await t.baustein.gibFreiAufBitte({ kind: "place", id: ORT })).toEqual({ ok: true });
        expect(setzen.laufend.value).toBeUndefined();
        expect(t.baustein.haelt({ kind: "place", id: ORT })).toBe(false);
        setzen.destroy();
    });
});
