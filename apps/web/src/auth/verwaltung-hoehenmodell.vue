<script setup lang="ts">
/**
 * Der Eintrag „Höhenmodell“ der Systemsteuerung (WI-0127 SYS-13, SYS-0001 §9c; Blatt `review/wi-0127/sys-13-blatt-1.png`). Was die
 * Oberfläche rechnet, steht in `hoehenmodell.ts`; hier steht nur, wie es aussieht.
 *
 * - Oben der Hinweis, was das Höhenmodell ist und was ein Wechsel kostet.
 * - **Fassungen und Entwürfe** ganz oben (Betreiber 2026-10-20: „Fassungen ganz nach oben“), in Legacys Listenform: Name mit Kreis
 *   (○ ◐ ●) und Pille „gilt“, darunter Rückverteilung und Abnahme, darunter, was die Fassung bedeutet; rechts die Handlung. Ein Klick auf
 *   den Namen wählt die Zeile; ihre Werte stehen weiter unten.
 * - **Karte „Gültig“** mit dem Zustand rechts (`AvmStatus`): eingestellt, wirksam, Höhenlinien als Feldzeilen wie im Betriebszustand,
 *   die laufende Kette und „↺ Zurück auf Fassung N“ mit der Bestätigung an Ort und Stelle. Die Gipfel unter der Grundhöhe zeigt die Seite
 *   nicht mehr (Betreiber 2026-10-20: „kannst du weglassen, die sind nicht wichtig“); der Server misst sie weiter.
 * - **Werte** der gewählten Zeile: Rückverteilung, die einstellbaren Regler (im Entwurf „neu statt alt“), die Tafel je Landschaftsart und
 *   wie viele Werte nur lesbar bleiben.
 * - **Telefon:** Feldzeilen untereinander, die Knöpfe nehmen die ganze Breite.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { HOEHENMODELL_REGLER } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmStatus from "../controls/avm-status.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import FensterTafel from "../fenster/fenster-tafel.vue";
import { t } from "../i18n/i18n";
import {
    neuRechnenSperre,
    aktivierenSperre,
    entwurfUnter,
    fassung,
    fassungName,
    fassungNummer,
    fassungUnter,
    fassungWas,
    formularAenderungen,
    formularSperre,
    gueltigFelder,
    gueltigZustand,
    ketteSatz,
    landschaftName,
    messenSperre,
    messungSatz,
    nurLesenSatz,
    reglerName,
    zahl,
    type Hoehenmodell,
} from "./hoehenmodell";
import { abnehmenSperre, testUnter } from "./hoehenmodell-test";
import { authState } from "./session-state";
import VerwaltungBetriebFrage from "./verwaltung-betrieb-frage.vue";
import VerwaltungHoehenmodellTest from "./verwaltung-hoehenmodell-test.vue";
import VerwaltungLadeproblem from "./verwaltung-ladeproblem.vue";
import VerwaltungMeldung from "./verwaltung-meldung.vue";

const props = defineProps<{
    hoehenmodell: Hoehenmodell;
    telefon: boolean;
}>();

const darf = authState.value.capabilities.includes("manage_terrain_recipe");
const h = props.hoehenmodell;

const jetzt = ref(new Date());
let uhr: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
    uhr = setInterval(() => (jetzt.value = new Date()), 15_000);
    h.follow(true);
    void h.load();
});
onUnmounted(() => {
    if (uhr !== undefined) clearInterval(uhr);
    h.follow(false);
});

const stand = computed(() => h.stand.value);
const KREISE = ["leer", "halb", "voll"] as const;

const gueltig = computed(() => {
    const s = stand.value;
    if (s === null) return null;
    return {
        zustand: gueltigZustand(s),
        felder: gueltigFelder(s, jetzt.value),
        kette: ketteSatz(s),
        unbekannt: s.eingestellt.unbekannt,
        rueckweg: s.rueckweg,
    };
});

const fassungen = computed(() => {
    const s = stand.value;
    if (s === null) return [];
    return [...s.fassungen].reverse().map((entry) => ({
        entry,
        name: fassungName(entry, s),
        // Die offene Fassung nennt ihre Testwerte (WI-0240).
        unter:
            s.test?.version === entry.version
                ? `${fassungUnter(entry, jetzt.value)} · ${testUnter(s.test)}`
                : fassungUnter(entry, jetzt.value),
        was: fassungWas(entry),
        sperre: aktivierenSperre(s, entry, darf),
        // Abnehmen nur, wo sie noch fehlt (◐), und nur mit dem Recht; auf Production gibt es keine eigene Abnahme (Frage 5 B).
        abnehmen: darf && entry.kreis === "halb" && s.profil === "voll",
        // An der offenen Fassung erst nach dem Speichern und wenn die Kette mit ihr fertig ist (WI-0240).
        abnehmenSperre: s.test?.version === entry.version ? abnehmenSperre(s, h.test.value.felder) : undefined,
        test: s.test?.version === entry.version,
        gewaehlt: h.zeile.value?.art === "fassung" && h.zeile.value.version === entry.version,
    }));
});

const entwuerfe = computed(() => {
    const s = stand.value;
    if (s === null) return [];
    return s.entwuerfe.map((entry) => ({
        entry,
        unter: entwurfUnter(entry, fassung(s, entry.basis), jetzt.value),
        messung: messungSatz(entry.messung),
        sperre: messenSperre(s, entry, darf),
        gewaehlt: h.zeile.value?.art === "entwurf" && h.zeile.value.id === entry.id,
    }));
});

/** Die gewählte Zeile ist die offene Fassung: Ihre Werte sind einstellbar (WI-0240). */
const testFassung = computed(() => {
    const s = stand.value;
    const z = h.zeile.value;
    if (s === null || s.test === undefined || z?.art !== "fassung" || z.version !== s.test.version) return null;
    return fassung(s, z.version) ?? null;
});

/** Die Werte der gewählten Zeile: eine Fassung oder ein Entwurf über seiner Basis. */
const werte = computed(() => {
    const s = stand.value;
    const z = h.zeile.value;
    if (s === null || z === null || testFassung.value !== null) return null;
    const entwurf = z.art === "entwurf" ? s.entwuerfe.find((entry) => entry.id === z.id) : undefined;
    const basis = fassung(s, z.art === "fassung" ? z.version : (entwurf?.basis ?? s.eingestellt.version));
    if (basis === undefined) return null;
    const regler = HOEHENMODELL_REGLER.map((r) => {
        const alt = basis.regler[r.id] ?? null;
        const neu = entwurf?.aenderungen[r.id];
        return {
            id: r.id,
            name: reglerName(r.id),
            wert:
                neu === undefined || neu === null
                    ? zahl(alt)
                    : t("admin.terrain.changeValue", { neu: zahl(neu), alt: zahl(alt) }),
            geaendert: neu !== undefined && neu !== null,
            regional: r.nurRegional,
        };
    });
    return {
        titel:
            entwurf === undefined
                ? t("admin.terrain.values", { n: basis.version })
                : t("admin.terrain.valuesDraft", { n: basis.version }),
        art: t(basis.regional ? "admin.terrain.upliftKind.regional" : "admin.terrain.upliftKind.global"),
        verteilung: regler.filter((r) => r.regional && basis.regional),
        global: regler.filter((r) => !r.regional),
        landschaften: basis.landschaften,
        rest: Math.max(
            0,
            basis.werte - Object.values(basis.regler).filter((v) => v !== null).length - basis.landschaften.length * 5,
        ),
    };
});

const formular = computed(() => {
    const s = stand.value;
    const f = h.formular.value;
    const basis = s === null || f === null ? undefined : fassung(s, f.basis);
    if (f === null || basis === undefined) return null;
    const { probleme } = formularAenderungen(f, basis);
    const sperre = formularSperre(f, basis);
    return {
        f,
        basis,
        felder: HOEHENMODELL_REGLER.map((r) => ({
            id: r.id,
            name: reglerName(r.id),
            vorgabe: zahl(basis.regler[r.id] ?? null),
            gesperrt: r.nurRegional && !basis.regional ? t("admin.terrain.invalid.regional") : undefined,
            problem: probleme[r.id],
        })),
        sperre: h.busy.value ? "" : sperre === undefined ? undefined : t(sperre),
    };
});

/** Die gewählte Fassung für „⊕ Neuer Entwurf“; aus einem gewählten Entwurf dessen Basis. */
const entwurfBasis = computed(() => {
    const s = stand.value;
    const z = h.zeile.value;
    if (s === null) return null;
    if (z?.art === "entwurf") return s.entwuerfe.find((entry) => entry.id === z.id)?.basis ?? null;
    return z?.version ?? s.eingestellt.version;
});

const meldung = (ort: string) => {
    const letzte = h.ergebnis.value;
    return letzte !== null && letzte.ort === ort ? letzte.result : undefined;
};
const frageFuer = (art: "waehlen" | "abnehmen", version: number) => {
    const f = h.frage.value;
    return f !== null && f.art === art && f.version === version ? f : null;
};
const verwerfenOffen = (draft: string) => {
    const f = h.frage.value;
    return f !== null && f.art === "verwerfen" && f.draft === draft;
};
const zurueckOffen = computed(() => h.frage.value?.art === "zurueck");
/** Was die Abnahme nach sich zieht; an der offenen Fassung dazu, dass ihre Testwerte feststehen (WI-0240). */
function abnehmenFolge(offen: boolean): string {
    const test = stand.value?.test;
    if (!offen || test === undefined) return t("admin.terrain.acceptFollows");
    const datei = `${String(test.version)}.json`;
    return `${t("admin.terrain.acceptFollows")} ${t("admin.terrain.test.acceptFollows", { r: test.revision, datei })}`;
}
const neuRechnenOffen = computed(() => h.frage.value?.art === "neuRechnen");
</script>

<template>
    <div class="hoehenmodell" :class="{ 'hoehenmodell--telefon': props.telefon }" data-testid="hoehenmodell">
        <AvmHinweis testid="hoehenmodell-hinweis">
            <strong class="hoehenmodell__erst">{{ t("admin.terrain.introFirst") }}</strong>
            {{ t("admin.terrain.intro") }}
        </AvmHinweis>
        <VerwaltungLadeproblem
            :problems="h.loadProblems.value"
            :fehlt="h.unconfirmed.value"
            testid="hoehenmodell-ladefehler"
            @bestaetigen="h.confirmAgain()"
            ><span class="hoehenmodell__block">{{ t("admin.terrain.loadFailed") }}</span></VerwaltungLadeproblem
        >
        <p v-if="stand === null && h.loading.value" class="hoehenmodell__leise">{{ t("admin.loading") }}</p>
        <p v-if="stand !== null && !darf" class="hoehenmodell__leise" data-testid="hoehenmodell-nur-lesen">
            {{ nurLesenSatz() }}
        </p>

        <template v-if="stand !== null && gueltig !== null">
            <!-- Die Fassungen ganz oben (Betreiber 2026-10-20: „Fassungen ganz nach oben“). -->
            <div class="hoehenmodell__kopf">
                <h3 class="hoehenmodell__titel">{{ t("admin.terrain.versions") }}</h3>
                <AvmKnopf
                    v-if="darf && entwurfBasis !== null && h.formular.value === null"
                    art="weich"
                    groesse="zeile"
                    :gesperrt="h.busy.value ? '' : undefined"
                    testid="hoehenmodell-neu"
                    @click="h.neuerEntwurf(entwurfBasis)"
                    ><span aria-hidden="true">⊕ </span>{{ t("admin.terrain.newDraft", { n: entwurfBasis }) }}</AvmKnopf
                >
            </div>

            <FensterKarte
                v-if="formular !== null"
                :titel="t('admin.terrain.newDraft', { n: formular.basis.version })"
                data-testid="hoehenmodell-formular"
            >
                <p class="hoehenmodell__leise">{{ t("admin.terrain.formHint") }}</p>
                <div class="hoehenmodell__regler">
                    <label v-for="feld in formular.felder" :key="feld.id" class="hoehenmodell__regel">
                        <span class="hoehenmodell__regel-name">{{ feld.name }}</span>
                        <AvmEingabe
                            v-model="formular.f.werte[feld.id]"
                            :placeholder="feld.vorgabe"
                            :gesperrt="feld.gesperrt"
                            :ungueltig="feld.problem !== undefined"
                            inputmode="decimal"
                            autocomplete="off"
                            :testid="`hoehenmodell-regler-${feld.id}`"
                        />
                        <span v-if="feld.problem !== undefined" class="hoehenmodell__warnung">{{ feld.problem }}</span>
                    </label>
                </div>
                <label class="hoehenmodell__regel">
                    <span class="hoehenmodell__regel-name">{{ t("admin.system.ask.reason") }}</span>
                    <AvmEingabe
                        v-model="formular.f.grund"
                        :placeholder="t('admin.system.ask.reasonHint')"
                        autocomplete="off"
                        testid="hoehenmodell-formular-grund"
                    />
                </label>
                <div class="hoehenmodell__knoepfe">
                    <AvmKnopf
                        art="gefuellt"
                        groesse="zeile"
                        :gesperrt="formular.sperre"
                        :breit="props.telefon"
                        testid="hoehenmodell-anlegen"
                        @click="h.anlegen()"
                        >{{ t("admin.terrain.create") }}</AvmKnopf
                    >
                    <AvmKnopf
                        art="weich"
                        groesse="zeile"
                        :breit="props.telefon"
                        testid="hoehenmodell-formular-abbrechen"
                        @click="h.verwirfFormular()"
                        >{{ t("ui.confirm.cancel") }}</AvmKnopf
                    >
                </div>
                <VerwaltungMeldung :ergebnis="meldung('formular')" testid="hoehenmodell-meldung-formular" />
            </FensterKarte>

            <ul class="hoehenmodell__liste" :aria-label="t('admin.terrain.versions')" data-testid="hoehenmodell-liste">
                <li
                    v-for="zeile in fassungen"
                    :key="`f${zeile.entry.version}`"
                    class="hoehenmodell__zeile"
                    :class="{ 'is-gewaehlt': zeile.gewaehlt }"
                    :data-testid="`hoehenmodell-fassung-${zeile.entry.version}`"
                >
                    <div class="hoehenmodell__zeile-inhalt">
                        <button
                            type="button"
                            class="hoehenmodell__name"
                            :aria-pressed="zeile.gewaehlt"
                            @click="h.waehle({ art: 'fassung', version: zeile.entry.version })"
                        >
                            <span>{{ zeile.name }}</span>
                            <AvmKreis
                                :fuellung="zeile.entry.kreis"
                                :name="t(`admin.terrain.circle.${zeile.entry.kreis}`)"
                            />
                            <AvmPille v-if="zeile.entry.gilt" ton="erfolg" testid="hoehenmodell-gilt">{{
                                t("admin.terrain.valid")
                            }}</AvmPille>
                        </button>
                        <span class="hoehenmodell__unter">{{ zeile.unter }}</span>
                        <span class="hoehenmodell__was">{{ zeile.was }}</span>
                    </div>
                    <div class="hoehenmodell__handlung">
                        <AvmKnopf
                            v-if="zeile.abnehmen"
                            art="weich"
                            groesse="zeile"
                            :gesperrt="h.busy.value ? '' : zeile.abnehmenSperre"
                            :breit="props.telefon"
                            :testid="`hoehenmodell-abnehmen-${zeile.entry.version}`"
                            @click="h.ask({ art: 'abnehmen', version: zeile.entry.version })"
                            ><span aria-hidden="true">● </span>{{ t("admin.terrain.accept") }}</AvmKnopf
                        >
                        <AvmKnopf
                            art="weich"
                            groesse="zeile"
                            :gesperrt="h.busy.value ? '' : zeile.sperre"
                            :breit="props.telefon"
                            :testid="`hoehenmodell-aktivieren-${zeile.entry.version}`"
                            @click="h.ask({ art: 'waehlen', version: zeile.entry.version })"
                            >{{ t("admin.terrain.activate") }}</AvmKnopf
                        >
                    </div>
                    <VerwaltungBetriebFrage
                        v-if="frageFuer('waehlen', zeile.entry.version) !== null"
                        v-model:grund="h.grund.value"
                        class="hoehenmodell__frage"
                        :frage="t('admin.terrain.activateAsk', { n: fassungNummer(stand, zeile.entry.version) })"
                        :folge="t('admin.terrain.activateFollows', { n: zeile.entry.version })"
                        :bestaetigen="t('admin.terrain.activate')"
                        :pflicht="true"
                        :busy="h.busy.value"
                        :testid="`hoehenmodell-frage-${zeile.entry.version}`"
                        @bestaetigen="h.confirm()"
                        @abbrechen="h.cancel()"
                    />
                    <VerwaltungBetriebFrage
                        v-if="frageFuer('abnehmen', zeile.entry.version) !== null"
                        v-model:grund="h.grund.value"
                        class="hoehenmodell__frage"
                        :frage="t('admin.terrain.acceptAsk', { n: fassungNummer(stand, zeile.entry.version) })"
                        :folge="abnehmenFolge(zeile.test)"
                        :bestaetigen="t('admin.terrain.accept')"
                        :pflicht="true"
                        :busy="h.busy.value"
                        :testid="`hoehenmodell-frage-abnehmen-${zeile.entry.version}`"
                        @bestaetigen="h.confirm()"
                        @abbrechen="h.cancel()"
                    />
                    <VerwaltungMeldung
                        class="hoehenmodell__frage"
                        :ergebnis="meldung(`fassung:${zeile.entry.version}`)"
                        :testid="`hoehenmodell-meldung-${zeile.entry.version}`"
                    />
                </li>
                <li
                    v-for="zeile in entwuerfe"
                    :key="zeile.entry.id"
                    class="hoehenmodell__zeile"
                    :class="{ 'is-gewaehlt': zeile.gewaehlt }"
                    data-testid="hoehenmodell-entwurf"
                >
                    <div class="hoehenmodell__zeile-inhalt">
                        <button
                            type="button"
                            class="hoehenmodell__name"
                            :aria-pressed="zeile.gewaehlt"
                            @click="h.waehle({ art: 'entwurf', id: zeile.entry.id })"
                        >
                            <span>{{ t("admin.terrain.draft", { n: zeile.entry.basis }) }}</span>
                            <AvmKreis
                                :fuellung="zeile.entry.kreis"
                                :name="t(`admin.terrain.circle.${zeile.entry.kreis}`)"
                            />
                        </button>
                        <span class="hoehenmodell__unter">{{ zeile.unter }}</span>
                        <span
                            class="hoehenmodell__was"
                            :class="`hoehenmodell__was--${zeile.messung.ton}`"
                            role="status"
                            data-testid="hoehenmodell-messung"
                            >{{ zeile.messung.text }}</span
                        >
                    </div>
                    <div class="hoehenmodell__handlung">
                        <AvmKnopf
                            art="weich"
                            groesse="zeile"
                            :gesperrt="h.busy.value ? '' : zeile.sperre"
                            :breit="props.telefon"
                            testid="hoehenmodell-messen"
                            @click="h.messen(zeile.entry.id)"
                            ><span aria-hidden="true">⇄ </span>{{ t("admin.terrain.measure") }}</AvmKnopf
                        >
                        <AvmKnopf
                            v-if="darf"
                            art="weich"
                            groesse="zeile"
                            :gesperrt="h.busy.value ? '' : undefined"
                            :breit="props.telefon"
                            testid="hoehenmodell-verwerfen"
                            @click="h.ask({ art: 'verwerfen', draft: zeile.entry.id })"
                            ><span aria-hidden="true">⊖ </span>{{ t("admin.terrain.discard") }}</AvmKnopf
                        >
                    </div>
                    <AvmBestaetigung
                        v-if="verwerfenOffen(zeile.entry.id)"
                        class="hoehenmodell__frage"
                        :frage="t('admin.terrain.discardAsk')"
                        :folge="t('admin.terrain.discardFollows')"
                        :bestaetigen="t('admin.terrain.discard')"
                        :gesperrt="h.busy.value ? '' : undefined"
                        testid="hoehenmodell-frage-verwerfen"
                        @bestaetigen="h.confirm()"
                        @abbrechen="h.cancel()"
                    />
                    <VerwaltungMeldung
                        class="hoehenmodell__frage"
                        :ergebnis="meldung(`entwurf:${zeile.entry.id}`)"
                        testid="hoehenmodell-meldung-entwurf"
                    />
                </li>
            </ul>
            <p class="hoehenmodell__legende" data-testid="hoehenmodell-legende">
                <span v-for="kreis in KREISE" :key="kreis" class="hoehenmodell__legende-teil">
                    <AvmKreis :fuellung="kreis" :name="t(`admin.terrain.circle.${kreis}`)" />{{
                        t(`admin.terrain.circle.${kreis}`)
                    }}
                </span>
            </p>

            <FensterKarte :titel="t('admin.terrain.card.valid')" data-testid="hoehenmodell-gueltig">
                <template #etikett>
                    <AvmStatus
                        class="hoehenmodell__zustand"
                        :ton="gueltig.zustand.ton"
                        :text="gueltig.zustand.text"
                        testid="hoehenmodell-zustand"
                    />
                </template>
                <dl class="hoehenmodell__felder">
                    <template v-for="feld in gueltig.felder" :key="feld.id">
                        <dt>{{ feld.name }}</dt>
                        <dd :data-testid="`hoehenmodell-${feld.id}`">
                            <AvmStatus v-if="feld.ton !== null" :ton="feld.ton" :text="feld.wert" />
                            <template v-else>{{ feld.wert }}</template>
                        </dd>
                    </template>
                </dl>
                <p v-if="gueltig.unbekannt !== null" class="hoehenmodell__warnung" data-testid="hoehenmodell-unbekannt">
                    {{ t("admin.terrain.unknownChosen", { n: gueltig.unbekannt }) }}
                </p>
                <p
                    v-if="gueltig.kette !== null"
                    class="hoehenmodell__leise"
                    role="status"
                    data-testid="hoehenmodell-kette"
                >
                    {{ gueltig.kette }}
                </p>
                <div v-if="gueltig.rueckweg !== null" class="hoehenmodell__zurueck">
                    <AvmKnopf
                        art="weich"
                        groesse="zeile"
                        :gesperrt="!darf || h.busy.value || zurueckOffen ? '' : undefined"
                        :breit="props.telefon"
                        testid="hoehenmodell-zurueck"
                        @click="h.ask({ art: 'zurueck', version: gueltig.rueckweg })"
                        ><span aria-hidden="true">↺ </span
                        >{{ t("admin.terrain.back", { n: gueltig.rueckweg }) }}</AvmKnopf
                    >
                    <span class="hoehenmodell__leise">{{
                        t("admin.terrain.backHint", { n: stand.eingestellt.version })
                    }}</span>
                </div>
                <VerwaltungBetriebFrage
                    v-if="zurueckOffen && gueltig.rueckweg !== null"
                    v-model:grund="h.grund.value"
                    :frage="t('admin.terrain.backAsk', { n: gueltig.rueckweg })"
                    :folge="t('admin.terrain.backFollows', { n: gueltig.rueckweg })"
                    :bestaetigen="t('admin.terrain.backAction')"
                    :pflicht="true"
                    :busy="h.busy.value"
                    testid="hoehenmodell-frage-zurueck"
                    @bestaetigen="h.confirm()"
                    @abbrechen="h.cancel()"
                />
                <VerwaltungMeldung :ergebnis="meldung('zurueck')" testid="hoehenmodell-meldung-zurueck" />
                <!-- „Gelände neu rechnen“ (Betreiber 2026-10-17, Topographie F8): dieselbe Fassung, die ganze Kette noch einmal. -->
                <div class="hoehenmodell__zurueck">
                    <AvmKnopf
                        art="weich"
                        groesse="zeile"
                        :gesperrt="neuRechnenOffen || h.busy.value ? '' : neuRechnenSperre(stand, darf)"
                        :breit="props.telefon"
                        testid="hoehenmodell-neu-rechnen"
                        @click="h.ask({ art: 'neuRechnen', version: stand.eingestellt.version })"
                        ><span aria-hidden="true">↻ </span>{{ t("admin.terrain.recompute") }}</AvmKnopf
                    >
                    <span class="hoehenmodell__leise">{{
                        t("admin.terrain.recomputeHint", { n: fassungNummer(stand, stand.eingestellt.version) })
                    }}</span>
                </div>
                <AvmBestaetigung
                    v-if="neuRechnenOffen"
                    :frage="t('admin.terrain.recomputeAsk', { n: fassungNummer(stand, stand.eingestellt.version) })"
                    :folge="t('admin.terrain.recomputeFollows')"
                    :bestaetigen="t('admin.terrain.recomputeAction')"
                    :gesperrt="h.busy.value ? '' : undefined"
                    testid="hoehenmodell-frage-neu-rechnen"
                    @bestaetigen="h.confirm()"
                    @abbrechen="h.cancel()"
                />
                <VerwaltungMeldung :ergebnis="meldung('neu-rechnen')" testid="hoehenmodell-meldung-neu-rechnen" />
            </FensterKarte>

            <VerwaltungHoehenmodellTest
                v-if="testFassung !== null"
                :hoehenmodell="h"
                :darf="darf"
                :telefon="props.telefon"
                :jetzt="jetzt"
            />
            <FensterKarte v-if="werte !== null" :titel="werte.titel" data-testid="hoehenmodell-werte">
                <h4 class="hoehenmodell__gruppe">{{ t("admin.terrain.uplift") }}</h4>
                <dl class="hoehenmodell__felder">
                    <dt>{{ t("admin.terrain.upliftKind") }}</dt>
                    <dd>{{ werte.art }}</dd>
                    <template v-for="r in werte.verteilung" :key="r.id">
                        <dt>{{ r.name }}</dt>
                        <dd :class="{ hoehenmodell__neu: r.geaendert }" :data-testid="`hoehenmodell-wert-${r.id}`">
                            {{ r.wert }}
                        </dd>
                    </template>
                </dl>
                <h4 class="hoehenmodell__gruppe">{{ t("admin.terrain.adjustable") }}</h4>
                <dl class="hoehenmodell__felder">
                    <template v-for="r in werte.global" :key="r.id">
                        <dt>{{ r.name }}</dt>
                        <dd :class="{ hoehenmodell__neu: r.geaendert }" :data-testid="`hoehenmodell-wert-${r.id}`">
                            {{ r.wert }}
                        </dd>
                    </template>
                </dl>
                <h4 class="hoehenmodell__gruppe">{{ t("admin.terrain.table") }}</h4>
                <FensterTafel :beschriftung="t('admin.terrain.table')" dicht>
                    <table data-testid="hoehenmodell-tafel">
                        <thead>
                            <tr>
                                <th scope="col">{{ t("admin.terrain.col.art") }}</th>
                                <th scope="col">{{ t("admin.terrain.col.uplift") }}</th>
                                <th scope="col">{{ t("admin.terrain.col.erosion") }}</th>
                                <th scope="col">{{ t("admin.terrain.col.diffusion") }}</th>
                                <th scope="col">{{ t("admin.terrain.col.runoff") }}</th>
                                <th scope="col">{{ t("admin.terrain.col.channels") }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="l in werte.landschaften" :key="l.art">
                                <th scope="row">{{ landschaftName(l.art) }}</th>
                                <td>{{ zahl(l.upliftWeight) }}</td>
                                <td>{{ zahl(l.erodibility) }}</td>
                                <td>{{ zahl(l.diffusivity) }}</td>
                                <td>{{ zahl(l.runoff) }}</td>
                                <td>{{ zahl(l.channelBias) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </FensterTafel>
                <p class="hoehenmodell__leise" data-testid="hoehenmodell-rest">
                    {{ t("admin.terrain.rest", { n: werte.rest }) }}
                </p>
            </FensterKarte>
        </template>
    </div>
</template>

<style scoped>
.hoehenmodell {
    display: flex;
    flex-direction: column;
    gap: var(--divider-gap);
    min-width: 0;
}

.hoehenmodell__erst {
    color: var(--color-text-strong);
    font-weight: 400;
}

.hoehenmodell__block {
    display: block;
}

.hoehenmodell__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.hoehenmodell__warnung {
    margin: 0;
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-small);
}

.hoehenmodell__zustand {
    margin-left: auto;
}

/* Feldzeilen wie im Betriebszustand: Beschriftung links leise, Wert rechts. */
.hoehenmodell__felder {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-4) var(--space-12);
    margin: 0;
    font-size: var(--font-size-small);
}

.hoehenmodell__felder > dt {
    color: var(--color-text-muted);
}

.hoehenmodell__felder > dd {
    min-width: 0;
    margin: 0;
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
}

.hoehenmodell--telefon .hoehenmodell__felder {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
}

.hoehenmodell--telefon .hoehenmodell__felder > dd + dt {
    margin-top: var(--space-6);
}

.hoehenmodell__neu {
    color: var(--color-accent-strong) !important;
}

.hoehenmodell__zurueck,
.hoehenmodell__knoepfe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6) var(--space-10);
    margin-top: var(--space-4);
}

.hoehenmodell__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6) var(--space-10);
}

.hoehenmodell__titel,
.hoehenmodell__gruppe {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-small);
    font-weight: 400;
    letter-spacing: 0.02em;
}

.hoehenmodell__gruppe {
    margin-top: var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    letter-spacing: 0;
}

.hoehenmodell__regler {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(calc(var(--avm-field-label-w) * 1.6), 1fr));
    gap: var(--space-8) var(--space-12);
}

.hoehenmodell__regel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.hoehenmodell__regel-name {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Legacys Liste: Name mit Kreis, darunter die Unterzeilen, rechts die Handlung; eine Haarlinie zwischen den Zeilen. */
.hoehenmodell__liste {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    list-style: none;
}

.hoehenmodell__zeile {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-4) var(--space-12);
    align-items: center;
    padding: var(--space-8) var(--space-10);
    transition: background-color var(--duration-fast, 120ms) ease;
}

.hoehenmodell__zeile + .hoehenmodell__zeile {
    border-top: 1px solid var(--color-divider);
}

.hoehenmodell__zeile.is-gewaehlt {
    background: var(--color-panel-active);
}

.hoehenmodell__zeile:first-child {
    border-radius: var(--radius-md) var(--radius-md) 0 0;
}

.hoehenmodell__zeile:last-child {
    border-radius: 0 0 var(--radius-md) var(--radius-md);
}

.hoehenmodell__zeile-inhalt {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.hoehenmodell__name {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: var(--space-6);
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-text-strong);
    font: inherit;
    font-size: var(--font-size-body);
    text-align: left;
    cursor: pointer;
}

.hoehenmodell__name:hover > span:first-child {
    color: var(--color-accent-strong);
}

.hoehenmodell__name:focus-visible {
    border-radius: var(--radius-sm);
    outline: var(--focus-ring, 2px solid var(--color-accent));
    outline-offset: 2px;
}

.hoehenmodell__unter {
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
}

.hoehenmodell__was {
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.hoehenmodell__was--gut {
    color: var(--color-success-soft-text);
}

.hoehenmodell__was--warnung {
    color: var(--color-warning-soft-text);
}

.hoehenmodell__handlung {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-6);
}

.hoehenmodell__frage {
    grid-column: 1 / -1;
}

.hoehenmodell--telefon .hoehenmodell__zeile {
    grid-template-columns: minmax(0, 1fr);
}

.hoehenmodell--telefon .hoehenmodell__handlung {
    justify-content: stretch;
}

.hoehenmodell__legende {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-12);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.hoehenmodell__legende-teil {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
}
</style>
