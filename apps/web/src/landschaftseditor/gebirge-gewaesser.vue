<script setup lang="ts">
import { computed } from "vue";
import type { EditorGebirge, EditorGebirgeProfile } from "@avesmaps3d/shared";
import { formatNumber, t } from "../i18n/i18n";
import { anteilDrin, durchquert, flaechenRahmen, ganzDrin, rahmen } from "./gebirge-gewaesser";
import GebirgeProfil from "./gebirge-profil.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import type { GebirgsNetz } from "./kamm-netz";
import { kammNetzProfil } from "./kamm-netz-profil";

/**
 * „Flüsse und Seen“ und „Gebirgspässe“ im Reiter „Gebirge“ (WI-0245, Lücke e zum Entwurf V16/V17): was die Eingabe der Vorschau trägt,
 * je Eintrag mit Art, ⌖ (die Kamera fliegt hin) und einem Satz: wie viel des Flusses in der Fläche liegt und welche Seen er durchquert,
 * ob ein See ganz drin liegt, wie viel eines Passes. Die Pässe trägt die Eingabe nur an Gebirgen mit gezeichneten Kämmen (sie wirken nur
 * im Rückennetz); ohne Pässe fehlt der Abschnitt. Flüsse und Pässe tragen ihr Höhenprofil (`gebirge-profil.vue`), sobald es geladen ist.
 *
 * WI-0259 (OPS-071): Das Profil eines Flusses zeigt die eigenen Höhen aus dem Netz im Entwurf (`netz`) und bekommt, solange „Kämme zeichnen“
 * an diesem Gebirge läuft (`kaemmeLaufen`), den Zugriff auf den laufenden Kammeditor (`kamm-netz-profil.ts`): Griffe, Auswahl, derselbe Entwurf.
 */
const props = defineProps<{
    eingabe: EditorGebirge["eingabe"];
    /** Die Höhenprofile (gleiche Folge wie die Eingabe); ohne sie stehen die Einträge ohne Kurve. */
    profile?: EditorGebirgeProfile | undefined;
    /** Kammhöhe (gestrichelt am Pass) und Name des Gebirges („in …“). */
    kamm?: number | undefined;
    name?: string | undefined;
    kennung: string;
    /** Das Netz im Entwurf: Die eigenen Höhen der Flüsse und Seen zeigt das Profil (WI-0259). */
    netz?: GebirgsNetz | undefined;
    /** Läuft „Kämme zeichnen“ an diesem Gebirge? Dann hat das Profil Griffe und ist doppelt so hoch. */
    kaemmeLaufen?: boolean | undefined;
}>();
/** Der Zugriff auf den laufenden Kammeditor, nur solange er an diesem Gebirge läuft. */
const steuerung = computed(() => (props.kaemmeLaufen === true ? kammNetzProfil.value : undefined));
const emit = defineEmits<{
    fliege: [bounds: [number, number, number, number]];
    /** Der Name als Link zum Objekt: Fluss und Pass öffnen ihren Weg, der See seine Landschaft. */
    oeffne: [art: "weg" | "landschaft", id: string];
}>();
/** Der Name des Kreises für Vorleser, aus der Legende der Listen. */
const KREIS_NAME = {
    leer: "editorListe.kreis.leer",
    halb: "editorListe.kreis.halb",
    "halb-rechts": "editorListe.kreis.halbRechts",
    voll: "editorListe.kreis.voll",
} as const;

const prozent = (anteil: number): string => formatNumber(Math.round(anteil * 100), 0);

const fluesse = computed(() =>
    props.eingabe.fluesse.map((fluss, i) => {
        const durchquerte = props.eingabe.seen.filter((see) => durchquert(fluss.p, see.g));
        const seen = durchquerte.map((see) => see.n);
        return {
            schluessel: `f${String(i)}`,
            nr: i,
            name: fluss.n,
            art: t(
                fluss.bach ? "landschaftseditor.gebirge.gewaesser.bach" : "landschaftseditor.gebirge.gewaesser.fluss",
            ),
            satz: [
                t("landschaftseditor.gebirge.gewaesser.anteil", {
                    p: prozent(anteilDrin(fluss.p, props.eingabe.geometry)),
                }),
                seen.length === 0
                    ? t("landschaftseditor.gebirge.gewaesser.keinSee")
                    : t("landschaftseditor.gebirge.gewaesser.durchquert", { seen: seen.join(", ") }),
            ].join(" · "),
            bounds: rahmen(fluss.p),
            linie: fluss.p,
            seen: durchquerte.map((see) => see.g),
            profil: props.profile?.fluesse[i] ?? null,
            objekt: props.profile?.objekte.fluesse[i] ?? null,
            objektArt: "weg" as const,
        };
    }),
);
const seen = computed(() =>
    props.eingabe.seen.map((see, i) => {
        const durch = props.eingabe.fluesse.filter((fluss) => durchquert(fluss.p, see.g)).map((fluss) => fluss.n);
        return {
            schluessel: `s${String(i)}`,
            nr: i,
            name: see.n,
            art: t("landschaftseditor.gebirge.gewaesser.see"),
            satz: [
                t(
                    ganzDrin(see.g, props.eingabe.geometry)
                        ? "landschaftseditor.gebirge.gewaesser.ganzDrin"
                        : "landschaftseditor.gebirge.gewaesser.ragtHinein",
                ),
                durch.length === 0
                    ? t("landschaftseditor.gebirge.gewaesser.keinFluss")
                    : t("landschaftseditor.gebirge.gewaesser.durchflossen", { fluesse: durch.join(", ") }),
            ].join(" · "),
            bounds: flaechenRahmen(see.g),
            linie: undefined,
            seen: [],
            profil: null,
            objekt: props.profile?.objekte.seen[i] ?? null,
            objektArt: "landschaft" as const,
        };
    }),
);
const gewaesser = computed(() => [...fluesse.value, ...seen.value]);
const paesse = computed(() =>
    (props.eingabe.paesse ?? []).map((pass, i) => ({
        schluessel: pass.id ?? `p${String(i)}`,
        name: pass.name ?? t("landschaftseditor.gebirge.paesse.ohneName"),
        art: t("landschaftseditor.gebirge.paesse.art"),
        satz: t("landschaftseditor.gebirge.paesse.anteil", {
            p: prozent(anteilDrin(pass.punkte, props.eingabe.geometry)),
        }),
        bounds: rahmen(pass.punkte),
        linie: pass.punkte,
        profil: props.profile?.paesse[i] ?? null,
        objekt: props.profile?.objekte.paesse[i] ?? null,
        objektArt: "weg" as const,
    })),
);
</script>

<template>
    <section class="gewaesser" :data-testid="`${kennung}-gebirge-gewaesser`">
        <h4 class="gewaesser__titel">
            {{ t("landschaftseditor.gebirge.gewaesser.titel", { n: formatNumber(gewaesser.length, 0) }) }}
        </h4>
        <ul v-if="gewaesser.length > 0" class="gewaesser__liste">
            <li v-for="eintrag in gewaesser" :key="eintrag.schluessel" class="gewaesser__eintrag">
                <span class="gewaesser__kopf">
                    <AvmKreis
                        v-if="eintrag.objekt"
                        :fuellung="eintrag.objekt.kreis"
                        :name="t(KREIS_NAME[eintrag.objekt.kreis])"
                    />
                    <button
                        v-if="eintrag.objekt"
                        type="button"
                        class="gewaesser__name gewaesser__link"
                        :title="t('landschaftseditor.gebirge.gipfel.oeffnen', { name: eintrag.name })"
                        :data-testid="`${kennung}-gebirge-objekt-${eintrag.schluessel}`"
                        @click="emit('oeffne', eintrag.objektArt, eintrag.objekt.id)"
                    >
                        {{ eintrag.name }}
                    </button>
                    <span v-else class="gewaesser__name">{{ eintrag.name }}</span>
                    <small class="gewaesser__art">{{ eintrag.art }}</small>
                    <button
                        type="button"
                        class="gewaesser__ziel"
                        :title="t('landschaftseditor.gebirge.gewaesser.ziel', { name: eintrag.name })"
                        :aria-label="t('landschaftseditor.gebirge.gewaesser.ziel', { name: eintrag.name })"
                        :data-testid="`${kennung}-gebirge-gewaesser-${eintrag.schluessel}-ziel`"
                        @click="emit('fliege', eintrag.bounds)"
                    >
                        ⌖
                    </button>
                </span>
                <small class="gewaesser__satz">{{ eintrag.satz }}</small>
                <GebirgeProfil
                    v-if="eintrag.profil && eintrag.linie"
                    art="fluss"
                    :linie="eintrag.linie"
                    :profil="eintrag.profil"
                    :flaeche="eingabe.geometry"
                    :name="name"
                    :kamm="kamm"
                    :seen="eintrag.seen"
                    :fluss-nr="eintrag.nr"
                    :eingabe="eingabe"
                    :netz="netz"
                    :steuerung="steuerung"
                />
            </li>
        </ul>
        <p v-if="profile && !profile.verfuegbar" class="gewaesser__hinweis">
            {{ t("landschaftseditor.gebirge.profil.ohne") }}
        </p>
        <p class="gewaesser__hinweis">
            {{
                t(
                    gewaesser.length > 0
                        ? "landschaftseditor.gebirge.gewaesser.hinweis"
                        : "landschaftseditor.gebirge.gewaesser.leer",
                )
            }}
        </p>
    </section>
    <section v-if="paesse.length > 0" class="gewaesser" :data-testid="`${kennung}-gebirge-paesse`">
        <h4 class="gewaesser__titel">
            {{ t("landschaftseditor.gebirge.paesse.titel", { n: formatNumber(paesse.length, 0) }) }}
        </h4>
        <ul class="gewaesser__liste">
            <li v-for="eintrag in paesse" :key="eintrag.schluessel" class="gewaesser__eintrag">
                <span class="gewaesser__kopf">
                    <AvmKreis
                        v-if="eintrag.objekt"
                        :fuellung="eintrag.objekt.kreis"
                        :name="t(KREIS_NAME[eintrag.objekt.kreis])"
                    />
                    <button
                        v-if="eintrag.objekt"
                        type="button"
                        class="gewaesser__name gewaesser__link"
                        :title="t('landschaftseditor.gebirge.gipfel.oeffnen', { name: eintrag.name })"
                        :data-testid="`${kennung}-gebirge-objekt-${eintrag.schluessel}`"
                        @click="emit('oeffne', eintrag.objektArt, eintrag.objekt.id)"
                    >
                        {{ eintrag.name }}
                    </button>
                    <span v-else class="gewaesser__name">{{ eintrag.name }}</span>
                    <small class="gewaesser__art">{{ eintrag.art }}</small>
                    <button
                        type="button"
                        class="gewaesser__ziel"
                        :title="t('landschaftseditor.gebirge.gewaesser.ziel', { name: eintrag.name })"
                        :aria-label="t('landschaftseditor.gebirge.gewaesser.ziel', { name: eintrag.name })"
                        :data-testid="`${kennung}-gebirge-paesse-${eintrag.schluessel}-ziel`"
                        @click="emit('fliege', eintrag.bounds)"
                    >
                        ⌖
                    </button>
                </span>
                <small class="gewaesser__satz">{{ eintrag.satz }}</small>
                <GebirgeProfil
                    v-if="eintrag.profil && eintrag.linie"
                    art="pass"
                    :linie="eintrag.linie"
                    :profil="eintrag.profil"
                    :flaeche="eingabe.geometry"
                    :name="name"
                    :kamm="kamm"
                />
            </li>
        </ul>
    </section>
</template>

<style scoped>
/* Wie die Kästen des Reiters (`.gebirge__kasten`, `.gebirge__titel`). */
.gewaesser {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.gewaesser__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.gewaesser__liste {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
}

.gewaesser__eintrag {
    display: grid;
    gap: var(--space-2);
}

.gewaesser__kopf {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
}

.gewaesser__name {
    flex: 1;
    color: var(--color-text-strong);
}

.gewaesser__link {
    padding: 0;
    border: none;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-align: left;
}

.gewaesser__link:hover {
    text-decoration: underline;
}

.gewaesser__link:focus-visible {
    outline: 2px solid var(--color-accent-brown);
    outline-offset: 1px;
}

.gewaesser__art,
.gewaesser__satz,
.gewaesser__hinweis {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.gewaesser__hinweis {
    margin: 0;
}

.gewaesser__ziel {
    padding: 0 var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-accent-brown);
    cursor: pointer;
    font: inherit;
    transition: border-color 120ms;
}

.gewaesser__ziel:hover {
    border-color: var(--color-accent-brown);
}

.gewaesser__ziel:focus-visible {
    outline: 2px solid var(--color-accent-brown);
    outline-offset: 1px;
}
</style>
