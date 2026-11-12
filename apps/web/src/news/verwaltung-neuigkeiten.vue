<script setup lang="ts">
import { computed, ref } from "vue";
import type { NewsEintragVoll } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import type { Phrase } from "../auth/formular";
import FensterKarte from "../fenster/fenster-karte.vue";
import { t } from "../i18n/i18n";
import NeuigkeitenEditor from "./neuigkeiten-editor.vue";
import NeuigkeitenLuecke from "./neuigkeiten-luecke.vue";
import NeuigkeitenPapierkorb from "./neuigkeiten-papierkorb.vue";
import NeuigkeitenZeile from "./neuigkeiten-zeile.vue";
import { platzHinweis, type EditorFelder, type NeuigkeitenPflege } from "./pflege";

/**
 * Systemsteuerung › Neuigkeiten (WI-0139 N6, WI-0217). Was Claudios tägliche Routine geschrieben hat, wartet hier: freigeben, bessern,
 * verstecken. Dazu seit WI-0217 (Betreiber 2026-10-17: „was fehlt sind löschen und neu. praktisch wär wie die blaue linie, wenn ich oben
 * oder zwischendrin manuell neuigkeiten einfügen könnte“):
 *
 * - **Neu** oben mit „✚ Neuigkeit“, **zwischendrin** über die Linie zwischen zwei Einträgen (`NeuigkeitenLuecke`). Der Editor öffnet an
 *   der Stelle; das Datum des Eintrags darüber ist vorgeschlagen, denn die Reihenfolge ist das Datum.
 * - **Löschen** legt in den Papierkorb unten (gewählt „Papierkorb“); gelöscht wird nie (WI-0139).
 * - **Auf der Stage** (gewählt „Bearbeitbar bis zum Zug“): ein Band sagt, dass der nächste Production-Zug alle Neuigkeiten durch die von
 *   Production ersetzt, und jede Änderung seit dem letzten Zug trägt „nur Stage“. Neuigkeiten wandern nur von Production auf die Stage.
 *
 * Rückmeldungen stehen als Satz in der Karte, nicht als Hinweis unten: Im modalen Fenster läge der unter dem Schleier.
 */
const props = defineProps<{ pflege: NeuigkeitenPflege }>();

/** Was gerade im Editor steht: neu unter einem Eintrag (`nach`, `null` ganz oben) oder ein Eintrag zum Bearbeiten. */
type Offen = { art: "neu"; nach: number | null } | { art: "bearbeiten"; id: number };
const offen = ref<Offen | null>(null);
/** Was zuletzt geschah, als Satz über der Liste. */
const meldung = ref<Phrase | null>(null);

const eintraege = computed(() => props.pflege.stand.value?.eintraege ?? []);
const papierkorb = computed(() => props.pflege.stand.value?.papierkorb ?? []);
const stage = computed(() => props.pflege.stand.value?.stage ?? null);
const beschaeftigt = computed(() => props.pflege.busy.value !== null);

const titelVon = (id: number | null): string => eintraege.value.find((eintrag) => eintrag.id === id)?.titel ?? "";

function ortVon(nach: number | null): string {
    return nach === null ? t("admin.news.editor.top") : t("admin.news.editor.below", { titel: titelVon(nach) });
}

function luecke(nach: number | null): string {
    return nach === null ? t("admin.news.insertTop") : t("admin.news.insertBelow", { titel: titelVon(nach) });
}

function oeffneNeu(nach: number | null): void {
    meldung.value = null;
    offen.value = { art: "neu", nach };
}

function oeffneBearbeiten(eintrag: NewsEintragVoll): void {
    meldung.value = null;
    offen.value = { art: "bearbeiten", id: eintrag.id };
}

function vorlageNeu(nach: number | null): EditorFelder {
    const oben = eintraege.value.find((eintrag) => eintrag.id === nach);
    const heute = new Date();
    const tag = `${String(heute.getFullYear())}-${String(heute.getMonth() + 1).padStart(2, "0")}-${String(heute.getDate()).padStart(2, "0")}`;
    return { datum: oben?.datum ?? tag, rubrik: "karte", titel: "", text: "" };
}

function vorlageVon(eintrag: NewsEintragVoll): EditorFelder {
    return {
        datum: eintrag.datum,
        rubrik: eintrag.rubrik as EditorFelder["rubrik"],
        titel: eintrag.titel,
        text: eintrag.text,
    };
}

/** Beim Bearbeiten bleibt ein Eintrag, solange sein Datum bleibt; ein neues stellt ihn an die Spitze seines Tages. */
function platzBearbeiten(alt: string) {
    return (datum: string) =>
        datum === alt
            ? { satz: null, bleibt: true }
            : { satz: { key: "admin.news.platz.neuesDatum" } as Phrase, bleibt: false };
}

async function lege(nach: number | null, felder: EditorFelder, zustand: "sichtbar" | "entwurf"): Promise<void> {
    const { bleibt } = platzHinweis(eintraege.value, nach, felder.datum);
    const ok = await props.pflege.anlegen({ ...felder, zustand, ...(nach === null ? {} : { nach }) });
    if (!ok) return;
    offen.value = null;
    meldung.value = {
        key: bleibt ? (zustand === "sichtbar" ? "admin.news.published" : "admin.news.drafted") : "admin.news.sorted",
    };
}

async function speichere(eintrag: NewsEintragVoll, felder: EditorFelder): Promise<void> {
    const geaendert: Partial<EditorFelder> = {};
    if (felder.titel !== eintrag.titel) geaendert.titel = felder.titel;
    if (felder.text !== eintrag.text) geaendert.text = felder.text;
    if (felder.datum !== eintrag.datum) geaendert.datum = felder.datum;
    if (felder.rubrik !== eintrag.rubrik) geaendert.rubrik = felder.rubrik;
    if (Object.keys(geaendert).length > 0 && !(await props.pflege.bessere(eintrag.id, geaendert))) return;
    offen.value = null;
    meldung.value = geaendert.datum === undefined ? null : { key: "admin.news.sorted" };
}

async function loesche(eintrag: NewsEintragVoll): Promise<void> {
    offen.value = null;
    if (await props.pflege.papierkorb(eintrag.id, true)) {
        meldung.value = { key: "admin.news.trash.moved", params: { titel: eintrag.titel } };
    }
}

async function holeZurueck(id: number): Promise<void> {
    const titel = papierkorb.value.find((eintrag) => eintrag.id === id)?.titel ?? "";
    if (await props.pflege.papierkorb(id, false)) {
        meldung.value = { key: "admin.news.trash.restored", params: { titel } };
    }
}

const zugZeit = computed(() => {
    const zug = stage.value?.letzterZug;
    if (zug === null || zug === undefined) return null;
    return new Date(zug).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
});
</script>

<template>
    <FensterKarte :titel="t('admin.news.title')">
        <div class="leiste">
            <p class="satz">{{ t("admin.news.lead") }}</p>
            <AvmKnopf
                groesse="zeile"
                art="gefuellt"
                :gesperrt="beschaeftigt ? '' : undefined"
                testid="news-neu"
                @click="oeffneNeu(null)"
                >{{ t("admin.news.new") }}</AvmKnopf
            >
        </div>

        <AvmHinweis v-if="stage" ton="warnung" class="band" testid="news-stage">
            {{ t("admin.news.stage.band") }}
            {{ zugZeit === null ? t("admin.news.stage.noPull") : t("admin.news.stage.lastPull", { zeit: zugZeit }) }}
            <template v-if="stage.nurStage > 0">{{ t("admin.news.stage.count", { anzahl: stage.nurStage }) }}</template>
        </AvmHinweis>

        <AvmHinweis v-if="meldung" class="band" rolle="status" testid="news-meldung">{{
            t(meldung.key, meldung.params)
        }}</AvmHinweis>

        <p v-if="props.pflege.fehler.value" class="satz satz--fehler" role="alert">{{ t("admin.news.failed") }}</p>
        <p v-else-if="eintraege.length === 0 && offen === null" class="satz" data-testid="news-pflege-leer">
            {{ t("admin.news.empty") }}
        </p>

        <ul v-if="!props.pflege.fehler.value" class="liste" data-testid="news-pflege-liste">
            <NeuigkeitenEditor
                v-if="offen?.art === 'neu' && offen.nach === null"
                art="neu"
                :ort="ortVon(null)"
                :vorlage="vorlageNeu(null)"
                :platz="(datum) => platzHinweis(eintraege, null, datum)"
                :beschaeftigt="beschaeftigt"
                @speichern="(felder, zustand) => lege(null, felder, zustand)"
                @abbrechen="offen = null"
            />
            <NeuigkeitenLuecke
                v-else-if="eintraege.length > 0"
                :label="luecke(null)"
                testid="news-luecke-oben"
                @einfuegen="oeffneNeu(null)"
            />
            <template v-for="eintrag in eintraege" :key="eintrag.id">
                <NeuigkeitenEditor
                    v-if="offen?.art === 'bearbeiten' && offen.id === eintrag.id"
                    art="bearbeiten"
                    :vorlage="vorlageVon(eintrag)"
                    :platz="platzBearbeiten(eintrag.datum)"
                    :beschaeftigt="beschaeftigt"
                    @speichern="(felder) => speichere(eintrag, felder)"
                    @abbrechen="offen = null"
                />
                <NeuigkeitenZeile
                    v-else
                    :eintrag="eintrag"
                    :gesperrt="beschaeftigt"
                    @zustand="(zustand) => props.pflege.setzeZustand(eintrag.id, zustand)"
                    @bearbeiten="oeffneBearbeiten(eintrag)"
                    @loeschen="loesche(eintrag)"
                />
                <NeuigkeitenEditor
                    v-if="offen?.art === 'neu' && offen.nach === eintrag.id"
                    art="neu"
                    :ort="ortVon(eintrag.id)"
                    :vorlage="vorlageNeu(eintrag.id)"
                    :platz="(datum) => platzHinweis(eintraege, eintrag.id, datum)"
                    :beschaeftigt="beschaeftigt"
                    @speichern="(felder, zustand) => lege(eintrag.id, felder, zustand)"
                    @abbrechen="offen = null"
                />
                <NeuigkeitenLuecke
                    v-else
                    :label="luecke(eintrag.id)"
                    :testid="`news-luecke-${String(eintrag.id)}`"
                    @einfuegen="oeffneNeu(eintrag.id)"
                />
            </template>
        </ul>

        <p v-for="problem in props.pflege.problems.value" :key="problem.key" class="satz satz--fehler" role="alert">
            {{ t(problem.key, problem.params) }}
        </p>

        <NeuigkeitenPapierkorb
            v-if="papierkorb.length > 0"
            :eintraege="papierkorb"
            :gesperrt="beschaeftigt"
            @zurueckholen="holeZurueck"
        />
    </FensterKarte>
</template>

<style scoped>
.leiste {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-6) var(--space-10);
    margin-bottom: var(--space-8);
}

.leiste .satz {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
}

.satz {
    margin: 0 0 var(--space-8);
    color: var(--color-text-muted);
}

.satz--fehler {
    color: var(--color-danger-soft-text);
}

.band {
    margin-bottom: var(--space-10);
}

.liste {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}
</style>
