import { ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import type {
    InhalteKorporaListe,
    InhalteKorporaSortierung,
    InhalteKorpusAnzeigeform,
    InhalteKorpusEintrag,
    InhalteKorpusFelder,
    InhalteKorpusForm,
    InhalteKorpusWirkung,
    InhalteKorpusZeile,
} from "@avesmaps3d/shared";
import { newOperationId } from "../auth/api";
import type { InhalteClient } from "./inhalte-client";
import { createKatalog, type Katalog, type KatalogAdapter } from "./inhalte-katalog-steuerung";
import {
    entwurfAlsKoerper,
    setzeFeld,
    setzeForm,
    setzeLizenz,
    standAusKorpus,
    zaehleAenderungen,
    bereinigeSchluessel,
    type AnzeigeformFilter,
    type KorpusFelder,
    type KorpusStand,
} from "./inhalte-korpora-modell";
import { t } from "../i18n/i18n";

export { SEITE } from "./inhalte-katalog-steuerung";
export type { AnlegenZustand, SpeicherZustand } from "./inhalte-katalog-steuerung";

/**
 * Der Zustand des Reiters „Korpora“ im Fenster „Inhalte bearbeiten“ (WI-0254, Runde 4): der gemeinsame Kern der Reiter (`inhalte-katalog-steuerung.ts`) mit
 * dem, was nur die Korpora wissen: der Filter nach Anzeigeform, die Rechnung am Entwurf (`inhalte-korpora-modell.ts`, ohne Vue, von Vitest geprüft),
 * „Wirkung prüfen“ und die Rückfrage ab zehn Quellen.
 *
 * - 🔴 **Ein Korpus ist das Angebot hinter den Quellen EINER registrierbaren Domain.** Der Schlüssel (die Domain) ist die Identität und wird beim Anlegen
 *   gesetzt; danach ändert ihn nichts.
 * - 🔴 **Wirkung:** Bei einer Belegstelle schreibt „Speichern“ Art, „offiziell“, Lizenz und Nennung auf ALLE Quellen der Domain durch (eine Operation: Revision,
 *   409, Protokoll in einer Transaktion). „Wirkung prüfen“ rechnet vorher, was sich ändert (`korpusWirkung`, schreibt nichts). Trifft die Änderung ab zehn
 *   Quellen, antwortet der Server mit 409 `corpus_confirm_required`: Das Fenster fragt nach (`rueckfrage`) und schreibt erst auf die Bestätigung.
 * - **Konflikt (409 `edit_conflict`):** wie bei den anderen Reitern; „eigene Änderungen anwenden“ legt die eigenen Felder auf den fremden Stand.
 */

type KorporaKatalog = Katalog<
    InhalteKorpusEintrag,
    InhalteKorpusZeile,
    InhalteKorporaListe,
    InhalteKorporaSortierung,
    KorpusStand
>;

/** Die Rechnung von „Wirkung prüfen“: erst nichts, dann lädt sie, dann steht sie da (oder ein Satz, warum nicht). */
export type WirkungZustand =
    | { readonly art: "aus" }
    | { readonly art: "laedt" }
    | { readonly art: "da"; readonly wirkung: InhalteKorpusWirkung }
    | { readonly art: "fehler"; readonly satz: string };

/** Die Frage, wenn die Änderung ab der Schwelle Quellen trifft: was der Server gezählt hat. */
export interface KorpusRueckfrage {
    readonly quellen: number;
    readonly aendern: number;
    readonly traeger: number;
}

export interface KorporaSteuerung extends Omit<
    KorporaKatalog,
    "legeAn" | "dokument" | "dokumentLaedt" | "dokumentFehler" | "jetzt" | "schritt"
> {
    readonly korpus: KorporaKatalog["dokument"];
    readonly korpusLaedt: KorporaKatalog["dokumentLaedt"];
    readonly korpusFehler: KorporaKatalog["dokumentFehler"];
    /** Der Filter der Liste nach Anzeigeform. */
    readonly anzeigeform: Ref<AnzeigeformFilter>;
    setzeFeldWert<K extends keyof KorpusFelder>(feld: K, wert: KorpusFelder[K]): void;
    setzeFormWert(form: InhalteKorpusForm): void;
    setzeLizenzWert(wert: string): void;
    /** Einen Korpus für eine Domain anlegen: Schlüssel (unveränderlich) und, wenn schon bekannt, der Name des Angebots. */
    legeAn(schluessel: string, name: string): Promise<void>;
    // --- Wirkung ---
    readonly wirkung: ShallowRef<WirkungZustand>;
    pruefeWirkung(): Promise<void>;
    // --- Rückfrage ab zehn Quellen ---
    readonly rueckfrage: ShallowRef<KorpusRueckfrage | undefined>;
    schreibeTrotzdem(): Promise<void>;
    bleibeBeimEntwurf(): void;
}

export interface KorporaSteuerungOptionen {
    client: InhalteClient;
    /** Wartezeit der Suche in Millisekunden; Tests nehmen 0. */
    entprellMs?: number;
    neueOperationId?: () => string;
}

const ENTPRELL_VORGABE = 250;

const felderOhnePaare = new Set(["lizenzKey"]);
/** Die Felder der Vorgabe in den Worten des Körpers. */
const VORGABE_FELDER = ["sourceType", "isOfficial", "lizenzAussage", "attribution"] as const;

/** Die Fassung des Kerns für die Korpora: was nur sie über Stand, Körper, Überschneidung und Übertragen wissen. */
export function korporaAdapter(
    client: InhalteClient,
    optionen: {
        /** Der Körper trägt die Bestätigung, wenn der Mensch auf die Rückfrage mit „schreiben“ geantwortet hat. */
        bestaetigt: () => boolean;
        /** Der Server verlangt die Bestätigung: das Fenster fragt. */
        frage: (rueckfrage: KorpusRueckfrage) => void;
    },
): KatalogAdapter<
    InhalteKorpusEintrag,
    InhalteKorpusZeile,
    InhalteKorporaListe,
    InhalteKorporaSortierung,
    KorpusStand,
    { fields: InhalteKorpusFelder }
> {
    return {
        quittungsArt: "corpus",
        idVon: (korpus) => korpus.id,
        revisionVon: (korpus) => korpus.revision,
        zeileId: (zeile) => zeile.id,
        zeilenVon: (liste) => liste.items,
        totalVon: (liste) => liste.total,
        haengeAn: (alt, neu) => ({ ...neu, items: [...alt.items, ...neu.items] }),
        ladeListe: (wunsch, signal) =>
            client.korpora(
                {
                    q: wunsch.q,
                    offset: wunsch.offset,
                    limit: wunsch.limit,
                    sort: wunsch.sort,
                    ...(wunsch.herkunft === "alle" ? {} : { herkunft: wunsch.herkunft }),
                    ...(wunsch.unter === undefined || wunsch.unter === "alle"
                        ? {}
                        : { form: wunsch.unter as InhalteKorpusAnzeigeform }),
                },
                signal,
            ),
        ladeDokument: (id, signal) => client.korpus(id, signal),
        async aendere(id, body) {
            const antwort = await client.korpusAendern(id, {
                ...body,
                ...(optionen.bestaetigt() ? { bestaetigt: true } : {}),
            });
            if (antwort.ok || antwort.status !== 409 || antwort.fehler.code !== "corpus_confirm_required")
                return antwort;
            // Der Server hat gezählt: ab der Schwelle fragt das Fenster, statt still auf alle Quellen zu schreiben.
            const d = (antwort.fehler.details ?? {}) as Partial<KorpusRueckfrage>;
            const frage: KorpusRueckfrage = {
                quellen: d.quellen ?? 0,
                aendern: d.aendern ?? 0,
                traeger: d.traeger ?? 0,
            };
            optionen.frage(frage);
            return { ...antwort, fehler: { ...antwort.fehler, message: t("inhalte.korpora.rueckfrage.fuss") } };
        },
        standAus: standAusKorpus,
        koerperAus: entwurfAlsKoerper,
        zaehle: zaehleAenderungen,
        // Der Name des Angebots darf leer sein (viele Legacy-Korpora haben keinen): dann steht die Domain vorn.
        pruefe: () => undefined,
        konflikt(start, eigen, fremd) {
            const eigene = Object.keys(entwurfAlsKoerper(start, eigen)?.fields ?? {}).filter(
                (feld) => !felderOhnePaare.has(feld),
            );
            const fremde = Object.keys(entwurfAlsKoerper(start, fremd)?.fields ?? {}).filter(
                (feld) => !felderOhnePaare.has(feld),
            );
            const beide = eigene.filter((feld) => fremde.includes(feld));
            // Wechselt der fremde Stand die Form, gelten die eigenen Änderungen der Vorgabe nicht mehr unverändert: Sie überschneiden sich damit.
            if (fremde.includes("form")) {
                for (const feld of eigene) {
                    if ((VORGABE_FELDER as readonly string[]).includes(feld) && !beide.includes(feld)) beide.push(feld);
                }
            }
            return { eigene, fremde, beide };
        },
        uebertrage(fremd, start, eigen) {
            const koerper = entwurfAlsKoerper(start, eigen);
            let stand = fremd;
            const felder = koerper?.fields ?? {};
            // Die Form zuerst: Sie entscheidet, ob die Vorgabe überhaupt änderbar ist.
            if (felder.form !== undefined) stand = setzeForm(stand, felder.form, fremd);
            for (const feld of Object.keys(felder)) {
                if (feld === "lizenzKey" || feld === "form") continue;
                if (feld === "lizenzAussage") {
                    stand = setzeLizenz(
                        stand,
                        eigen.felder.lizenzAussage === "license" && eigen.felder.lizenzKey !== null
                            ? `license:${eigen.felder.lizenzKey}`
                            : eigen.felder.lizenzAussage,
                    );
                    continue;
                }
                const key = feld as keyof KorpusFelder;
                stand = setzeFeld(stand, key, eigen.felder[key] as never);
            }
            return stand;
        },
    };
}

export function createKorporaSteuerung(optionen: KorporaSteuerungOptionen): KorporaSteuerung {
    const { client } = optionen;
    const neueOperationId = optionen.neueOperationId ?? newOperationId;
    const entprellMs = optionen.entprellMs ?? ENTPRELL_VORGABE;
    const anzeigeform = ref<AnzeigeformFilter>("alle");
    const rueckfrage = shallowRef<KorpusRueckfrage | undefined>(undefined);
    let bestaetigt = false;
    const k = createKatalog({
        adapter: korporaAdapter(client, {
            bestaetigt: () => bestaetigt,
            frage: (frage) => {
                rueckfrage.value = frage;
                // Die Rechnung gehört zur Frage: Das Fenster zeigt je Feld, was sich ändert.
                void pruefeWirkung();
            },
        }),
        vorgabeSortierung: "title",
        unter: anzeigeform,
        entprellMs,
        neueOperationId,
    });

    // --- Der Entwurf ---
    function setzeFeldWert<K extends keyof KorpusFelder>(feld: K, wert: KorpusFelder[K]): void {
        const aktuell = k.jetzt();
        if (aktuell === undefined) return;
        k.schritt(setzeFeld(aktuell, feld, wert), `feld:${feld}`);
    }
    function setzeFormWert(form: InhalteKorpusForm): void {
        const aktuell = k.jetzt();
        const d = k.dokument.value;
        if (aktuell === undefined || d === undefined) return;
        k.schritt(setzeForm(aktuell, form, standAusKorpus(d)));
    }
    function setzeLizenzWert(wert: string): void {
        const aktuell = k.jetzt();
        if (aktuell !== undefined) k.schritt(setzeLizenz(aktuell, wert));
    }

    // --- Anlegen: die Domain ist die Identität ---
    const legeAn = (schluessel: string, name: string): Promise<void> =>
        k.legeAn(
            () =>
                client.korpusAnlegen({
                    operationId: neueOperationId(),
                    key: bereinigeSchluessel(schluessel),
                    ...(name.trim() === "" ? {} : { label: name.trim() }),
                }),
            {
                code: "corpus_exists",
                idAus: (details) => (details as { corpusId?: string } | undefined)?.corpusId,
            },
        );

    // --- Wirkung prüfen ---
    const wirkung = shallowRef<WirkungZustand>({ art: "aus" });
    async function pruefeWirkung(): Promise<void> {
        const d = k.dokument.value;
        const jetzt = k.jetzt();
        if (d === undefined || jetzt === undefined || wirkung.value.art === "laedt") return;
        const gesehen = k.stand.value;
        wirkung.value = { art: "laedt" };
        const antwort = await client.korpusWirkung(d.id, {
            fields: entwurfAlsKoerper(standAusKorpus(d), jetzt)?.fields ?? {},
        });
        // Ein Entwurf, der sich inzwischen geändert hat, oder ein anderer Korpus: Die Rechnung gilt nicht mehr.
        if (k.stand.value !== gesehen || k.dokument.value?.id !== d.id) return;
        wirkung.value = antwort.ok
            ? { art: "da", wirkung: antwort.quittung }
            : { art: "fehler", satz: antwort.fehler.message };
    }
    // Jede Änderung am Entwurf und jeder Wechsel macht eine Rechnung und eine Rückfrage ungültig.
    watch([k.stand, k.gewaehlt], () => {
        wirkung.value = { art: "aus" };
        rueckfrage.value = undefined;
    });

    async function schreibeTrotzdem(): Promise<void> {
        if (rueckfrage.value === undefined) return;
        rueckfrage.value = undefined;
        bestaetigt = true;
        try {
            await k.speichern();
        } finally {
            bestaetigt = false;
        }
    }
    function bleibeBeimEntwurf(): void {
        rueckfrage.value = undefined;
        if (k.zustand.value.art === "abgelehnt") k.zustand.value = { art: "bereit" };
    }

    const { dokument, dokumentLaedt, dokumentFehler, jetzt: _jetzt, schritt: _schritt, legeAn: _legeAn, ...kern } = k;
    void _legeAn;
    void _jetzt;
    void _schritt;
    return {
        ...kern,
        korpus: dokument,
        korpusLaedt: dokumentLaedt,
        korpusFehler: dokumentFehler,
        anzeigeform,
        setzeFeldWert,
        setzeFormWert,
        setzeLizenzWert,
        legeAn,
        wirkung,
        pruefeWirkung,
        rueckfrage,
        schreibeTrotzdem,
        bleibeBeimEntwurf,
    };
}
