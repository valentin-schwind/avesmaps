import { effectScope, ref, type EffectScope } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import type { InhalteAdressAuskunft, InhalteQuelleAnlegenBody } from "@avesmaps3d/shared";
import type { SchreibAntwort } from "../src/fenster/entwurf-senden.ts";
import {
    createQuellePerLink,
    linkAusText,
    type QuellePerLink,
    type QuellePerLinkClient,
} from "../src/fenster/quelle-per-link-steuerung.ts";

/**
 * Eine neue Quelle per Link (WI-0277), ohne Oberfläche. Problemfälle: Eine vorhandene Quelle wird noch einmal angelegt; eine fehlgeschlagene Prüfung sperrt das Formular; der Vorschlag des vorigen Links bleibt stehen; eine späte Antwort
 * überschreibt die neuere; was der Korpus vorgibt, geht trotzdem über die Leitung.
 */

const SEITE = "https://www.herzogtum-weiden.net/geographie/fluesse-und-seen";
const ID = "11111111-1111-4111-8111-111111111111";
const KORPUS = {
    key: "herzogtum-weiden.net",
    name: "Herzogtum Weiden",
    sourceType: "briefspiel",
    isOfficial: false,
    artVorschlag: null,
    offiziellVorschlag: false,
    lizenzAussage: "license",
    lizenzName: "CC BY-NC-SA 3.0",
    attribution: null,
    rechteAusBestand: false,
    quellen: 95,
    objekte: 503,
} as const;
const GELESEN: InhalteAdressAuskunft = {
    url: SEITE,
    zustand: "gelesen",
    httpStatus: 200,
    titel: "Flüsse und Seen in Weiden",
    korpus: KORPUS,
    vorhanden: null,
};
const BEKANNT: InhalteAdressAuskunft = {
    url: SEITE,
    zustand: "bekannt",
    korpus: KORPUS,
    vorhanden: {
        id: ID,
        title: "Vorhanden",
        url: SEITE,
        sourceType: "briefspiel",
        stillgelegt: false,
        uses: 3,
        gleicheAdresse: true,
    },
};

const scopes: EffectScope[] = [];
afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop();
});
const warte = async (): Promise<void> => {
    await new Promise((fertig) => setTimeout(fertig, 2));
    await new Promise((fertig) => setTimeout(fertig, 2));
};

interface Aufbau {
    link: QuellePerLink;
    text: { value: string };
    auskuenfte: string[];
    angelegt: InhalteQuelleAnlegenBody[];
}

function baue(
    antwort: (url: string) => Promise<InhalteAdressAuskunft>,
    anlegen: (body: InhalteQuelleAnlegenBody) => SchreibAntwort<{ publicId: string }> = () => ({
        ok: true,
        quittung: { publicId: ID },
    }),
    start = SEITE,
): Aufbau {
    const text = ref(start);
    const auskuenfte: string[] = [];
    const angelegt: InhalteQuelleAnlegenBody[] = [];
    const client = {
        adresse: (url: string) => {
            auskuenfte.push(url);
            return antwort(url);
        },
        anlegen: (body: InhalteQuelleAnlegenBody) => {
            angelegt.push(body);
            return Promise.resolve(anlegen(body));
        },
    } as unknown as QuellePerLinkClient;
    const scope = effectScope();
    scopes.push(scope);
    const link = scope.run(() =>
        createQuellePerLink(() => text.value, { client, entprellMs: 0, neueOperationId: () => "op" }),
    )!;
    return { link, text, auskuenfte, angelegt };
}

const nieDa = (): boolean => false;

describe("Was ist ein Link?", () => {
    it.each([
        [SEITE, SEITE],
        [`  ${SEITE}  `, SEITE],
        ["http://example.org/", "http://example.org/"],
        ["www.example.org/seite", "https://www.example.org/seite"],
    ])("%s ist ein Link", (text, link) => {
        expect(linkAusText(text)).toBe(link);
    });

    it.each(["Herzogtum Weiden", "herzogtum-weiden.net", "https://", "https://localhost", "https://zwei worte.de", ""])(
        "„%s“ bleibt Suche",
        (text) => {
            expect(linkAusText(text)).toBeUndefined();
        },
    );
});

describe("Eine neue Quelle per Link", () => {
    it("ein Suchwort lässt die Steuerung ruhen", async () => {
        const { link, auskuenfte } = baue(() => Promise.resolve(GELESEN), undefined, "Weiden");
        await warte();
        expect(link.link.value).toBeUndefined();
        expect(auskuenfte).toEqual([]);
        expect(link.bereit(nieDa)).toBe(false);
    });

    it("🔴 der Link genügt: Der Titel steht, und angelegt wird mit Link und Titel; was der Korpus vorgibt, gibt er vor", async () => {
        const { link, angelegt } = baue(() => Promise.resolve(GELESEN));
        expect(link.prueft.value).toBe(true);
        expect(link.bereit(nieDa)).toBe(false);
        await warte();
        expect(link.prueft.value).toBe(false);
        expect(link.titel.value).toBe("Flüsse und Seen in Weiden");
        expect(link.bereit(nieDa)).toBe(true);

        const quelle = await link.bestaetige();
        expect(angelegt).toEqual([{ operationId: "op", url: SEITE, title: "Flüsse und Seen in Weiden" }]);
        expect(quelle).toEqual({ id: ID, title: "Flüsse und Seen in Weiden", sourceType: "briefspiel", url: SEITE });
    });

    it("ein Link ohne bekannten Korpus: Art und „offiziell“ wählt der Mensch", async () => {
        const { link, angelegt } = baue(() => Promise.resolve({ ...GELESEN, korpus: null }));
        await warte();
        link.setzeArt("roman");
        link.setzeOffiziell(true);
        const quelle = await link.bestaetige();
        expect(angelegt[0]).toMatchObject({ sourceType: "roman", isOfficial: true });
        expect(quelle?.sourceType).toBe("roman");
    });

    it("🔴 sagt der Bestand des Korpus etwas, belegt es die Felder vor; wer wählt, behält seine Wahl", async () => {
        const auskunft: InhalteAdressAuskunft = {
            ...GELESEN,
            korpus: {
                ...KORPUS,
                sourceType: null,
                isOfficial: null,
                artVorschlag: "briefspiel",
                offiziellVorschlag: true,
            },
        };
        const belegt = baue(() => Promise.resolve(auskunft));
        await warte();
        expect(belegt.link.art.value).toBe("briefspiel");
        expect(belegt.link.offiziell.value).toBe(true);
        expect(await belegt.link.bestaetige()).toMatchObject({ sourceType: "briefspiel" });
        expect(belegt.angelegt[0]).toMatchObject({ sourceType: "briefspiel", isOfficial: true });

        let frei: (wert: InhalteAdressAuskunft) => void = () => undefined;
        const gewaehlt = baue(() => new Promise((fertig) => (frei = fertig)));
        await warte();
        gewaehlt.link.setzeArt("roman");
        frei(auskunft);
        await warte();
        expect(gewaehlt.link.art.value).toBe("roman");
        expect(gewaehlt.link.offiziell.value).toBe(true);
    });

    it("🔴 eine vorhandene Quelle wird nie noch einmal angelegt", async () => {
        const { link, angelegt } = baue(() => Promise.resolve(BEKANNT));
        await warte();
        expect(link.bereit(nieDa)).toBe(true);
        const quelle = await link.bestaetige();
        expect(angelegt).toEqual([]);
        expect(quelle).toEqual({ id: ID, title: "Vorhanden", sourceType: "briefspiel", url: SEITE });
    });

    it("hängt die vorhandene Quelle hier schon, geht der Knopf nicht", async () => {
        const { link } = baue(() => Promise.resolve(BEKANNT));
        await warte();
        expect(link.bereit((id) => id === ID)).toBe(false);
    });

    it("eine unterdrückte Quelle lässt sich hier weder anhängen noch neu anlegen", async () => {
        const { link, angelegt } = baue(() =>
            Promise.resolve({ ...BEKANNT, vorhanden: { ...BEKANNT.vorhanden!, stillgelegt: true } }),
        );
        await warte();
        expect(link.bereit(nieDa)).toBe(false);
        expect(await link.bestaetige()).toBeUndefined();
        expect(angelegt).toEqual([]);
    });

    it("🔴 scheitert die Prüfung, bleibt das Formular bedienbar", async () => {
        const { link, angelegt } = baue(() => Promise.reject(new Error("kein Netz")));
        await warte();
        expect(link.prueft.value).toBe(false);
        expect(link.pruefFehler.value).toBe(true);
        expect(link.bereit(nieDa)).toBe(false);
        link.setzeTitel("Von Hand");
        expect(link.bereit(nieDa)).toBe(true);
        await link.bestaetige();
        // Ohne Auskunft und ohne Wahl entscheidet der Server dieselbe Regel: Art und „offiziell“ gehen nicht über die Leitung.
        expect(angelegt[0]).toEqual({ operationId: "op", url: SEITE, title: "Von Hand" });
    });

    it("eine Seite, die nicht antwortet, trägt keinen Titel, und der Mensch trägt ihn ein", async () => {
        const { link } = baue(() =>
            Promise.resolve({ url: SEITE, zustand: "unerreichbar", korpus: KORPUS, vorhanden: null }),
        );
        await warte();
        expect(link.titel.value).toBe("");
        link.setzeTitel("Von Hand");
        expect(link.bereit(nieDa)).toBe(true);
    });

    it("„↻“ fragt noch einmal", async () => {
        let mal = 0;
        const { link, auskuenfte } = baue(() => {
            mal += 1;
            return mal === 1 ? Promise.reject(new Error("weg")) : Promise.resolve(GELESEN);
        });
        await warte();
        expect(link.pruefFehler.value).toBe(true);
        link.pruefeErneut();
        await warte();
        expect(auskuenfte).toHaveLength(2);
        expect(link.pruefFehler.value).toBe(false);
        expect(link.titel.value).toBe("Flüsse und Seen in Weiden");
    });

    it("🔴 wer selbst getippt hat, behält seinen Titel; der Vorschlag des vorigen Links verschwindet", async () => {
        const { link, text } = baue((url) =>
            Promise.resolve({ ...GELESEN, url, titel: url.endsWith("b") ? "Zweite" : "Erste" }),
        );
        await warte();
        expect(link.titel.value).toBe("Erste");
        text.value = "https://example.org/b";
        await warte();
        expect(link.titel.value).toBe("Zweite");
        link.setzeTitel("Meiner");
        text.value = "https://example.org/a";
        await warte();
        expect(link.titel.value).toBe("Meiner");
    });

    it("🔴 eine späte Antwort überschreibt die neuere nicht", async () => {
        const offen = new Map<string, (auskunft: InhalteAdressAuskunft) => void>();
        const { link, text } = baue((url) => new Promise((fertig) => offen.set(url, fertig)));
        await warte();
        text.value = "https://example.org/neu";
        await warte();
        offen.get("https://example.org/neu")!({ ...GELESEN, url: "https://example.org/neu", titel: "Neu" });
        await warte();
        offen.get(SEITE)!({ ...GELESEN, titel: "Alt" });
        await warte();
        expect(link.titel.value).toBe("Neu");
        expect(link.auskunft.value?.url).toBe("https://example.org/neu");
        expect(link.prueft.value).toBe(false);
    });

    it("🔴 hat jemand die Adresse inzwischen angelegt: nichts doppelt, der Befund kommt neu", async () => {
        let mal = 0;
        const { link, angelegt } = baue(
            () => {
                mal += 1;
                return Promise.resolve(mal === 1 ? GELESEN : BEKANNT);
            },
            () => ({
                ok: false,
                status: 409,
                fehler: { code: "source_exists", message: "schon da", details: { sourceId: ID } },
            }),
        );
        await warte();
        expect(await link.bestaetige()).toBeUndefined();
        expect(link.fehler.value).toBeTruthy();
        await warte();
        expect(link.auskunft.value?.zustand).toBe("bekannt");
        expect(await link.bestaetige()).toMatchObject({ id: ID });
        expect(angelegt).toHaveLength(1);
    });

    it("eine Abweisung des Servers steht als Satz da", async () => {
        const { link } = baue(
            () => Promise.resolve(GELESEN),
            () => ({ ok: false, status: 423, fehler: { code: "map_editing_off", message: "Bearbeiten ist aus." } }),
        );
        await warte();
        expect(await link.bestaetige()).toBeUndefined();
        expect(link.fehler.value).toBe("Bearbeiten ist aus.");
        expect(link.laeuft.value).toBe(false);
    });

    it("wird das Feld geleert, beginnt alles von vorn", async () => {
        const { link, text } = baue(() => Promise.resolve(GELESEN));
        await warte();
        link.setzeArt("roman");
        text.value = "";
        await warte();
        expect(link.link.value).toBeUndefined();
        expect(link.auskunft.value).toBeUndefined();
        expect(link.titel.value).toBe("");
        expect(link.art.value).toBe("sonstiges");
    });
});
