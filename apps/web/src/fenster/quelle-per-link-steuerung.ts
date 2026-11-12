import { computed, onScopeDispose, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import type { InhalteAdressAuskunft, InhalteQuellenZeile, SourceType } from "@avesmaps3d/shared";
import { newOperationId } from "../auth/api";
import { t } from "../i18n/i18n";
import { createInhalteClient, type InhalteClient } from "../inhalte/inhalte-client";
import { istAbbruch } from "../medien/medien-client";

/**
 * Eine neue Quelle per Link (WI-0277; Vali 2026-11-02: „nur einen link von der briefspiel-seite hinzugefügt und er hat automatisch den korpus erkannt und die entsprechenden felder ausgefüllt“), ohne Bauteil.
 * Sie hängt am Feld „＋ Quelle“ (`quellen-anhaengen.vue`): Steht dort ein Link statt eines Suchworts, übernimmt sie.
 *
 * - **Der Link genügt:** Die Auskunft kommt von selbst (`InhalteAdressAuskunft`) und sagt, ob es die Seite schon gibt, zu welchem Korpus sie gehört und wie sie heißt. Enter oder der Knopf hängen an: die vorhandene Quelle, sonst eine
 *   neu angelegte. Die Fundstelle trägt man danach in der aufgeklappten Zeile ein, wie bei jeder Quelle.
 * - 🔴 **Eine Quelle, die es gibt, wird nie noch einmal angelegt:** `bestaetige` legt nur an, wo die Auskunft keine fand. Hat sie jemand inzwischen angelegt (409 `source_exists`), kommt die Auskunft neu und sagt es.
 * - 🔴 **Das Eintragen hängt nicht an einem fremden Server:** Schlägt die Prüfung fehl (Seite weg, Zeit um, Drossel, kein Netz), sagt der Satz es, und Titel und Knopf bleiben bedienbar.
 * - **Der Titel:** Die Auskunft setzt ihn nur, wo noch nichts oder nur der vorige Vorschlag steht; wer selbst getippt hat, meinte das (Legacy). Fremder Text, darum nur als Wert eines Felds.
 * - **Art und „offiziell“** belegt die Auskunft vor (was die Quellen des Korpus gemeinsam sagen), solange der Mensch nicht selbst gewählt hat. Ohne Auskunft und ohne Wahl gehen sie nicht über die Leitung: Dann entscheidet der Server dieselbe Regel.
 */

/** Was das Anhängen von einer Quelle braucht. */
export type QuelleZumAnhaengen = Pick<InhalteQuellenZeile, "id" | "title" | "sourceType" | "url"> & {
    /** Der Name des Korpus, wo die Auskunft einen kennt. */
    korpus?: string | null;
};

/**
 * Der Link in diesem Text; `undefined`, wenn es ein Suchwort ist. `www.…` gilt als Link und bekommt `https://`. Solange der Name keinen Punkt trägt, tippt jemand noch (oder sucht): Das bleibt Suche.
 */
export function linkAusText(text: string): string | undefined {
    const roh = text.trim();
    if (roh === "" || /\s/u.test(roh)) return undefined;
    const kandidat = roh.startsWith("www.") ? `https://${roh}` : roh;
    if (!/^https?:\/\//u.test(kandidat)) return undefined;
    try {
        return new URL(kandidat).hostname.includes(".") ? kandidat : undefined;
    } catch {
        return undefined;
    }
}

export type QuellePerLinkClient = Pick<InhalteClient, "adresse" | "anlegen">;

export interface QuellePerLinkOptionen {
    client?: QuellePerLinkClient | undefined;
    neueOperationId?: (() => string) | undefined;
    /** Wartezeit nach dem letzten Zeichen in Millisekunden; Tests nehmen 0. */
    entprellMs?: number | undefined;
}

export interface QuellePerLink {
    /** Der Link im Feld; `undefined`: Dort steht ein Suchwort, die Steuerung ruht. */
    readonly link: ComputedRef<string | undefined>;
    readonly prueft: Readonly<Ref<boolean>>;
    /** Die Prüfung selbst ging nicht (nicht die Seite: der Weg dorthin). */
    readonly pruefFehler: Readonly<Ref<boolean>>;
    readonly auskunft: Readonly<ShallowRef<InhalteAdressAuskunft | undefined>>;
    readonly titel: Readonly<Ref<string>>;
    /** Die Art einer neuen Quelle, wo der Korpus keine vorgibt. */
    readonly art: Readonly<Ref<SourceType>>;
    /** „Offiziell“ einer neuen Quelle, wo der Korpus nichts vorgibt. */
    readonly offiziell: Readonly<Ref<boolean>>;
    setzeTitel(wert: string): void;
    setzeArt(wert: SourceType): void;
    setzeOffiziell(wert: boolean): void;
    readonly laeuft: Readonly<Ref<boolean>>;
    readonly fehler: Readonly<Ref<string | undefined>>;
    /** Geht „＋ Quelle“ gerade? `schonDa`: Die vorhandene Quelle hängt hier schon. */
    bereit(schonDa: (sourceId: string) => boolean): boolean;
    pruefeErneut(): void;
    /** Der Klick auf „＋ Quelle“: die vorhandene Quelle oder eine neu angelegte; `undefined`, wenn es nicht ging (der Satz steht in `fehler`). */
    bestaetige(): Promise<QuelleZumAnhaengen | undefined>;
}

const ENTPRELL_VORGABE = 300;

export function createQuellePerLink(text: () => string, optionen: QuellePerLinkOptionen = {}): QuellePerLink {
    const client = optionen.client ?? createInhalteClient();
    const neueOperationId = optionen.neueOperationId ?? newOperationId;
    const entprellMs = optionen.entprellMs ?? ENTPRELL_VORGABE;

    const link = computed(() => linkAusText(text()));
    const prueft = ref(false);
    const pruefFehler = ref(false);
    const auskunft = shallowRef<InhalteAdressAuskunft | undefined>(undefined);
    const titel = ref("");
    const art = ref<SourceType>("sonstiges");
    const offiziell = ref(false);
    const laeuft = ref(false);
    const fehler = ref<string | undefined>(undefined);

    let abbruch: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let vorschlag = "";
    let artGewaehlt = false;
    let offiziellGewaehlt = false;

    function halte(): void {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        abbruch?.abort();
        abbruch = undefined;
    }

    async function pruefe(url: string, steuer: AbortController): Promise<void> {
        try {
            const antwort = await client.adresse(url, steuer.signal);
            if (steuer.signal.aborted) return;
            auskunft.value = antwort;
            pruefFehler.value = false;
            const gelesen = antwort.titel ?? "";
            if (gelesen !== "" && (titel.value.trim() === "" || titel.value === vorschlag)) titel.value = gelesen;
            vorschlag = gelesen;
            if (!artGewaehlt) art.value = antwort.korpus?.artVorschlag ?? "sonstiges";
            if (!offiziellGewaehlt) offiziell.value = antwort.korpus?.offiziellVorschlag ?? false;
        } catch (grund) {
            if (istAbbruch(grund, steuer.signal) || steuer.signal.aborted) return;
            pruefFehler.value = true;
        } finally {
            if (abbruch === steuer) prueft.value = false;
        }
    }

    function stosseAn(url: string, warten: number): void {
        halte();
        const steuer = new AbortController();
        abbruch = steuer;
        prueft.value = true;
        pruefFehler.value = false;
        timer = setTimeout(() => void pruefe(url, steuer), warten);
    }

    watch(
        link,
        (url) => {
            halte();
            auskunft.value = undefined;
            fehler.value = undefined;
            pruefFehler.value = false;
            if (url === undefined) {
                prueft.value = false;
                titel.value = "";
                vorschlag = "";
                art.value = "sonstiges";
                offiziell.value = false;
                artGewaehlt = false;
                offiziellGewaehlt = false;
                return;
            }
            // Der Vorschlag des vorigen Links ist hier falsch; was jemand selbst getippt hat, bleibt.
            if (titel.value === vorschlag) titel.value = "";
            vorschlag = "";
            stosseAn(url, entprellMs);
        },
        { immediate: true },
    );
    onScopeDispose(halte);

    return {
        link,
        prueft,
        pruefFehler,
        auskunft,
        titel,
        art,
        offiziell,
        laeuft,
        fehler,
        setzeTitel(wert) {
            titel.value = wert;
        },
        setzeArt(wert) {
            artGewaehlt = true;
            art.value = wert;
        },
        setzeOffiziell(wert) {
            offiziellGewaehlt = true;
            offiziell.value = wert;
        },
        bereit(schonDa) {
            if (link.value === undefined || prueft.value || laeuft.value) return false;
            const vorhanden = auskunft.value?.vorhanden;
            if (vorhanden !== null && vorhanden !== undefined) return !vorhanden.stillgelegt && !schonDa(vorhanden.id);
            return titel.value.trim() !== "";
        },
        pruefeErneut() {
            const url = link.value;
            if (url !== undefined) stosseAn(url, 0);
        },
        async bestaetige() {
            const url = link.value;
            if (url === undefined || laeuft.value) return undefined;
            const vorhanden = auskunft.value?.vorhanden;
            if (vorhanden !== null && vorhanden !== undefined) {
                return vorhanden.stillgelegt
                    ? undefined
                    : {
                          id: vorhanden.id,
                          title: vorhanden.title,
                          sourceType: vorhanden.sourceType,
                          url: vorhanden.url,
                          korpus: auskunft.value?.korpus?.name ?? null,
                      };
            }
            laeuft.value = true;
            fehler.value = undefined;
            const korpus = auskunft.value?.korpus;
            const vorgabeArt = korpus?.sourceType ?? null;
            const vorgabeOffiziell = korpus?.isOfficial ?? null;
            const anzulegen = titel.value.trim();
            try {
                const antwort = await client.anlegen({
                    operationId: neueOperationId(),
                    url,
                    title: anzulegen,
                    ...(vorgabeArt === null && (artGewaehlt || auskunft.value !== undefined)
                        ? { sourceType: art.value }
                        : {}),
                    ...(vorgabeOffiziell === null && (offiziellGewaehlt || auskunft.value !== undefined)
                        ? { isOfficial: offiziell.value }
                        : {}),
                });
                if (antwort.ok) {
                    return {
                        id: antwort.quittung.publicId,
                        title: anzulegen,
                        sourceType: vorgabeArt ?? art.value,
                        url,
                        korpus: korpus?.name ?? null,
                    };
                }
                if (antwort.fehler.code === "source_exists") {
                    fehler.value = t("quellen.link.inzwischenDa");
                    stosseAn(url, 0);
                } else {
                    fehler.value = antwort.fehler.message;
                }
                return undefined;
            } finally {
                laeuft.value = false;
            }
        },
    };
}
