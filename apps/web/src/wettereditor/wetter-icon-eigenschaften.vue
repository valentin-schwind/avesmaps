<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
    WETTER_SYMBOL_GRENZEN,
    type WetterSymbol,
    type WetterSymbolAenderungen,
    type WetterWikiArtikel,
} from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmFeld from "../controls/avm-feld.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import FensterFeldzeile from "../fenster/fenster-feldzeile.vue";
import { t } from "../i18n/i18n";
import { artName, himmelName, staerkeBasis, symbolName } from "./wetter-editor-modell";
import WetterWertzeile from "./wetter-wertzeile.vue";
import WetterWikiFeld from "./wetter-wiki-feld.vue";

/**
 * Die Eigenschaften eines Wetter-Icons (WI-0288 Stufe 3; Probierseite `iconEigenschaften`): Name, „Auf der Karte“ (zeigen, Name zeigen),
 * Lage, Reichweite, Stärke und Richtung (Wind, Strömung; Grad nach der Windrose) oder Drehsinn (Wirbel), zuletzt „Icon entfernen …“.
 *
 * - **Ausgeblendet wirkt weiter** (Betreiber 2026-11-07): Der Kasten oben sagt es, mit „Wieder zeigen“.
 * - **Die Art bleibt**: Der Server ändert sie nicht (Stufe 2, `WetterSymbolAenderungen`); sie steht in der Unterzeile. Die Probierseite
 *   zeigte sie als Wahl.
 * - Der Name gilt beim Tippen (entprellt gespeichert); das Feld hält, was getippt ist, auch Leerzeichen am Ende, die der Server kürzt.
 * - **Wiki-Artikel** (Stufe 6, `wetter-wiki-feld.vue`): unter dem Namen, ein Verweis auf den Artikel des Winds, der Strömung oder des Mahlstroms.
 */
const props = defineProps<{
    symbol: WetterSymbol;
    entfernenFrage: boolean;
    laeuft: boolean;
    gesperrt: string | undefined;
    kennung: string;
    wikiArtikel: readonly WetterWikiArtikel[] | undefined;
    wikiFehler: boolean;
}>();
const emit = defineEmits<{
    setze: [aenderungen: WetterSymbolAenderungen];
    wikiBrauche: [];
    entfernenFragen: [];
    entfernenNein: [];
    entfernenJa: [];
}>();

const name = ref(props.symbol.name ?? "");
// Ein anderes Icon oder ein neu geladener Stand (Konflikt): Das Feld zeigt den Namen, außer er ist nur das Getippte ohne Leerzeichen am Rand.
watch(
    () => [props.symbol.id, props.symbol.name] as const,
    ([id, gespeichert], [altId]) => {
        if (id !== altId || (gespeichert ?? "") !== name.value.trim()) name.value = gespeichert ?? "";
    },
);
watch(name, (text) => {
    if (text.trim() !== (props.symbol.name ?? "")) emit("setze", { name: text });
});
const basis = computed(() => staerkeBasis(props.symbol.art));
const g = WETTER_SYMBOL_GRENZEN;
const drehsinn = computed({
    get: () => String(props.symbol.drehsinn ?? -1),
    set: (wert: string) => emit("setze", { drehsinn: wert === "1" ? 1 : -1 }),
});
const drehsinnOptionen = computed(() => [
    { value: "-1", label: t("wettereditor.drehsinn.gegenGross") },
    { value: "1", label: t("wettereditor.drehsinn.mitGross") },
]);
function lage(feld: "x" | "z", ereignis: Event): void {
    const eingabe = ereignis.target as HTMLInputElement;
    const neu = Number(eingabe.value);
    if (eingabe.value.trim() === "" || !Number.isFinite(neu)) {
        eingabe.value = String(Math.round(props.symbol[feld]));
        return;
    }
    emit("setze", { [feld]: neu });
}
</script>

<template>
    <div class="wetter-eigenschaften" :data-testid="`${kennung}-icon`">
        <div class="wetter-eigenschaften__name">
            <strong>{{ symbolName(symbol) }}</strong>
            <small>{{ t("wettereditor.icon.unterzeile", { art: artName(symbol.art) }) }}</small>
        </div>
        <div v-if="!symbol.sichtbar" class="wetter-eigenschaften__stand" :data-testid="`${kennung}-ausgeblendet`">
            <span>{{ t("wettereditor.icon.ausgeblendet") }}</span>
            <AvmKnopf
                groesse="zeile"
                :gesperrt="gesperrt"
                :testid="`${kennung}-zeigen`"
                @click="emit('setze', { sichtbar: true })"
            >
                {{ t("wettereditor.icon.wiederZeigen") }}
            </AvmKnopf>
        </div>
        <section class="wetter-eigenschaften__abschnitt">
            <h4 class="wetter-eigenschaften__titel">{{ t("wettereditor.icon.identitaet") }}</h4>
            <FensterFeldzeile :name="t('wettereditor.icon.name')" :fuer="`${kennung}-name`">
                <AvmEingabe
                    :id="`${kennung}-name`"
                    v-model="name"
                    :placeholder="t('wettereditor.icon.ohneName')"
                    :gesperrt="gesperrt"
                    :testid="`${kennung}-name`"
                />
            </FensterFeldzeile>
            <WetterWikiFeld
                :symbol="symbol"
                :artikel="wikiArtikel"
                :fehler="wikiFehler"
                :gesperrt="gesperrt"
                :kennung="kennung"
                @setze="(aenderungen: WetterSymbolAenderungen) => emit('setze', aenderungen)"
                @brauche="emit('wikiBrauche')"
            />
            <FensterFeldzeile :name="t('wettereditor.icon.aufDerKarte')">
                <span class="wetter-eigenschaften__haken">
                    <AvmKaestchen
                        art="checkbox"
                        :checked="symbol.sichtbar"
                        :gesperrt="gesperrt"
                        :testid="`${kennung}-sichtbar`"
                        @change="(an: boolean) => emit('setze', { sichtbar: an })"
                        >{{ t("wettereditor.icon.zeigen") }}</AvmKaestchen
                    >
                    <AvmKaestchen
                        art="checkbox"
                        :checked="symbol.nameZeigen"
                        :gesperrt="gesperrt"
                        :testid="`${kennung}-name-zeigen`"
                        @change="(an: boolean) => emit('setze', { nameZeigen: an })"
                        >{{ t("wettereditor.icon.nameZeigen") }}</AvmKaestchen
                    >
                </span>
            </FensterFeldzeile>
            <p class="wetter-eigenschaften__leise">{{ t("wettereditor.icon.satz") }}</p>
        </section>
        <section class="wetter-eigenschaften__abschnitt">
            <h4 class="wetter-eigenschaften__titel">{{ t("wettereditor.icon.wirkung") }}</h4>
            <FensterFeldzeile :name="t('wettereditor.icon.lage')" :fuer="`${kennung}-x`">
                <span class="wetter-eigenschaften__lage">
                    <span class="wetter-eigenschaften__leise">x</span>
                    <AvmFeld
                        :id="`${kennung}-x`"
                        type="number"
                        :min="g.x.min"
                        :max="g.x.max"
                        step="1"
                        :value="Math.round(symbol.x)"
                        :aria-label="t('wettereditor.icon.lageX')"
                        :disabled="gesperrt !== undefined"
                        :data-testid="`${kennung}-x`"
                        @change="lage('x', $event)"
                    />
                    <span class="wetter-eigenschaften__leise">z</span>
                    <AvmFeld
                        type="number"
                        :min="g.z.min"
                        :max="g.z.max"
                        step="1"
                        :value="Math.round(symbol.z)"
                        :aria-label="t('wettereditor.icon.lageZ')"
                        :disabled="gesperrt !== undefined"
                        :data-testid="`${kennung}-z`"
                        @change="lage('z', $event)"
                    />
                    <span class="wetter-eigenschaften__leise">{{ t("wettereditor.icon.ziehen") }}</span>
                </span>
            </FensterFeldzeile>
            <WetterWertzeile
                schluessel="reichweite"
                :kennung="kennung"
                :name="t('wettereditor.icon.reichweite')"
                :satz="t('wettereditor.icon.reichweite.satz')"
                :min="g.reichweite.min"
                :max="g.reichweite.max"
                :schritt="5"
                :wert="symbol.reichweite"
                :stellen="0"
                :faktor="3"
                :einheit="t('wettereditor.einheit.km')"
                :gesperrt="gesperrt"
                @setze="(wert: number) => emit('setze', { reichweite: wert })"
            />
            <WetterWertzeile
                schluessel="staerke"
                :kennung="kennung"
                :name="t('wettereditor.icon.staerke')"
                :satz="t('wettereditor.icon.staerke.satz')"
                :min="g.staerke.min"
                :max="g.staerke.max"
                :schritt="0.5"
                :wert="symbol.staerke"
                :stellen="2"
                :faktor="1 / basis"
                :einheit="
                    symbol.art === 'stroemung' || symbol.art === 'mahlstrom'
                        ? t('wettereditor.icon.staerke.stroemung')
                        : t('wettereditor.icon.staerke.wind')
                "
                :gesperrt="gesperrt"
                @setze="(wert: number) => emit('setze', { staerke: wert })"
            />
            <WetterWertzeile
                v-if="symbol.art !== 'wirbel' && symbol.art !== 'mahlstrom'"
                schluessel="richtung"
                :kennung="kennung"
                :name="t('wettereditor.icon.richtung')"
                :satz="t('wettereditor.icon.richtung.satz')"
                :min="0"
                :max="359"
                :schritt="1"
                :wert="Math.round(symbol.richtung ?? 0) % 360"
                :stellen="0"
                :einheit="t('wettereditor.icon.richtung.einheit', { richtung: himmelName(symbol.richtung ?? 0) })"
                :gesperrt="gesperrt"
                @setze="(wert: number) => emit('setze', { richtung: wert })"
            />
            <FensterFeldzeile v-else :name="t('wettereditor.icon.drehsinn')">
                <AvmSegmente
                    v-model="drehsinn"
                    :options="drehsinnOptionen"
                    :label="t('wettereditor.icon.drehsinn')"
                    :testid="`${kennung}-drehsinn`"
                />
            </FensterFeldzeile>
        </section>
        <section class="wetter-eigenschaften__abschnitt">
            <AvmBestaetigung
                v-if="entfernenFrage"
                :frage="t('wettereditor.entfernen.frage', { name: symbolName(symbol) })"
                :folge="t('wettereditor.entfernen.folge')"
                :bestaetigen="t('wettereditor.entfernen.ja')"
                :gesperrt="laeuft ? t('wettereditor.laeuft') : undefined"
                :testid="`${kennung}-entfernen-frage`"
                @bestaetigen="emit('entfernenJa')"
                @abbrechen="emit('entfernenNein')"
            />
            <span v-else class="wetter-eigenschaften__entfernen">
                <AvmKnopf
                    art="gefahr"
                    groesse="zeile"
                    :gesperrt="gesperrt"
                    :testid="`${kennung}-entfernen`"
                    @click="emit('entfernenFragen')"
                >
                    {{ t("wettereditor.entfernen") }}
                </AvmKnopf>
            </span>
        </section>
    </div>
</template>

<style scoped>
.wetter-eigenschaften {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

.wetter-eigenschaften__name {
    display: grid;
    gap: var(--space-2);
}

.wetter-eigenschaften__name strong {
    color: var(--color-text-strong);
    font-weight: normal;
    font-size: var(--font-size-subhead);
}

.wetter-eigenschaften__name small {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Wie der Kasten „stillgelegt“ der Landschaft (`landschaftseditor__stand`). */
.wetter-eigenschaften__stand {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
    padding: var(--space-4) var(--space-8);
    border: 1px solid var(--color-warning-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-warning-soft);
}

.wetter-eigenschaften__abschnitt {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.wetter-eigenschaften__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.wetter-eigenschaften__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wetter-eigenschaften__haken {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-10);
}

.wetter-eigenschaften__lage {
    display: grid;
    grid-template-columns: auto 7ch auto 7ch minmax(0, 1fr);
    gap: var(--space-4);
    align-items: center;
}

.wetter-eigenschaften__entfernen {
    display: flex;
}
</style>
