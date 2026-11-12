<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import AvmBildansicht from "../controls/avm-bildansicht.vue";
import { besucher as communityBesucher, ortAusAntwort } from "../community/community-besucher";
import type { BezugOrt } from "../community/meldung-modell";
import { t } from "../i18n/i18n";
import { fetchNearestPlace } from "../route-planner/route-client";
import type { ReisebildKarte } from "@avesmaps3d/shared";
import { ansichtZeile, ortBezug } from "./reisebild-ansicht-modell";
import ReisebildKiZeichen from "./reisebild-ki-zeichen.vue";
import { REISEBILD_SYMBOLE } from "./reisebild-zeichen";
import { reisebildGefaellt } from "./reisebild-gefaellt";
import { reisebilder } from "./reisebilder-zustand";

/**
 * Die Bildansicht der Reisebilder mit Nennung (WI-0272 S4, Aufgabe 30): `AvmBildansicht` (eine Bildansicht für alle) mit der Zeile der Reisebilder als Block unter dem Bild: Titel, „n von m“, die Nennung
 * („Bild von …“, hervorgehoben), Entstehung · Stelle · Blick, die Lizenz als Link, dazu „Zur Stelle“, „♥ Gefällt mir“ und „Melden“.
 *
 * - **Die Folge** (`liste`) wird beim Öffnen festgehalten: Verschiebt sich die Karte unter der Ansicht, blättert sie weiter in denselben Bildern (die Bilder bleiben im Schnappschuss, auch wenn die
 *   Antwort der Karte sie inzwischen nicht mehr trägt). Vorladen der Nachbarn macht die Bildansicht selbst.
 * - **Esc** verbraucht die Bildansicht selbst (sie schließt nur sich, die Leiste bleibt offen); die Karte hat dafür keine Regel.
 * - **Zur Stelle:** Ansicht zu, Leiste auf, das Bild markiert, die Kamera fliegt und der Ring pulst (`zeige`). **Melden:** Ansicht zu, das Meldeformular der Besucher mit der Stelle des Bildes.
 * - **Gefällt mir** (WI-0304) wie bei den Bewertungen: ein Knopf mit der Zahl, einmal je Browser, ein zweiter Klick nimmt es zurück (`reisebild-gefaellt.ts`). Gesperrt, solange der Aufruf zählt; scheitert er, steht ein Satz darunter.
 * - **Ein Bild ohne Ort** fragt einmal den nächsten Ort; scheitert das, fehlt der Teil „Stelle“.
 */
const { ansicht, bilder } = reisebilder;

/** Die Bilder der Folge, festgehalten: Neues kommt aus der Antwort der Karte hinzu, Gehaltenes bleibt. */
const schnappschuss = shallowRef<ReadonlyMap<string, ReisebildKarte>>(new Map());
watch(
    () => ansicht.value?.liste,
    (liste) => {
        if (liste === undefined) {
            schnappschuss.value = new Map();
            return;
        }
        const neu = new Map(schnappschuss.value);
        for (const bild of bilder.value) neu.set(bild.id, bild);
        schnappschuss.value = neu;
    },
    { immediate: true },
);

const folge = computed<readonly ReisebildKarte[]>(() => {
    const liste = ansicht.value?.liste ?? [];
    return liste.flatMap((id) => {
        const bild = schnappschuss.value.get(id);
        return bild === undefined ? [] : [bild];
    });
});

const stelle = computed<number | null>({
    get: () => {
        const offen = ansicht.value;
        if (offen === undefined) return null;
        const id = offen.liste[offen.stelle];
        const index = folge.value.findIndex((b) => b.id === id);
        return index < 0 ? null : index;
    },
    set: (neu) => {
        if (neu === null) {
            reisebilder.schliesseAnsicht();
            return;
        }
        const bild = folge.value[neu];
        if (bild !== undefined) reisebilder.oeffneAnsicht(bild.id, ansicht.value?.liste);
    },
});

const bilderAnsicht = computed(() =>
    folge.value.map((bild) => ({
        url: bild.datei.url,
        breite: bild.datei.breite,
        hoehe: bild.datei.hoehe,
        titel: bild.beschreibung,
    })),
);

/** Der nächste Ort je Bild ohne Ort, einmal gefragt; `null` heißt: gefragt, ohne Ergebnis. */
const naechste = ref<Record<string, BezugOrt | null>>({});
watch(
    () => (stelle.value === null ? undefined : folge.value[stelle.value]),
    async (bild) => {
        if (bild === undefined || bild.ort !== undefined || bild.id in naechste.value) return;
        naechste.value = { ...naechste.value, [bild.id]: null };
        try {
            const ort = ortAusAntwort(await fetchNearestPlace(bild.lage));
            if (ort !== undefined) naechste.value = { ...naechste.value, [bild.id]: ort };
        } catch {
            // Ohne den Ort fehlt der Teil „Stelle“.
        }
    },
    { immediate: true },
);

const zeile = (bild: ReisebildKarte): ReturnType<typeof ansichtZeile> =>
    ansichtZeile(bild, t, naechste.value[bild.id] ?? undefined);

/** Nur eine Adresse mit https wird zum Link. */
const sicherer = (uri: string | undefined): string | undefined =>
    uri !== undefined && /^https:\/\//u.test(uri) ? uri : undefined;

function zurStelle(bild: ReisebildKarte): void {
    reisebilder.schliesseAnsicht();
    reisebilder.setzeLeiste(true);
    reisebilder.markiere([bild.id]);
    reisebilder.zeige(bild.id);
}

function melden(bild: ReisebildKarte): void {
    reisebilder.schliesseAnsicht();
    communityBesucher.oeffneStelle(bild.lage, ortBezug(bild), bild.id);
}
</script>

<template>
    <AvmBildansicht
        v-if="ansicht !== undefined"
        v-model="stelle"
        :bilder="bilderAnsicht"
        block
        testid="reisebild-ansicht"
    >
        <template #zeile="{ stelle: nr, anzahl }">
            <div v-if="folge[nr]" class="reisebild-zeile">
                <div class="reisebild-zeile__kopf">
                    <span class="reisebild-zeile__titel" data-testid="reisebild-titel">{{
                        folge[nr].beschreibung
                    }}</span>
                    <span v-if="anzahl > 1" class="reisebild-zeile__stand" data-testid="reisebild-stand">{{
                        t("photobox.karte.von", { n: nr + 1, von: anzahl })
                    }}</span>
                </div>
                <div class="reisebild-zeile__nennung" data-testid="reisebild-nennung">
                    {{ zeile(folge[nr]).nennung }}
                </div>
                <div class="reisebild-zeile__mehr" data-testid="reisebild-mehr">
                    <template v-for="(teil, n) in zeile(folge[nr]).teile" :key="n">
                        <span v-if="n > 0" aria-hidden="true"> · </span>
                        <ReisebildKiZeichen v-if="folge[nr].entstehung === 'ai_generated' && n === 0" mit-text />
                        <span v-else class="reisebild-zeile__teil">{{ teil }}</span>
                    </template>
                    <template v-if="zeile(folge[nr]).lizenz !== undefined">
                        <span aria-hidden="true"> · </span>
                        <a
                            v-if="sicherer(zeile(folge[nr]).lizenz?.uri) !== undefined"
                            class="reisebild-zeile__lizenz"
                            :href="sicherer(zeile(folge[nr]).lizenz?.uri)"
                            target="_blank"
                            rel="noopener"
                            data-testid="reisebild-lizenz"
                            >{{ zeile(folge[nr]).lizenz?.text }}</a
                        >
                        <span v-else data-testid="reisebild-lizenz">{{ zeile(folge[nr]).lizenz?.text }}</span>
                    </template>
                </div>
                <div class="reisebild-zeile__taten">
                    <button
                        type="button"
                        class="reisebild-zeile__tat"
                        data-testid="reisebild-zur-stelle"
                        @click="zurStelle(folge[nr])"
                    >
                        <img :src="REISEBILD_SYMBOLE.pin" alt="" aria-hidden="true" />{{
                            t("photobox.karte.zurStelle")
                        }}
                    </button>
                    <button
                        type="button"
                        class="reisebild-zeile__tat reisebild-zeile__mag"
                        :class="{ 'is-an': reisebildGefaellt.gemocht.hat(folge[nr].id) }"
                        :aria-pressed="reisebildGefaellt.gemocht.hat(folge[nr].id)"
                        :title="
                            reisebildGefaellt.gemocht.hat(folge[nr].id)
                                ? t('photobox.karte.gefaelltZurueck')
                                : t('photobox.karte.gefaellt')
                        "
                        :disabled="reisebildGefaellt.zaehlt(folge[nr].id)"
                        data-testid="reisebild-gefaellt"
                        @click="void reisebildGefaellt.umschalten(folge[nr])"
                    >
                        <span class="reisebild-zeile__herz" aria-hidden="true">{{
                            reisebildGefaellt.gemocht.hat(folge[nr].id) ? "♥" : "♡"
                        }}</span
                        >{{ t("photobox.karte.gefaellt")
                        }}<template v-if="reisebildGefaellt.zahl(folge[nr]) > 0">
                            <span class="reisebild-zeile__zahl" data-testid="reisebild-gefaellt-zahl"
                                >({{ reisebildGefaellt.zahl(folge[nr]) }})</span
                            ></template
                        >
                    </button>
                    <button
                        type="button"
                        class="reisebild-zeile__tat"
                        data-testid="reisebild-melden"
                        @click="melden(folge[nr])"
                    >
                        <img src="/icons/context/brief.webp" alt="" aria-hidden="true" />{{
                            t("photobox.karte.melden")
                        }}
                    </button>
                </div>
                <div
                    v-if="reisebildGefaellt.problem(folge[nr].id) !== undefined"
                    class="reisebild-zeile__problem"
                    role="status"
                    data-testid="reisebild-gefaellt-problem"
                >
                    {{ reisebildGefaellt.problem(folge[nr].id) }}
                </div>
            </div>
        </template>
    </AvmBildansicht>
</template>

<style scoped>
.reisebild-zeile {
    display: grid;
    gap: var(--space-4);
    padding-top: var(--space-8);
}

.reisebild-zeile__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2) var(--space-12);
    font-size: var(--font-size-body);
}

.reisebild-zeile__stand {
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
}

/* Die Nennung gehört zum Bild: Rahmen und Schrift im Akzent (Probierseite, Nennung). */
.reisebild-zeile__nennung {
    justify-self: start;
    padding: var(--space-2) var(--space-8);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-sm);
    color: var(--color-accent);
    font-size: var(--font-size-small);
}

.reisebild-zeile__mehr {
    font-size: var(--font-size-caption);
    opacity: 0.85;
}

.reisebild-zeile__teil {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}

.reisebild-zeile__lizenz {
    color: inherit;
    text-decoration: underline;
}

.reisebild-zeile__taten {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-8);
    padding-top: var(--space-4);
}

/* Die Taten auf dem dunklen Grund der Bildansicht: runde Scheiben wie die Pfeile (Guide §16.1), Zustände nach §30.5. */
.reisebild-zeile__tat {
    display: inline-flex;
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-4) var(--space-12) var(--space-4) var(--space-8);
    border: 0;
    border-radius: 999px;
    background: var(--color-media-nav);
    color: var(--color-media-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    transition:
        background-color 120ms ease,
        box-shadow 120ms ease;
}

.reisebild-zeile__tat img {
    width: 1.5em;
    height: 1.5em;
    object-fit: contain;
}

.reisebild-zeile__tat:hover,
.reisebild-zeile__tat:active {
    background: var(--color-media-nav-hover);
}

/* „Gefällt mir“: aktiv (gesetzt) im Akzent mit Ring, gesperrt während des Zählens (Guide §30.5). */
.reisebild-zeile__mag {
    padding-left: var(--space-12);
}

.reisebild-zeile__herz {
    color: inherit;
    transition: color 120ms ease;
}

.reisebild-zeile__mag.is-an {
    box-shadow: inset 0 0 0 1px var(--color-accent);
}

.reisebild-zeile__mag.is-an .reisebild-zeile__herz {
    color: var(--color-accent);
}

.reisebild-zeile__zahl {
    margin-left: var(--space-4);
    font-variant-numeric: tabular-nums;
}

.reisebild-zeile__tat:disabled {
    cursor: progress;
    opacity: 0.7;
}

.reisebild-zeile__problem {
    font-size: var(--font-size-caption);
    color: var(--color-media-text);
}

.reisebild-zeile__tat:focus-visible {
    outline: none;
    background: var(--color-media-nav-hover);
    box-shadow: var(--focus-ring);
}

@media (prefers-reduced-motion: reduce) {
    .reisebild-zeile__tat,
    .reisebild-zeile__herz {
        transition: none;
    }
}
</style>
