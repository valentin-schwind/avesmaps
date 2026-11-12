<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, useTemplateRef, watch, watchEffect } from "vue";
import type {
    StrasseStreckeAntwort,
    StrassenAbschnitt,
    StrassenOrt,
    StrassenZustand,
    WikiTreffer,
} from "@avesmaps3d/shared";
import { newOperationId } from "../auth/api";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { createWikiBoxDaten } from "../fenster/wiki-box-daten";
import type { FensterBox } from "../fenster/fenster-lage";
import { formatNumber, t, tPlural, type MessageKey } from "../i18n/i18n";
import { fetchWaypointHits } from "../route-planner/route-client";
import {
    abseitsRahmen,
    befundeVon,
    fuegeOrtEin,
    neueWahl,
    rahmenVon,
    rechneAssistent,
    verschiebeOrt,
    zuweisenBody,
    zuweisenGrund,
    type AssistentBild,
    type AssistentEingabe,
    type Rahmen,
    type ZuweisenGrund,
} from "./strassen-assistent";
import {
    createStrassenAssistentDaten,
    createStreckenLeser,
    fehlerSchluessel,
    type LeserStand,
    type StrassenAssistentDaten,
} from "./strassen-assistent-daten";
import { useVorschlaege } from "./strassen-assistent-suche";

/**
 * Das Fenster „Straßen-Assistent · Name“ (WI-0310; Vali 2026-11-11, Entwurf Fassung 3, „passt, bauen“ am 2026-11-12). Es gibt vorhandenen Abschnitten
 * Name, Hauptartikel und Quellen EINER Straße und verlegt keine Linie. Die Strecke zwischen den Orten rechnet der Server; die Rechnung dahinter
 * (`strassen-assistent.ts`) sagt, was sich ändern würde, und der Schreibweg (`path.assign_street`) ist EINE Operation mit ↺ im Verlauf des Wegs.
 *
 * - **Aufbau wie der Entwurf:** Straße (Artikel mit Suche, Name, Verlauf im Wiki) · Orte in Reihenfolge (Ziehen, Pfeiltasten, ✕, Suche, „Orte aus
 *   dem Wiki“) · Abschnitte auf der Strecke (je Ortspaar, Haken, Statuskreis ● ◐ ○ und ⇄, Länge, Befunde) · Mit dem Namen, abseits der Strecke ·
 *   Außerdem (Quellen) · Fuß „Verwerfen“ und „Zuweisen …“ mit der Vorschau „Zuweisen würde schreiben“ und „Wirklich zuweisen“.
 * - **Die Karte ist die Editorkarte.** Das Fenster zeichnet nichts selbst: `zeige` nennt die Abschnitte, die auf der Karte leuchten sollen
 *   (Nummern in Fahrtfolge, die geänderten hervor), und bei „Zeigen“ einen Kasten zum Hinfliegen. Der Wegeditor bedient beides mit der
 *   Schicht `abschnitte-leuchten.ts` und dem vorhandenen Flug.
 * - **Fehler verhindern statt erklären:** Ein Knopf, der nicht geht, ist gesperrt und nennt den Grund (`zuweisenGrund`). Ein Konflikt (409) liest die
 *   Strecke neu.
 * - Das Fenster öffnet angedockt in voller Höhe wie die anderen Fenster der Editoren (Betreiber 2026-10-31: „angedockt bleibt standard im backend“); gelöst steht es links unten. Ohne Ablage: Es hat keinen Entwurf.
 */
const props = defineProps<{
    /** Ein Abschnitt der Straße, wie das Wege-Fenster sie kennt. */
    anker: string;
    /** Die Kennung für Testkennungen; die des Wegeditor-Fensters. */
    kennung: string;
    /** Darf diese Sitzung zuweisen (`edit_map_objects` und Bearbeiten an)? */
    schreibt: boolean;
    daten?: StrassenAssistentDaten | undefined;
    /** Die Artikelsuche; nur Tests geben sie vor. */
    artikelSuche?: ((q: string, signal: AbortSignal) => Promise<readonly WikiTreffer[]>) | undefined;
    /** Die Ortssuche; nur Tests geben sie vor. */
    ortSuche?: ((q: string, signal: AbortSignal) => Promise<readonly StrassenOrt[]>) | undefined;
}>();

const emit = defineEmits<{
    /** Zugewiesen: Die Straße hat einen neuen Stand; mit dem Anker aus der Quittung liest der Wegeditor sie neu. */
    geaendert: [anker: string];
    schliessen: [];
    /** Diese Abschnitte sollen auf der Karte leuchten; mit `rahmen` fliegt die Karte dorthin („Zeigen“). Ohne Bild: nichts leuchtet. */
    zeige: [bild: AssistentBild | undefined, rahmen?: Rahmen];
}>();

const daten = props.daten ?? createStrassenAssistentDaten();
const wikiDaten = createWikiBoxDaten();
const grundId = useId();

// --- Fenster: angedockt wie die Editoren, gelöst links unten ---
const lage = ref<"angedockt" | "geloest" | "versenkt">("angedockt");
const box = ref<FensterBox | undefined>(undefined);
function neueLage(neu: "angedockt" | "geloest" | "versenkt", neueBox?: FensterBox): void {
    lage.value = neu === "versenkt" ? "geloest" : neu;
    box.value = neueBox;
}
const offen = computed({
    get: () => true,
    set: (auf: boolean) => {
        if (!auf) emit("schliessen");
    },
});

// --- Zustand ---
const ankerJetzt = ref(props.anker);
watch(
    () => props.anker,
    (neu) => {
        // Nach dem Zuweisen nennt die Quittung den neuen Anker schon (`ankerJetzt`): Dann bleibt die Liste, wie sie ist.
        if (neu === ankerJetzt.value) return;
        ankerJetzt.value = neu;
        key.value = undefined;
        nameEigen.value = false;
        frage(true, true);
    },
);
const stand = shallowRef<LeserStand>({ phase: "laedt" });
/** Die letzte gute Antwort: Sie bleibt stehen, während eine neue gelesen wird, damit die Liste nicht flackert. */
const antwort = shallowRef<StrasseStreckeAntwort | undefined>(undefined);
/** Der gewählte Artikel: `undefined` der Hauptartikel der Straße (so schlägt ihn der Server vor), `null` ohne Artikel. */
const key = ref<string | null | undefined>(undefined);
const name = ref("");
/** Der Name im Feld ist einer, den der Mensch schrieb: Ein Wechsel der Orte überschreibt ihn nicht. */
const nameEigen = ref(false);
const liste = shallowRef<readonly StrassenOrt[]>([]);
const wahl = ref(neueWahl());
const gewaehlt = ref<string | undefined>(undefined);
const vorschauOffen = ref(false);
const laeuft = ref(false);
const satz = ref<MessageKey | undefined>(undefined);
const fertig = ref(false);
const eingereiht = ref<string | undefined>(undefined);

const leser = createStreckenLeser(daten, (neu) => {
    stand.value = neu;
    if (neu.phase !== "bereit") return;
    antwort.value = neu.antwort;
    liste.value = neu.antwort.orte;
    if (!nameEigen.value) name.value = neu.antwort.name;
});

/** Fragt die Strecke; `ausWiki`: die Orte kommen aus dem Verlauf des Artikels statt aus der Liste. */
function frage(sofort: boolean, ausWiki = false): void {
    leser.frage(
        {
            anker: ankerJetzt.value,
            ...(key.value === undefined ? {} : { key: key.value }),
            ...(ausWiki ? {} : { orte: liste.value.map((o) => o.id) }),
        },
        sofort,
    );
}
frage(true, true);
onBeforeUnmount(() => {
    leser.stopp();
    emit("zeige", undefined);
});

const effektiverKey = computed((): string | null =>
    key.value === undefined ? (antwort.value?.artikel?.key ?? null) : key.value,
);
const eingabe = computed((): AssistentEingabe | undefined =>
    antwort.value === undefined
        ? undefined
        : { antwort: antwort.value, name: name.value, key: effektiverKey.value, wahl: wahl.value },
);
const modell = computed(() => (eingabe.value === undefined ? undefined : rechneAssistent(eingabe.value)));
const befunde = computed(() =>
    eingabe.value === undefined || modell.value === undefined ? [] : befundeVon(eingabe.value, modell.value),
);
const laedt = computed(() => stand.value.phase === "laedt");
const lesefehler = computed(() => (stand.value.phase === "fehler" ? stand.value.satz : undefined));

const grund = computed((): ZuweisenGrund | undefined =>
    eingabe.value === undefined || modell.value === undefined
        ? "laedt"
        : zuweisenGrund(modell.value, eingabe.value, {
              darf: props.schreibt,
              laedt: laedt.value && antwort.value === undefined,
              laeuft: laeuft.value,
          }),
);
const GRUND_TEXT: Record<ZuweisenGrund, MessageKey> = {
    recht: "wegeditor.assistent.grund.recht",
    laedt: "wegeditor.assistent.grund.laedt",
    laeuft: "wegeditor.assistent.grund.laeuft",
    "kein-name": "wegeditor.assistent.grund.keinName",
    griff: "wegeditor.assistent.grund.griff",
    "zu-lang": "wegeditor.assistent.grund.zuLang",
    "zu-viele": "wegeditor.assistent.grund.zuViele",
    nichts: "wegeditor.assistent.grund.nichts",
};
const grundText = computed(() => (grund.value === undefined ? undefined : t(GRUND_TEXT[grund.value])));

// --- Karte: was leuchtet ---
const abschnittVon = (id: string): StrassenAbschnitt | undefined => antwort.value?.abschnitte[id];
watchEffect(() => {
    const m = modell.value;
    if (m === undefined) return;
    emit("zeige", {
        ids: m.strecke,
        hervor: gewaehlt.value === undefined ? [...m.geaendert] : [gewaehlt.value],
    });
});
function zeigeAbschnitte(ids: readonly string[], rahmen: Rahmen | undefined): void {
    if (rahmen === undefined) return;
    emit("zeige", { ids, hervor: ids }, rahmen);
}

// --- Straße: Artikel, Name, Verlauf ---
const artikelSuche = useVorschlaege<WikiTreffer>({
    finde: (q, signal) =>
        props.artikelSuche !== undefined
            ? props.artikelSuche(q, signal)
            : wikiDaten.suche("weg", ankerJetzt.value, q, signal),
    nimm: (treffer) => {
        key.value = treffer.key;
        nameEigen.value = false;
        wahl.value = { ...wahl.value, aus: new Set(), rein: new Set() };
        frage(true, true);
    },
});
function artikelAb(): void {
    key.value = null;
    wahl.value = { ...wahl.value, aus: new Set(), rein: new Set() };
    frage(true);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ortSuche = useVorschlaege<StrassenOrt>({
    finde: async (q, signal) => {
        if (props.ortSuche !== undefined) return props.ortSuche(q, signal);
        const antwortOrte = await fetchWaypointHits(q, signal);
        return antwortOrte.hits
            .filter((hit) => UUID.test(hit.id))
            .map((hit) => ({ id: hit.id, name: hit.name, x: hit.x, y: hit.y }));
    },
    nimm: (ort) => fuege(ort),
});
const ortTreffer = computed(() => ortSuche.treffer.value.filter((o) => !liste.value.some((v) => v.id === o.id)));

function nameGeaendert(): void {
    nameEigen.value = true;
    wahl.value = { ...wahl.value, aus: new Set(), rein: new Set() };
}
const nameWeicht = computed(() => {
    const a = antwort.value?.artikel;
    return a !== undefined && a !== null && effektiverKey.value === a.key && name.value.trim() !== a.name;
});
/** Der Artikel, der gerade gilt: der vom Server genannte, oder der in dieser Sitzung gewählte (nur sein Name ist bekannt). */
const artikel = computed(() => {
    if (key.value === null) return undefined;
    const vomServer = antwort.value?.artikel;
    if (vomServer !== undefined && vomServer !== null && vomServer.key === effektiverKey.value) return vomServer;
    return undefined;
});

const ohneUmlaut = (s: string): string =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").trim();
const verlaufNamen = computed(() => {
    const v = artikel.value?.verlauf;
    return v === null || v === undefined || v.trim() === ""
        ? []
        : v
              .split(/\s*→\s*/)
              .map((n) => n.trim())
              .filter((n) => n !== "");
});
const unbekannt = computed(() => new Set((antwort.value?.unbekannt ?? []).map(ohneUmlaut)));
const imVerlauf = computed(() => new Set(verlaufNamen.value.map(ohneUmlaut)));

// --- Orte ---
function fuege(ort: StrassenOrt): void {
    const r = fuegeOrtEin(liste.value, ort);
    if (r === undefined) {
        eingereiht.value = t("wegeditor.assistent.orte.schon", { name: ort.name });
        return;
    }
    liste.value = r.liste;
    eingereiht.value = t("wegeditor.assistent.orte.eingereiht", { name: ort.name, n: r.stelle + 1 });
    frage(false);
}
function entferne(i: number): void {
    liste.value = liste.value.filter((_, k) => k !== i);
    frage(false);
}
function verschiebe(von: number, nach: number): void {
    const neu = verschiebeOrt(liste.value, von, nach);
    if (neu === liste.value) return;
    liste.value = neu;
    frage(false);
}
function ausWiki(): void {
    frage(true, true);
}
const kannAusWiki = computed(() => artikel.value?.verlauf !== null && artikel.value?.verlauf !== undefined);
function zeigeOrt(ort: StrassenOrt): void {
    const m = modell.value;
    emit("zeige", m === undefined ? undefined : { ids: m.strecke, hervor: [...m.geaendert] }, [
        ort.x - 10,
        ort.y - 10,
        ort.x + 10,
        ort.y + 10,
    ]);
}
const teilNach = (i: number) => antwort.value?.teile[i];

// Ziehen in der Liste (Maus und Finger); mit den Pfeiltasten am Griff geht dasselbe.
interface Zug {
    readonly von: number;
    ziel: number;
    readonly zeilen: readonly HTMLElement[];
    readonly y0: number;
}
const zug = ref<{ von: number; ziel: number } | undefined>(undefined);
let zugInnen: Zug | undefined;
function ziehStart(event: PointerEvent, i: number): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const griff = event.currentTarget as HTMLElement;
    const zeilen = [...(griff.closest("ol")?.querySelectorAll<HTMLElement>(".assistent__ort") ?? [])];
    zugInnen = { von: i, ziel: i, zeilen, y0: event.clientY };
    zug.value = { von: i, ziel: i };
    griff.setPointerCapture(event.pointerId);
    griff.addEventListener("pointermove", ziehBewegt);
    griff.addEventListener("pointerup", ziehEnde, { once: true });
    griff.addEventListener("pointercancel", ziehEnde, { once: true });
}
function ziehBewegt(event: PointerEvent): void {
    const z = zugInnen;
    if (z === undefined) return;
    const eigene = z.zeilen[z.von];
    if (eigene !== undefined) eigene.style.transform = `translateY(${String(event.clientY - z.y0)}px)`;
    let ziel = 0;
    z.zeilen.forEach((zeile, k) => {
        if (k === z.von) return;
        const r = zeile.getBoundingClientRect();
        if (r.top + r.height / 2 < event.clientY) ziel += 1;
    });
    z.ziel = ziel;
    zug.value = { von: z.von, ziel };
}
function ziehEnde(event: Event): void {
    (event.currentTarget as HTMLElement | null)?.removeEventListener("pointermove", ziehBewegt);
    const z = zugInnen;
    zugInnen = undefined;
    zug.value = undefined;
    if (z === undefined) return;
    const eigene = z.zeilen[z.von];
    if (eigene !== undefined) eigene.style.transform = "";
    verschiebe(z.von, z.ziel);
}
function griffTaste(event: KeyboardEvent, i: number): void {
    const nach = event.key === "ArrowUp" ? i - 1 : event.key === "ArrowDown" ? i + 1 : undefined;
    if (nach === undefined || nach < 0 || nach >= liste.value.length) return;
    // Die Pfeile gehören hier der Zeile, nicht der Karte.
    event.preventDefault();
    event.stopPropagation();
    verschiebe(i, nach);
    const griff = event.currentTarget as HTMLElement | null;
    const liste_ = griff?.closest("ol");
    requestAnimationFrame(() => liste_?.querySelectorAll<HTMLElement>(".assistent__griff")[nach]?.focus());
}

// --- Strecke: Abschnitte ---
const meilen = (n: number): string =>
    tPlural("wegeditor.assistent.meilen", Math.round(n), { n: formatNumber(Math.round(n), 0) });
const FUELLUNG = { fertig: "voll", artikel: "halb", name: "leer" } as const;
const ZUSTAND_TEXT: Record<StrassenZustand, MessageKey> = {
    fertig: "wegeditor.assistent.zustand.fertig",
    artikel: "wegeditor.assistent.zustand.artikel",
    name: "wegeditor.assistent.zustand.name",
    fremd: "wegeditor.assistent.zustand.fremd",
};
const zustandVon = (id: string): StrassenZustand => modell.value?.zustand[id] ?? "fremd";
const wirdGeaendert = (id: string): boolean => modell.value?.geaendert.has(id) === true;
/** Der Name eines Abschnitts, wie ein Leser ihn sieht: ein Griff oder nichts heißt „ohne Namen“. */
function abschnittName(a: StrassenAbschnitt): string {
    return zustandVon(a.id) === "name" || a.name.trim() === "" ? t("wegeditor.assistent.abschnitt.ohneName") : a.name;
}
function tunText(a: StrassenAbschnitt): string {
    const z = zustandVon(a.id);
    const an = wirdGeaendert(a.id);
    const artikelName = artikel.value?.name ?? "";
    if (z === "fertig") return t("wegeditor.assistent.tun.bleibt");
    if (z === "fremd")
        return an
            ? t("wegeditor.assistent.tun.fremdWechselt", { name: name.value.trim() })
            : t("wegeditor.assistent.tun.fremdBleibt", { name: a.name });
    if (!an) return t("wegeditor.assistent.tun.aus");
    const mitArtikel = effektiverKey.value !== null;
    if (z === "artikel")
        return a.wiki !== null && mitArtikel
            ? t("wegeditor.assistent.tun.artikelWechsel", { alt: a.wiki.name, neu: artikelName })
            : t("wegeditor.assistent.tun.artikel");
    return t(mitArtikel ? "wegeditor.assistent.tun.nameArtikel" : "wegeditor.assistent.tun.name");
}
/** Die Abschnitte je Ortspaar; ein Abschnitt, der schon bei einem früheren Paar steht, kommt nicht noch einmal. */
const paare = computed(() => {
    const a = antwort.value;
    if (a === undefined) return [];
    const gesehen = new Set<string>();
    return a.teile.map((teil, i) => {
        const ids = teil.abschnitte.filter((id) => {
            if (gesehen.has(id) || a.abschnitte[id] === undefined) return false;
            gesehen.add(id);
            return true;
        });
        return {
            i,
            teil,
            von: a.orte.find((o) => o.id === teil.von)?.name ?? "",
            nach: a.orte.find((o) => o.id === teil.nach)?.name ?? "",
            abschnitte: ids.flatMap((id) => a.abschnitte[id] ?? []),
        };
    });
});
function schalte(id: string): void {
    const z = zustandVon(id);
    if (z === "fertig") return;
    const menge = new Set(z === "fremd" ? wahl.value.rein : wahl.value.aus);
    if (menge.has(id)) menge.delete(id);
    else menge.add(id);
    wahl.value = z === "fremd" ? { ...wahl.value, rein: menge } : { ...wahl.value, aus: menge };
}
function waehle(a: StrassenAbschnitt): void {
    gewaehlt.value = a.id;
    zeigeAbschnitte([a.id], rahmenVon([a]));
}
function zeigeBefund(b: (typeof befunde.value)[number]): void {
    const a = antwort.value;
    if (a === undefined) return;
    if (b.art === "umweg") {
        zeigeAbschnitte(b.abschnitte, rahmenVon(b.abschnitte.flatMap((id) => a.abschnitte[id] ?? [])));
    } else if (b.art === "kein-weg") {
        const von = a.orte.find((o) => o.id === b.von);
        const nach = a.orte.find((o) => o.id === b.nach);
        if (von === undefined || nach === undefined) return;
        const ids = modell.value?.strecke ?? [];
        zeigeAbschnitte(ids, [
            Math.min(von.x, nach.x) - 6,
            Math.min(von.y, nach.y) - 6,
            Math.max(von.x, nach.x) + 6,
            Math.max(von.y, nach.y) + 6,
        ]);
    }
}
const ortName = (id: string): string => antwort.value?.orte.find((o) => o.id === id)?.name ?? "";

const zahlen = computed(() => {
    const m = modell.value;
    if (m === undefined || m.strecke.length === 0) return undefined;
    return {
        n: m.strecke.length,
        laenge: m.laenge,
        geaendert: m.geaendert.size,
    };
});
const ZAEHLUNG: readonly StrassenZustand[] = ["fertig", "artikel", "name", "fremd"];

// --- Abseits, Quellen ---
const abseitsAbschnitte = computed(() =>
    (antwort.value?.abseits ?? []).flatMap((id) => antwort.value?.abschnitte[id] ?? []),
);
const abseitsMitArtikel = computed(() => abseitsAbschnitte.value.filter((a) => a.wiki !== null).length);
const abseitsLaenge = computed(() => abseitsAbschnitte.value.reduce((s, a) => s + a.laenge, 0));
const vorschlaege = computed(() =>
    (antwort.value?.vorschlaege ?? []).filter((o) => !liste.value.some((v) => v.id === o.id)),
);
const quellenAnzahl = computed(() => antwort.value?.quellen.length ?? 0);
const quellenOhne = computed(() => {
    const m = modell.value;
    const n = quellenAnzahl.value;
    if (m === undefined || n === 0) return 0;
    return [...m.geaendert].filter((id) => (abschnittVon(id)?.quellen ?? 0) < n).length;
});
function setzeAbseits(wert: "lassen" | "entfernen"): void {
    wahl.value = { ...wahl.value, abseits: wert };
}

// --- Fuß: Verwerfen, Zuweisen ---
const fussSatz = computed(() => {
    const m = modell.value;
    if (m === undefined) return t("wegeditor.assistent.laedt");
    const n = m.schreibt.abschnitte;
    return n === 0
        ? t("wegeditor.assistent.fuss.nichts")
        : tPlural("wegeditor.assistent.fuss.geaendert", n, { n: formatNumber(n, 0) });
});
function verwerfen(): void {
    key.value = undefined;
    nameEigen.value = false;
    wahl.value = neueWahl();
    gewaehlt.value = undefined;
    vorschauOffen.value = false;
    satz.value = undefined;
    fertig.value = false;
    frage(true, true);
}
const vorschauKasten = useTemplateRef<HTMLElement>("vorschauKasten");
/** „Zuweisen …“: Die Vorschau steht unten im Rumpf, der rollt; darum rollt sie ins Bild (ohne Gleiten bei reduzierter Bewegung). */
function vorschau(): void {
    if (grund.value !== undefined) return;
    fertig.value = false;
    satz.value = undefined;
    vorschauOffen.value = true;
    void nextTick(() => {
        const ruhig = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
        vorschauKasten.value?.scrollIntoView({ block: "nearest", behavior: ruhig ? "auto" : "smooth" });
    });
}
async function zuweisen(): Promise<void> {
    const e = eingabe.value;
    const m = modell.value;
    if (e === undefined || m === undefined || grund.value !== undefined) return;
    laeuft.value = true;
    satz.value = undefined;
    const ergebnis = await daten.zuweisen(zuweisenBody(m, e, newOperationId()));
    laeuft.value = false;
    if (!ergebnis.ok) {
        vorschauOffen.value = false;
        satz.value = fehlerSchluessel(ergebnis.status, ergebnis.fehler.code);
        // Ein Abschnitt änderte sich oder ist gesperrt: Die Strecke wird neu gelesen, damit die Revisionen stimmen.
        if (ergebnis.status === 409) frage(true);
        return;
    }
    vorschauOffen.value = false;
    fertig.value = true;
    ankerJetzt.value = ergebnis.quittung.anker;
    wahl.value = neueWahl();
    gewaehlt.value = undefined;
    emit("geaendert", ergebnis.quittung.anker);
    frage(true);
}

const titelZusatz = computed(() => name.value.trim() || t("wegeditor.assistent.abschnitt.ohneName"));
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="entscheiden"
        :lage="lage"
        :box="box"
        vorgabe-ecke="links-unten"
        ohne-ablage
        :titel="t('wegeditor.assistent.titel')"
        :zusatz="titelZusatz"
        :testid="`${kennung}-assistent`"
        @update:lage="neueLage"
        @update:box="(neu: FensterBox) => (box = neu)"
    >
        <div class="assistent">
            <AvmHinweis v-if="fertig" ton="neutral" rolle="status" :testid="`${kennung}-assistent-fertig`">
                {{ t("wegeditor.assistent.fertig") }}
            </AvmHinweis>
            <AvmHinweis v-if="satz" ton="gefahr" rolle="alert" :testid="`${kennung}-assistent-satz`">
                {{ t(satz) }}
            </AvmHinweis>
            <AvmHinweis v-if="lesefehler" ton="gefahr" rolle="alert" :testid="`${kennung}-assistent-lesefehler`">
                {{ t(lesefehler) }}
                <AvmKnopf groesse="zeile" @click="frage(true)">{{ t("wegeditor.assistent.erneut") }}</AvmKnopf>
            </AvmHinweis>
            <p v-if="!antwort && !lesefehler" class="assistent__leise" role="status">
                {{ t("wegeditor.assistent.laedt") }}
            </p>

            <template v-if="antwort">
                <!-- Straße -->
                <section class="assistent__kasten" aria-labelledby="assistent-strasse">
                    <h4 id="assistent-strasse" class="assistent__titel">{{ t("wegeditor.assistent.strasse") }}</h4>
                    <div class="assistent__feld">
                        <span class="assistent__beschriftung">{{ t("wegeditor.assistent.artikel") }}</span>
                        <div class="assistent__feldinhalt">
                            <div
                                v-if="effektiverKey !== null"
                                class="assistent__artikel"
                                :data-testid="`${kennung}-assistent-artikel`"
                            >
                                <span
                                    class="assistent__artikel-text einzeilig"
                                    :title="artikel?.name ?? effektiverKey"
                                    >{{ artikel?.name ?? effektiverKey }}</span
                                >
                                <button
                                    type="button"
                                    class="assistent__weg"
                                    :title="t('wegeditor.assistent.artikel.abTitel')"
                                    :aria-label="t('wegeditor.assistent.artikel.abName')"
                                    :disabled="!schreibt"
                                    :data-testid="`${kennung}-assistent-artikel-ab`"
                                    @click="artikelAb"
                                >
                                    ✕
                                </button>
                            </div>
                            <div v-else class="assistent__suche">
                                <AvmEingabe
                                    v-model="artikelSuche.text.value"
                                    art="suche"
                                    role="combobox"
                                    aria-autocomplete="list"
                                    :aria-expanded="artikelSuche.offen.value"
                                    :aria-controls="`${grundId}-artikel`"
                                    :placeholder="t('wegeditor.assistent.artikel.suche')"
                                    :aria-label="t('wegeditor.assistent.artikel.sucheName')"
                                    :gesperrt="schreibt ? undefined : t('wegeditor.assistent.grund.recht')"
                                    :testid="`${kennung}-assistent-artikel-suche`"
                                    @input="artikelSuche.eingabe()"
                                    @keydown="artikelSuche.taste($event)"
                                    @blur="artikelSuche.verlassen()"
                                />
                                <ul
                                    v-if="artikelSuche.offen.value"
                                    :id="`${grundId}-artikel`"
                                    class="assistent__vorschlaege"
                                    role="listbox"
                                >
                                    <li
                                        v-if="artikelSuche.laedt.value && artikelSuche.treffer.value.length === 0"
                                        class="assistent__leise"
                                        aria-disabled="true"
                                    >
                                        {{ t("wegeditor.assistent.sucht") }}
                                    </li>
                                    <li
                                        v-else-if="
                                            artikelSuche.beantwortet.value && artikelSuche.treffer.value.length === 0
                                        "
                                        class="assistent__leise"
                                        aria-disabled="true"
                                    >
                                        {{ t("wegeditor.assistent.keineTreffer") }}
                                    </li>
                                    <li
                                        v-for="(tr, k) in artikelSuche.treffer.value"
                                        :key="tr.key"
                                        role="option"
                                        :aria-selected="k === artikelSuche.aktiv.value"
                                        @pointerdown.prevent="artikelSuche.nimm(k)"
                                    >
                                        <span>{{ tr.name }}</span>
                                        <small v-if="tr.belegt">{{
                                            t("wegeditor.assistent.artikel.belegt", { name: tr.belegt })
                                        }}</small>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>
                    <div class="assistent__feld">
                        <label class="assistent__beschriftung" :for="`${grundId}-name`">{{
                            t("wegeditor.assistent.name")
                        }}</label>
                        <AvmEingabe
                            :id="`${grundId}-name`"
                            v-model="name"
                            :gesperrt="schreibt ? undefined : t('wegeditor.assistent.grund.recht')"
                            :testid="`${kennung}-assistent-name`"
                            @input="nameGeaendert"
                        />
                    </div>
                    <p v-if="nameWeicht" class="assistent__hinweis">
                        {{ t("wegeditor.assistent.name.weicht", { name: antwort.artikel?.name ?? "" }) }}
                    </p>
                    <p class="assistent__verlauf">
                        <template v-if="verlaufNamen.length > 0">
                            <span>{{ t("wegeditor.assistent.verlauf") }}</span>
                            <template v-for="(ort, k) in verlaufNamen" :key="k">
                                <s
                                    v-if="unbekannt.has(ohneUmlaut(ort))"
                                    :title="t('wegeditor.assistent.verlauf.unbekannt')"
                                    >{{ ort }}</s
                                >
                                <b v-else>{{ ort }}</b>
                                <span v-if="k + 1 < verlaufNamen.length">→</span>
                            </template>
                        </template>
                        <span v-else-if="artikel">{{ t("wegeditor.assistent.verlauf.ohne") }}</span>
                        <span v-else>{{ t("wegeditor.assistent.verlauf.keinArtikel") }}</span>
                    </p>
                </section>

                <!-- Orte in Reihenfolge -->
                <section class="assistent__kasten" aria-labelledby="assistent-orte">
                    <div class="assistent__kopf">
                        <h4 id="assistent-orte" class="assistent__titel">{{ t("wegeditor.assistent.orte") }}</h4>
                        <AvmKnopf
                            v-if="kannAusWiki"
                            groesse="zeile"
                            :gesperrt="schreibt ? undefined : t('wegeditor.assistent.grund.recht')"
                            :testid="`${kennung}-assistent-aus-wiki`"
                            @click="ausWiki"
                        >
                            {{ t("wegeditor.assistent.orte.ausWiki") }}
                        </AvmKnopf>
                    </div>
                    <ol class="assistent__orte" :data-testid="`${kennung}-assistent-orte`">
                        <li
                            v-for="(ort, i) in liste"
                            :key="ort.id"
                            class="assistent__ort"
                            :class="{
                                'assistent__ort--zieht': zug?.von === i,
                                'assistent__ort--ziel': zug !== undefined && zug.von !== i && zug.ziel === i,
                            }"
                            :data-testid="`${kennung}-assistent-ort`"
                            @click="(ev: MouseEvent) => !(ev.target as HTMLElement).closest('button') && zeigeOrt(ort)"
                        >
                            <button
                                type="button"
                                class="assistent__griff"
                                :title="t('wegeditor.assistent.orte.griff')"
                                :aria-label="t('wegeditor.assistent.orte.griffName', { name: ort.name })"
                                :disabled="!schreibt"
                                @pointerdown="ziehStart($event, i)"
                                @keydown="griffTaste($event, i)"
                            >
                                ⋮⋮
                            </button>
                            <span class="assistent__nr">{{ i + 1 }}</span>
                            <span class="assistent__ort-name einzeilig"
                                >{{ ort.name }}
                                <small v-if="verlaufNamen.length > 0 && !imVerlauf.has(ohneUmlaut(ort.name))">{{
                                    t("wegeditor.assistent.orte.nichtImWiki")
                                }}</small></span
                            >
                            <span class="assistent__weit" :title="t('wegeditor.assistent.orte.weitZettel')">{{
                                teilNach(i) === undefined
                                    ? ""
                                    : teilNach(i)?.laenge === null
                                      ? t("wegeditor.assistent.orte.keinWeg")
                                      : t("wegeditor.assistent.orte.weiter", {
                                            laenge: meilen(teilNach(i)?.laenge ?? 0),
                                        })
                            }}</span>
                            <button
                                type="button"
                                class="assistent__weg"
                                :title="t('wegeditor.assistent.orte.entfernenZettel')"
                                :aria-label="t('wegeditor.assistent.orte.entfernen', { name: ort.name })"
                                :disabled="!schreibt"
                                @click="entferne(i)"
                            >
                                ✕
                            </button>
                        </li>
                        <li v-if="liste.length === 0" class="assistent__leise">
                            {{ t("wegeditor.assistent.orte.leer") }}
                        </li>
                    </ol>
                    <p v-if="eingereiht" class="assistent__leise" role="status">{{ eingereiht }}</p>
                    <div class="assistent__suche">
                        <AvmEingabe
                            v-model="ortSuche.text.value"
                            role="combobox"
                            aria-autocomplete="list"
                            :aria-expanded="ortSuche.offen.value"
                            :aria-controls="`${grundId}-ort`"
                            :placeholder="t('wegeditor.assistent.orte.hinzu')"
                            :aria-label="t('wegeditor.assistent.orte.hinzuName')"
                            :gesperrt="schreibt ? undefined : t('wegeditor.assistent.grund.recht')"
                            :testid="`${kennung}-assistent-ort-suche`"
                            @input="ortSuche.eingabe()"
                            @keydown="ortSuche.taste($event)"
                            @blur="ortSuche.verlassen()"
                        />
                        <ul
                            v-if="ortSuche.offen.value"
                            :id="`${grundId}-ort`"
                            class="assistent__vorschlaege"
                            role="listbox"
                        >
                            <li
                                v-if="ortSuche.laedt.value && ortTreffer.length === 0"
                                class="assistent__leise"
                                aria-disabled="true"
                            >
                                {{ t("wegeditor.assistent.sucht") }}
                            </li>
                            <li
                                v-else-if="ortSuche.beantwortet.value && ortTreffer.length === 0"
                                class="assistent__leise"
                                aria-disabled="true"
                            >
                                {{ t("wegeditor.assistent.keineTreffer") }}
                            </li>
                            <li
                                v-for="(ort, k) in ortTreffer"
                                :key="ort.id"
                                role="option"
                                :aria-selected="k === ortSuche.aktiv.value"
                                @pointerdown.prevent="ortSuche.nimm(ortSuche.treffer.value.indexOf(ort))"
                            >
                                <span>{{ ort.name }}</span>
                                <small v-if="antwort.vorschlaege.some((v) => v.id === ort.id)">{{
                                    t("wegeditor.assistent.orte.amNamen")
                                }}</small>
                            </li>
                        </ul>
                    </div>
                </section>

                <!-- Abschnitte auf der Strecke -->
                <section class="assistent__kasten" aria-labelledby="assistent-strecke">
                    <div class="assistent__kopf">
                        <h4 id="assistent-strecke" class="assistent__titel">{{ t("wegeditor.assistent.strecke") }}</h4>
                        <small class="assistent__leise">{{ t("wegeditor.assistent.strecke.hakenWeg") }}</small>
                    </div>
                    <div v-if="zahlen" class="assistent__zahlen" :data-testid="`${kennung}-assistent-zahlen`">
                        <span>{{
                            tPlural("wegeditor.assistent.zahl.abschnitte", zahlen.n, { n: formatNumber(zahlen.n, 0) })
                        }}</span>
                        <span>{{ meilen(zahlen.laenge) }}</span>
                        <span>{{
                            zahlen.geaendert > 0
                                ? tPlural("wegeditor.assistent.zahl.geaendert", zahlen.geaendert, {
                                      n: formatNumber(zahlen.geaendert, 0),
                                  })
                                : t("wegeditor.assistent.zahl.nichts")
                        }}</span>
                    </div>
                    <ol class="assistent__strecke" :data-testid="`${kennung}-assistent-strecke`">
                        <template v-for="paar in paare" :key="paar.i">
                            <li
                                class="assistent__paar"
                                :class="{
                                    'assistent__paar--warn': paar.teil.laenge === null || (paar.teil.umweg ?? 0) >= 1.5,
                                }"
                            >
                                <span class="assistent__paar-name einzeilig"
                                    >{{ paar.i + 1 }}. {{ paar.von }} → {{ paar.nach }}</span
                                >
                                <span>{{
                                    paar.teil.laenge === null
                                        ? t("wegeditor.assistent.paar.keinWeg")
                                        : (paar.teil.umweg ?? 0) >= 1.5
                                          ? t("wegeditor.assistent.paar.umweg", { laenge: meilen(paar.teil.laenge) })
                                          : meilen(paar.teil.laenge)
                                }}</span>
                            </li>
                            <li
                                v-for="a in paar.abschnitte"
                                :key="a.id"
                                class="assistent__abschnitt"
                                :class="{
                                    'assistent__abschnitt--aus': zustandVon(a.id) !== 'fertig' && !wirdGeaendert(a.id),
                                }"
                                :aria-selected="gewaehlt === a.id"
                                tabindex="0"
                                :data-testid="`${kennung}-assistent-abschnitt`"
                                :data-zustand="zustandVon(a.id)"
                                @click="waehle(a)"
                                @keydown.enter="waehle(a)"
                            >
                                <span class="assistent__haken" @click.stop>
                                    <AvmKaestchen
                                        v-if="zustandVon(a.id) !== 'fertig'"
                                        art="checkbox"
                                        :checked="wirdGeaendert(a.id)"
                                        :gesperrt="schreibt ? undefined : t('wegeditor.assistent.grund.recht')"
                                        :testid="`${kennung}-assistent-haken`"
                                        @change="schalte(a.id)"
                                    >
                                        <span class="assistent__verborgen">{{
                                            t(
                                                wirdGeaendert(a.id)
                                                    ? "wegeditor.assistent.haken.aus"
                                                    : "wegeditor.assistent.haken.ein",
                                                { name: abschnittName(a) },
                                            )
                                        }}</span>
                                    </AvmKaestchen>
                                </span>
                                <span class="assistent__kreis">
                                    <span
                                        v-if="zustandVon(a.id) === 'fremd'"
                                        class="assistent__wechsel"
                                        role="img"
                                        :title="t(ZUSTAND_TEXT.fremd)"
                                        :aria-label="t(ZUSTAND_TEXT.fremd)"
                                        >⇄</span
                                    >
                                    <AvmKreis
                                        v-else
                                        :fuellung="FUELLUNG[zustandVon(a.id) as 'fertig' | 'artikel' | 'name']"
                                        :name="t(ZUSTAND_TEXT[zustandVon(a.id)])"
                                    />
                                </span>
                                <span class="assistent__abschnitt-name einzeilig" :title="a.name"
                                    >{{ abschnittName(a) }} <small>{{ a.subtype }}</small></span
                                >
                                <span class="assistent__laenge">{{ meilen(a.laenge) }}</span>
                                <span class="assistent__tun einzeilig">{{ tunText(a) }}</span>
                            </li>
                        </template>
                    </ol>
                    <div v-if="zahlen" class="assistent__legende" :data-testid="`${kennung}-assistent-zaehlung`">
                        <span
                            v-for="z in ZAEHLUNG.filter((z) => modell && (modell.zaehlung[z] > 0 || z !== 'fremd'))"
                            :key="z"
                        >
                            {{ t(ZUSTAND_TEXT[z]) }}
                            <span v-if="z === 'fremd'" aria-hidden="true">⇄</span>
                            <AvmKreis v-else :fuellung="FUELLUNG[z]" :name="t(ZUSTAND_TEXT[z])" />
                            {{ modell?.zaehlung[z] ?? 0 }}
                        </span>
                    </div>
                    <div class="assistent__befunde">
                        <AvmHinweis
                            v-for="(b, k) in befunde"
                            :key="k"
                            :ton="b.art === 'kein-weg' || b.art === 'umweg' ? 'warnung' : 'neutral'"
                            :testid="`${kennung}-assistent-befund-${b.art}`"
                        >
                            <template v-if="b.art === 'zu-wenig'">{{
                                t("wegeditor.assistent.befund.zuWenig")
                            }}</template>
                            <template v-else-if="b.art === 'kein-weg'">{{
                                t("wegeditor.assistent.befund.keinWeg", { von: ortName(b.von), nach: ortName(b.nach) })
                            }}</template>
                            <template v-else-if="b.art === 'umweg'">{{
                                t("wegeditor.assistent.befund.umweg", {
                                    von: ortName(b.von),
                                    nach: ortName(b.nach),
                                    laenge: meilen(b.laenge),
                                    faktor: formatNumber(b.faktor, 1),
                                })
                            }}</template>
                            <template v-else-if="b.art === 'unbekannt'">{{
                                t("wegeditor.assistent.befund.unbekannt", { namen: b.namen.join(", ") })
                            }}</template>
                            <template v-else-if="b.art === 'fremd'">{{
                                tPlural("wegeditor.assistent.befund.fremd", b.anzahl, {
                                    anzahl: formatNumber(b.anzahl, 0),
                                    namen: b.namen.join(", "),
                                })
                            }}</template>
                            <template v-else>{{
                                tPlural(
                                    effektiverKey === null
                                        ? "wegeditor.assistent.befund.fertig"
                                        : "wegeditor.assistent.befund.fertigArtikel",
                                    b.anzahl,
                                    { anzahl: formatNumber(b.anzahl, 0), name: name.trim() },
                                )
                            }}</template>
                            <AvmKnopf
                                v-if="b.art === 'kein-weg' || b.art === 'umweg'"
                                groesse="zeile"
                                class="assistent__befund-knopf"
                                @click="zeigeBefund(b)"
                            >
                                {{ t("wegeditor.assistent.zeigen") }}
                            </AvmKnopf>
                        </AvmHinweis>
                    </div>
                </section>

                <!-- Abseits der Strecke -->
                <section
                    v-if="abseitsAbschnitte.length > 0"
                    class="assistent__kasten"
                    aria-labelledby="assistent-abseits"
                    :data-testid="`${kennung}-assistent-abseits`"
                >
                    <h4 id="assistent-abseits" class="assistent__titel">{{ t("wegeditor.assistent.abseits") }}</h4>
                    <p class="assistent__leise">
                        {{
                            tPlural("wegeditor.assistent.abseits.satz", abseitsAbschnitte.length, {
                                name: name.trim() || antwort.name,
                                n: formatNumber(abseitsAbschnitte.length, 0),
                                laenge: meilen(abseitsLaenge),
                                mit: formatNumber(abseitsMitArtikel, 0),
                            })
                        }}
                    </p>
                    <div class="assistent__chips">
                        <AvmKnopf
                            v-for="o in vorschlaege"
                            :key="o.id"
                            groesse="zeile"
                            :title="t('wegeditor.assistent.abseits.plusZettel')"
                            :gesperrt="schreibt ? undefined : t('wegeditor.assistent.grund.recht')"
                            @click="fuege(o)"
                        >
                            {{ t("wegeditor.assistent.abseits.plus", { name: o.name }) }}
                        </AvmKnopf>
                        <AvmKnopf
                            groesse="zeile"
                            :testid="`${kennung}-assistent-abseits-zeigen`"
                            @click="zeigeAbschnitte(antwort.abseits, abseitsRahmen(antwort))"
                        >
                            {{ t("wegeditor.assistent.zeigen") }}
                        </AvmKnopf>
                    </div>
                    <div class="assistent__wahl" role="radiogroup" :aria-label="t('wegeditor.assistent.abseits')">
                        <AvmKaestchen
                            art="radio"
                            name="assistent-abseits"
                            mehrzeilig
                            :checked="wahl.abseits === 'lassen'"
                            :gesperrt="schreibt ? undefined : t('wegeditor.assistent.grund.recht')"
                            :testid="`${kennung}-assistent-abseits-lassen`"
                            @change="setzeAbseits('lassen')"
                        >
                            <span>{{ t("wegeditor.assistent.abseits.lassen") }}</span>
                        </AvmKaestchen>
                        <AvmKaestchen
                            art="radio"
                            name="assistent-abseits"
                            mehrzeilig
                            :checked="wahl.abseits === 'entfernen'"
                            :gesperrt="schreibt ? undefined : t('wegeditor.assistent.grund.recht')"
                            :testid="`${kennung}-assistent-abseits-entfernen`"
                            @change="setzeAbseits('entfernen')"
                        >
                            <span class="assistent__wahl-text">
                                <span>{{ t("wegeditor.assistent.abseits.entfernen") }}</span>
                                <small>{{ t("wegeditor.assistent.abseits.entfernen.satz") }}</small>
                            </span>
                        </AvmKaestchen>
                    </div>
                </section>

                <!-- Außerdem: Quellen -->
                <section class="assistent__kasten" aria-labelledby="assistent-mit">
                    <h4 id="assistent-mit" class="assistent__titel">{{ t("wegeditor.assistent.ausserdem") }}</h4>
                    <div class="assistent__feld">
                        <span class="assistent__beschriftung">{{ t("wegeditor.assistent.quellen") }}</span>
                        <AvmKaestchen
                            art="checkbox"
                            mehrzeilig
                            :checked="wahl.quellen && quellenAnzahl > 0"
                            :gesperrt="
                                !schreibt
                                    ? t('wegeditor.assistent.grund.recht')
                                    : quellenAnzahl === 0
                                      ? t('wegeditor.assistent.quellen.keine')
                                      : undefined
                            "
                            :testid="`${kennung}-assistent-quellen`"
                            @change="(an: boolean) => (wahl = { ...wahl, quellen: an })"
                        >
                            <span>{{
                                quellenAnzahl === 0
                                    ? t("wegeditor.assistent.quellen.keine")
                                    : tPlural("wegeditor.assistent.quellen.geben", quellenOhne, {
                                          q: formatNumber(quellenAnzahl, 0),
                                          n: formatNumber(quellenOhne, 0),
                                      })
                            }}</span>
                        </AvmKaestchen>
                    </div>
                </section>

                <!-- Zuweisen würde schreiben -->
                <section
                    v-if="vorschauOffen && modell && eingabe"
                    ref="vorschauKasten"
                    class="assistent__kasten"
                    aria-labelledby="assistent-schreibt"
                    :data-testid="`${kennung}-assistent-schreibt`"
                >
                    <h4 id="assistent-schreibt" class="assistent__titel">{{ t("wegeditor.assistent.schreibt") }}</h4>
                    <ul class="assistent__schreibt">
                        <li>{{ t("wegeditor.assistent.schreibt.schritt") }}</li>
                        <li>{{ t("wegeditor.assistent.schreibt.nur") }}</li>
                        <li v-if="modell.schreibt.name > 0">
                            {{
                                tPlural("wegeditor.assistent.schreibt.name", modell.schreibt.name, {
                                    name: name.trim(),
                                    n: formatNumber(modell.schreibt.name, 0),
                                })
                            }}
                        </li>
                        <li v-if="modell.schreibt.artikel > 0">
                            {{
                                tPlural("wegeditor.assistent.schreibt.artikel", modell.schreibt.artikel, {
                                    artikel: artikel?.name ?? effektiverKey ?? "",
                                    n: formatNumber(modell.schreibt.artikel, 0),
                                })
                            }}
                            <template v-if="modell.schreibt.artikelErsetzt">{{
                                t("wegeditor.assistent.schreibt.artikelErsetzt")
                            }}</template>
                        </li>
                        <li v-if="modell.schreibt.quellen > 0">
                            {{
                                tPlural("wegeditor.assistent.schreibt.quellen", modell.schreibt.quellen, {
                                    n: formatNumber(modell.schreibt.quellen, 0),
                                })
                            }}
                        </li>
                        <li v-if="modell.schreibt.abseits > 0">
                            {{
                                tPlural("wegeditor.assistent.schreibt.abseits", modell.schreibt.abseits, {
                                    n: formatNumber(modell.schreibt.abseits, 0),
                                })
                            }}
                        </li>
                        <li>{{ t("wegeditor.assistent.schreibt.sperre") }}</li>
                    </ul>
                    <div class="assistent__zeile">
                        <AvmKnopf
                            art="gefuellt"
                            :gesperrt="laeuft ? t('wegeditor.assistent.grund.laeuft') : undefined"
                            :testid="`${kennung}-assistent-wirklich`"
                            @click="zuweisen"
                        >
                            {{ t("wegeditor.assistent.zuweisen.wirklich") }}
                        </AvmKnopf>
                        <AvmKnopf
                            :gesperrt="laeuft ? t('wegeditor.assistent.grund.laeuft') : undefined"
                            @click="vorschauOffen = false"
                        >
                            {{ t("wegeditor.assistent.zurueck") }}
                        </AvmKnopf>
                    </div>
                </section>
            </template>
        </div>

        <template #fuss-hinweis>
            <span role="status" :data-testid="`${kennung}-assistent-fuss`">{{ fussSatz }}</span>
        </template>
        <template #fuss-haupt>
            <AvmKnopf
                :title="t('wegeditor.assistent.verwerfen.zettel')"
                :gesperrt="laeuft ? t('wegeditor.assistent.grund.laeuft') : undefined"
                :testid="`${kennung}-assistent-verwerfen`"
                @click="verwerfen"
            >
                {{ t("wegeditor.assistent.verwerfen") }}
            </AvmKnopf>
            <AvmKnopf art="gefuellt" :gesperrt="grundText" :testid="`${kennung}-assistent-zuweisen`" @click="vorschau">
                {{ t("wegeditor.assistent.zuweisen") }}
            </AvmKnopf>
        </template>
    </AvmFenster>
</template>

<style scoped>
/* Maße und Farben aus dem Kanon (`fenster-huelle.test.ts`); gekürzt wird nur über `.einzeilig` (`design-canon.test.ts`). */
.assistent {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    min-width: 0;
}

.assistent__kasten {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
    padding-top: var(--divider-gap);
    border-top: 1px solid var(--color-divider);
}

.assistent__kasten:first-of-type {
    padding-top: 0;
    border-top: 0;
}

.assistent__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4) var(--space-8);
}

.assistent__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.assistent__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.assistent__hinweis {
    margin: 0;
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-small);
}

.assistent__feld {
    display: grid;
    grid-template-columns: var(--avm-field-label-w) minmax(0, 1fr);
    gap: var(--space-8);
    align-items: center;
}

.assistent__beschriftung {
    color: var(--color-text-muted);
}

.assistent__feldinhalt {
    min-width: 0;
}

.assistent__artikel {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
    padding: var(--space-4) var(--space-4) var(--space-4) var(--space-8);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft, var(--color-panel));
}

.assistent__artikel-text {
    flex: 1 1 auto;
    min-width: 0;
}

/* ✕ und Griff: nackte Zeichenknöpfe in der Zeile (Ruhe gedämpft, Hover Wäsche bzw. Gefahr, Fokusring, 120 ms, gesperrt ohne Hover). */
.assistent__weg,
.assistent__griff {
    flex: none;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    transition:
        background-color 120ms ease,
        color 120ms ease;
}

.assistent__weg {
    width: var(--icon-lg);
    height: var(--icon-lg);
}

.assistent__weg:hover:not(:disabled) {
    background: var(--color-danger-soft);
    color: var(--color-danger);
}

.assistent__griff {
    height: var(--space-24);
    padding: 0;
    cursor: grab;
    letter-spacing: -0.15em;
    touch-action: none;
}

.assistent__griff:hover:not(:disabled) {
    background: var(--color-hover-wash);
}

.assistent__weg:focus-visible,
.assistent__griff:focus-visible,
.assistent__abschnitt:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.assistent__weg:disabled,
.assistent__griff:disabled {
    cursor: default;
}

.assistent__verlauf {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-4);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.assistent__verlauf b {
    color: var(--color-text);
    font-weight: normal;
}

.assistent__verlauf s {
    text-decoration-color: var(--color-text-muted);
}

/* Orte */
.assistent__orte {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

.assistent__ort {
    position: relative;
    display: grid;
    grid-template-columns: var(--space-20) var(--space-20) minmax(0, 1fr) auto auto;
    align-items: center;
    gap: var(--space-6);
    min-height: var(--avm-control-h);
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background-color 120ms ease;
}

.assistent__ort:hover {
    background: var(--color-hover-wash);
}

.assistent__ort--zieht {
    z-index: 2;
    background: var(--color-panel-active);
    box-shadow: var(--shadow-drag-lift);
    transition: none;
}

.assistent__ort--ziel::before {
    position: absolute;
    top: calc(var(--space-2) / -2);
    right: 0;
    left: 0;
    border-top: 2px solid var(--color-accent-strong);
    content: "";
}

.assistent__nr {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: var(--icon-md);
    height: var(--icon-md);
    border: 2px solid var(--color-marker-waypoint);
    border-radius: 50%;
    background: var(--color-panel);
    color: var(--color-text-strong);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
}

.assistent__ort-name,
.assistent__abschnitt-name,
.assistent__paar-name {
    min-width: 0;
}

.assistent__ort-name small,
.assistent__abschnitt-name small {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.assistent__weit,
.assistent__laenge {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    text-align: right;
}

/* Suche und Vorschläge: Die Liste überlagert, sie verschiebt nicht. */
.assistent__suche {
    position: relative;
}

.assistent__vorschlaege {
    position: absolute;
    top: calc(100% + var(--space-2));
    right: 0;
    left: 0;
    z-index: 6;
    max-height: 14lh;
    margin: 0;
    padding: var(--space-2);
    overflow: auto;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    list-style: none;
}

.assistent__vorschlaege li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-6);
    padding: var(--space-2) var(--space-8);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background-color 120ms ease;
}

.assistent__vorschlaege li > span:first-child {
    min-width: 0;
}

.assistent__vorschlaege li[aria-selected="true"],
.assistent__vorschlaege li:hover {
    background: var(--color-active-wash);
}

.assistent__vorschlaege li[aria-disabled="true"] {
    background: none;
    cursor: default;
}

.assistent__vorschlaege small {
    color: var(--color-text-muted);
    white-space: nowrap;
}

/* Strecke */
.assistent__zahlen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-12);
    color: var(--color-text-strong);
    font-variant-numeric: tabular-nums;
}

.assistent__strecke {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

.assistent__paar {
    display: flex;
    justify-content: space-between;
    gap: var(--space-6);
    padding: var(--space-4) var(--space-2) var(--space-2);
    border-top: 1px solid var(--color-divider);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.assistent__paar:first-child {
    padding-top: 0;
    border-top: 0;
}

.assistent__paar-name {
    color: var(--color-text);
}

.assistent__paar--warn .assistent__paar-name {
    color: var(--color-warning-soft-text);
}

.assistent__abschnitt {
    display: grid;
    grid-template-columns: var(--icon-md) var(--icon-sm) minmax(0, 1fr) auto minmax(0, auto);
    align-items: center;
    gap: 0 var(--space-6);
    min-height: var(--space-24);
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background-color 120ms ease;
}

.assistent__abschnitt:hover {
    background: var(--color-hover-wash);
}

.assistent__abschnitt[aria-selected="true"] {
    background: var(--color-active-wash);
}

.assistent__kreis {
    display: grid;
    place-items: center;
}

.assistent__wechsel {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: 1;
}

.assistent__tun {
    min-width: 0;
    text-align: right;
    font-size: var(--font-size-small);
}

.assistent__abschnitt--aus .assistent__abschnitt-name,
.assistent__abschnitt--aus .assistent__tun {
    color: var(--color-text-muted);
}

.assistent__abschnitt--aus .assistent__abschnitt-name {
    text-decoration: line-through;
    text-decoration-color: var(--color-text-muted);
}

/* Nur für Vorleser: der Name des Hakens, den die Zeile schon zeigt. */
.assistent__verborgen {
    position: absolute;
    width: 0;
    height: 0;
    overflow: hidden;
    white-space: nowrap;
}

.assistent__legende {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-6);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-divider);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.assistent__legende > span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
}

.assistent__befunde {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.assistent__befund-knopf {
    margin-top: var(--space-4);
}

/* Abseits, Quellen, Vorschau */
.assistent__chips,
.assistent__zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6);
}

.assistent__wahl {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.assistent__wahl-text {
    display: flex;
    flex-direction: column;
}

.assistent__wahl small {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.assistent__schreibt {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding-left: var(--space-16);
}

@media (prefers-reduced-motion: reduce) {
    .assistent__ort,
    .assistent__abschnitt,
    .assistent__weg,
    .assistent__griff,
    .assistent__vorschlaege li {
        transition: none;
    }
}
</style>
