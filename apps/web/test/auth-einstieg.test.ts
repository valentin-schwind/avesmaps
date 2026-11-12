import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { windowForEditorStart, windowForEntry } from "../src/auth/auth-windows.ts";
import {
    isEditorAddress,
    publicMapUrl,
    readEntry,
    rememberLink,
    rememberView,
    takeRememberedLink,
    takeRememberedView,
} from "../src/auth/entry.ts";
import type { Fetcher } from "../src/auth/api.ts";
import { followLateSession, loadSession, authState } from "../src/auth/session-state.ts";
import { secondFactorMissing } from "../src/auth/zweiter-faktor.ts";
import { bootstrapViewer } from "../src/viewer/bootstrap-viewer.ts";

/**
 * Einstieg und Ansicht (WI-0120 A9, AUTH-0001 §6.3, §6.5, §8): Ein Link mit Geheimnis im Fragment wird vor dem Start gelesen
 * und aus der Adresse genommen; die Rückkehr von Discord findet ihren Kartenausschnitt wieder; die Ansicht folgt der Sitzung,
 * und ohne Antwort des Servers zeigt `/edit` die Besucheransicht mit dem Anmeldefenster (WI-0203).
 */
const TOKEN = "A".repeat(20) + "b_-".repeat(7) + "Z".repeat(2);

// `loadSession` setzt den gemeinsamen `authState`. Im geteilten Prozess (`--no-isolate`, Sammellauf) las die nächste Datei sonst die
// Sitzung dieser Fälle (Befund der Arbeitshygiene 2026-10-19: zwei Fälle in `map-checks.test.ts` rot); nach jedem Fall gilt der Stand davor.
let sitzungVorher: typeof authState.value;
beforeEach(() => {
    sitzungVorher = authState.value;
});
afterEach(() => {
    authState.value = sitzungVorher;
});

class MemoryStorage {
    private readonly items = new Map<string, string>();
    getItem(key: string): string | null {
        return this.items.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
        this.items.set(key, value);
    }
    removeItem(key: string): void {
        this.items.delete(key);
    }
}

describe("Editor-Modus (Betreiber 2026-10-09)", () => {
    it("🔴 nur `/edit`, `?editor=true` und Legacys `?edit=1`; sonst ist es die öffentliche Karte", () => {
        expect(isEditorAddress({ pathname: "/edit", search: "" })).toBe(true);
        expect(isEditorAddress({ pathname: "/edit/", search: "?route=Gareth~Punin" })).toBe(true);
        expect(isEditorAddress({ pathname: "/", search: "?route=Gareth~Punin&editor=true" })).toBe(true);
        expect(isEditorAddress({ pathname: "/", search: "?edit=1" })).toBe(true);
        expect(isEditorAddress({ pathname: "/", search: "" })).toBe(false);
        expect(isEditorAddress({ pathname: "/", search: "?editor=false&edit=0" })).toBe(false);
        expect(isEditorAddress({ pathname: "/editor", search: "" })).toBe(false);
    });
});

describe("Einstieg über einen Link", () => {
    it("🔴 Einladung: Token aus dem Fragment, Adresse danach /edit (Editor-Modus) mit den übrigen Parametern", () => {
        expect(TOKEN).toHaveLength(43);
        const entry = readEntry({ pathname: "/einladung", search: "?lang=en", hash: `#${TOKEN}` });
        expect(entry.link).toEqual({ kind: "invitation", token: TOKEN });
        expect(entry.url).toBe("/edit?lang=en");
        expect(readEntry({ pathname: "/passwort/", search: "", hash: `#${TOKEN}` }).link).toEqual({
            kind: "password_reset",
            token: TOKEN,
        });
    });

    it("🔴 ein verstümmeltes Token ist kein Token; die Adresse wird trotzdem bereinigt", () => {
        const entry = readEntry({ pathname: "/notzugang", search: "", hash: "#zu-kurz" });
        expect(entry.link).toEqual({ kind: "recovery", token: null });
        expect(entry.url).toBe("/edit");
    });

    it("🔴 Statusseite einer Meldung (WI-0268 C2): der Schlüssel kommt aus dem Fragment und geht aus der Adresse, die Karte bleibt die Karte", () => {
        const entry = readEntry({ pathname: "/meldung", search: "?lang=en", hash: `#${TOKEN}` });
        expect(entry.status).toBe(TOKEN);
        // Kein Anmeldelink: weder ein Fenster der Anmeldung noch der Editor-Modus; die Adresse ist die der Karte, ohne Fragment.
        expect(entry.link).toBeNull();
        expect(entry.outcome).toBeNull();
        expect(entry.url).toBe("/?lang=en");
        expect(windowForEntry(entry, null)).toBeNull();
        expect(readEntry({ pathname: "/meldung/", search: "", hash: `#${TOKEN}` })).toMatchObject({
            status: TOKEN,
            url: "/",
        });
    });

    it("🔴 ein fehlender oder verstümmelter Schlüssel der Statusseite ist `null` (das Fenster sagt „gibt es nicht (mehr)“); die Adresse wird trotzdem bereinigt", () => {
        for (const hash of ["", "#", "#zu-kurz", `#${TOKEN}x`]) {
            const entry = readEntry({ pathname: "/meldung", search: "", hash });
            expect(entry.status, hash).toBeNull();
            expect(entry.url, hash).toBe("/");
        }
    });

    it("jede andere Adresse hat kein `status`: nur `/meldung` öffnet die Statusseite", () => {
        expect(readEntry({ pathname: "/", search: "", hash: `#${TOKEN}` }).status).toBeUndefined();
        expect(readEntry({ pathname: "/einladung", search: "", hash: `#${TOKEN}` }).status).toBeUndefined();
        expect(readEntry({ pathname: "/meldungen", search: "", hash: `#${TOKEN}` }).status).toBeUndefined();
    });

    it("🔴 Token-Link der Karten (WI-0280): `/paket#<43 Zeichen>` ergibt `entry.kartenPaket` und nimmt das Token aus der Adresse", () => {
        const entry = readEntry({ pathname: "/paket", search: "?lang=en", hash: `#${TOKEN}` });
        expect(entry.kartenPaket).toBe(TOKEN);
        expect(entry.link).toBeNull();
        expect(entry.url).toBe("/?lang=en");
        expect(entry.url).not.toContain(TOKEN);
        expect(windowForEntry(entry, null)).toBeNull();
        // Verstümmelt: Das Fenster sagt „gilt nicht mehr“, statt dass der Rest der Adresse eine Karte öffnet.
        expect(readEntry({ pathname: "/paket", search: "", hash: "#kurz" }).kartenPaket).toBeNull();
        expect(readEntry({ pathname: "/paketchen", search: "", hash: `#${TOKEN}` }).kartenPaket).toBeUndefined();
    });

    it("🔴 Statusseite eines Reisebilds (WI-0272 S2b): `/reisebild#<43 Zeichen>` ergibt `entry.reisebild` und räumt die Adresse auf; die Karte bleibt die Karte", () => {
        const entry = readEntry({ pathname: "/reisebild", search: "?lang=en", hash: `#${TOKEN}` });
        expect(entry.reisebild).toBe(TOKEN);
        // Kein Anmeldelink, kein Ergebnis der Rückkehr und auch keine Meldung: ein eigenes Feld, dieselbe Bereinigung wie bei `/meldung`.
        expect(entry.link).toBeNull();
        expect(entry.outcome).toBeNull();
        expect(entry.status).toBeUndefined();
        expect(entry.url).toBe("/?lang=en");
        expect(windowForEntry(entry, null)).toBeNull();
        expect(readEntry({ pathname: "/reisebild/", search: "", hash: `#${TOKEN}` })).toMatchObject({
            reisebild: TOKEN,
            url: "/",
        });
    });

    it("🔴 ein fehlender oder verstümmelter Schlüssel des Reisebilds ist `null` (die Seite sagt „gibt es nicht (mehr)“); die Adresse wird trotzdem bereinigt", () => {
        for (const hash of ["", "#", "#zu-kurz", `#${TOKEN}x`]) {
            const entry = readEntry({ pathname: "/reisebild", search: "", hash });
            expect(entry.reisebild, hash).toBeNull();
            expect(entry.url, hash).toBe("/");
        }
    });

    it("nur `/reisebild` öffnet die Statusseite eines Reisebilds, nur `/meldung` die einer Meldung: keine Adresse bedient beide", () => {
        expect(readEntry({ pathname: "/", search: "", hash: `#${TOKEN}` }).reisebild).toBeUndefined();
        expect(readEntry({ pathname: "/meldung", search: "", hash: `#${TOKEN}` }).reisebild).toBeUndefined();
        expect(readEntry({ pathname: "/reisebild", search: "", hash: `#${TOKEN}` }).status).toBeUndefined();
        expect(readEntry({ pathname: "/reisebilder", search: "", hash: `#${TOKEN}` }).reisebild).toBeUndefined();
        expect(readEntry({ pathname: "/einladung", search: "", hash: `#${TOKEN}` }).reisebild).toBeUndefined();
    });

    it("🔴 Rückkehr von Discord: Ergebnis gelesen, Parameter weg, Ausschnitt bleibt; Unbekanntes wird nur entfernt", () => {
        const back = readEntry({ pathname: "/edit", search: "?anmeldung=kein_zugang&von=Gareth", hash: "#x=1&z=5" });
        expect(back).toEqual({ link: null, outcome: "kein_zugang", url: "/edit?von=Gareth#x=1&z=5" });
        expect(readEntry({ pathname: "/", search: "?edit=1&anmeldung=ok", hash: "" }).url).toBe("/?edit=1");
        // Ohne Ziel zurück (Umweg abgelaufen): in den Editor-Modus, denn nur dort gibt es die Anmeldung.
        expect(readEntry({ pathname: "/", search: "?anmeldung=abgelaufen&von=Gareth", hash: "#x=1" }).url).toBe(
            "/edit?von=Gareth#x=1",
        );
        expect(readEntry({ pathname: "/", search: "?anmeldung=<script>", hash: "" })).toEqual({
            link: null,
            outcome: null,
            url: "/",
        });
        expect(readEntry({ pathname: "/", search: "?von=Gareth", hash: "#x=1" }).url).toBeNull();
    });

    it("🔴 was beim Start aufgeht: Link → Fenster, schlechte Rückkehr → Fenster mit Erklärung, gute → nichts", () => {
        const invitation = readEntry({ pathname: "/einladung", search: "", hash: `#${TOKEN}` });
        expect(windowForEntry(invitation, null)).toEqual({ name: "einladung", token: TOKEN });
        const refused = readEntry({ pathname: "/", search: "?anmeldung=kein_zugang", hash: "" });
        expect(windowForEntry(refused, null)).toEqual({ name: "anmelden", outcome: "kein_zugang" });
        const ok = readEntry({ pathname: "/", search: "?anmeldung=ok", hash: "" });
        expect(windowForEntry(ok, null)).toBeNull();
        expect(windowForEntry(ok, { kind: "passkey_enrollment", token: TOKEN })).toEqual({
            name: "passkey",
            token: TOKEN,
        });
        expect(windowForEntry(readEntry({ pathname: "/anmelden", search: "", hash: "" }), null)).toEqual({
            name: "anmelden",
        });
    });

    it("🔴 `/anmelden` angemeldet: kein Fenster, gleich in den Editor-Modus; Discords Rückkehr dorthin zählt nach Ergebnis (R6)", () => {
        const login = readEntry({ pathname: "/anmelden", search: "", hash: "" });
        expect(login.url).toBe("/edit");
        expect(windowForEntry(login, null, true)).toBeNull();
        const refused = readEntry({ pathname: "/anmelden", search: "?anmeldung=kein_zugang", hash: "" });
        expect(refused.url).toBe("/edit");
        expect(windowForEntry(refused, null)).toEqual({ name: "anmelden", outcome: "kein_zugang" });
        const invalid = readEntry({ pathname: "/anmelden", search: "?anmeldung=einladung_ungueltig", hash: "" });
        expect(windowForEntry(invalid, null)).toEqual({
            name: "einladung",
            token: null,
            outcome: "einladung_ungueltig",
        });
        const ok = readEntry({ pathname: "/anmelden", search: "?s=k3x9&anmeldung=ok", hash: "" });
        expect(ok.url).toBe("/edit?s=k3x9");
        expect(windowForEntry(ok, null, true)).toBeNull();
        expect(windowForEntry(ok, { kind: "passkey_enrollment", token: TOKEN }, true)).toEqual({
            name: "passkey",
            token: TOKEN,
        });
    });

    it("🔴 hinter der Stage-Tür: `/anmelden#ziel=…` führt nach `/edit` mit der Suche des Ziels, Zeichen für Zeichen (2026-10-18)", () => {
        const route = readEntry({ pathname: "/anmelden", search: "", hash: "#ziel=/?route=Trallop~Baliho" });
        expect(route.url).toBe("/edit?route=Trallop~Baliho");
        expect(windowForEntry(route, null)).toEqual({ name: "anmelden" });
        expect(
            readEntry({ pathname: "/anmelden", search: "", hash: "#ziel=/edit?verwaltung=wegfindung&tab=x" }).url,
        ).toBe("/edit?verwaltung=wegfindung&tab=x");
        expect(readEntry({ pathname: "/anmelden", search: "", hash: "#ziel=/edit" }).url).toBe("/edit");
        // Nur ein Pfad derselben Seite; alles andere fällt auf den Editor-Modus ohne Ziel zurück.
        for (const fremd of [
            "#ziel=//boese.example/?a=1",
            "#ziel=/\\boese.example",
            "#ziel=https://boese.example/",
            "#ziel=/?anmeldung=ok",
            "#ziel=/ leer",
        ])
            expect(readEntry({ pathname: "/anmelden", search: "", hash: fremd }).url).toBe("/edit");
        // Eine Rückkehr von Discord trägt ihre eigenen Parameter; ein Ziel gilt dann nicht.
        expect(
            readEntry({ pathname: "/anmelden", search: "?anmeldung=ok&s=k3x9", hash: "#ziel=/?route=A~B" }).url,
        ).toBe("/edit?s=k3x9");
        // Ein Ziel auf anderen Einstiegen ist kein Ziel.
        expect(readEntry({ pathname: "/", search: "?von=Gareth", hash: "#ziel=/?route=A~B" }).url).toBeNull();
    });

    it("🔴 hinter der Stage-Tür mit `?ziel=…`: das Fragment des Links geht mit nach `/edit` (Betreiber 2026-10-19, `#view=political`)", () => {
        // Der Browser behält das Fragment des Links nur, wenn das Ziel der Umleitung keines trägt.
        expect(readEntry({ pathname: "/anmelden", search: "?ziel=/edit", hash: "#view=political" }).url).toBe(
            "/edit#view=political",
        );
        const route = readEntry({
            pathname: "/anmelden",
            search: "?ziel=/edit?route=Trallop~Baliho&tab=reise",
            hash: "#x=518.750&y=504.000&z=4.50&view=powerlines",
        });
        expect(route.url).toBe("/edit?route=Trallop~Baliho&tab=reise#x=518.750&y=504.000&z=4.50&view=powerlines");
        expect(windowForEntry(route, null)).toEqual({ name: "anmelden" });
        // Nur ein Pfad derselben Seite; sonst der Editor-Modus ohne Ziel und ohne fremdes Fragment.
        for (const fremd of ["?ziel=//boese.example/", "?ziel=https://boese.example/", "?ziel=/?anmeldung=ok"])
            expect(readEntry({ pathname: "/anmelden", search: fremd, hash: "#view=political" }).url).toBe("/edit");
        // Eine Rückkehr von Discord bleibt, wie sie war.
        expect(readEntry({ pathname: "/anmelden", search: "?anmeldung=ok", hash: "" }).url).toBe("/edit");
    });

    it("🔴 Discord-Anmeldung ohne zweiten Faktor bei Verwaltungsrechten: das Anmeldefenster im zweiten Schritt (2026-10-10)", () => {
        const ok = readEntry({ pathname: "/anmelden", search: "?anmeldung=ok", hash: "" });
        expect(windowForEntry(ok, null, true, true)).toEqual({ name: "anmelden", zweiterFaktor: true });
        const welcome = readEntry({ pathname: "/anmelden", search: "?anmeldung=willkommen", hash: "" });
        expect(windowForEntry(welcome, null, true, true)).toEqual({ name: "anmelden", zweiterFaktor: true });
        // Bestätigt oder verknüpft: das ist schon ein Schritt in der Sitzung, kein neuer.
        const confirmed = readEntry({ pathname: "/edit", search: "?anmeldung=bestaetigt", hash: "" });
        expect(windowForEntry(confirmed, null, true, true)).toBeNull();
        // Ein gemerkter Passkey-Link geht vor: er richtet ja gerade den zweiten Faktor ein.
        expect(windowForEntry(ok, { kind: "passkey_enrollment", token: TOKEN }, true, true)).toEqual({
            name: "passkey",
            token: TOKEN,
        });
        expect(
            secondFactorMissing({ person: { assurance: "basic" }, capabilities: ["manage_people", "view_operations"] }),
        ).toBe(true);
        expect(secondFactorMissing({ person: { assurance: "strong" }, capabilities: ["manage_people"] })).toBe(false);
        expect(secondFactorMissing({ person: { assurance: "recovery" }, capabilities: ["manage_people"] })).toBe(false);
        // Ein Editor trägt mit dem Notaus ein Recht der Stufe S, aber keine Verwaltung: ihm fehlt nichts.
        expect(
            secondFactorMissing({
                person: { assurance: "basic" },
                capabilities: ["edit_map_objects", "suspend_media_publication", "edit_territories", "edit_landscapes"],
            }),
        ).toBe(false);
        expect(secondFactorMissing({ person: null, capabilities: ["manage_people"] })).toBe(false);
    });
});

describe("Der Umweg über Discord", () => {
    beforeEach(() => {
        (globalThis as { sessionStorage?: unknown }).sessionStorage = new MemoryStorage();
    });
    afterEach(() => {
        delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    });

    it("🔴 Ausschnitt und Link überleben den Umweg genau einmal und höchstens 15 Minuten", () => {
        rememberView("#x=551&y=532&z=5", 1_000);
        expect(takeRememberedView(1_000 + 60_000)).toBe("#x=551&y=532&z=5");
        expect(takeRememberedView(1_000 + 60_000)).toBeNull();
        rememberView("#x=1", 1_000);
        expect(takeRememberedView(1_000 + 16 * 60_000)).toBeNull();
        rememberLink({ kind: "passkey_enrollment", token: TOKEN }, 5_000);
        expect(takeRememberedLink(6_000)).toEqual({ kind: "passkey_enrollment", token: TOKEN });
        expect(takeRememberedLink(6_000)).toBeNull();
    });

    it("🔴 ohne Speicher (privates Fenster) geht nichts kaputt", () => {
        delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
        rememberView("#x=1");
        expect(takeRememberedView()).toBeNull();
    });
});

describe("Die Ansicht folgt der Sitzung (im Editor-Modus)", () => {
    const response =
        (body: unknown, status = 200) =>
        async () =>
            new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    it("🔴 angemeldet: genau die Capabilities der Sitzung; `?besucher` nimmt weiter alles weg", async () => {
        await loadSession(
            response({
                environment: "development",
                authEnabled: true,
                person: { id: "p", displayName: "Rondrikan", role: "reviewer" },
                capabilities: ["pin_selection", "use_editor_menu", "moderate_submissions"],
            }),
        );
        const viewer = bootstrapViewer("", undefined, "/edit");
        expect(viewer.source).toBe("session:reviewer");
        expect(viewer.can("use_editor_menu")).toBe(true);
        expect(viewer.can("view_flow_directions")).toBe(false);
        expect(bootstrapViewer("?besucher", undefined, "/edit").can("use_editor_menu")).toBe(false);
    });

    it("🔴 Anmeldung eingerichtet, niemand angemeldet: was der Server für Gäste sagt (Production: nichts)", async () => {
        await loadSession(response({ environment: "production", authEnabled: true, person: null, capabilities: [] }));
        const viewer = bootstrapViewer("", undefined, "/edit");
        expect(viewer.source).toBe("session:ohne-anmeldung");
        expect(viewer.can("view_editor_series")).toBe(false);
        // Auch dann geht das Anmeldefenster von selbst auf (WI-0203; der Betreiber wählte 2026-10-16 „Ja, wie rechts“).
        expect(windowForEditorStart(authState.value, { pathname: "/edit", search: "" })).toEqual({ name: "anmelden" });
        expect(windowForEditorStart(authState.value, { pathname: "/", search: "" })).toBeNull();
    });

    it("🔴 keine Antwort, Fehler oder Zeitablauf: die Besucheransicht und das Anmeldefenster, keine Werkzeuge (WI-0203)", async () => {
        const offline = async () => {
            throw new TypeError("offline");
        };
        const stumm: Fetcher = (_url, init) =>
            new Promise<Response>((_resolve, reject) =>
                init?.signal?.addEventListener("abort", () => reject(new Error("abort"))),
            );
        for (const [fall, laden] of [
            ["offline", () => loadSession(offline)],
            ["500", () => loadSession(response({ error: { code: "internal_error", message: "x" } }, 500))],
            ["Zeitablauf", () => loadSession(stumm, 20)],
        ] as const) {
            await laden();
            expect(authState.value.known, fall).toBe(false);
            const viewer = bootstrapViewer("", undefined, "/edit");
            expect(viewer.source, fall).toBe("ohne-antwort:anmeldung");
            expect(viewer.can("use_editor_menu"), fall).toBe(false);
            expect(viewer.can("view_editor_series"), fall).toBe(false);
            expect(windowForEditorStart(authState.value, { pathname: "/edit", search: "" }), fall).toEqual({
                name: "anmelden",
            });
        }
    });

    it("🔴 Anmeldung nicht eingerichtet (lokal): alles wie vor der Anmeldung, Editor-Ansicht ohne Fenster", async () => {
        await loadSession(response({ environment: null, authEnabled: false, person: null, capabilities: [] }));
        expect(bootstrapViewer("", undefined, "/edit").source).toBe("default:passwortgeschuetzte-instanz");
        expect(bootstrapViewer("", undefined, "/edit").can("use_editor_menu")).toBe(true);
        expect(windowForEditorStart(authState.value, { pathname: "/edit", search: "" })).toBeNull();
    });

    it("das Anmeldefenster nur im Editor-Modus und nur ohne Person", async () => {
        await loadSession(async () => {
            throw new TypeError("offline");
        });
        expect(windowForEditorStart(authState.value, { pathname: "/", search: "" })).toBeNull();
        expect(windowForEditorStart(authState.value, { pathname: "/", search: "?edit=1" })).toEqual({
            name: "anmelden",
        });
        expect(windowForEditorStart(authState.value, { pathname: "/", search: "?editor=true" })).toEqual({
            name: "anmelden",
        });
        await loadSession(
            response({
                environment: "staging",
                authEnabled: true,
                person: { id: "p", displayName: "Rondrikan", role: "editor" },
                capabilities: ["use_editor_menu"],
            }),
        );
        expect(windowForEditorStart(authState.value, { pathname: "/edit", search: "" })).toBeNull();
    });
});

describe("Die Nachfrage im Hintergrund nach einem Start ohne Antwort (WI-0203)", () => {
    const response =
        (body: unknown, status = 200) =>
        async () =>
            new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const PERSON = { id: "p", displayName: "Rondrikan", role: "editor" };

    async function ohneAntwort(): Promise<void> {
        await loadSession(async () => {
            throw new TypeError("offline");
        });
    }

    it("🔴 fragt weiter, bis eine Antwort kommt; bringt sie eine Person, lädt die Seite neu", async () => {
        await ohneAntwort();
        const pausen: number[] = [];
        let versuche = 0;
        let neu = 0;
        await followLateSession({
            pause: async (ms) => {
                pausen.push(ms);
            },
            fetcher: async () => {
                versuche += 1;
                if (versuche < 3) throw new TypeError("offline");
                return response({ environment: "staging", authEnabled: true, person: PERSON, capabilities: [] })();
            },
            reload: () => {
                neu += 1;
            },
        });
        expect(versuche).toBe(3);
        expect(pausen).toEqual([5_000, 10_000, 20_000]);
        expect(neu).toBe(1);
    });

    it("🔴 eine Antwort ohne Person beendet die Nachfrage ohne Neuladen; der Hinweis im Fenster folgt `known`", async () => {
        await ohneAntwort();
        let neu = 0;
        await followLateSession({
            pause: async () => undefined,
            fetcher: response({ environment: "staging", authEnabled: true, person: null, capabilities: [] }),
            reload: () => {
                neu += 1;
            },
        });
        expect(authState.value.known).toBe(true);
        expect(neu).toBe(0);
    });

    it("der Abstand wächst bis höchstens eine Minute", async () => {
        await ohneAntwort();
        const pausen: number[] = [];
        let versuche = 0;
        await followLateSession({
            pause: async (ms) => {
                pausen.push(ms);
            },
            fetcher: async () => {
                versuche += 1;
                if (versuche < 6) throw new TypeError("offline");
                return response({ environment: "staging", authEnabled: true, person: null, capabilities: [] })();
            },
        });
        expect(pausen).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
    });
});

/**
 * 💣 **Befund des Betreibers 2026-10-13.** Er zeigte zwei Links, die er zum Teilen erzeugt hatte:
 * `https://stage.avesmaps.de/edit?s=hHEEWwRi` und `http://100.102.26.41:5174/edit?s=ajSB3HKf`. Beide tragen `/edit`.
 *
 * Der Teilen-Knopf baute die Adresse aus `location.pathname` (`app.vue`, `info-panel.vue`), und wer im Editor-Modus steht,
 * verschickte damit einen Editor-Link. `/edit` ist nicht kosmetisch: `isEditorAddress` schaltet den Modus genau daran ein.
 *
 * 🪤 Folgenlos war das nur, solange das Editorpanel im ausgelieferten Build gar nicht existierte (bis `a77b1127`). Seitdem
 * landet jeder Empfänger mit `use_editor_menu` im Editor statt auf der geteilten Ansicht.
 */
describe("Die Adresse eines geteilten Links", () => {
    it("🔴 aus dem Editor-Modus zeigt sie auf die Karte, nicht auf /edit", () => {
        expect(publicMapUrl({ origin: "https://stage.avesmaps.de", pathname: "/edit" })).toBe(
            "https://stage.avesmaps.de/",
        );
        // Genau die Form aus dem Befund, samt Schrägstrich am Ende.
        expect(publicMapUrl({ origin: "http://100.102.26.41:5174", pathname: "/edit/" })).toBe(
            "http://100.102.26.41:5174/",
        );
    });

    it("eine gewöhnliche Adresse bleibt, wie sie ist", () => {
        expect(publicMapUrl({ origin: "https://avesmaps.de", pathname: "/" })).toBe("https://avesmaps.de/");
        expect(publicMapUrl({ origin: "https://avesmaps.de", pathname: "" })).toBe("https://avesmaps.de");
    });

    it("🔴 was herauskommt, ist nie wieder eine Editor-Adresse", () => {
        for (const pathname of ["/edit", "/edit/", "/"]) {
            const url = new URL(publicMapUrl({ origin: "https://avesmaps.de", pathname }));
            expect(isEditorAddress({ pathname: url.pathname, search: url.search }), pathname).toBe(false);
        }
    });
});
