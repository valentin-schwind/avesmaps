<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { MamKarteZeile } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";
import { istAbbruch, type MedienClient } from "./medien-client";
import { kartenUnterzeile, sichtbaresBild } from "./medien-karten-modell";
import { zielTreffer } from "./medien-karte-zusammenlegen-modell";

/**
 * Die Wahl des Eintrags der Kartensammlung, der etwas bekommt (WI-0287 Stufe 2, Entwurf Fassung 5 `zielWahl`, `zeichneZielTreffer`): im Dialog „Eintrag entfernen“ („Bilder an
 * anderen Eintrag geben“) und im Blatt „Annehmen“ eines Kartenvorschlags („Weitere Version eines Eintrags“). Suche mit Vorschaubild; ohne Suchwort stehen die Namensvettern da (gleiches
 * erstes Wort, `wort`). Gewählt steht der Eintrag als Zeile mit „⇄ Andere wählen“. Nie der Eintrag selbst (`ausser`), nie ein stillgelegter (die Liste liefert sie ohne Schalter nicht).
 *
 * 🔴 Jede Anfrage trägt ein `AbortSignal`: Ein jüngeres Suchwort bricht die ältere ab (AGENTS „Abbrechen ist Pflicht, nicht Kür“).
 */
const props = defineProps<{
    client: Pick<MedienClient, "karten">;
    /** Das erste Wort, nach dem die Namensvettern gesucht werden (`erstesWort`); leer: ohne Suchwort keine Treffer. */
    wort: string;
    /** Der Eintrag, der nicht zur Wahl steht (er selbst). */
    ausser?: string | undefined;
    gesperrt?: boolean | undefined;
    testid: string;
}>();
const gewaehlt = defineModel<MamKarteZeile | undefined>({ required: true });

const q = ref("");
const treffer = shallowRef<readonly MamKarteZeile[]>([]);
const laedt = ref(false);
const fehler = ref(false);
let uhr: ReturnType<typeof setTimeout> | undefined;
let lauf: AbortController | undefined;
const RUHE_MS = 250;

function haltAn(): void {
    if (uhr !== undefined) clearTimeout(uhr);
    lauf?.abort();
}
onBeforeUnmount(haltAn);

function lade(): void {
    haltAn();
    fehler.value = false;
    const suchwort = q.value.trim();
    const frage = suchwort === "" ? props.wort : suchwort;
    if (frage === "") {
        treffer.value = [];
        laedt.value = false;
        return;
    }
    laedt.value = true;
    uhr = setTimeout(
        () => {
            const abbruch = new AbortController();
            lauf = abbruch;
            props.client
                .karten(frage, abbruch.signal)
                .then((antwort) => {
                    if (abbruch.signal.aborted) return;
                    treffer.value = zielTreffer(antwort.items, props.ausser, suchwort, props.wort);
                    laedt.value = false;
                })
                .catch((error: unknown) => {
                    if (istAbbruch(error, abbruch.signal)) return;
                    fehler.value = true;
                    laedt.value = false;
                });
        },
        suchwort === "" ? 0 : RUHE_MS,
    );
}

// Ohne Wahl wird gesucht; die Wahl selbst braucht keine Liste.
watch(
    [q, () => props.wort, () => gewaehlt.value === undefined],
    () => {
        if (gewaehlt.value === undefined) lade();
        else haltAn();
    },
    { immediate: true },
);

function waehle(zeile: MamKarteZeile): void {
    gewaehlt.value = zeile;
}
function andere(): void {
    q.value = "";
    gewaehlt.value = undefined;
}
</script>

<template>
    <div class="zielwahl" :data-testid="testid">
        <div v-if="gewaehlt" class="zielwahl__zeile" :data-testid="`${testid}-gewaehlt`">
            <span class="zielwahl__daumen">
                <img v-if="sichtbaresBild(gewaehlt)" :src="sichtbaresBild(gewaehlt)!.url" alt="" loading="lazy" />
            </span>
            <span class="zielwahl__text">
                <span class="zielwahl__name">{{ gewaehlt.title }}</span>
                <span class="zielwahl__l2">{{ kartenUnterzeile(gewaehlt) }}</span>
            </span>
            <AvmKnopf
                groesse="zeile"
                :gesperrt="gesperrt ? t('medien.bearbeiten.sendet') : undefined"
                :testid="`${testid}-andere`"
                @click="andere"
            >
                <template #zeichen>⇄</template>
                {{ t("medien.karten.zielwahl.andere") }}
            </AvmKnopf>
        </div>
        <template v-else>
            <AvmEingabe
                v-model="q"
                art="suche"
                :placeholder="t('medien.karten.zielwahl.suche')"
                :aria-label="t('medien.karten.zielwahl.suche')"
                :testid="`${testid}-suche`"
            />
            <ul class="zielwahl__treffer" :aria-busy="laedt">
                <li v-for="zeile in treffer" :key="zeile.id">
                    <button
                        type="button"
                        class="zielwahl__treffer-zeile"
                        :disabled="gesperrt"
                        :data-testid="`${testid}-treffer`"
                        @click="waehle(zeile)"
                    >
                        <span class="zielwahl__daumen zielwahl__daumen--klein">
                            <img v-if="sichtbaresBild(zeile)" :src="sichtbaresBild(zeile)!.url" alt="" loading="lazy" />
                        </span>
                        <span class="zielwahl__text">
                            <span class="zielwahl__name einzeilig">{{ zeile.title }}</span>
                            <span class="zielwahl__l2">{{ kartenUnterzeile(zeile) }}</span>
                        </span>
                    </button>
                </li>
                <li
                    v-if="!laedt && !fehler && treffer.length === 0"
                    class="zielwahl__l2 zielwahl__nichts"
                    :data-testid="`${testid}-nichts`"
                >
                    {{ t(q.trim() === "" ? "medien.karten.zielwahl.leer" : "medien.karten.platz.nichtsGefunden") }}
                </li>
                <li v-if="fehler" class="zielwahl__l2 zielwahl__nichts">{{ t("medien.karten.zielwahl.fehler") }}</li>
            </ul>
        </template>
    </div>
</template>

<style scoped>
.zielwahl {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
}

.zielwahl__zeile {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
}

.zielwahl__daumen {
    flex: none;
    width: 44px;
    height: 33px;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
}

.zielwahl__daumen img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.zielwahl__text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.zielwahl__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
    overflow-wrap: anywhere;
}

.zielwahl__l2 {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.zielwahl__treffer {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-height: 232px;
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
    scrollbar-width: thin;
}

/* Ein Treffer (wie im Platz „Die Karte“, `platz__treffer-zeile`): Ruhe, Hover-Lasur, Aktiv-Lasur, Fokusring, 120 ms. */
.zielwahl__treffer-zeile {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    width: 100%;
    min-width: 0;
    padding: var(--space-2) var(--space-4);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition:
        background-color 120ms ease,
        box-shadow 120ms ease;
}

.zielwahl__treffer-zeile:hover:not(:disabled) {
    background: var(--color-hover-wash);
}

.zielwahl__treffer-zeile:active:not(:disabled) {
    background: var(--color-active-wash);
}

.zielwahl__treffer-zeile:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.zielwahl__treffer-zeile:disabled {
    color: var(--color-text-muted);
    cursor: default;
}

.zielwahl__nichts {
    padding: var(--space-4);
}

@media (prefers-reduced-motion: reduce) {
    .zielwahl__treffer-zeile {
        transition: none;
    }
}
</style>
