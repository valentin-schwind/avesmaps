<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";
import type { StapelStand, StapelZeile } from "./medien-stapel-modell";
import { anzeigeName, zahl } from "./medien-text";

/**
 * Die Dateien eines Stapels (WI-0068 MAM-R3, Blatt P6 Abschnitt 2): oben die Ablage für mehrere Dateien, darunter eine Reihe je Datei
 * mit Vorschau, Namen und Ergebnis. Die Arbeit tut das Fenster (`medien-hochladen-fenster.vue`, `medien-stapel-modell.ts`); hier steht
 * nur, was jede Zeile zeigt und anbietet: „übernehmen“ bei einer Datei, die es schon gibt, „↺ Erneut“ bei einer, die nicht
 * eingeordnet wurde, und „✕“, solange nichts gesendet ist.
 */
const props = defineProps<{
    zeilen: readonly StapelZeile[];
    gesperrt: boolean;
    /** Was die Dateiauswahl annimmt (dieselben Typen wie das Formular). */
    annehmen: string;
}>();
const emit = defineEmits<{
    dateien: [dateien: File[]];
    erneut: [zeile: StapelZeile];
    uebernehmen: [zeile: StapelZeile, wert: boolean];
    entfernen: [zeile: StapelZeile];
}>();

const ziehtUeber = ref(false);
function gewaehlt(event: Event): void {
    const eingabe = event.target as HTMLInputElement;
    emit("dateien", [...(eingabe.files ?? [])]);
    eingabe.value = "";
}
function abgelegt(event: DragEvent): void {
    ziehtUeber.value = false;
    if (props.gesperrt) return;
    emit("dateien", [...(event.dataTransfer?.files ?? [])]);
}

// Die Vorschau aus dem Speicher des Browsers, je Datei einmal; wer geht, gibt sie frei.
const vorschau = new Map<string, string>();
const bild = (zeile: StapelZeile): string => {
    let url = vorschau.get(zeile.schluessel);
    if (url === undefined) {
        url = URL.createObjectURL(zeile.datei);
        vorschau.set(zeile.schluessel, url);
    }
    return url;
};
watch(
    () => props.zeilen.map((zeile) => zeile.schluessel),
    (jetzt) => {
        for (const [schluessel, url] of vorschau) {
            if (!jetzt.includes(schluessel)) {
                URL.revokeObjectURL(url);
                vorschau.delete(schluessel);
            }
        }
    },
);
onBeforeUnmount(() => {
    for (const url of vorschau.values()) URL.revokeObjectURL(url);
});

const TON: Readonly<Record<StapelStand, "ruhig" | "gut" | "warnung" | "gefahr">> = {
    prueft: "ruhig",
    neu: "ruhig",
    vorhanden: "warnung",
    laedt: "ruhig",
    ordnet: "ruhig",
    fertig: "gut",
    abgewiesen: "gefahr",
    offen: "warnung",
    schonDrin: "ruhig",
    uebersprungen: "ruhig",
};
function ergebnis(zeile: StapelZeile): string {
    switch (zeile.stand) {
        case "fertig":
            return t("medien.stapel.fertig", { n: zahl(zeile.nummer ?? 0) });
        case "abgewiesen":
            return t("medien.stapel.abgewiesen", { grund: zeile.meldung ?? "" });
        case "offen":
            return t("medien.stapel.offen");
        case "vorhanden":
            return t("medien.stapel.vorhanden", {
                name: zeile.treffer === undefined ? "" : anzeigeName(zeile.treffer, zeile.treffer.primaryUsage),
            });
        default:
            return t(`medien.stapel.stand.${zeile.stand}`);
    }
}
const darfEntfernen = (zeile: StapelZeile): boolean =>
    !props.gesperrt && ["prueft", "neu", "vorhanden", "abgewiesen", "uebersprungen"].includes(zeile.stand);
</script>

<template>
    <div class="stapel" data-testid="medien-stapel">
        <label
            class="stapel__ablage"
            :class="{ 'is-ueber': ziehtUeber, 'is-gesperrt': gesperrt }"
            data-testid="medien-stapel-ablage"
            @dragover.prevent="ziehtUeber = !gesperrt"
            @dragleave="ziehtUeber = false"
            @drop.prevent="abgelegt"
        >
            <input
                class="stapel__eingabe"
                type="file"
                multiple
                :accept="annehmen"
                :disabled="gesperrt"
                data-testid="medien-stapel-dateien"
                @change="gewaehlt"
            />
            <strong>↥ {{ t("medien.stapel.ablage") }}</strong>
            <span class="stapel__klein">{{ t("medien.formular.typenBild") }}</span>
        </label>
        <ul v-if="zeilen.length > 0" class="stapel__liste">
            <li
                v-for="zeile in zeilen"
                :key="zeile.schluessel"
                class="stapel__zeile"
                :class="`stapel__zeile--${TON[zeile.stand]}`"
                :data-stand="zeile.stand"
                data-testid="medien-stapel-zeile"
            >
                <img class="stapel__bild" :src="bild(zeile)" alt="" />
                <span class="stapel__name einzeilig">{{ zeile.datei.name }}</span>
                <span class="stapel__ergebnis" data-testid="medien-stapel-ergebnis">{{ ergebnis(zeile) }}</span>
                <label v-if="zeile.stand === 'vorhanden'" class="stapel__wahl">
                    <input
                        type="checkbox"
                        :checked="zeile.uebernehmen"
                        :disabled="gesperrt"
                        data-testid="medien-stapel-uebernehmen"
                        @change="emit('uebernehmen', zeile, ($event.target as HTMLInputElement).checked)"
                    />
                    {{ t("medien.stapel.uebernehmen") }}
                </label>
                <AvmKnopf
                    v-if="zeile.stand === 'offen'"
                    groesse="zeile"
                    :gesperrt="gesperrt ? t('medien.formular.laeuft') : undefined"
                    testid="medien-stapel-erneut"
                    @click="emit('erneut', zeile)"
                >
                    ↺ {{ t("medien.stapel.erneut") }}
                </AvmKnopf>
                <button
                    v-if="darfEntfernen(zeile)"
                    type="button"
                    class="stapel__weg"
                    :aria-label="t('medien.stapel.entfernen')"
                    :title="t('medien.stapel.entfernen')"
                    data-testid="medien-stapel-entfernen"
                    @click="emit('entfernen', zeile)"
                >
                    ✕
                </button>
            </li>
        </ul>
        <p class="stapel__klein">{{ t("medien.stapel.satz") }}</p>
    </div>
</template>

<style scoped>
.stapel {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.stapel__ablage {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-6);
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-md);
    text-align: center;
    cursor: pointer;
}

.stapel__ablage.is-ueber {
    border-color: var(--color-accent-strong);
    background: var(--color-hover-wash);
}

.stapel__ablage.is-gesperrt {
    cursor: default;
    opacity: 0.6;
}

.stapel__eingabe {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: inherit;
}

.stapel__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.stapel__zeile {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto auto;
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-2) var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--font-size-small);
}

.stapel__zeile--gut {
    border-color: var(--color-success);
}

.stapel__zeile--warnung {
    border-color: var(--color-warning);
}

.stapel__zeile--gefahr {
    border-color: var(--color-danger);
}

.stapel__bild {
    width: 36px;
    height: 24px;
    object-fit: cover;
    border-radius: var(--radius-sm);
}

.stapel__ergebnis {
    color: var(--color-text-strong);
}

.stapel__wahl {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}

.stapel__weg {
    border: 0;
    background: none;
    color: var(--color-text);
    cursor: pointer;
}

.stapel__klein {
    margin: 0;
    font-size: var(--font-size-small);
    color: var(--color-text);
}
</style>
