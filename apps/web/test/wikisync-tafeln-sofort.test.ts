import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    KANON_OBJEKTART_VORGABE,
    WIKISYNC_TAFELN_URL,
    WIKISYNC_UEBERNEHMEN_URL,
    WIKI_NAMESPACE_VORGABE,
    type WikisyncTafeln,
} from "@avesmaps3d/shared";
import type { Need } from "../src/auth/bestaetigen.ts";
import { locale } from "../src/i18n/i18n.ts";
import { createWikisync } from "../src/wikisync/wikisync.ts";
import { nsSofort, ohneSofort } from "../src/wikisync/wikisync-tafeln-sofort.ts";

/**
 * Die zwei Tafeln des Kanon-Etiketts speichern jede Änderung sofort (WI-0253, Vali 2026-10-27: „sachen die ich in Ohne Wiki-Artikel und ohne Quelle einstelle,
 * speichern nicht“ und „warum muss man speichern, warum speichert der klick nicht?“). Der Server hier ist nachgebaut: Er hält die Tafeln und die Revision, prüft
 * `baseRevision` wie die Route (409 `edit_conflict`) und verlangt auf Wunsch den Passkey (403 `reauth_required`).
 */

type Koerper = {
    operationId: string;
    baseRevision: number;
    namensraeume?: { ns: number; praefix: string; kanon: string; einsammeln: boolean; bezeichner: string }[];
    entfernen?: number[];
    objektarten?: { art: string; anzeigen: boolean; bezeichner: string }[];
};

interface Welt {
    revision: number;
    namensraeume: WikisyncTafeln["namensraeume"];
    objektarten: WikisyncTafeln["objektarten"];
    posts: Koerper[];
    /** Soll der nächste Schreibversuch scheitern? Eine Antwort statt der Quittung. */
    ablehnen: Response | undefined;
    passkey: boolean;
    passkeyNoetig: boolean;
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
const fehler = (status: number, code: string, details?: Record<string, unknown>): Response =>
    json({ error: { code, message: code, details } }, status);

function server(optionen: { passkeyNoetig?: boolean } = {}) {
    const welt: Welt = {
        revision: 5,
        namensraeume: WIKI_NAMESPACE_VORGABE.map((zeile) => ({
            ...zeile,
            objekte: zeile.ns === 222 ? 12 : 0,
            geaendertAm: null,
            geaendertVon: null,
        })),
        objektarten: KANON_OBJEKTART_VORGABE.map((zeile) => ({
            ...zeile,
            objekte: zeile.art === "place" ? 1118 : 40,
            geaendertAm: null,
            geaendertVon: null,
        })),
        posts: [],
        ablehnen: undefined,
        passkey: false,
        passkeyNoetig: optionen.passkeyNoetig ?? false,
    };
    const tafeln = (): WikisyncTafeln => ({
        jetzt: "2026-10-27T08:00:00Z",
        quelle: "datenbank",
        revision: welt.revision,
        namensraeume: welt.namensraeume.map((zeile) => ({ ...zeile })),
        objektarten: welt.objektarten.map((zeile) => ({ ...zeile })),
    });
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
        const pfad = String(url).split("?")[0] ?? "";
        // Ein echter Server antwortet nie im selben Augenblick: Zwei Klicks hintereinander sind so wirklich gleichzeitig unterwegs.
        await new Promise((fertig) => setTimeout(fertig, 1));
        if (init?.method !== "POST") return pfad === WIKISYNC_TAFELN_URL ? json(tafeln()) : json({});
        const body = JSON.parse(String(init.body)) as Koerper;
        welt.posts.push(body);
        if (welt.passkeyNoetig && !welt.passkey) return fehler(403, "reauth_required", { need: "passkey" });
        if (welt.ablehnen !== undefined) return welt.ablehnen;
        if (body.baseRevision !== welt.revision) return fehler(409, "edit_conflict");
        for (const zeile of body.namensraeume ?? []) {
            const vorhanden = welt.namensraeume.findIndex((kandidat) => kandidat.ns === zeile.ns);
            const alt = welt.namensraeume[vorhanden];
            const neu = { ...zeile, objekte: alt?.objekte ?? null, geaendertAm: null, geaendertVon: null };
            if (vorhanden >= 0) welt.namensraeume[vorhanden] = neu as never;
            else welt.namensraeume.push(neu as never);
            welt.namensraeume.sort((a, b) => a.ns - b.ns);
        }
        for (const ns of body.entfernen ?? []) welt.namensraeume = welt.namensraeume.filter((z) => z.ns !== ns);
        for (const zeile of body.objektarten ?? []) {
            const vorhanden = welt.objektarten.findIndex((kandidat) => kandidat.art === zeile.art);
            const alt = welt.objektarten[vorhanden];
            welt.objektarten[vorhanden] = { ...alt, ...zeile } as never;
        }
        welt.revision += 1;
        return json({ environment: "staging", affected: [], derivedWork: [], warnings: [] });
    }) as typeof fetch;
    return { welt, fetcher };
}

async function seite(optionen: { passkeyNoetig?: boolean; passkeyGeben?: boolean } = {}) {
    const s = server({ passkeyNoetig: optionen.passkeyNoetig ?? false });
    const fragen: Need[] = [];
    const ws = createWikisync({
        fetcher: s.fetcher,
        ask: async (need) => {
            fragen.push(need);
            s.welt.passkey = optionen.passkeyGeben ?? true;
            return s.welt.passkey;
        },
    });
    await ws.ladeTafeln();
    return { ...s, fragen, ws, ohne: ohneSofort(ws, () => "staging"), ns: nsSofort(ws, () => "staging") };
}

const warteAuf = (bedingung: () => boolean) => vi.waitFor(() => expect(bedingung()).toBe(true));

beforeEach(() => {
    locale.value = "de";
});

describe("Ohne Wiki-Artikel und ohne Quelle: jede Änderung speichert sofort", () => {
    it("Anzeigen wechseln speichert beim Wechsel, die Zeile zeigt den Wunsch, danach den Stand und die Wirkung in einem Satz", async () => {
        const { welt, ohne } = await seite();
        ohne.aendere("place", { anzeigen: true });
        // Unterwegs: Die Auswahl springt nicht zurück, die Zeile sagt, dass sie gespeichert wird.
        expect(ohne.speichert("place")).toBe(true);
        expect(ohne.zeilen.value.find((zeile) => zeile.art === "place")?.anzeigen).toBe(true);
        await warteAuf(() => !ohne.speichert("place"));
        expect(welt.posts).toHaveLength(1);
        expect(welt.posts[0]).toMatchObject({
            baseRevision: 5,
            objektarten: [{ art: "place", anzeigen: true, bezeichner: "Avesmaps" }],
        });
        expect(welt.posts[0]?.namensraeume).toBeUndefined();
        expect(ohne.zeilen.value.find((zeile) => zeile.art === "place")?.anzeigen).toBe(true);
        expect(ohne.meldung.value).toBe(
            "Orte: gespeichert, die Tafel von Stage gilt sofort. 1.118 Objekte bekommen eine Pille.",
        );
        expect(ohne.fehler.value).toBeUndefined();
    });

    it("Wege zählen Abschnitte: der Satz sagt „bis zu“", async () => {
        const { ohne } = await seite();
        ohne.aendere("path", { anzeigen: true });
        await warteAuf(() => !ohne.speichert("path"));
        expect(ohne.meldung.value).toContain("bis zu 40 Objekte bekommen eine Pille");
    });

    it("eine ausgeschaltete Art, deren Bezeichner sich ändert: kein Objekt betroffen, der Satz sagt, wann er gilt", async () => {
        const { ohne } = await seite();
        ohne.tippe("area", "Avesmaps Gebiet");
        ohne.fertig("area");
        await warteAuf(() => !ohne.speichert("area"));
        expect(ohne.meldung.value).toContain("Keine Objekte betroffen");
    });

    it("ein Textfeld speichert erst beim Verlassen, nie je Tastendruck", async () => {
        const { welt, ohne } = await seite();
        for (const text of ["N", "Ne", "Neu", "Neuer Bezeichner"]) ohne.tippe("place", text);
        // Nichts ging an den Server, solange getippt wird; das Feld zeigt den getippten Text.
        await new Promise((fertig) => setTimeout(fertig, 20));
        expect(welt.posts).toHaveLength(0);
        const zeile = ohne.zeilen.value.find((kandidat) => kandidat.art === "place")!;
        expect(ohne.text("place", zeile)).toBe("Neuer Bezeichner");
        ohne.fertig("place");
        await warteAuf(() => !ohne.speichert("place"));
        expect(welt.posts).toHaveLength(1);
        expect(welt.posts[0]?.objektarten).toEqual([{ art: "place", anzeigen: false, bezeichner: "Neuer Bezeichner" }]);
        // Enter und danach der Abgang des Fokus melden sich beide: gespeichert wird einmal.
        ohne.fertig("place");
        await new Promise((fertig) => setTimeout(fertig, 20));
        expect(welt.posts).toHaveLength(1);
    });

    it("Escape stellt den gespeicherten Wert wieder her und speichert nichts; ohne getippten Text gilt Escape nicht dem Feld", async () => {
        const { welt, ohne } = await seite();
        const zeile = ohne.zeilen.value.find((kandidat) => kandidat.art === "place")!;
        expect(ohne.zurueck("place")).toBe(false);
        ohne.tippe("place", "Verworfen");
        expect(ohne.zurueck("place")).toBe(true);
        expect(ohne.text("place", zeile)).toBe("Avesmaps");
        ohne.fertig("place");
        await new Promise((fertig) => setTimeout(fertig, 20));
        expect(welt.posts).toHaveLength(0);
    });

    it("ein unveränderter Text schickt nichts", async () => {
        const { welt, ohne } = await seite();
        ohne.tippe("place", "  Avesmaps ");
        ohne.fertig("place");
        await new Promise((fertig) => setTimeout(fertig, 20));
        expect(welt.posts).toHaveLength(0);
    });

    it("ein zu langer Bezeichner wird nicht gespeichert, bleibt im Feld stehen und die Zeile nennt den Grund; ein gekürzter Text speichert", async () => {
        const { welt, ohne } = await seite();
        const zeile = ohne.zeilen.value.find((kandidat) => kandidat.art === "place")!;
        const zuLang = "x".repeat(41);
        ohne.tippe("place", zuLang);
        ohne.fertig("place");
        await new Promise((fertig) => setTimeout(fertig, 20));
        expect(welt.posts).toHaveLength(0);
        expect(ohne.text("place", zeile)).toBe(zuLang);
        expect(ohne.textGrund("place")).toBe("Der Bezeichner in der Zeile Orte ist länger als 40 Zeichen.");
        // Weiter tippen nimmt den Grund weg; gespeichert wird erst, wenn der Text gilt.
        ohne.tippe("place", "x".repeat(40));
        expect(ohne.textGrund("place")).toBeUndefined();
        ohne.fertig("place");
        await warteAuf(() => !ohne.speichert("place"));
        expect(welt.posts).toHaveLength(1);
        expect(welt.posts[0]?.objektarten?.[0]?.bezeichner).toBe("x".repeat(40));
    });

    it("↺ setzt die Zeile auf die Vorgabe und speichert sofort", async () => {
        const { welt, ohne } = await seite();
        ohne.aendere("place", { anzeigen: true });
        await warteAuf(() => !ohne.speichert("place"));
        const zeile = ohne.zeilen.value.find((kandidat) => kandidat.art === "place")!;
        ohne.tippe("place", "halb getippt");
        ohne.ersetze("place", { ...zeile, anzeigen: false, bezeichner: "Avesmaps" });
        // Auch der halb getippte Text ist weg.
        expect(ohne.text("place", zeile)).toBe("Avesmaps");
        await warteAuf(() => !ohne.speichert("place"));
        expect(welt.posts).toHaveLength(2);
        expect(welt.posts[1]?.objektarten).toEqual([{ art: "place", anzeigen: false, bezeichner: "Avesmaps" }]);
        expect(ohne.meldung.value).toContain("verlieren ihre Pille");
    });

    it("lehnt der Server ab, springt die Zeile auf den gespeicherten Wert zurück und die Meldung steht an der Tafel", async () => {
        const { welt, ohne } = await seite();
        welt.ablehnen = fehler(400, "validation_failed", { reason: "bezeichner_zu_lang", row: "place" });
        ohne.aendere("place", { anzeigen: true });
        await warteAuf(() => !ohne.speichert("place"));
        expect(ohne.zeilen.value.find((zeile) => zeile.art === "place")?.anzeigen).toBe(false);
        expect(ohne.fehler.value?.ok).toBe(false);
        expect(ohne.fehler.value?.problems[0]).toEqual({
            key: "admin.wikisync.tafel.fehler.bezeichner_zu_lang",
            params: { zeile: "place" },
        });
        expect(ohne.meldung.value).toBeNull();
    });

    it("hat jemand die Tafel inzwischen geändert (409), springt die Zeile zurück und die Meldung nennt den Konflikt", async () => {
        const { welt, ohne } = await seite();
        welt.revision += 1; // eine andere Sitzung war schneller
        ohne.aendere("place", { anzeigen: true });
        await warteAuf(() => !ohne.speichert("place"));
        expect(ohne.zeilen.value.find((zeile) => zeile.art === "place")?.anzeigen).toBe(false);
        expect(ohne.fehler.value?.ok).toBe(false);
        expect(ohne.fehler.value?.conflict).toBeDefined();
    });

    it("bricht die Person den Passkey ab, springt die Zeile zurück, und es steht da, dass die Bestätigung fehlt", async () => {
        const { welt, ohne, fragen } = await seite({ passkeyNoetig: true, passkeyGeben: false });
        ohne.aendere("place", { anzeigen: true });
        await warteAuf(() => !ohne.speichert("place"));
        expect(fragen).toEqual(["passkey"]);
        expect(welt.revision).toBe(5);
        expect(ohne.zeilen.value.find((zeile) => zeile.art === "place")?.anzeigen).toBe(false);
        expect(ohne.fehler.value?.problems).toEqual([{ key: "admin.system.error.notConfirmed" }]);
    });

    it("zwei Klicks hintereinander in verschiedenen Zeilen: zwei Anfragen in einer Reihe, die zweite mit der neuen Revision, ein Passkey", async () => {
        const { welt, ohne, fragen } = await seite({ passkeyNoetig: true });
        ohne.aendere("place", { anzeigen: true });
        ohne.aendere("path", { anzeigen: true });
        await warteAuf(() => !ohne.speichert("place") && !ohne.speichert("path"));
        expect(fragen).toEqual(["passkey"]);
        expect(ohne.fehler.value).toBeUndefined();
        // Der erste Versuch scheitert am Passkey (403), die Wiederholung gelingt; danach folgt die zweite Zeile mit der Revision nach der ersten.
        const gelungen = welt.posts.filter((_, index) => index > 0);
        expect(gelungen.map((post) => post.baseRevision)).toEqual([5, 6]);
        expect(welt.objektarten.filter((zeile) => zeile.anzeigen).map((zeile) => zeile.art)).toEqual(["place", "path"]);
    });

    it("zwei Änderungen an derselben Zeile hintereinander: eine Anfrage mit beiden Werten", async () => {
        const { welt, ohne } = await seite();
        ohne.aendere("place", { anzeigen: true });
        ohne.tippe("place", "Beides");
        ohne.fertig("place");
        await warteAuf(() => !ohne.speichert("place"));
        expect(welt.posts).toHaveLength(1);
        expect(welt.posts[0]?.objektarten).toEqual([{ art: "place", anzeigen: true, bezeichner: "Beides" }]);
        expect(ohne.fehler.value).toBeUndefined();
    });
});

describe("Namensräume: jede Änderung speichert sofort", () => {
    it("Kanon wechseln speichert beim Wechsel; der Satz nennt die Zahl der Objekte und dass die Etiketten erst beim Neuberechnen folgen", async () => {
        const { welt, ns } = await seite();
        ns.aendere(222, { kanon: "offiziell" });
        await warteAuf(() => !ns.speichert(222));
        expect(welt.posts[0]).toMatchObject({
            baseRevision: 5,
            namensraeume: [
                {
                    ns: 222,
                    praefix: "Inoffiziell",
                    kanon: "offiziell",
                    einsammeln: true,
                    bezeichner: "Wiki Aventurica",
                },
            ],
        });
        expect(ns.meldung.value).toBe(
            "Namensraum 222 gespeichert (Tafel von Stage). 12 Objekte wechseln den Kanon. Die Etiketten folgen beim nächsten Neuberechnen.",
        );
    });

    it("Einsammeln wechseln speichert und sagt, ab wann es gilt", async () => {
        const { ns } = await seite();
        ns.aendere(220, { einsammeln: true });
        await warteAuf(() => !ns.speichert(220));
        expect(ns.meldung.value).toContain("Kein Objekt wechselt sein Etikett.");
        expect(ns.meldung.value).toContain("Das Einsammeln gilt ab dem nächsten Lauf.");
    });

    it("der Bezeichner speichert beim Verlassen; ↺ stellt die Vorgabe her und speichert", async () => {
        const { welt, ns } = await seite();
        ns.tippe(218, "Schwarze Katze");
        expect(welt.posts).toHaveLength(0);
        ns.fertig(218);
        await warteAuf(() => !ns.speichert(218));
        expect(welt.posts[0]?.namensraeume?.[0]).toMatchObject({ ns: 218, bezeichner: "Schwarze Katze" });
        const zeile = ns.zeilen.value.find((kandidat) => kandidat.ns === 218)!;
        ns.ersetze(218, { ...zeile, bezeichner: "" });
        await warteAuf(() => !ns.speichert(218));
        expect(welt.posts[1]?.namensraeume?.[0]).toMatchObject({ ns: 218, bezeichner: "" });
    });

    it("ein hinzugefügter Raum wird gespeichert und steht danach in der Tafel; ✕ nimmt ihn heraus", async () => {
        const { welt, ns } = await seite();
        const ergebnis = await ns.fuegeHinzu(300, {
            ns: 300,
            praefix: "Briefspiel",
            kanon: "inoffiziell",
            einsammeln: false,
            bezeichner: "",
            objekte: null,
        });
        expect(ergebnis.ok).toBe(true);
        expect(welt.posts[0]?.namensraeume).toEqual([
            { ns: 300, praefix: "Briefspiel", kanon: "inoffiziell", einsammeln: false, bezeichner: "" },
        ]);
        expect(ns.zeilen.value.map((zeile) => zeile.ns)).toContain(300);
        expect(ns.meldung.value).toBe(
            "Namensraum 300 („Briefspiel“): neu in der Tafel, Kanon inoffiziell, Einsammeln nein.",
        );

        ns.entferne(300);
        // Unterwegs ist die Zeile schon weg (die Tafel zeigt den Wunsch).
        expect(ns.zeilen.value.map((zeile) => zeile.ns)).not.toContain(300);
        await warteAuf(() => !ns.speichert(300));
        expect(welt.posts[1]).toMatchObject({ baseRevision: 6, entfernen: [300] });
        expect(ns.meldung.value).toBe("Namensraum 300 („Briefspiel“): aus der Tafel entfernt.");
    });

    it("lehnt der Server das Entfernen ab, steht die Zeile wieder da und die Meldung steht an der Tafel", async () => {
        const { welt, ns } = await seite();
        await ns.fuegeHinzu(300, {
            ns: 300,
            praefix: "Briefspiel",
            kanon: "inoffiziell",
            einsammeln: false,
            bezeichner: "",
            objekte: null,
        });
        welt.ablehnen = fehler(409, "no_change");
        ns.entferne(300);
        await warteAuf(() => !ns.speichert(300));
        expect(ns.zeilen.value.map((zeile) => zeile.ns)).toContain(300);
        expect(ns.fehler.value?.problems).toEqual([{ key: "admin.wikisync.fehler.no_change" }]);
    });

    it("eine abgelehnte neue Zeile meldet das Ergebnis dem Formular (es bleibt offen) und setzt die Meldung der Tafel", async () => {
        const { welt, ns } = await seite();
        welt.ablehnen = fehler(400, "validation_failed", { reason: "praefix_doppelt", row: 300 });
        const ergebnis = await ns.fuegeHinzu(300, {
            ns: 300,
            praefix: "Elf",
            kanon: "inoffiziell",
            einsammeln: false,
            bezeichner: "",
            objekte: null,
        });
        expect(ergebnis.ok).toBe(false);
        expect(ns.fehler.value?.ok).toBe(false);
        expect(ns.zeilen.value.map((zeile) => zeile.ns)).not.toContain(300);
    });
});

describe("Wikisync.tafelnSpeichern: die Reihe", () => {
    it("ein Körper, der nichts mehr zu schicken hat (null), ist ein Erfolg ohne Anfrage", async () => {
        const { welt, ws } = await seite();
        const ergebnis = await ws.tafelnSpeichern("ohne", () => null);
        expect(ergebnis.ok).toBe(true);
        expect(welt.posts).toHaveLength(0);
    });

    it("läuft gerade eine andere Handlung des Reiters, steht es da, statt still nichts zu tun", async () => {
        const s = server();
        let frei!: () => void;
        const tor = new Promise<void>((fertig) => (frei = fertig));
        const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === "POST" && String(url).startsWith(WIKISYNC_UEBERNEHMEN_URL)) {
                await tor;
                return json({ environment: "staging", affected: [], derivedWork: [], warnings: [] });
            }
            return s.fetcher(url, init);
        }) as typeof fetch;
        const ws = createWikisync({ fetcher, ask: async () => true });
        await ws.ladeTafeln();
        const start = ws.starten({ alle: true, ablauf: "ganz" });
        await vi.waitFor(() => expect(ws.busy.value).toBe("start"));
        const ergebnis = await ws.tafelnSpeichern("ohne", {
            objektarten: [{ art: "place", anzeigen: true, bezeichner: "" }],
        });
        expect(ergebnis.ok).toBe(false);
        expect(ergebnis.problems).toEqual([{ key: "admin.wikisync.fehler.beschaeftigt" }]);
        frei();
        await start;
    });
});
