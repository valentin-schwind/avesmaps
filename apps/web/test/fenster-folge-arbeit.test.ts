import { describe, expect, it } from "vitest";
import { nextTick, shallowRef } from "vue";
import type { OperationReceipt } from "@avesmaps3d/shared";
import { createFolgeArbeit, folgeSatz, HOECHSTENS_MS } from "../src/fenster/folge-arbeit";
import type { EigenerAuftrag } from "../src/warteschlange/eigene-auftraege";
import { t } from "../src/i18n/i18n";

/**
 * Das Band „wird berechnet“ im Fuß eines Fensters (WI-0223, EDIT-0003 G7; Plan der Derographie, von der Editor-Orchestrierung 2026-10-19
 * angenommen): je Art eine Regel, der Stand aus derselben Quelle wie die Warteschlange im Kopf (WI-0230). Problemfälle: Das Band endet
 * nie, weil eine Gebietsableitung ohne neue Eingabe kein Ereignis meldet; es endet zu früh, weil der Kopf ein fertiges nach 4 s nicht mehr
 * nennt oder der Abruf einmal scheitert; es zeigt den ersten Auftrag der Gelände-Kette als „fertig“, während der zweite noch läuft; die
 * Quelle läuft weiter, wenn nichts mehr offen ist.
 */
const LOKAL = { kind: "terrain_local", jobId: "lokal-1", state: "queued" } as const;
const PUBLISH = { kind: "dem_publish", jobId: "publish-1", state: "queued" } as const;
const GEBIETE = { kind: "territory_derive", jobId: "gebiete-1", state: "queued" } as const;
const quittung = (...arbeit: OperationReceipt["derivedWork"]) => ({ derivedWork: arbeit });

const eintrag = (art: string, auftrag: string, stand: EigenerAuftrag["stand"]): EigenerAuftrag => ({
    auftrag: { art, auftrag },
    stand,
    dauerS: null,
    anteil: null,
});

function aufbau() {
    let jetzt = 0;
    const liste = shallowRef<EigenerAuftrag[]>([]);
    let leser = 0;
    let bezogen = 0;
    const folge = createFolgeArbeit({
        beziehe: () => {
            leser += 1;
            bezogen += 1;
            return { quelle: { liste: liste as never }, abmelden: () => void (leser -= 1) };
        },
        now: () => jetzt,
    });
    const zeige = async (...eintraege: EigenerAuftrag[]): Promise<void> => {
        liste.value = eintraege;
        await nextTick();
    };
    return { folge, zeige, leser: () => leser, bezogen: () => bezogen, spaeter: (ms: number) => (jetzt += ms) };
}

describe("Folgearbeit nach dem Speichern", () => {
    it("ohne Gelände und ohne Gebiete kein Band, und die Quelle wird nicht gelesen", () => {
        const t0 = aufbau();
        expect(t0.folge.vormerke(quittung({ kind: "land_smooth", jobId: "g", state: "queued" }))).toBeUndefined();
        expect(t0.bezogen()).toBe(0);
    });

    it("🔴 Gelände: gesammelt mit Restzeit, dann der zweite Auftrag der Kette; fertig erst mit `dem_publish`, und es bleibt fertig", async () => {
        const t0 = aufbau();
        const folge = t0.folge.vormerke(quittung(LOKAL, PUBLISH, { kind: "tiles", state: "done" }));
        expect(folge).toEqual({ art: "gelaende", auftrag: "publish-1" });
        expect(t0.folge.stand(folge)).toEqual({ stand: "wartet" });
        expect(t0.leser()).toBe(1);

        await t0.zeige(
            eintrag("terrain_local", "lokal-1", { stand: "gesammelt", rest: 170 }),
            eintrag("dem_publish", "publish-1", { stand: "wartet" }),
        );
        expect(t0.folge.stand(folge)).toEqual({ stand: "gesammelt", rest: 170 });
        // Der erste ist fertig, der zweite läuft: nicht „fertig“.
        await t0.zeige(
            eintrag("terrain_local", "lokal-1", { stand: "fertig" }),
            eintrag("dem_publish", "publish-1", { stand: "laeuft", rest: 12 }),
        );
        expect(t0.folge.stand(folge)).toEqual({ stand: "laeuft", rest: 12 });
        // Ein Abruf scheitert (leere Liste): Der Stand bleibt, ohne Restzeit.
        await t0.zeige();
        expect(t0.folge.stand(folge)).toEqual({ stand: "laeuft" });
        await t0.zeige(eintrag("dem_publish", "publish-1", { stand: "fertig" }));
        expect(t0.folge.stand(folge)).toEqual({ stand: "fertig" });
        expect(t0.leser()).toBe(0);
        // Nach 4 s nennt der Kopf ihn nicht mehr; der Fuß bleibt bei „fertig“.
        await t0.zeige();
        expect(t0.folge.stand(folge)).toEqual({ stand: "fertig" });
    });

    it("🔴 Gebiete: mehrere Speicherungen teilen EINEN Auftrag; ohne Ereignis endet das Band am Zustand, fehlgeschlagen bleibt stehen", async () => {
        const t0 = aufbau();
        const erste = t0.folge.vormerke(quittung(GEBIETE));
        const zweite = t0.folge.vormerke(quittung(GEBIETE));
        expect(zweite).toEqual({ art: "gebiete", auftrag: "gebiete-1" });
        expect(t0.leser()).toBe(1);
        await t0.zeige(eintrag("territory_derive", "gebiete-1", { stand: "wartet", rest: 30 }));
        expect(t0.folge.stand(erste)).toEqual({ stand: "wartet", rest: 30 });
        await t0.zeige(eintrag("territory_derive", "gebiete-1", { stand: "fehlgeschlagen" }));
        expect(t0.folge.stand(zweite)).toEqual({ stand: "fehlgeschlagen" });
        expect(t0.leser()).toBe(0);
        // Quittiert der Kopf den Fehlschlag, bleibt er im Fuß.
        await t0.zeige();
        expect(t0.folge.stand(erste)).toEqual({ stand: "fehlgeschlagen" });
    });

    it("nach 30 Minuten endet ein Band still, und die Quelle wird abgemeldet", async () => {
        const t0 = aufbau();
        const folge = t0.folge.vormerke(quittung(GEBIETE));
        await t0.zeige(eintrag("territory_derive", "gebiete-1", { stand: "laeuft" }));
        t0.spaeter(HOECHSTENS_MS + 1);
        await t0.zeige(eintrag("territory_derive", "gebiete-1", { stand: "laeuft" }));
        expect(t0.folge.stand(folge)).toBeUndefined();
        expect(t0.leser()).toBe(0);
    });

    it("der Satz: Restzeit wie im Kopf („1:16“), ohne Restzeit „…“, fertig und fehlgeschlagen ohne beides", () => {
        expect(folgeSatz("gelaende", { stand: "laeuft", rest: 75.2 })).toBe(
            `${t("entwurf.folge.gelaende.laeuft")} · ${t("entwurf.folge.rest.laeuft", { zeit: "1:16" })}`,
        );
        expect(folgeSatz("gebiete", { stand: "wartet" })).toBe(`${t("entwurf.folge.gebiete.wartet")} …`);
        expect(folgeSatz("gelaende", { stand: "fertig" })).toBe(t("entwurf.folge.gelaende.fertig"));
    });
});
