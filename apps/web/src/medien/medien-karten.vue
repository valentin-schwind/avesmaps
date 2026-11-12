<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { MamKartenListe } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { t } from "../i18n/i18n";
import type { Geladen } from "./medien-daten";
import MedienEintragNeu from "./medien-eintrag-neu.vue";
import { kartenKreisName, kartenUnterzeile, kreisDerKarte } from "./medien-karten-modell";
import { KREIS_LEGENDE } from "./medien-kreis";
import { zahl } from "./medien-text";

/**
 * Spalte 2 für das Medienobjekt „Kartensammlung“ (WI-0068 R5, nur lesend): die Karten aus Legacy in der Folge des Katalogs (nach Titel).
 *
 * - Je Zeile die Vorschau der Karte, der Titel und darunter Art, Typen und Zeitraum, wie der Katalog sie nennt.
 * - Der Kreis sagt, ob die Karte ein Bild hat und ob eines öffentlich ist; die Legende mit Zählung steht in EINER Zeile unter der Liste.
 * - Entfernte (stillgelegte) Einträge stehen nicht in der Liste (WI-0287); das Kästchen unter der Liste, nur wenn es welche gibt, holt sie
 *   dazu, und sie tragen die Marke „stillgelegt“.
 * - Die Suche geht an den Server (Titel, Zeichner, Verlag, Namen der Orte): dieselbe Leiste wie bei den Galerien.
 */
const props = defineProps<{
    liste: Geladen<MamKartenListe>;
    suche: string;
    gewaehlt: string | undefined;
    telefon: boolean;
    /** „Stillgelegte anzeigen“ ist an. */
    stillgelegte?: boolean | undefined;
    /** Ein Satz über der Liste, etwa nach dem Entfernen eines Eintrags. */
    hinweis?: string | undefined;
    /** Wer Einträge ändern darf, legt auch neue an (WI-0287): oben in der Liste steht „✚ Neuer Eintrag“. */
    darfAnlegen?: boolean | undefined;
}>();
const emit = defineEmits<{
    waehle: [id: string];
    suche: [wert: string];
    erneut: [];
    zurueck: [];
    stillgelegte: [an: boolean];
    neu: [];
}>();

const zeilen = computed(() => props.liste.wert?.items ?? []);
const stillgelegt = computed(() => props.liste.wert?.retiredTotal ?? 0);
// Wer aus dem Reiter „Karten“ eines Objekts kommt, soll nicht suchen: Die gewählte Zeile steht im Bild.
const listenWurzel = ref<HTMLElement>();
watch(
    [() => props.gewaehlt, () => zeilen.value.length],
    () =>
        void nextTick(() =>
            listenWurzel.value?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest" }),
        ),
    { immediate: true },
);
const unterzeile = computed(() =>
    props.liste.laedt && props.liste.wert === undefined
        ? t("medien.treffer.laedt")
        : t("medien.karten.unterzeile", { n: zahl(props.liste.wert?.total ?? 0) }),
);
/** Legende und Zählung in einer Zeile, mit den Namen (Hausregel: „Name, Kreis, Zahl“). */
const legende = computed(() =>
    KREIS_LEGENDE.map((fuellung) => ({
        fuellung,
        name: kartenKreisName(fuellung),
        n: zeilen.value.filter((zeile) => kreisDerKarte(zeile) === fuellung).length,
    })),
);
</script>

<template>
    <FensterSpalte
        breite="fuellen"
        :telefon="telefon"
        :titel="t('medien.objekt.kartensammlung')"
        :unterzeile="unterzeile"
        testid="medien-spalte-karten"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="medien-zurueck-arten" @click="emit('zurueck')">{{
                t("medien.zurueck.arten")
            }}</AvmKnopf>
        </template>
        <template #leiste>
            <AvmListenleiste
                :model-value="suche"
                :platzhalter="t('medien.karten.suche.platzhalter')"
                :beschriftung="t('medien.karten.suche.label')"
                class="karten__leiste"
                testid="medien-karten"
                @update:model-value="(wert: string) => emit('suche', wert)"
            />
        </template>

        <AvmHinweis v-if="liste.fehler" :ton="liste.fehler.ton" rolle="alert" testid="medien-karten-fehler">{{
            liste.fehler.text
        }}</AvmHinweis>
        <AvmKnopf v-if="liste.fehler?.erneut" groesse="zeile" testid="medien-karten-erneut" @click="emit('erneut')">{{
            t("medien.erneut")
        }}</AvmKnopf>

        <AvmHinweis v-if="hinweis" testid="medien-karten-hinweis">{{ hinweis }}</AvmHinweis>

        <MedienEintragNeu
            v-if="darfAnlegen"
            class="karten__neu"
            rolle="eintrag"
            ansicht="liste"
            @hochladen="emit('neu')"
        />

        <p
            v-if="!liste.fehler && !liste.laedt && zeilen.length === 0"
            class="karten__satz"
            data-testid="medien-karten-leer"
        >
            {{ suche.trim() === "" ? t("medien.karten.leer") : t("medien.karten.leerGesucht") }}
        </p>

        <ul
            v-if="zeilen.length > 0"
            ref="listenWurzel"
            class="karten__liste"
            :aria-label="t('medien.objekt.kartensammlung')"
            data-testid="medien-karten-liste"
        >
            <li v-for="zeile in zeilen" :key="zeile.id">
                <button
                    type="button"
                    class="karte-zeile"
                    :class="{ 'is-gewaehlt': zeile.id === gewaehlt }"
                    :aria-current="zeile.id === gewaehlt ? 'true' : undefined"
                    :data-karte="zeile.id"
                    data-testid="medien-karte-zeile"
                    @click="emit('waehle', zeile.id)"
                >
                    <span class="karte-zeile__bild">
                        <img
                            v-if="zeile.preview ?? zeile.privatePreview"
                            :src="(zeile.preview ?? zeile.privatePreview)!.url"
                            alt=""
                            loading="lazy"
                            decoding="async"
                        />
                    </span>
                    <span class="karte-zeile__text">
                        <span class="karte-zeile__l1">
                            <AvmKreis :fuellung="kreisDerKarte(zeile)" :name="kartenKreisName(kreisDerKarte(zeile))" />
                            <span class="karte-zeile__name einzeilig">{{ zeile.title }}</span>
                            <span
                                v-if="!zeile.active"
                                class="karte-zeile__marke"
                                data-testid="medien-karte-stillgelegt"
                                >{{ t("medien.verwendung.stillgelegt") }}</span
                            >
                        </span>
                        <span class="karte-zeile__l2 einzeilig">{{ kartenUnterzeile(zeile) }}</span>
                    </span>
                    <span class="karte-zeile__n">{{ t("medien.karten.orteZahl", { n: zahl(zeile.places) }) }}</span>
                </button>
            </li>
        </ul>
        <p v-if="liste.laedt" class="karten__satz" data-testid="medien-karten-laedt">
            {{ t("medien.treffer.laedt") }}
        </p>
        <AvmKaestchen
            v-if="stillgelegt > 0 || stillgelegte"
            art="checkbox"
            :checked="stillgelegte === true"
            testid="medien-karten-stillgelegte"
            @change="(an: boolean) => emit('stillgelegte', an)"
            >{{ t("medien.karten.stillgelegtZeigen", { n: zahl(stillgelegt) }) }}</AvmKaestchen
        >
        <p v-if="zeilen.length > 0" class="karten__legende" data-testid="medien-karten-legende">
            <span v-for="eintrag in legende" :key="eintrag.fuellung" class="karten__legende-eintrag">
                {{ eintrag.name }} <AvmKreis :fuellung="eintrag.fuellung" :name="eintrag.name" /> {{ zahl(eintrag.n) }}
            </span>
        </p>
    </FensterSpalte>
</template>

<style scoped>
.karten__leiste {
    flex: 1 1 auto;
    min-width: 0;
}

.karten__neu {
    margin-bottom: var(--space-2);
}

/* Die Fläche des Zeichens so groß wie das Bild einer Zeile. */
.karten__neu :deep(.medien-neu__bild) {
    width: 62px;
    height: 46px;
}

.karten__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.karten__satz,
.karten__legende {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.karten__legende {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-8);
    font-size: var(--font-size-caption);
}

.karten__legende-eintrag {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}

/* Eine Zeile wie jede Zeile des Hauses (wie die Galerien): durchsichtige Kante immer da, Zustände nach Guide §30.5. */
.karte-zeile {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
    width: 100%;
    margin: 0;
    padding: var(--avm-row-pad);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.karte-zeile:hover {
    background: var(--color-hover-wash);
}

.karte-zeile:active {
    background: var(--color-active-wash);
}

.karte-zeile:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.karte-zeile.is-gewaehlt,
.karte-zeile.is-gewaehlt:hover {
    border-color: var(--color-accent);
    background: var(--color-active-wash);
}

.karte-zeile__bild {
    flex: none;
    width: 62px;
    height: 46px;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
}

.karte-zeile__bild img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.karte-zeile__text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.karte-zeile__l1 {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
}

.karte-zeile__name {
    flex: 0 1 auto;
    min-width: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.karte-zeile__marke {
    flex: none;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.karte-zeile__l2,
.karte-zeile__n {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.karte-zeile__n {
    flex: none;
}

@media (prefers-reduced-motion: reduce) {
    .karte-zeile {
        transition: none;
    }
}
</style>
