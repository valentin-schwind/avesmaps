import { describe, expect, it, vi } from "vitest";
import { KURZINFO_URL } from "@avesmaps3d/shared";
import { createKurzinfo } from "../src/auth/kurzinfo";

/** Die Kurzinfo „Was ist neu?“ (WI-0137, VERSION-0001 §4): einmal geladen, ein Fehler bleibt still und wird beim nächsten Öffnen wiederholt. */

const antwort = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const KURZ = { stand: "2026-10-11T04:45:00+02:00", abschnitte: [{ titel: "Prüfen", punkte: ["Routen."] }] };

describe("Kurzinfo laden", () => {
    it("🔴 lädt einmal, auch wenn Kasten und Glocke zugleich fragen", async () => {
        const fetcher = vi.fn(() => antwort(200, KURZ));
        const speicher = createKurzinfo(fetcher as unknown as typeof fetch);
        await Promise.all([speicher.laden(), speicher.laden()]);
        await speicher.laden();
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(String((fetcher.mock.calls[0] as unknown[])[0])).toBe(KURZINFO_URL);
        expect(speicher.kurzinfo.value).toEqual(KURZ);
    });

    it("🔴 ein Fehler zeigt nichts (nur „Neu laden“) und wird beim nächsten Öffnen wiederholt", async () => {
        const fetcher = vi.fn().mockReturnValueOnce(antwort(503, { error: { code: "unavailable" } }));
        fetcher.mockReturnValueOnce(antwort(200, KURZ));
        const speicher = createKurzinfo(fetcher as unknown as typeof fetch);
        await speicher.laden();
        expect(speicher.kurzinfo.value).toBeNull();
        await speicher.laden();
        expect(speicher.kurzinfo.value).toEqual(KURZ);
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("🔴 merkt sich beim Start den Stand der Seite und holt bei neuer Version die Neuerungen seitdem (Betreiber 2026-10-17)", async () => {
        const NEU = {
            stand: null,
            abschnitte: [{ titel: "Neu", punkte: ["Ein Legacy-Zug lässt sich einreihen."] }],
            release: "20261018T010000Z-5a96cea",
        };
        const fetcher = vi
            .fn()
            .mockReturnValueOnce(antwort(200, { stand: null, abschnitte: [], release: "20261017T170005Z-3ab71b9" }))
            .mockReturnValueOnce(antwort(200, NEU));
        const speicher = createKurzinfo(fetcher as unknown as typeof fetch);
        await speicher.merkeStand();
        await speicher.merkeStand();
        expect(speicher.stand.value).toBe("3ab71b9");
        await speicher.laden();
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(String((fetcher.mock.calls[1] as unknown[])[0])).toBe(`${KURZINFO_URL}?seit=3ab71b9`);
        expect(speicher.kurzinfo.value).toEqual(NEU);
    });

    it("ohne Anmeldung bleibt der Stand offen und wird beim nächsten Mal wieder erfragt", async () => {
        const fetcher = vi
            .fn()
            .mockReturnValueOnce(antwort(401, { error: { code: "unauthenticated" } }))
            .mockReturnValueOnce(antwort(200, { stand: null, abschnitte: [], release: "dev" }));
        const speicher = createKurzinfo(fetcher as unknown as typeof fetch);
        await speicher.merkeStand();
        expect(speicher.stand.value).toBeNull();
        await speicher.merkeStand();
        // Lokal (`dev`) trägt das Release keinen Stand: Die Meldung zeigt dann die Kurzinfo des neuen Release.
        expect(speicher.stand.value).toBeNull();
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
});
