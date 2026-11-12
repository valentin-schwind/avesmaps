<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import type { BewertungListe, BewertungZeile } from "@avesmaps3d/shared";
import type { FilterAbschnitt, FilterWahl } from "../controls/avm-filterknopf";
import AvmFilterknopf from "../controls/avm-filterknopf.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmKreisLegende from "../controls/avm-kreis-legende.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import AvmMenueknopf from "../controls/avm-menueknopf.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import AvmSortierzeichen from "../controls/avm-sortierzeichen.vue";
import { formatNumber, t } from "../i18n/i18n";
import InfoStars from "../info-panel/info-stars.vue";
import { entprellt } from "../system/entprellt";
import { ladeStand } from "./api";
import {
    HERKUNFT_FILTER,
    LISTEN_SEGMENTE,
    ORDNUNGEN,
    STERNE_FILTER,
    ZUSTAND_NAME,
    anfrageVon,
    filterGesetzt,
    griffe,
    kreisVon,
    legendeNamen,
    legendeZahlen,
    marken,
    rechtsText,
    segmentZahl,
    sterneLabel,
    sterneVon,
    textVon,
    unterreiterZahl,
    unterzeile,
    type BewertungsFilter,
    type ListenSegment,
    type Ordnung,
} from "./bewertungen-modell";
import { gibBewertungFrei, ladeBewertungen, sichteBewertung } from "./bewertungen-redaktion-api";
import { redaktionSatz } from "./redaktion-ablehnung";
import { redaktion } from "./redaktion";

/**
 * Die Liste „Community › Bewertungen“ (WI-0269 C10; Bedienkonzept WI-0263 §6.1): oben die Segmente **Zu sichten · Sichtbar · Verborgen** mit Zahl, darunter die Leiste des Hauses (Suche links, Trichter und Sortierung
 * rechtsbündig, Guide §13.45), dann die Zeilen, unten EINE Zeile Legende mit Zählung („neu ○ 3 · zurückgehalten ◑ 1 · gesichtet ● 120 · verborgen ◌ 4“). Im Stil des Reiters Meldungen.
 *
 * - **Gesucht wird auf dem Server** (Ort, Name, Text); Sterne (1 bis 5), Herkunft (Website, Legacy), „nur gemeldete“ und „nur zurückgehaltene“ filtert der Server mit, die Sortierung auch (neueste, älteste, wenigste Sterne).
 * - **Eine Zeile:** Kreis (○ neu, ◑ zurückgehalten, ● gesichtet, ◌ verborgen), Sterne, Ort, Zeit; darunter der Text einzeilig gekürzt, dann Name und aventurisches Datum; Marken „gemeldet COM-…“, „Spamverdacht“,
 *   „Legacy“. Rechts die Aktionsspalte: ✓ „Gesichtet“ (bei zurückgehaltenen „Freigeben“) und ⊘ „Verbergen …“. Ein Klick auf die Zeile öffnet das Fenster, und die Karte fliegt zum Ort (`redaktion.ts`).
 * - **Ohne eingerichtetes Modul** (`GET /api/community/stand` ist falsch) steht ein ruhiger Hinweis statt der Liste.
 */
const props = defineProps<{
    rechte: readonly string[];
    /** Das Panel ist zu sehen: Ein Wechsel auf „sichtbar“ lädt neu, damit die Liste nicht von gestern ist. */
    sichtbar?: boolean | undefined;
}>();
const emit = defineEmits<{ zaehler: [zuSichten: number | undefined] }>();

// --- Zustand der Leiste ----------------------------------------------------------------------------------------------------

const segment = ref<ListenSegment>("sichten");
const suche = ref("");
const gesucht = entprellt(suche);
const filter = ref<BewertungsFilter>({});
const ordnung = ref<Ordnung>("neueste");

// --- Laden -----------------------------------------------------------------------------------------------------------------

type Stand =
    | { readonly art: "laedt" }
    | { readonly art: "nicht-eingerichtet" }
    | { readonly art: "fehler"; readonly satz: string }
    | { readonly art: "da"; readonly liste: BewertungListe };

const stand = shallowRef<Stand>({ art: "laedt" });
const problem = shallowRef<string | undefined>(undefined);
let lauf = 0;

async function lade(): Promise<void> {
    const mein = ++lauf;
    try {
        if (stand.value.art === "laedt" || stand.value.art === "nicht-eingerichtet") {
            const bereit = await ladeStand();
            if (mein !== lauf) return;
            if (!bereit) {
                stand.value = { art: "nicht-eingerichtet" };
                emit("zaehler", undefined);
                return;
            }
        }
        const liste = await ladeBewertungen(anfrageVon(segment.value, gesucht.value, filter.value, ordnung.value));
        if (mein !== lauf) return;
        stand.value = { art: "da", liste };
        emit("zaehler", unterreiterZahl(liste));
    } catch (fehler) {
        if (mein !== lauf) return;
        stand.value = { art: "fehler", satz: redaktionSatz(fehler) };
    }
}

watch([segment, gesucht, filter, ordnung], () => void lade(), { immediate: true, deep: true });
watch(
    () => redaktion.listeVersion.value,
    () => void lade(),
);
watch(
    () => props.sichtbar,
    (an) => {
        if (an === true) void lade();
    },
);

const liste = computed(() => (stand.value.art === "da" ? stand.value.liste : undefined));
const zeilen = computed((): BewertungZeile[] => liste.value?.zeilen ?? []);

// --- Segmente, Trichter, Sortierung ----------------------------------------------------------------------------------------

const segmente = computed(() =>
    LISTEN_SEGMENTE.map((wert) => ({
        value: wert,
        label:
            liste.value === undefined
                ? t(`bewertungen.redaktion.segment.${wert}`)
                : `${t(`bewertungen.redaktion.segment.${wert}`)} (${formatNumber(segmentZahl(liste.value.zaehler, wert), 0)})`,
    })),
);

const gesetzteWahl = computed((): FilterWahl => filter.value);
const abschnitte = computed((): FilterAbschnitt[] => [
    {
        id: "sterne",
        titel: t("bewertungen.redaktion.filter.sterne"),
        art: "eins",
        werte: STERNE_FILTER.map((wert) => ({ wert: String(wert), text: sterneLabel(wert) })),
    },
    {
        id: "herkunft",
        titel: t("bewertungen.redaktion.filter.herkunft"),
        art: "eins",
        werte: HERKUNFT_FILTER.map((wert) => ({ wert, text: t(`bewertungen.redaktion.herkunft.${wert}`) })),
    },
    {
        id: "sonst",
        titel: t("bewertungen.redaktion.filter.sonst"),
        art: "mehrere",
        werte: [
            { wert: "gemeldet", text: t("bewertungen.redaktion.filter.gemeldet") },
            { wert: "zurueckgehalten", text: t("bewertungen.redaktion.filter.zurueckgehalten") },
        ],
    },
]);

function setzeFilter(abschnitt: string, werte: string[]): void {
    filter.value = { ...filter.value, [abschnitt]: werte };
}

const sortierungen = computed(() => ORDNUNGEN.map((wert) => ({ wert, text: t(`bewertungen.redaktion.sort.${wert}`) })));
const sortName = computed(() => t(`bewertungen.redaktion.sort.${ordnung.value}`));
const sortArt = (wert: string): "zeit" | "menge" => (wert === "wenigste" ? "menge" : "zeit");

// --- Zeilen ----------------------------------------------------------------------------------------------------------------

/** Die Bewertung im vordersten sichtbaren Fenster: ihre Zeile steht gewählt da. */
const geoeffnet = computed(
    () =>
        [...redaktion.bewertungFenster.value]
            .filter((fenster) => fenster.lage !== "versenkt")
            .sort((a, b) => b.vorn - a.vorn)[0]?.gegenstand,
);

const titelVon = (zeile: BewertungZeile): string => `${sterneLabel(zeile.sterne)} · ${zeile.ort.name}`;

const oeffne = (zeile: BewertungZeile): void => {
    redaktion.oeffneBewertung(zeile.id, `${"★".repeat(zeile.sterne)}${"☆".repeat(5 - zeile.sterne)} ${zeile.ort.name}`);
};
const oeffneZumVerbergen = (zeile: BewertungZeile): void => {
    redaktion.oeffneBewertung(
        zeile.id,
        `${"★".repeat(zeile.sterne)}${"☆".repeat(5 - zeile.sterne)} ${zeile.ort.name}`,
        "verbergen",
    );
};

const schreibt = ref<string | undefined>(undefined);
async function schritt(zeile: BewertungZeile, lauf_: () => Promise<unknown>): Promise<void> {
    if (schreibt.value !== undefined) return;
    schreibt.value = zeile.id;
    problem.value = undefined;
    try {
        await lauf_();
    } catch (fehler) {
        // WI-0291: der genaue Grund (Stand, Zustand der Bewertung), bei Konflikt und Übergang mit dem Hinweis, dass die Liste neu lädt.
        problem.value = redaktionSatz(fehler);
    } finally {
        schreibt.value = undefined;
        redaktion.geaendert();
    }
}
const sichte = (zeile: BewertungZeile): Promise<void> =>
    schritt(zeile, () => sichteBewertung(zeile.id, zeile.revision));
const gibFrei = (zeile: BewertungZeile): Promise<void> =>
    schritt(zeile, () => gibBewertungFrei(zeile.id, zeile.revision));

const leer = computed(() =>
    suche.value.trim() !== "" || filterGesetzt(filter.value)
        ? t("community.redaktion.leer.treffer")
        : t(`bewertungen.redaktion.leer.${segment.value}`),
);
</script>

<template>
    <div class="bewertungen" data-testid="community-bewertungen">
        <AvmHinweis
            v-if="stand.art === 'nicht-eingerichtet'"
            ton="neutral"
            rolle="status"
            testid="community-bewertungen-nicht-eingerichtet"
        >
            {{ t("community.redaktion.nichtEingerichtet") }}
        </AvmHinweis>

        <template v-else>
            <AvmSegmente
                v-model="segment"
                :options="segmente"
                :label="t('bewertungen.redaktion.segmente')"
                testid="community-bewertungen-segmente"
            />
            <AvmListenleiste
                v-model="suche"
                :platzhalter="t('bewertungen.redaktion.suche.platzhalter')"
                :beschriftung="t('bewertungen.redaktion.suche')"
                testid="community-bewertungen-leiste"
            >
                <AvmFilterknopf
                    :abschnitte="abschnitte"
                    :wahl="gesetzteWahl"
                    testid="community-bewertungen-filter"
                    @setze="setzeFilter"
                    @loesen="filter = {}"
                />
                <AvmMenueknopf
                    v-model="ordnung"
                    :optionen="sortierungen"
                    :bezeichnung="t('bewertungen.redaktion.sort.knopf', { wahl: sortName })"
                    :menue-bezeichnung="t('bewertungen.redaktion.sort.menue')"
                    testid="community-bewertungen-sortierung"
                >
                    <template #zeichen="{ wert }"
                        ><AvmSortierzeichen :art="sortArt(wert)" :umgekehrt="wert === 'aelteste'"
                    /></template>
                </AvmMenueknopf>
            </AvmListenleiste>

            <p
                v-if="stand.art === 'laedt'"
                class="bewertungen__leise"
                role="status"
                data-testid="community-bewertungen-laedt"
            >
                {{ t("community.redaktion.laedt") }}
            </p>
            <template v-if="stand.art === 'fehler'">
                <AvmHinweis ton="gefahr" rolle="alert" testid="community-bewertungen-fehler">{{
                    stand.satz
                }}</AvmHinweis>
                <AvmKnopf testid="community-bewertungen-erneut" @click="lade()">{{
                    t("community.redaktion.neuLaden")
                }}</AvmKnopf>
            </template>
            <AvmHinweis
                v-if="problem !== undefined"
                ton="gefahr"
                rolle="alert"
                testid="community-bewertungen-problem"
                >{{ problem }}</AvmHinweis
            >

            <template v-if="liste !== undefined">
                <p v-if="zeilen.length === 0" class="bewertungen__leise" data-testid="community-bewertungen-leer">
                    {{ leer }}
                </p>
                <ol
                    v-else
                    class="liste"
                    :aria-label="t('bewertungen.redaktion.liste')"
                    data-testid="community-bewertungen-liste"
                >
                    <li v-for="zeile in zeilen" :key="zeile.id" class="eintrag">
                        <button
                            type="button"
                            class="zeile"
                            :class="{ 'is-gewaehlt': zeile.id === geoeffnet }"
                            :aria-current="zeile.id === geoeffnet ? 'true' : undefined"
                            :data-testid="`community-bewertung-zeile-${zeile.id}`"
                            @click="oeffne(zeile)"
                        >
                            <AvmKreis :fuellung="kreisVon(zeile.zustand)" :name="t(ZUSTAND_NAME[zeile.zustand])" />
                            <span class="zeile__text">
                                <span class="zeile__kopf">
                                    <InfoStars :stars="sterneVon(zeile.sterne)" :label="titelVon(zeile)" />
                                    <span class="zeile__titel einzeilig">{{ zeile.ort.name }}</span>
                                </span>
                                <span class="zeile__inhalt einzeilig">{{
                                    textVon(zeile) || t("bewertungen.redaktion.ohneText")
                                }}</span>
                                <span class="zeile__unter einzeilig">{{ unterzeile(zeile) }}</span>
                                <span v-for="marke in marken(zeile)" :key="marke" class="zeile__hinweis">{{
                                    marke
                                }}</span>
                            </span>
                            <span class="zeile__rechts">{{ rechtsText(zeile) }}</span>
                        </button>
                        <span class="aktionen">
                            <AvmKnopf
                                v-if="griffe(zeile, rechte).sichten.zeigen"
                                groesse="zeile"
                                :gesperrt="schreibt === zeile.id ? '' : undefined"
                                :title="t('bewertungen.redaktion.griff.sichten')"
                                :aria-label="t('bewertungen.redaktion.griff.sichten')"
                                :testid="`community-bewertung-sichten-${zeile.id}`"
                                @click="sichte(zeile)"
                                >✓</AvmKnopf
                            >
                            <AvmKnopf
                                v-else-if="griffe(zeile, rechte).freigeben.zeigen"
                                groesse="zeile"
                                :gesperrt="schreibt === zeile.id ? '' : undefined"
                                :title="t('bewertungen.redaktion.griff.freigeben')"
                                :aria-label="t('bewertungen.redaktion.griff.freigeben')"
                                :testid="`community-bewertung-freigeben-${zeile.id}`"
                                @click="gibFrei(zeile)"
                                >✓</AvmKnopf
                            >
                            <AvmKnopf
                                v-if="griffe(zeile, rechte).verbergen.zeigen"
                                art="gefahr"
                                groesse="zeile"
                                :gesperrt="schreibt === zeile.id ? '' : undefined"
                                :title="t('bewertungen.redaktion.griff.verbergen')"
                                :aria-label="t('bewertungen.redaktion.griff.verbergen')"
                                :testid="`community-bewertung-verbergen-${zeile.id}`"
                                @click="oeffneZumVerbergen(zeile)"
                                >⊘</AvmKnopf
                            >
                        </span>
                    </li>
                </ol>
                <AvmKreisLegende
                    :namen="legendeNamen()"
                    :zahlen="legendeZahlen(liste.zaehler)"
                    :beschriftung="t('bewertungen.redaktion.legende')"
                    testid="community-bewertungen-legende"
                />
            </template>
        </template>
    </div>
</template>

<style scoped>
.bewertungen {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

.bewertungen__leise {
    margin: 0;
    padding: var(--space-8) var(--space-2);
    color: var(--color-text-muted);
}

.liste {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Eine Zeile: der Kasten der Zeile mit der Aktionsspalte rechts (wie die Mails, Bedienkonzept §13.27); Zustände nach Guide §30.5. */
.eintrag {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    border-bottom: 1px solid var(--color-divider);
}

.zeile {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--space-2) var(--space-8);
    align-items: start;
    box-sizing: border-box;
    width: 100%;
    padding: var(--space-8) var(--space-6);
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: background-color 120ms ease;
}

.zeile:hover {
    background: var(--color-hover-wash);
}

.zeile:active {
    background: var(--color-active-wash);
}

.zeile:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.zeile.is-gewaehlt {
    background: var(--color-panel-active);
}

.zeile :deep(.avm-kreis) {
    margin-top: var(--space-2);
}

.zeile__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.zeile__kopf {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
}

.zeile__kopf :deep(.info-stars__glyphs) {
    font-size: var(--font-size-small);
}

.zeile__titel {
    min-width: 0;
    color: var(--color-text-strong);
}

.zeile__inhalt {
    color: var(--color-text);
}

.zeile__unter {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.zeile__hinweis {
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-small);
}

.zeile__rechts {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    white-space: nowrap;
}

.aktionen {
    display: flex;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-4) 0 0;
}

@media (prefers-reduced-motion: reduce) {
    .zeile {
        transition: none;
    }
}
</style>
