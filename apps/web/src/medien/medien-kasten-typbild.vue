<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { MEDIA_TYPE_IMAGE_VARIANTS, type MamTypeImage, type MediaTypeImageVariant } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import { t } from "../i18n/i18n";
import { datum, entstehungName, kurzKennung, typbildObjekteName, zahl } from "./medien-text";
import { entstehungPasst, paarStand, typbildSlot } from "./medien-typbilder-modell";

/**
 * Der Kasten „Typbild“ im Inspector (WI-0068, Betreiber 2026-10-11: „im inspector ★ Typbild für alle Orte der Art Dorf (3.181) …
 * ⇄ anderes Typbild wählen … Frühere Typbilder“; Blatt abgenommen 2026-10-12).
 *
 * Er steht, sobald eine Typbildkategorie gewählt ist, auch wenn die gewählte Variante noch kein Asset hat, und sagt in EINER Zeile, für welche Objekte das Bild
 * gilt. Darunter, was Besucher davon sehen, und die früheren Typbilder als Verlauf (ihre Assets bleiben, sie sind nur nicht mehr der ★).
 *
 * **Das Typbildpaar** (WI-0281, Betreiber 2026-11-05): Oben steht, ob das Paar vollständig ist, und je Variante eine Zeile (✓ vorhanden mit Titel und Kennung des
 * Assets, – fehlt); ein Klick auf die Zeile zeigt diese Variante (dasselbe wie der Umschalter über der Vorschau). Alles darunter gilt der gewählten Variante: ihr ★,
 * ihr Stand, „⇄ anderes Typbild wählen …“ (dort auch hochladen) und ihr Verlauf. Herkunft, Rechte und Eigenschaften zeigen die Kästen des Assets darunter, je
 * Variante ein eigenes Asset. 🔴 Passt die Entstehung nicht (mehr) zur Variante, sagt es ein Hinweis: Eine Ohne-KI-Variante, deren Bild jemand auf KI oder
 * „unbekannt“ umgetragen hat, sehen Besucher nicht.
 *
 * **Variante lösen** (Vali 2026-11-05: „ja im zweifel darf auch nix sein - und dann ist halt grau“): nimmt den ★ der gezeigten Variante, ohne ein anderes Bild zu
 * setzen; das Asset bleibt und steht im Verlauf. Vorher fragt die Bestätigung des Hauses an Ort und Stelle (`AvmBestaetigung`), was danach gilt.
 *
 * 🪤 Die Zeile mit der Objektzahl ist heute TEXT, kein Link: Die Ortsliste des Ortseditors hält ihren Filter im Bauteil, nicht in der
 * Adresse — es gibt also noch keinen tiefen Link „Orte der Art Dorf“. Sobald WI-0128 einen anbietet, wird daraus EIN Link (Guide P8,
 * „was auf der Karte ist, ist anklickbar“); eine erfundene Adresse wäre ein toter Link.
 */
const props = defineProps<{
    eintrag: MamTypeImage;
    /** Die gezeigte Variante (Umschalter über der Vorschau). */
    variante: MediaTypeImageVariant;
    /** Darf der ★ gewechselt werden (`upload_media`)? Ohne das Recht steht der Knopf gesperrt mit Grund. */
    darfSetzen: boolean;
    /** Läuft das Lösen gerade? Dann ist die Handlung gesperrt und sagt es. */
    loest?: boolean | undefined;
}>();
const emit = defineEmits<{
    waehlen: [];
    waehleAsset: [id: string];
    variante: [variante: MediaTypeImageVariant];
    /** „Lösen“ bestätigt: Das Fenster löst den ★ der gezeigten Variante. */
    loesen: [];
}>();

/** Steht die Bestätigung des Lösens da? Eine andere Variante oder Kategorie fragt nicht weiter. */
const fragt = ref(false);
watch([() => props.eintrag.category, () => props.variante], () => (fragt.value = false));

const slot = computed(() => typbildSlot(props.eintrag, props.variante));
const paar = computed(() => paarStand(props.eintrag));

/** Je Variante eine Zeile: vorhanden (mit Titel und Kennung) oder fehlt. */
const zeilen = computed(() =>
    MEDIA_TYPE_IMAGE_VARIANTS.map((variante) => {
        const aktuell = typbildSlot(props.eintrag, variante).current;
        return {
            variante,
            aktuell,
            text:
                aktuell === null
                    ? t(`medien.typbild.paar.fehlt.${variante}`)
                    : t(`medien.typbild.paar.vorhanden.${variante}`, {
                          titel: aktuell.title ?? t("medien.typbild.kasten.ohneTitel"),
                          id: kurzKennung(aktuell.assetId),
                      }),
        };
    }),
);

/** Die eine Zeile: für welche Objekte dieses Typbild gilt. */
const geltung = computed(() => {
    const art = typbildObjekteName(props.eintrag.objects);
    return props.eintrag.count === null
        ? t("medien.typbild.kasten.geltungOhneZahl", { label: props.eintrag.label, art })
        : t("medien.typbild.kasten.geltung", {
              label: props.eintrag.label,
              art,
              n: zahl(props.eintrag.count),
          });
});

const stand = computed(() => {
    const aktuell = slot.value.current;
    if (aktuell === null) return t(`medien.typbild.kasten.keines.${props.variante}`);
    if (aktuell.public) return t("medien.typbild.kasten.oeffentlich", { seit: datum(aktuell.since) });
    return t(`medien.typbild.kasten.intern.${props.variante}`, { seit: datum(aktuell.since) });
});

/** Passt die Entstehung des ★ nicht zur Variante, der Satz dazu. */
const unpassend = computed(() => {
    const method = slot.value.current?.creationMethod;
    if (method === undefined || entstehungPasst(slot.value, props.variante)) return undefined;
    return t(`medien.typbild.kasten.unpassend.${props.variante}`, { entstehung: entstehungName(method) });
});

const gesperrt = computed(() => (props.darfSetzen ? undefined : t("medien.typbild.kasten.keinRecht")));
const loesenGesperrt = computed(() => (props.loest === true ? t("medien.typbild.kasten.loestGerade") : gesperrt.value));
</script>

<template>
    <FensterKarte :titel="t('medien.typbild.kasten.titel')" data-testid="medien-kasten-typbild">
        <div class="typbild-kasten__paar" :data-paar="paar" data-testid="medien-typbild-paarstand">
            <p class="typbild-kasten__paar-satz" :class="{ 'is-voll': paar === 'paar' }">
                {{ t(`medien.typbild.kasten.paar.${paar}`) }}
            </p>
            <ul class="typbild-kasten__liste">
                <li v-for="zeile in zeilen" :key="zeile.variante">
                    <button
                        type="button"
                        class="typbild-kasten__variante"
                        :class="{ 'is-gewaehlt': zeile.variante === variante, 'is-fehlt': zeile.aktuell === null }"
                        :aria-pressed="zeile.variante === variante ? 'true' : 'false'"
                        :data-variante="zeile.variante"
                        data-testid="medien-typbild-variante-zeile"
                        @click="emit('variante', zeile.variante)"
                    >
                        <span class="typbild-kasten__zeichen" aria-hidden="true">{{
                            zeile.aktuell === null ? "–" : "✓"
                        }}</span>
                        <span class="typbild-kasten__variante-text einzeilig">{{ zeile.text }}</span>
                    </button>
                </li>
            </ul>
        </div>

        <p class="typbild-kasten__geltung" data-testid="medien-typbild-geltung">
            <span v-if="slot.current !== null" class="typbild-kasten__stern" aria-hidden="true">★ </span>{{ geltung }}
        </p>
        <p class="typbild-kasten__satz" data-testid="medien-typbild-stand">{{ stand }}</p>
        <AvmHinweis v-if="unpassend !== undefined" ton="warnung" testid="medien-typbild-unpassend">{{
            unpassend
        }}</AvmHinweis>

        <div class="typbild-kasten__handlungen">
            <AvmKnopf groesse="zeile" :gesperrt="gesperrt" testid="medien-typbild-waehlen" @click="emit('waehlen')">{{
                t(slot.current === null ? "medien.typbild.kasten.waehlenNeu" : "medien.typbild.kasten.waehlen")
            }}</AvmKnopf>
            <AvmKnopf
                v-if="slot.current !== null && !fragt"
                art="gefahr"
                groesse="zeile"
                :gesperrt="loesenGesperrt"
                testid="medien-typbild-loesen"
                @click="fragt = true"
                >{{ t(`medien.typbild.kasten.loesen.${variante}`) }}</AvmKnopf
            >
        </div>
        <AvmBestaetigung
            v-if="fragt && slot.current !== null"
            :frage="t(`medien.typbild.kasten.loesenFrage.${variante}`, { label: eintrag.label })"
            :folge="t(`medien.typbild.kasten.loesenFolge.${variante}`)"
            :bestaetigen="t('medien.typbild.kasten.loesenKnopf')"
            :gesperrt="loesenGesperrt"
            testid="medien-typbild-loesen-frage"
            @bestaetigen="
                fragt = false;
                emit('loesen');
            "
            @abbrechen="fragt = false"
        />

        <div v-if="slot.formerItems.length > 0" class="typbild-kasten__frueher">
            <p class="typbild-kasten__frueher-titel">
                {{ t("medien.typbild.kasten.frueher", { n: zahl(slot.former) }) }}
            </p>
            <ul class="typbild-kasten__liste" data-testid="medien-typbild-frueher">
                <li v-for="alt in slot.formerItems" :key="`${alt.assetId}-${alt.retiredAt}`">
                    <button
                        type="button"
                        class="typbild-kasten__alt"
                        :data-asset="alt.assetId"
                        @click="emit('waehleAsset', alt.assetId)"
                    >
                        <span class="typbild-kasten__bild">
                            <img
                                v-if="alt.preview !== null"
                                :src="alt.preview.url"
                                :width="alt.preview.width"
                                :height="alt.preview.height"
                                alt=""
                                loading="lazy"
                                decoding="async"
                            />
                        </span>
                        <span class="typbild-kasten__alt-text einzeilig">{{
                            alt.title ?? t("medien.typbild.kasten.ohneTitel")
                        }}</span>
                        <span class="typbild-kasten__alt-zeit">{{ datum(alt.retiredAt) }}</span>
                    </button>
                </li>
            </ul>
        </div>
    </FensterKarte>
</template>

<style scoped>
.typbild-kasten__geltung {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.typbild-kasten__stern {
    color: var(--color-accent);
}

.typbild-kasten__satz,
.typbild-kasten__frueher-titel {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Das Paar: ein Satz, dann je Variante eine Zeile. Vollständig im Ton des Erfolgs, sonst im warmen Ton des Befunds (wie die Liste). */
.typbild-kasten__paar {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.typbild-kasten__paar-satz {
    margin: 0;
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-small);
}

.typbild-kasten__paar-satz.is-voll {
    color: var(--color-success-soft-text);
}

.typbild-kasten__handlungen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.typbild-kasten__frueher {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.typbild-kasten__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Eine Zeile wie jede Zeile des Hauses: durchsichtige Kante immer da, Hover- und Aktiv-Lasur, sichtbarer Fokus (Guide §30.5). */
.typbild-kasten__alt,
.typbild-kasten__variante {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: var(--space-6);
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
        border-color 120ms ease;
}

.typbild-kasten__alt:hover,
.typbild-kasten__variante:hover {
    background: var(--color-hover-wash);
}

.typbild-kasten__alt:active,
.typbild-kasten__variante:active {
    background: var(--color-active-wash);
}

.typbild-kasten__alt:focus-visible,
.typbild-kasten__variante:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* Die gezeigte Variante trägt die Kante der Wahl, wie eine gewählte Zeile der Liste. */
.typbild-kasten__variante.is-gewaehlt,
.typbild-kasten__variante.is-gewaehlt:hover {
    border-color: var(--color-accent);
    background: var(--color-active-wash);
}

.typbild-kasten__zeichen {
    flex: none;
    width: var(--space-12);
    color: var(--color-success-soft-text);
    font-size: var(--font-size-small);
    text-align: center;
}

.typbild-kasten__variante.is-fehlt .typbild-kasten__zeichen,
.typbild-kasten__variante.is-fehlt .typbild-kasten__variante-text {
    color: var(--color-warning-soft-text);
}

.typbild-kasten__variante-text {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--font-size-small);
}

.typbild-kasten__bild {
    display: grid;
    flex: none;
    place-items: center;
    overflow: hidden;
    width: var(--space-24);
    height: var(--space-24);
    border-radius: var(--radius-sm);
    background: var(--color-panel-soft);
}

.typbild-kasten__bild img {
    display: block;
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
}

.typbild-kasten__alt-text {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--font-size-small);
}

.typbild-kasten__alt-zeit {
    flex: none;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

@media (prefers-reduced-motion: reduce) {
    .typbild-kasten__alt,
    .typbild-kasten__variante {
        transition: none;
    }
}
</style>
