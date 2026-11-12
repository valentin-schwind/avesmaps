<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { mediaPhotoboxOrtReisebilderUrl, type PhotoboxOrtReisebilder } from "@avesmaps3d/shared";
import { getJson } from "../auth/api";
import { t } from "../i18n/i18n";
import { oeffneMedien, reisebilderStand } from "../medien/medien-oeffnen";
import ReisebildZeilen from "../photobox/reisebild-zeilen.vue";
import { reisebilder as karte } from "../photobox/reisebilder-zustand";
import { inhaltsstand } from "../system/inhaltsstand";

type Reisebild = PhotoboxOrtReisebilder["reisebilder"][number];

/**
 * Das Panel „Reisebilder der Community“ im Reiter „Bilder“ des Ortseditors (WI-0272; Vali 2026-11-02: „unter "Ortseigenschaften" -> im Tab "Bilder" muss ein Panel "Reisebilder der Community" erscheinen, wo
 * die alle gelistet sind (unter "Titelbild" oder "Galerie")“). Es listet die freigegebenen Reisebilder dieses Ortes in der Reihenfolge der Freigabe, geschützt gelesen.
 *
 * - **Je Eintrag:** Vorschau, Beschreibung, Name und Entstehung; „Zur Stelle“ fliegt hin; der Knopf der Medienverwaltung öffnet genau dieses Bild. Offline nehmen und korrigieren bleiben dort, mit ihrer Rückfrage
 *   und ihren Folgen: Ein zweiter Weg hier hieße zwei Stellen für dieselbe Handlung.
 * - **Frisch:** neu gelesen, wenn der Ort wechselt, nach jeder eigenen Operation an einer Einreichung und wenn der Stand der Reisebilder im Takt der Seite anders ist (`inhaltsstand`).
 */
const props = defineProps<{ publicId: string; kennung: string }>();
const emit = defineEmits<{
    /** Wie viele der Ort hat: Der Satz im Kasten darüber sagt, was das Infopanel zeigt. */
    zahl: [n: number];
}>();

const bilder = shallowRef<readonly Reisebild[] | undefined>();
const fehler = ref(false);

let lauf: AbortController | undefined;
async function lade(): Promise<void> {
    lauf?.abort();
    const eigener = new AbortController();
    lauf = eigener;
    try {
        const antwort = await getJson<PhotoboxOrtReisebilder>(
            mediaPhotoboxOrtReisebilderUrl(props.publicId),
            (url, init) => fetch(url, { ...init, signal: eigener.signal }),
        );
        if (eigener.signal.aborted) return;
        bilder.value = antwort.reisebilder;
        fehler.value = false;
        emit("zahl", antwort.reisebilder.length);
    } catch {
        if (!eigener.signal.aborted) fehler.value = true;
    }
}

watch(
    () => props.publicId,
    () => {
        bilder.value = undefined;
        fehler.value = false;
        emit("zahl", 0);
    },
);
watch([() => props.publicId, reisebilderStand, () => inhaltsstand.stand.value.reisebilder], () => void lade(), {
    immediate: true,
});
onBeforeUnmount(() => lauf?.abort());

const zeilen = computed(() => bilder.value ?? []);

function zurStelle(bild: Reisebild): void {
    karte.markiere([bild.publicId]);
    karte.zeige(bild.publicId, bild.lage);
}

function zuDenMedien(bild?: Reisebild): void {
    oeffneMedien({
        korb: "photobox_uploads",
        einreichung: "erledigt",
        ...(bild === undefined ? {} : { asset: bild.publicId }),
    });
}
</script>

<template>
    <section class="reisebilder" :data-testid="`${kennung}-bilder-reisebilder`">
        <div class="reisebilder__kopf">
            <h4 class="reisebilder__titel">
                {{ t("ortseditor.bilder.reisebilder") }}
                <template v-if="zeilen.length > 0">({{ zeilen.length }})</template>
            </h4>
            <button
                type="button"
                class="reisebilder__verweis"
                :data-testid="`${kennung}-medien-reisebilder`"
                @click="zuDenMedien()"
            >
                {{ t("ortseditor.bilder.zuReisebildern") }}
            </button>
        </div>
        <p v-if="fehler" class="reisebilder__leise" :data-testid="`${kennung}-reisebilder-fehler`">
            {{ t("ortseditor.bilder.reisebilderFehler") }}
        </p>
        <p
            v-else-if="bilder && zeilen.length === 0"
            class="reisebilder__leise"
            :data-testid="`${kennung}-reisebilder-keine`"
        >
            {{ t("ortseditor.bilder.keineReisebilder") }}
        </p>
        <ReisebildZeilen
            v-if="zeilen.length > 0"
            :bilder="zeilen"
            :kennung="kennung"
            :medien-text="t('ortseditor.bilder.inMedienverwaltung')"
            @stelle="zurStelle"
            @medien="zuDenMedien"
        />
    </section>
</template>

<style scoped>
.reisebilder {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.reisebilder__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4) var(--space-8);
}

.reisebilder__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.reisebilder__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.reisebilder__verweis {
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    text-decoration: underline;
}

.reisebilder__verweis:hover {
    color: var(--color-link-hover);
}

.reisebilder__verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}
</style>
