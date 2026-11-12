<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import {
    KARTENVORSCHLAG_SEGMENTE,
    type KartenvorschlagListe,
    type KartenvorschlagSegment,
    type KartenvorschlagZeile,
} from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmKreisLegende from "../controls/avm-kreis-legende.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import { phoneViewport } from "../controls/phone-viewport";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import { entprellt } from "../system/entprellt";
import { ladeVorschlaege, nichtEingerichtet } from "./kartenvorschlaege-api";
import { ZUSTAND_NAME, hinweisVon, kreisVon, legendeNamen, legendeZahlen, quelleVon } from "./kartenvorschlaege-modell";
import { zeitAbstand } from "./meldungen-modell";
import { REDAKTION_FEHLER_SATZ, redaktionFehler } from "./redaktion-api";
import { redaktion } from "./redaktion";

/**
 * Die Liste der Kartenvorschläge in der Medienverwaltung (Eingänge › Kartenvorschläge, WI-0068 OPS-000093; Liste aus WI-0275, Entwurf Fassung 2): oben die Segmente **Offen · Angenommen · Abgelehnt**, darunter die Suche in Titel,
 * Ort und Nummer (auf dem Server), dann die Zeilen, unten die Legende mit Zählung. Im Stil der Bewertungen (`bewertungen-liste.vue`).
 *
 * - **Eine Zeile:** Kreis, Titel, Zeit; darunter Ort und Quelle (der Host eines Links, das Format einer Datei mit dem Bild-Zeichen davor, Vali 2026-11-04), dann die Nummer; wo es etwas zu sagen gibt, ein Hinweis.
 *   Ein Klick wählt den Vorschlag für Spalte 3 (`waehle`, `gewaehlt` trägt die Marke); das Blatt „Ablehnen“ liegt dort.
 * - **Ohne Vorschaubild in der Zeile** (Entwurf: „erst ohne“): Das bräuchte ein Feld und eine kleine Bildfassung.
 * - **Offen die ältesten zuerst**, entschiedene die neuesten. „Weitere laden“ holt die nächsten 50.
 * - Die Redaktion in Community sieht Kartenvorschläge seit WI-0305 in der Liste der Meldungen (`meldungen-karten.ts`), nicht mehr in dieser Liste; den Unterreiter „Karten“ gibt es nicht mehr.
 */
const props = defineProps<{
    /** Die Spalte ist zu sehen: Ein Wechsel auf „sichtbar“ lädt neu, damit die Liste nicht von gestern ist. */
    sichtbar?: boolean | undefined;
    /** Der gewählte Vorschlag (öffentliche Kennung): seine Zeile steht gewählt da. */
    gewaehlt?: string | undefined;
}>();
const emit = defineEmits<{ waehle: [id: string, titel: string] }>();

const segment = ref<KartenvorschlagSegment>("offen");
const suche = ref("");
const gesucht = entprellt(suche);

type Stand =
    | { readonly art: "laedt" }
    | { readonly art: "nicht-eingerichtet" }
    | { readonly art: "fehler"; readonly key: MessageKey }
    | { readonly art: "da"; readonly liste: KartenvorschlagListe };

const stand = shallowRef<Stand>({ art: "laedt" });
const laedtWeitere = ref(false);
let lauf = 0;

async function lade(): Promise<void> {
    const mein = ++lauf;
    laedtWeitere.value = false;
    try {
        const liste = await ladeVorschlaege({ segment: segment.value, q: gesucht.value });
        if (mein !== lauf) return;
        stand.value = { art: "da", liste };
    } catch (fehler) {
        if (mein !== lauf) return;
        if (nichtEingerichtet(fehler)) stand.value = { art: "nicht-eingerichtet" };
        else stand.value = { art: "fehler", key: REDAKTION_FEHLER_SATZ[redaktionFehler(fehler)] };
    }
}

async function ladeWeitere(): Promise<void> {
    const jetzt = stand.value;
    if (jetzt.art !== "da" || jetzt.liste.naechste === null || laedtWeitere.value) return;
    const mein = ++lauf;
    laedtWeitere.value = true;
    try {
        const mehr = await ladeVorschlaege({ segment: segment.value, q: gesucht.value, nach: jetzt.liste.naechste });
        if (mein !== lauf) return;
        stand.value = { art: "da", liste: { ...mehr, eintraege: [...jetzt.liste.eintraege, ...mehr.eintraege] } };
    } catch (fehler) {
        if (mein !== lauf) return;
        stand.value = { art: "fehler", key: REDAKTION_FEHLER_SATZ[redaktionFehler(fehler)] };
    } finally {
        if (mein === lauf) laedtWeitere.value = false;
    }
}

watch([segment, gesucht], () => void lade(), { immediate: true });
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
const zeilen = computed((): KartenvorschlagZeile[] => liste.value?.eintraege ?? []);

const segmente = computed(() =>
    KARTENVORSCHLAG_SEGMENTE.map((wert) => ({ value: wert, label: t(`kartenvorschlag.redaktion.segment.${wert}`) })),
);

const titelVon = (zeile: KartenvorschlagZeile): string => `${zeile.nummer} ${zeile.titel}`;
const oeffne = (zeile: KartenvorschlagZeile): void => emit("waehle", zeile.id, titelVon(zeile));

const leer = computed(() =>
    suche.value.trim() !== ""
        ? t("community.redaktion.leer.treffer")
        : t(`kartenvorschlag.redaktion.leer.${segment.value}`),
);
const rechtsText = (zeile: KartenvorschlagZeile): string => zeitAbstand(zeile.eingegangenAm, new Date());
</script>

<template>
    <div class="karten" data-testid="community-karten">
        <AvmHinweis
            v-if="stand.art === 'nicht-eingerichtet'"
            ton="neutral"
            rolle="status"
            testid="community-karten-nicht-eingerichtet"
        >
            {{ t("kartenvorschlag.redaktion.nichtEingerichtet") }}
        </AvmHinweis>

        <template v-else>
            <AvmSegmente
                v-model="segment"
                :options="segmente"
                :label="t('kartenvorschlag.redaktion.segmente')"
                :eng="phoneViewport"
                testid="community-karten-segmente"
            />
            <AvmListenleiste
                v-model="suche"
                :platzhalter="t('kartenvorschlag.redaktion.suche.platzhalter')"
                :beschriftung="t('kartenvorschlag.redaktion.suche')"
                testid="community-karten-leiste"
            />

            <p v-if="stand.art === 'laedt'" class="karten__leise" role="status" data-testid="community-karten-laedt">
                {{ t("community.redaktion.laedt") }}
            </p>
            <template v-if="stand.art === 'fehler'">
                <AvmHinweis ton="gefahr" rolle="alert" testid="community-karten-fehler">{{ t(stand.key) }}</AvmHinweis>
                <AvmKnopf testid="community-karten-erneut" @click="lade()">{{
                    t("community.redaktion.neuLaden")
                }}</AvmKnopf>
            </template>

            <template v-if="liste !== undefined">
                <p v-if="zeilen.length === 0" class="karten__leise" data-testid="community-karten-leer">
                    {{ leer }}
                </p>
                <ol
                    v-else
                    class="liste"
                    :aria-label="t('kartenvorschlag.redaktion.liste')"
                    data-testid="community-karten-liste"
                >
                    <li v-for="zeile in zeilen" :key="zeile.id" class="eintrag">
                        <button
                            type="button"
                            class="zeile"
                            :class="{ 'is-gewaehlt': zeile.id === gewaehlt }"
                            :aria-current="zeile.id === gewaehlt ? 'true' : undefined"
                            :data-testid="`community-karte-zeile-${zeile.id}`"
                            @click="oeffne(zeile)"
                        >
                            <AvmKreis :fuellung="kreisVon(zeile.zustand)" :name="t(ZUSTAND_NAME[zeile.zustand])" />
                            <span class="zeile__text">
                                <span class="zeile__titel einzeilig">{{ zeile.titel }}</span>
                                <span class="zeile__inhalt einzeilig"
                                    ><span v-if="zeile.ort === null" class="zeile__ohne">{{
                                        t("kartenvorschlag.redaktion.ohneOrt")
                                    }}</span
                                    ><template v-else>{{ zeile.ort.name }}</template> ·
                                    <span v-if="zeile.weg === 'datei'" aria-hidden="true">🖼️ </span
                                    >{{ quelleVon(zeile) }}</span
                                >
                                <span class="zeile__unter einzeilig">{{ zeile.nummer }}</span>
                                <span v-if="hinweisVon(zeile) !== undefined" class="zeile__hinweis">{{
                                    hinweisVon(zeile)
                                }}</span>
                            </span>
                            <span class="zeile__rechts">{{ rechtsText(zeile) }}</span>
                        </button>
                    </li>
                </ol>
                <div v-if="liste.weitere">
                    <AvmKnopf
                        :gesperrt="laedtWeitere ? '' : undefined"
                        testid="community-karten-weitere"
                        @click="ladeWeitere()"
                        >{{ t("kartenvorschlag.redaktion.weitere") }}</AvmKnopf
                    >
                </div>
                <AvmKreisLegende
                    :namen="legendeNamen(segment)"
                    :zahlen="legendeZahlen(liste.zaehler)"
                    :beschriftung="t('kartenvorschlag.redaktion.legende')"
                    testid="community-karten-legende"
                />
            </template>
        </template>
    </div>
</template>

<style scoped>
.karten {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

.karten__leise {
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

/* Eine Zeile; Zustände nach Guide §30.5. */
.eintrag {
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

.zeile__titel {
    color: var(--color-text-strong);
}

.zeile__inhalt {
    color: var(--color-text);
}

.zeile__ohne {
    color: var(--color-text-muted);
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

@media (prefers-reduced-motion: reduce) {
    .zeile {
        transition: none;
    }
}
</style>
