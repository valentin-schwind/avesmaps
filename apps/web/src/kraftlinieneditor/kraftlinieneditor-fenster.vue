<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
    EDITORPANEL,
    KRAFTLINIENEDITOR,
    kraftlinienGestalt,
    type EditorPowerlineDetail,
    type EditorPowerlineList,
    type EditorPowerlineNode,
    type EditorPowerlineSegment,
} from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import EditorZeichen from "../controls/editor-zeichen.vue";
import { phoneViewport } from "../controls/phone-viewport";
import EditorListe from "../editor-liste/editor-liste.vue";
import type { ListenEinstellung } from "../editor-liste/listen-einstellung";
import type { WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import AvmFenster from "../fenster/avm-fenster.vue";
import EntwurfFuss from "../fenster/entwurf-fuss.vue";
import EntwurfKonflikt from "../fenster/entwurf-konflikt.vue";
import type { Verlauf } from "../fenster/entwurf-verlauf";
import EntwurfVerlauf from "../fenster/entwurf-verlauf.vue";
import type { FensterBox } from "../fenster/fenster-lage";
import FensterReiter from "../fenster/fenster-reiter.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { herkunftIm, mitHerkunft } from "../fenster/wiki-feld";
import FensterFeldzeile from "../fenster/fenster-feldzeile.vue";
import WikiFeld from "../fenster/wiki-feld.vue";
import WikiBox from "../fenster/wiki-box.vue";
import type { WikiBoxFeld } from "../fenster/wiki-box";
import { formatNumber, t, tPlural } from "../i18n/i18n";
import { listenBreite } from "../fenster/listen-schalter";
import {
    KRAFTLINIEN_LEGENDE,
    KRAFTLINIEN_OPTIONEN,
    KRAFTLINIEN_SORTIERUNGEN,
    endName,
    facettenName,
    gestaltName,
    sortierungsName,
    wertName,
    zeileVon,
} from "./kraftlinien-liste";
import { felderAus, type KraftlinieFelder } from "./kraftlinie-art";
import {
    allesAufWiki,
    aufWiki,
    eigeneWerte,
    kraftlinieWikiLage,
    nurWiki,
    type KraftlinieNurWiki,
    type KraftlinieWikiFeld,
} from "./kraftlinie-wiki-felder";
import type { KraftlinieBearbeitung } from "./kraftlinie-kurve";
import type { KraftlinieSammel } from "./kraftlinie-sammel";
import KraftlinieSammelAnsicht from "./kraftlinie-sammel.vue";

/**
 * Der Kraftlinien-Editor (WI-0205 Pakete K2, K6, K8; Blatt Kraftlinien; EDIT-0003 T44): ein Werkzeugfenster wie der Landschaftseditor
 * (rechts angedockt, « » klappt die Liste ein), links die Linien (eine Zeile je Name), rechts die Eigenschaften der Linie DIESES Fensters.
 * Je Linie ein Fenster (T44, D19).
 *
 * - 🔴 **Die Nodices stehen als Kasten in den Eigenschaften** (EDIT-0003 T28 (2), Betreiber: „die nodices sind eigenschaften“); das
 *   Fenster bleibt zweispaltig. Die Kette folgt der Linie vom westlichen Ende her, je Abschnitt seine Kurve; „trifft:“ nennt die anderen
 *   Linien am Nodix. Ein Klick auf „zeigen“ fliegt hin.
 * - Ein Klick in der Liste wählt und stellt die Karte auf die Ansicht „Kraftlinien“, ohne Flug (F17); Doppelklick und Enter fliegen
 *   dazu zum Rahmen der Bahn (T32). Beides macht `app.vue` über die gemeinsame Zuordnung (`ansichtFuerHinflug`).
 * - **Bearbeiten** (K6, K8 auf O3, `fenster/bearbeitung.ts`): Name, Beschriftung und Beschreibung sind Felder des EINEN Entwurfs der
 *   Linie, zusammen mit der Form aus „Kurve bearbeiten“. Die erste Änderung beginnt die Bearbeitung (Sperre, Leiste mit „Fertig“ auf
 *   der Karte); ein Feld ist ein Schritt, sobald man es verlässt (T44). Der Fuß zeigt nur „n ungespeichert“ und den Zustand, Konflikt
 *   und „Sperre abgelaufen“ stehen als Kasten über den Reitern. Die Kette zeigt den Bogen des Entwurfs. Ohne Schreibrecht bleibt das
 *   Fenster lesend („nur lesen“).
 * - **Verlauf** (Reiter, gemeinsamer Verlauf `fenster/entwurf-verlauf.vue`): jede Operation an der Linie, ↺ als neue Operation, nur
 *   solange nicht bearbeitet wird (T44).
 * - **Nodices im Entwurf** (T28 (5), R5): Die Kette zeigt den Entwurf, sobald die Kurve anhängt; „✕“ an einem Nodix nimmt ihn aus der
 *   Linie (die Nachbarn verbinden sich), „✚ Nodix anfügen“ verbindet einen Knoten der Linie mit einem weiteren Nodix (Legacy „+ Nodix
 *   hinzufügen“). Beides hängt die Kurve an und ist ein Schritt; „Fertig“ schreibt alles in EINER Operation.
 * - **Entfernen in zwei Stufen** (K10, EDIT-0003 T43, wie Wege und Ort): „Von der Karte nehmen“ (die Linie bleibt unter „Nicht auf der
 *   Karte“) oder „Ganz löschen“ (weich). Eine Linie, die nicht auf der Karte ist, steht lesend da, mit „Zurück auf die Karte“ oder
 *   „Zurückholen“; beides geht auch über den Verlauf.
 * - **Telefon:** Liste und Eigenschaften als Drill-down mit „‹ Liste“, wie Orts- und Landschaftseditor.
 * - **Mehrfachauswahl** (WI-0238, EDIT-0003 T57): Umschalter und Häkchen der Liste (`v-model:mehrfach`, `v-model:angehakt`, gehalten in
 *   der Steuerung); ab zwei angehakten Linien stehen statt der Eigenschaften EINER Linie die aller (`kraftlinie-sammel.vue`): ↺ auf
 *   Wiki-Werte und „Entfernen …“ für alle, alles andere „Nur einzeln“.
 */
const props = defineProps<{
    fenster: WerkzeugFenster;
    liste: EditorPowerlineList | undefined;
    ladeFehler: string | undefined;
    einstellung: ListenEinstellung;
    /** Die Bearbeitung der Linie dieses Fensters (`kraftlinieneditor-steuerung.ts`); ohne Linie keine. */
    bearbeitung: KraftlinieBearbeitung | undefined;
    /** Der Verlauf der Linie dieses Fensters; ohne ihn kein Reiter „Verlauf“. */
    verlauf?: Verlauf<unknown> | undefined;
    /** Liegt die Kurve dieser Linie gerade auf der Karte? */
    kurveLaeuft?: boolean | undefined;
    /** Die Nodices, an die angefügt werden kann (aus der laufenden Kurve); leer, solange sie nicht läuft. */
    kandidaten?: readonly { readonly id: string; readonly name: string }[] | undefined;
    /** Ein Handgriff verlangt „Nodix anfügen“ (Kartenmenü); `mal` zählt die Wünsche. */
    anfuegenWunsch?: number | undefined;
    ablageZiel: () => DOMRect | undefined;
    /** Darf Felder schreiben (`edit_map_objects`) und die Form (`edit_map_geometry`), und ist Bearbeiten an (`MAP_EDITING`)? */
    darfFelder?: boolean | undefined;
    darfForm?: boolean | undefined;
    /** Die Linie, deren Entfernen gerade nachgefragt wird (EDIT-0003 T39, aus dem Kartenmenü). */
    entfernenFrage?: string | undefined;
    /** Läuft das Entfernen gerade? Dann ist „Entfernen“ gesperrt. */
    entferntGerade?: boolean | undefined;
    /** Ist die Liste eingezogen? Der Schalter liegt in `app.vue` (`listenSchalter`). */
    listeZu?: boolean | undefined;
    /** Die Mehrfachauswahl dieses Fensters (WI-0238): an oder aus und die Häkchen, gehalten in der Steuerung. */
    mehrfach?: { readonly mehrfach: boolean; readonly angehakt: readonly string[] } | undefined;
    /** Ab zwei angehakten Linien die Sammelansicht (`kraftlinie-sammel.ts`). */
    sammel?: KraftlinieSammel | undefined;
}>();
const emit = defineEmits<{
    "update:auswahl": [id: string | undefined];
    /** Doppelklick und Enter: zum Rahmen der Bahn fliegen. */
    fliege: [bounds: [number, number, number, number]];
    /** „zeigen“ am Nodix: zu diesem Punkt fliegen. */
    zeige: [x: number, y: number];
    lage: [lage: "angedockt" | "geloest" | "versenkt", box?: FensterBox];
    box: [box: FensterBox];
    vorn: [];
    schliesse: [];
    erneut: [];
    /** „Kurve bearbeiten“: die Form dieser Linie an die Karte. */
    kurve: [];
    /** Die Nachfrage zum Entfernen: bestätigt (mit der Stufe) oder abgebrochen. */
    entfernen: [wahl: "abnehmen" | "loeschen"];
    abbrechenEntfernen: [];
    /** „Zurück auf die Karte“ (abgenommen) oder „Zurückholen“ (gelöscht). */
    zurueck: [];
    /** Einen Nodix aus der Linie nehmen (R5). */
    herausnehmen: [knoten: string];
    /** „✚ Nodix anfügen“: von einem Knoten der Linie zu einem Nodix; ohne Ziel nur die Kurve anhängen (damit die Nodices laden). */
    anfuegen: [von: string, nach: string | undefined];
    listeZu: [zu: boolean];
    /** Der Umschalter „Mehrfachauswahl“ und die Häkchen der Liste. */
    mehrfach: [an: boolean];
    angehakt: [ids: readonly string[]];
}>();

const kennung = computed(() => `kraftlinieneditor-${props.fenster.id}`);
/** Die Linie dieses Fensters (je Linie ein Fenster, T44), unter ihrem Anker. */
const auswahl = computed(() => props.fenster.gegenstand);
const detail = computed((): EditorPowerlineDetail | undefined => props.bearbeitung?.detail.value);
const detailFehler = computed(() => {
    const art = props.bearbeitung?.zustand.value.art;
    if (art === "fehlt") return t("entwurf.fehlt");
    if (art === "lesefehler") return t("entwurf.lesefehler");
    return undefined;
});
const stand = computed(() => props.bearbeitung?.stand.value);
/** Nicht auf der Karte (K10): dann steht die Linie lesend da. */
const linienStand = computed(() => detail.value?.state);
const schreibt = computed(
    () =>
        props.darfFelder === true &&
        props.bearbeitung !== undefined &&
        detail.value !== undefined &&
        linienStand.value === undefined,
);
const formGeht = computed(
    () => props.darfForm === true && props.bearbeitung !== undefined && linienStand.value === undefined,
);
const konflikt = computed(() => {
    const zustand = props.bearbeitung?.zustand.value;
    return zustand?.art === "konflikt" ? zustand : undefined;
});
/** Die Namen der Teile im Konfliktkasten. */
function teilName(teil: string): string {
    if (teil === "name") return t("kraftlinieneditor.feld.name");
    if (teil === "beschriftung") return t("kraftlinieneditor.feld.beschriftung");
    if (teil === "beschreibung") return t("kraftlinieneditor.feld.beschreibung");
    if (teil === "wiki") return t("kraftlinieneditor.abschnitt.wiki");
    return t("entwurf.form");
}
function setze<K extends keyof KraftlinieFelder>(feld: K, wert: KraftlinieFelder[K], verschmelze?: string): void {
    props.bearbeitung?.feld((felder) => ({ ...felder, [feld]: wert }), verschmelze);
}
const offen = computed({
    get: () => true,
    set: (auf: boolean) => {
        if (!auf) emit("schliesse");
    },
});
/** Am Telefon gibt es kein gelöstes Fenster. */
const lage = computed(() =>
    phoneViewport.value && props.fenster.lage === "geloest" ? "angedockt" : props.fenster.lage,
);

// --- Die Liste: Facetten aus dem Register ---
const facetten = (EDITORPANEL.eintraege.find((x) => x.id === "kraftlinien") as { facetten: readonly string[] })
    .facetten;
const optionen = { ...KRAFTLINIEN_OPTIONEN, facetten };
const sortierungen = KRAFTLINIEN_SORTIERUNGEN.map((wert) => ({ wert, text: sortierungsName(wert) }));
const legende = KRAFTLINIEN_LEGENDE();
const zeilen = computed(() => (props.liste?.rows ?? []).map(zeileVon));
/**
 * In der Mehrfachauswahl hakt ein Klick an und wählt nicht: Je Linie ein Fenster (T44, D19), ein gemeldeter Klick legte dieses Fenster
 * samt Sammelansicht ab. Den Anker für Umschalt-Klick hält die Liste dann hier.
 */
/** Bleibt in der Mehrfachauswahl genau eine angehakt, meldet die Liste sie als Klick: Das Fenster zeigt sie wie einzeln gewählt. */
function einzelnAngehakt(id: string): void {
    if (props.mehrfach?.mehrfach === true) emit("update:auswahl", id);
}
const mehrfachAnker = ref<string | undefined>(undefined);
watch(
    () => props.mehrfach?.mehrfach === true,
    () => (mehrfachAnker.value = undefined),
);
const gewaehlt = computed({
    get: () => (props.mehrfach?.mehrfach === true ? (mehrfachAnker.value ?? auswahl.value) : auswahl.value),
    set: (id: string | undefined) => {
        if (props.mehrfach?.mehrfach === true) {
            mehrfachAnker.value = id;
            return;
        }
        emit("update:auswahl", id);
        if (id !== undefined && phoneViewport.value) telefonSeite.value = "eigenschaften";
    },
});
const zeile = computed(() => props.liste?.rows.find((row) => row.id === auswahl.value));
/** Der Kopf der Eigenschaften: aus der Liste, sonst (gelöscht, nicht in der Liste) aus dem Detail. */
const kopf = computed(() => {
    if (zeile.value !== undefined)
        return { name: zeileVon(zeile.value).name, shape: zeile.value.shape, segments: zeile.value.segments };
    const d = detail.value;
    return d === undefined
        ? undefined
        : { name: d.name.trim() === "" ? "…" : d.name, shape: d.shape, segments: d.segments.length };
});
function fliege(id: string): void {
    const bounds = props.liste?.rows.find((row) => row.id === id)?.bounds;
    if (bounds !== undefined) emit("fliege", bounds);
}

// --- « » wie der Landschaftseditor ---
// Der Schalter liegt in `app.vue` (`listenSchalter`), wie beim Ortseditor: Nur so rücken die Laschen „Info“/„Editor“ mit (`slotBreite`).
const zu = computed(() => props.listeZu === true && !phoneViewport.value);
const einzug = computed(() => (phoneViewport.value ? undefined : zu.value ? listenBreite() : 0));
const schalterText = computed(() => t(zu.value ? "ortseditor.liste.ausklappen" : "ortseditor.liste.einklappen"));
const telefonSeite = ref<"liste" | "eigenschaften">("liste");

// --- Die Eigenschaften ---
type Reiter = (typeof KRAFTLINIENEDITOR)["eintraege"][number]["id"];
const reiter = ref<Reiter>("eigenschaften");
const REITER_NAMEN = {
    eigenschaften: () => t("kraftlinieneditor.reiter.eigenschaften"),
    verlauf: () => t("kraftlinieneditor.reiter.verlauf"),
} as const satisfies Record<Reiter, () => string>;
// Die Nachfrage zum Entfernen steht in den Eigenschaften: Fragt die Karte, kommt der Reiter nach vorn.
watch(
    () => props.entfernenFrage !== undefined && props.entfernenFrage === auswahl.value,
    (fragt) => {
        if (fragt) reiter.value = "eigenschaften";
    },
    { immediate: true },
);
/** Die Namen der Felder im Verlauf (und in seinem Konflikt), wie das Protokoll sie führt. */
function verlaufFeldName(feld: string): string {
    if (feld === "labelVisible") return t("kraftlinieneditor.feld.beschriftungAn");
    if (feld === "curve") return t("kraftlinieneditor.verlauf.bogen");
    if (feld === "from") return t("kraftlinieneditor.verlauf.von");
    if (feld === "to") return t("kraftlinieneditor.verlauf.bis");
    if (feld === "active") return t("verlauf.aktiv");
    if (feld === "offMap") return t("kraftlinieneditor.verlauf.offMap");
    if (feld === "stand") return t("kraftlinieneditor.verlauf.stand");
    if (feld === "wiki") return t("kraftlinieneditor.abschnitt.wiki");
    return teilName(feld === "description" ? "beschreibung" : feld);
}
/** Ein Wert im Verlauf: der Bogen wie in der Kette, ein Knoten mit seinem Namen. */
function verlaufWert(feld: string, wert: unknown): string | undefined {
    if (feld === "curve" && (typeof wert === "number" || wert === null)) return bogenText(wert);
    if ((feld === "from" || feld === "to") && typeof wert === "string") {
        const knoten = knotenVon.value.get(wert);
        return knoten === undefined ? undefined : knotenName(knoten);
    }
    return undefined;
}
const reiterListe = computed(() =>
    KRAFTLINIENEDITOR.eintraege.map((eintrag) => ({ id: eintrag.id, name: REITER_NAMEN[eintrag.id]() })),
);
const titel = computed(() => {
    const n = props.sammel?.ids.length;
    if (n !== undefined)
        return `${t("kraftlinieneditor.titel")} · ${tPlural("kraftlinieneditor.sammel.gewaehlt", n, { n: formatNumber(n, 0) })}`;
    return kopf.value ? `${t("kraftlinieneditor.titel")} · ${kopf.value.name}` : t("kraftlinieneditor.titel");
});
/** Der Fuß zeigt den Entwurf, der gerade gilt: mit Sammelansicht ihren, sonst den der Linie. */
const fussEntwurf = computed(() => props.sammel?.entwurf ?? props.bearbeitung);

/** Die Nodices in der Folge der Kette (Strang und Ring), sonst die Abschnitte und danach die Knoten (verzweigt, in Teilen). */
type Glied =
    | { art: "knoten"; knoten: EditorPowerlineNode; ende: boolean; zurueck: boolean }
    | { art: "abschnitt"; abschnitt: EditorPowerlineSegment; mitNamen: boolean }
    | { art: "zwischen"; text: string };
/**
 * Die Linie, wie die Kette sie zeigt: ohne angehängte Kurve der gelesene Stand, mit ihr der Entwurf (herausgenommene Abschnitte fehlen,
 * angefügte stehen mit ihrem neuen Nodix da).
 */
const linie = computed((): { segments: EditorPowerlineSegment[]; nodes: EditorPowerlineNode[] } | undefined => {
    const d = detail.value;
    if (!d) return undefined;
    const form = stand.value?.form;
    if (form === undefined) return { segments: d.segments, nodes: d.nodes };
    const alt = new Map(d.segments.map((a) => [a.id, a]));
    const segments = Object.entries(form.enden).map(([id, e]): EditorPowerlineSegment => ({
        ...(alt.get(id) ?? { id, curve: null, labelVisible: false, revision: 0 }),
        id,
        from: e.from,
        to: e.to,
    }));
    const da = new Set(d.nodes.map((k) => k.id));
    const neu = Object.entries(form.knoten ?? {})
        .filter(([id]) => !da.has(id))
        .map(([id, k]): EditorPowerlineNode => ({
            id,
            kind: k.kind,
            name: k.name,
            x: k.x,
            y: k.y,
            nodix: true,
            meets: [],
        }));
    const genutzt = new Set(segments.flatMap((a) => [a.from, a.to]));
    return { segments, nodes: [...d.nodes, ...neu].filter((k) => genutzt.has(k.id)) };
});
const knotenVon = computed(() => new Map((linie.value?.nodes ?? []).map((k) => [k.id, k])));
const abschnittVon = computed(() => new Map((linie.value?.segments ?? []).map((a) => [a.id, a])));
const kette = computed<Glied[]>(() => {
    const d = linie.value;
    if (!d) return [];
    const gestalt = kraftlinienGestalt(
        d.segments.map((a) => ({ id: a.id, from: a.from, to: a.to })),
        (id) => {
            const k = knotenVon.value.get(id);
            return k?.x !== undefined && k.y !== undefined ? [k.x, k.y] : undefined;
        },
    );
    const glieder: Glied[] = [];
    if (gestalt.kette.length > 0) {
        gestalt.kette.forEach((g, i) => {
            if ("abschnitt" in g) {
                const abschnitt = abschnittVon.value.get(g.abschnitt);
                if (abschnitt) glieder.push({ art: "abschnitt", abschnitt, mitNamen: false });
                return;
            }
            const knoten = knotenVon.value.get(g.knoten);
            if (knoten)
                glieder.push({
                    art: "knoten",
                    knoten,
                    ende: gestalt.shape === "strang" && (i === 0 || i === gestalt.kette.length - 1),
                    zurueck: g.zurueck === true,
                });
        });
        return glieder;
    }
    glieder.push({ art: "zwischen", text: t("kraftlinieneditor.nodices.abschnitte") });
    for (const abschnitt of d.segments) glieder.push({ art: "abschnitt", abschnitt, mitNamen: true });
    glieder.push({ art: "zwischen", text: t("kraftlinieneditor.nodices.knoten") });
    for (const knoten of d.nodes)
        glieder.push({ art: "knoten", knoten, ende: gestalt.enden.includes(knoten.id), zurueck: false });
    return glieder;
});
const knotenName = (k: EditorPowerlineNode | undefined): string =>
    k === undefined
        ? t("kraftlinieneditor.knoten.fehlt")
        : k.kind === "missing"
          ? t("kraftlinieneditor.knoten.fehlt")
          : endName(k.name ?? "");
const knotenArt = (k: EditorPowerlineNode): string => {
    if (k.kind === "missing") return t("kraftlinieneditor.knoten.verweisLeer");
    if (k.kind === "nodix") return t("kraftlinieneditor.knoten.punkt");
    if (k.kind === "label")
        return k.nodix ? t("kraftlinieneditor.knoten.labelMitNodix") : t("kraftlinieneditor.knoten.labelOhneNodix");
    if (k.kind === "landmark")
        return k.nodix
            ? t("kraftlinieneditor.knoten.landmarkeMitNodix")
            : t("kraftlinieneditor.knoten.landmarkeOhneNodix");
    return k.nodix ? t("kraftlinieneditor.knoten.ortMitNodix") : t("kraftlinieneditor.knoten.ortOhneNodix");
};
// --- Bearbeiten (K6, K8 auf O3): der Bogen des Entwurfs, sobald die Form angehängt ist ---
const kurveImEntwurf = computed(
    () => new Map((stand.value?.form?.teile ?? []).map((teil) => [teil.objekt, teil.wert ?? null] as const)),
);
function bogenText(bogen: number | null | undefined): string {
    const wert = Math.round(bogen ?? 0);
    return `⌒ ${wert > 0 ? "+" : wert < 0 ? "−" : "±"}${formatNumber(Math.abs(wert), 0)} %`;
}
const kurveText = (abschnitt: EditorPowerlineSegment): string =>
    bogenText(kurveImEntwurf.value.has(abschnitt.id) ? kurveImEntwurf.value.get(abschnitt.id) : abschnitt.curve);
const beschriftung = computed(() => {
    const teile = detail.value?.segments ?? [];
    const an = teile.filter((a) => a.labelVisible).length;
    if (an === 0) return t("editorListe.nein");
    return an === teile.length
        ? t("editorListe.ja")
        : t("kraftlinieneditor.beschriftung.teil", { n: an, von: teile.length });
});
// --- Die Wiki-Box (WI-0253): der Artikel der Linie (je LINIE wie Legacy), Zuweisen · Sync · Entfernen. Sie wirkt auf dem Server, nicht im Entwurf;
// darum sperrt sie bei ungespeicherten Änderungen, und nach einer Änderung liest das Fenster die Linie neu. ---
const wikiBoxUngespeichert = computed(() => {
    const lage = props.bearbeitung?.lage.value;
    return lage !== undefined && (lage.ungespeichert > 0 || lage.form);
});
const wikiBoxLesestand = computed(() => detail.value?.segments.map((a) => a.revision).join(",") ?? "");
function wikiBoxFeld(feld: KraftlinieWikiFeld, name: string): WikiBoxFeld | undefined {
    const jetzt = felderJetzt.value;
    if (jetzt === undefined) return undefined;
    const lage = kraftlinieWikiLage(jetzt, feld, !schreibbar.value);
    return {
        id: feld,
        plan: [feld],
        name,
        lage,
        folgt: herkunftIm(jetzt, feld) === "wiki",
        eigen: jetzt[feld],
        mehrzeilig: feld === "description",
    };
}
const wikiBoxFelder = computed((): WikiBoxFeld[] =>
    [
        wikiBoxFeld("name", t("kraftlinieneditor.feld.name")),
        wikiBoxFeld("description", t("kraftlinieneditor.feld.beschreibung")),
    ].filter((feld): feld is WikiBoxFeld => feld !== undefined),
);
function wikiGeaendert(): void {
    void props.bearbeitung?.neuLesen();
    emit("erneut");
}

// --- Die Felder mit Wiki-Wert (WI-0225, Design Guide §13.8): Name und Beschreibung, dazu lesend, was nur das Wiki führt ---
/** Die Felder, die das Fenster zeigt: im Entwurf, sonst (ohne Schreibrecht) der gelesene Stand. */
const felderJetzt = computed(() => stand.value?.felder ?? (detail.value ? felderAus(detail.value) : undefined));
const schreibbar = computed(() => schreibt.value && stand.value !== undefined);
const NUR_WIKI_NAME: Record<KraftlinieNurWiki, () => string> = {
    staerke: () => t("infoPanel.field.staerke"),
    affinitaet: () => t("infoPanel.field.affinitaet"),
    laenge: () => t("infoPanel.field.laenge"),
    regionen: () => t("infoPanel.field.regionen"),
};
/** Getippt ist manual, auch beim Wortlaut des Wiki (WI-0225); Tippen in einem Feld ist EIN Schritt bis zum Verlassen. */
function tippe(feld: KraftlinieWikiFeld, wert: string): void {
    props.bearbeitung?.feld((felder) => mitHerkunft(felder, feld, wert, "manual"), feld);
}
/** ↺ ist EIN Schritt (ohne Verschmelzen); geschrieben wird mit „Fertig“. */
function zurueckAufWiki(feld: KraftlinieWikiFeld): void {
    props.bearbeitung?.feldVerlassen();
    props.bearbeitung?.feld((felder) => aufWiki(felder, feld));
}
/** „↺ Alles auf Wiki-Werte (n)“ im Kopf, nur mit Bearbeitung und Artikel; bei null gesperrt, den Grund sagt „Identität“. */
const wikiZahl = computed(() => (stand.value ? eigeneWerte(stand.value.felder) : 0));
const wikiKnopf = computed(() => schreibbar.value && stand.value?.felder.wiki != null);
function allesZurueck(): void {
    props.bearbeitung?.feldVerlassen();
    props.bearbeitung?.feld((felder) => allesAufWiki(felder));
}

// --- „✚ Nodix anfügen“ (Legacy „+ Nodix hinzufügen“): verbinden von einem Knoten der Linie zu einem weiteren Nodix ---
const anfuegenOffen = ref(false);
const anfuegenVon = ref("");
const anfuegenSuche = ref("");
watch(
    () => props.anfuegenWunsch,
    (mal) => {
        if (mal !== undefined && mal > 0) oeffneAnfuegen();
    },
);
function oeffneAnfuegen(): void {
    reiter.value = "eigenschaften";
    anfuegenOffen.value = true;
    const enden = kette.value.filter((g) => g.art === "knoten" && g.ende);
    const letztes = enden.at(-1) ?? kette.value.filter((g) => g.art === "knoten").at(-1);
    if (letztes?.art === "knoten" && anfuegenVon.value === "") anfuegenVon.value = letztes.knoten.id;
    // Die Nodices kommen mit der Kurve: Läuft sie nicht, hängt das Fenster sie an.
    if (!props.kurveLaeuft) emit("anfuegen", anfuegenVon.value, undefined);
}
const anfuegenTreffer = computed(() => {
    const inLinie = new Set(knotenVon.value.keys());
    const gesucht = anfuegenSuche.value.trim().toLocaleLowerCase();
    return (props.kandidaten ?? [])
        .filter((k) => !inLinie.has(k.id))
        .filter((k) => gesucht === "" || k.name.toLocaleLowerCase().includes(gesucht))
        .slice(0, 30);
});
function fuegeAn(nach: string): void {
    if (anfuegenVon.value === "") return;
    emit("anfuegen", anfuegenVon.value, nach);
    anfuegenOffen.value = false;
    anfuegenSuche.value = "";
}

// --- Entfernen in zwei Stufen (K10) ---
const entfernenWahl = ref<"abnehmen" | "loeschen">("abnehmen");
const ENTFERNEN_TITEL = {
    abnehmen: () => t("kraftlinieneditor.entfernen.abnehmen"),
    loeschen: () => t("kraftlinieneditor.entfernen.loeschen"),
} as const;
const ENTFERNEN_SATZ = {
    abnehmen: () => t("kraftlinieneditor.entfernen.abnehmenSatz"),
    loeschen: () => t("kraftlinieneditor.entfernen.loeschenSatz"),
} as const;
/** Mitten in einer Bearbeitung wird nicht entfernt: erst schreiben oder verwerfen. */
const entfernenGrund = computed(() =>
    props.entferntGerade
        ? t("kraftlinieneditor.bearbeiten.speichert")
        : props.bearbeitung?.lage.value.aktiv === true
          ? t("verlauf.gesperrtBearbeitung")
          : undefined,
);
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="werkzeug"
        rumpf="spalten"
        :lage="lage"
        :box="fenster.box"
        :ablage-ziel="ablageZiel"
        :einzug="einzug"
        :titel="titel"
        :zusatz="darfFelder ? undefined : t('editorPanel.verb.lesen')"
        :testid="kennung"
        @update:lage="(neu, box) => emit('lage', neu, box)"
        @update:box="(box) => emit('box', box)"
        @vorn="emit('vorn')"
    >
        <FensterSpalte
            v-if="!phoneViewport || telefonSeite === 'liste'"
            :id="`${kennung}-listenspalte`"
            :titel="t('kraftlinieneditor.liste')"
            breite="inspektor"
            :telefon="phoneViewport"
            :einziehbar="!phoneViewport"
            :inert="zu || undefined"
            :schliessen="t('fenster.liste.schliessen')"
            :testid="`${kennung}-liste`"
            @schliesse="phoneViewport ? (telefonSeite = 'eigenschaften') : emit('listeZu', true)"
        >
            <p v-if="ladeFehler" class="kraftlinieneditor__leise">
                {{ ladeFehler }}
                <button type="button" class="kraftlinieneditor__verweis" @click="emit('erneut')">
                    {{ t("editorListe.erneut") }}
                </button>
            </p>
            <p v-else-if="!liste" class="kraftlinieneditor__leise">{{ t("kraftlinieneditor.laedt") }}</p>
            <EditorListe
                v-else
                v-model:gewaehlt="gewaehlt"
                :mehrfach="mehrfach?.mehrfach ?? false"
                :angehakt="mehrfach?.angehakt ?? []"
                :zeilen="zeilen"
                :optionen="optionen"
                :facetten-name="facettenName"
                :wert-name="wertName"
                :sortierungen="sortierungen"
                :legende="legende"
                :leer-text="t('kraftlinieneditor.leer')"
                :kennung="`${kennung}-linien`"
                :beschriftung="t('kraftlinieneditor.liste')"
                :einstellung="einstellung"
                @oeffne="fliege"
                @klick="(id: string) => einzelnAngehakt(id)"
                @update:mehrfach="(an: boolean | undefined) => emit('mehrfach', an === true)"
                @update:angehakt="(ids: readonly string[]) => emit('angehakt', ids)"
            />
        </FensterSpalte>
        <FensterSpalte
            v-if="!phoneViewport || telefonSeite === 'eigenschaften'"
            :titel="t('kraftlinieneditor.eigenschaften')"
            breite="fuellen"
            :telefon="phoneViewport"
            :testid="`${kennung}-eigenschaften-spalte`"
        >
            <template #zurueck>
                <button
                    v-if="phoneViewport"
                    type="button"
                    class="kraftlinieneditor__verweis"
                    @click="telefonSeite = 'liste'"
                >
                    {{ t("ortseditor.zurListe") }}
                </button>
                <button
                    v-else
                    type="button"
                    class="kraftlinieneditor__listenschalter"
                    :aria-expanded="!zu"
                    :aria-controls="`${kennung}-listenspalte`"
                    :aria-label="schalterText"
                    :title="schalterText"
                    :data-testid="`${kennung}-listenschalter`"
                    @click="emit('listeZu', !zu)"
                >
                    <span class="avm-versalmitte" aria-hidden="true">{{ zu ? "»" : "«" }}</span>
                </button>
            </template>
            <!-- „↺ Alles auf Wiki-Werte (n)“ rechts im Kopf (§13.8, wie am Ort); gesperrt nennt der Kasten „Identität“ den Grund. -->
            <template v-if="wikiKnopf && !sammel" #kopf>
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="wikiZahl === 0 ? '' : undefined"
                    :title="wikiZahl === 0 ? t('wikiFeld.keineEigenen') : undefined"
                    :testid="`${kennung}-alle-wiki`"
                    @click="allesZurueck"
                >
                    {{ t("wikiFeld.alle", { n: formatNumber(wikiZahl, 0) }) }}
                </AvmKnopf>
            </template>
            <KraftlinieSammelAnsicht
                v-if="sammel"
                :kennung="kennung"
                :sammel="sammel"
                :darf-felder="darfFelder"
                :darf-form="darfForm"
                @entfernt="emit('angehakt', [])"
            />
            <p v-else-if="!kopf" class="kraftlinieneditor__leise">{{ t("kraftlinieneditor.keineWahl") }}</p>
            <template v-else>
                <div class="kraftlinieneditor__name">
                    <strong>{{ kopf.name }}</strong>
                    <small>{{
                        t("kraftlinieneditor.kopf", {
                            gestalt: gestaltName(kopf.shape),
                            abschnitte: tPlural("kraftlinieneditor.unter.abschnitte", kopf.segments, {
                                n: kopf.segments,
                            }),
                        })
                    }}</small>
                </div>
                <!-- Nicht auf der Karte (K10): lesend, mit dem Weg zurück. -->
                <div v-if="linienStand" class="kraftlinieneditor__stand" :data-testid="`${kennung}-stand`">
                    <span>{{
                        linienStand === "abgenommen"
                            ? t("kraftlinieneditor.stand.abgenommen")
                            : t("kraftlinieneditor.stand.geloescht")
                    }}</span>
                    <AvmKnopf
                        v-if="linienStand === 'abgenommen' ? darfForm : darfFelder"
                        groesse="zeile"
                        :gesperrt="entferntGerade ? t('kraftlinieneditor.bearbeiten.speichert') : undefined"
                        :testid="`${kennung}-zurueck`"
                        @click="emit('zurueck')"
                    >
                        {{
                            linienStand === "abgenommen"
                                ? t("kraftlinieneditor.stand.zurueck")
                                : t("kraftlinieneditor.stand.holen")
                        }}
                    </AvmKnopf>
                </div>
                <EntwurfKonflikt
                    v-if="konflikt && bearbeitung"
                    :bearbeitung="bearbeitung"
                    :konflikt="konflikt"
                    :feld-name="teilName"
                    :kennung="kennung"
                />
                <FensterReiter
                    v-model="reiter"
                    :reiter="reiterListe"
                    :beschriftung="t('kraftlinieneditor.reiter')"
                    :kennung="kennung"
                />
                <div
                    :id="`${kennung}-inhalt-${reiter}`"
                    class="kraftlinieneditor__rumpf"
                    role="tabpanel"
                    :data-testid="`${kennung}-eigenschaften`"
                >
                    <p v-if="detailFehler" class="kraftlinieneditor__leise">{{ detailFehler }}</p>
                    <p v-else-if="!detail" class="kraftlinieneditor__leise">{{ t("kraftlinieneditor.detailLaedt") }}</p>
                    <template v-else-if="reiter === 'eigenschaften'">
                        <!-- Die Nachfrage zum Entfernen (T39): Sie steht an der Linie, die im Kartenmenü gewählt wurde. -->
                        <AvmBestaetigung
                            v-if="entfernenFrage === detail.id && !linienStand"
                            :frage="t('kraftlinieneditor.entfernen.frage', { name: detail.name })"
                            :folge="t('kraftlinieneditor.entfernen.folge')"
                            :bestaetigen="ENTFERNEN_TITEL[entfernenWahl]()"
                            :gesperrt="entfernenGrund"
                            :testid="`${kennung}-entfernen`"
                            @bestaetigen="emit('entfernen', entfernenWahl)"
                            @abbrechen="emit('abbrechenEntfernen')"
                        >
                            <div
                                class="kraftlinieneditor__wahlen"
                                role="radiogroup"
                                :aria-label="t('kraftlinieneditor.griff.entfernen')"
                            >
                                <AvmKaestchen
                                    v-for="wahl in ['abnehmen', 'loeschen'] as const"
                                    :key="wahl"
                                    art="radio"
                                    :name="`${kennung}-entfernen-wahl`"
                                    mehrzeilig
                                    :checked="entfernenWahl === wahl"
                                    :testid="`${kennung}-entfernen-${wahl}`"
                                    @change="entfernenWahl = wahl"
                                >
                                    <span class="kraftlinieneditor__wahlzeichen" aria-hidden="true"
                                        ><EditorZeichen :name="wahl === 'loeschen' ? 'loeschen' : 'abnehmen'"
                                    /></span>
                                    <span class="kraftlinieneditor__wahltext">
                                        <strong>{{ ENTFERNEN_TITEL[wahl]() }}</strong>
                                        <small>{{ ENTFERNEN_SATZ[wahl]() }}</small>
                                    </span>
                                </AvmKaestchen>
                            </div>
                        </AvmBestaetigung>
                        <section class="kraftlinieneditor__abschnitt">
                            <div class="kraftlinieneditor__kopfzeile">
                                <h4 class="kraftlinieneditor__titel">
                                    {{ t("kraftlinieneditor.abschnitt.identitaet") }}
                                </h4>
                                <span
                                    v-if="wikiKnopf && wikiZahl === 0"
                                    class="kraftlinieneditor__leise"
                                    :data-testid="`${kennung}-wiki-gleich`"
                                    >{{ t("wikiFeld.keineEigenen") }}</span
                                >
                            </div>
                            <!-- Jedes Feld ist eine Zeile des Wiki-Felds (§13.8), mit oder ohne Wiki-Wert, damit alles fluchtet. Schreibbar (O3):
                                 die erste Änderung beginnt; ein Feld wird zum Schritt, sobald man es verlässt. Ohne Schreibrecht lesend. -->
                            <div
                                v-if="felderJetzt"
                                class="kraftlinieneditor__felder"
                                :data-testid="`${kennung}-felder`"
                                @focusout="schreibbar ? bearbeitung?.feldVerlassen() : undefined"
                            >
                                <WikiFeld
                                    :name="t('kraftlinieneditor.feld.name')"
                                    :fuer="`${kennung}-feld-name-id`"
                                    :lage="kraftlinieWikiLage(felderJetzt, 'name', !schreibbar)"
                                    :testid="`${kennung}-zeile-name`"
                                    @zurueck="zurueckAufWiki('name')"
                                >
                                    <AvmEingabe
                                        :id="`${kennung}-feld-name-id`"
                                        :model-value="felderJetzt.name"
                                        :gesperrt="schreibbar ? undefined : ''"
                                        :testid="`${kennung}-feld-name`"
                                        @update:model-value="(wert: string) => tippe('name', wert)"
                                    />
                                </WikiFeld>
                                <p v-if="schreibbar" class="kraftlinieneditor__leise">
                                    {{ t("kraftlinieneditor.feld.nameHinweis") }}
                                </p>
                                <!-- Ohne Wiki-Gegenstück: dieselbe Feldzeile, dieselbe Kante (Betreiber 2026-10-19, „eine Feldkante“). -->
                                <FensterFeldzeile :name="t('kraftlinieneditor.feld.beschriftung')">
                                    <AvmKaestchen
                                        v-if="schreibbar"
                                        art="checkbox"
                                        :checked="felderJetzt.labelVisible"
                                        :testid="`${kennung}-feld-beschriftung`"
                                        @change="(an: boolean) => setze('labelVisible', an)"
                                    >
                                        {{ t("kraftlinieneditor.feld.beschriftungAn") }}
                                    </AvmKaestchen>
                                    <span v-else>{{ beschriftung }}</span>
                                </FensterFeldzeile>
                                <WikiFeld
                                    :name="t('kraftlinieneditor.feld.beschreibung')"
                                    :fuer="`${kennung}-feld-beschreibung-id`"
                                    :lage="kraftlinieWikiLage(felderJetzt, 'description', !schreibbar)"
                                    oben
                                    :testid="`${kennung}-zeile-beschreibung`"
                                    @zurueck="zurueckAufWiki('description')"
                                >
                                    <AvmTextbereich
                                        :id="`${kennung}-feld-beschreibung-id`"
                                        :model-value="felderJetzt.description"
                                        :zeilen="3"
                                        :gesperrt="schreibbar ? undefined : ''"
                                        :testid="`${kennung}-feld-beschreibung`"
                                        @update:model-value="(wert: string) => tippe('description', wert)"
                                    />
                                </WikiFeld>
                                <!-- Was nur das Wiki führt: gesperrt, kein ↺ (§13.8 „nur lesend“). -->
                                <WikiFeld
                                    v-for="wert in nurWiki(felderJetzt)"
                                    :key="wert.schluessel"
                                    :name="NUR_WIKI_NAME[wert.schluessel]()"
                                    :lage="wert.lage"
                                    :testid="`${kennung}-zeile-${wert.schluessel}`"
                                >
                                    <AvmEingabe
                                        :model-value="wert.wert"
                                        gesperrt=""
                                        :title="wert.wert"
                                        :testid="`${kennung}-feld-${wert.schluessel}`"
                                    />
                                </WikiFeld>
                            </div>
                        </section>
                        <section class="kraftlinieneditor__abschnitt" :data-testid="`${kennung}-nodices`">
                            <h4 class="kraftlinieneditor__titel">
                                {{
                                    t("kraftlinieneditor.abschnitt.nodices", {
                                        n: formatNumber(detail.nodes.length, 0),
                                    })
                                }}
                            </h4>
                            <p class="kraftlinieneditor__gestalt">
                                <strong>{{ gestaltName(detail.shape) }}</strong>
                                ·
                                {{
                                    tPlural("kraftlinieneditor.unter.abschnitte", detail.segments.length, {
                                        n: detail.segments.length,
                                    })
                                }}
                                · {{ t("kraftlinieneditor.nodices.kurve") }}
                            </p>
                            <AvmKnopf
                                v-if="formGeht && !kurveLaeuft"
                                groesse="zeile"
                                :testid="`${kennung}-kurve-bearbeiten`"
                                @click="emit('kurve')"
                            >
                                {{ t("kraftlinieneditor.knopf.form") }}
                            </AvmKnopf>
                            <ol class="kraftlinieneditor__kette" :aria-label="t('kraftlinieneditor.nodices.kette')">
                                <template v-for="(glied, i) in kette" :key="i">
                                    <li v-if="glied.art === 'zwischen'" class="kraftlinieneditor__zwischen">
                                        {{ glied.text }}
                                    </li>
                                    <li v-else-if="glied.art === 'abschnitt'" class="kraftlinieneditor__kante">
                                        <span>{{
                                            glied.mitNamen
                                                ? `${knotenName(knotenVon.get(glied.abschnitt.from))} – ${knotenName(knotenVon.get(glied.abschnitt.to))}`
                                                : t("kraftlinieneditor.nodices.abschnitt")
                                        }}</span>
                                        <span class="kraftlinieneditor__wert">{{ kurveText(glied.abschnitt) }}</span>
                                    </li>
                                    <li v-else class="kraftlinieneditor__knoten" :data-knoten="glied.knoten.id">
                                        <span
                                            class="kraftlinieneditor__punkt"
                                            :data-art="glied.knoten.kind"
                                            :data-nodix="glied.knoten.nodix || undefined"
                                            aria-hidden="true"
                                        />
                                        <span class="kraftlinieneditor__kname">
                                            {{ knotenName(glied.knoten) }}
                                            <template v-if="glied.zurueck">{{
                                                t("kraftlinieneditor.nodices.zurueck")
                                            }}</template>
                                        </span>
                                        <button
                                            v-if="glied.knoten.x !== undefined && glied.knoten.y !== undefined"
                                            type="button"
                                            class="kraftlinieneditor__zeigen"
                                            :aria-label="
                                                t('kraftlinieneditor.nodices.zeigenAria', {
                                                    name: knotenName(glied.knoten),
                                                })
                                            "
                                            @click="emit('zeige', glied.knoten.x, glied.knoten.y)"
                                        >
                                            {{ t("kraftlinieneditor.nodices.zeigen") }}
                                        </button>
                                        <span
                                            class="kraftlinieneditor__kart"
                                            :data-warnung="glied.knoten.kind === 'missing' || undefined"
                                        >
                                            {{ knotenArt(glied.knoten)
                                            }}{{ glied.ende ? ` · ${t("kraftlinieneditor.nodices.ende")}` : "" }}
                                        </span>
                                        <span v-if="glied.knoten.meets.length > 0" class="kraftlinieneditor__trifft">
                                            {{
                                                t("kraftlinieneditor.nodices.trifft", {
                                                    linien: glied.knoten.meets.join(", "),
                                                })
                                            }}
                                        </span>
                                        <button
                                            v-if="formGeht"
                                            type="button"
                                            class="kraftlinieneditor__heraus"
                                            :title="t('kraftlinieneditor.nodices.herausnehmen')"
                                            :aria-label="
                                                t('kraftlinieneditor.nodices.herausnehmenAria', {
                                                    name: knotenName(glied.knoten),
                                                })
                                            "
                                            :data-testid="`${kennung}-heraus-${glied.knoten.id}`"
                                            @click="emit('herausnehmen', glied.knoten.id)"
                                        >
                                            ✕
                                        </button>
                                    </li>
                                </template>
                            </ol>
                            <template v-if="formGeht">
                                <AvmKnopf
                                    v-if="!anfuegenOffen"
                                    groesse="zeile"
                                    :testid="`${kennung}-anfuegen`"
                                    @click="oeffneAnfuegen"
                                >
                                    {{ t("kraftlinieneditor.anfuegen.knopf") }}
                                </AvmKnopf>
                                <div
                                    v-else
                                    class="kraftlinieneditor__anfuegen"
                                    :data-testid="`${kennung}-anfuegen-kasten`"
                                >
                                    <label class="kraftlinieneditor__feld">
                                        <span>{{ t("kraftlinieneditor.anfuegen.von") }}</span>
                                        <select v-model="anfuegenVon" :data-testid="`${kennung}-anfuegen-von`">
                                            <option v-for="k in linie?.nodes ?? []" :key="k.id" :value="k.id">
                                                {{ knotenName(k) }}
                                            </option>
                                        </select>
                                    </label>
                                    <label class="kraftlinieneditor__feld">
                                        <span>{{ t("kraftlinieneditor.anfuegen.nach") }}</span>
                                        <AvmEingabe
                                            v-model="anfuegenSuche"
                                            :testid="`${kennung}-anfuegen-suche`"
                                            :placeholder="t('kraftlinieneditor.anfuegen.suchen')"
                                        />
                                    </label>
                                    <p v-if="!kurveLaeuft" class="kraftlinieneditor__leise">
                                        {{ t("kraftlinieneditor.anfuegen.laedt") }}
                                    </p>
                                    <p v-else-if="anfuegenTreffer.length === 0" class="kraftlinieneditor__leise">
                                        {{ t("kraftlinieneditor.anfuegen.keine") }}
                                    </p>
                                    <ul v-else class="kraftlinieneditor__treffer">
                                        <li v-for="k in anfuegenTreffer" :key="k.id">
                                            <button
                                                type="button"
                                                class="kraftlinieneditor__verweis"
                                                :data-testid="`${kennung}-anfuegen-ziel`"
                                                @click="fuegeAn(k.id)"
                                            >
                                                {{ k.name === "" ? t("kraftlinieneditor.knoten.punkt") : k.name }}
                                            </button>
                                        </li>
                                    </ul>
                                    <AvmKnopf groesse="zeile" @click="anfuegenOffen = false">
                                        {{ t("kraftlinieneditor.anfuegen.abbrechen") }}
                                    </AvmKnopf>
                                </div>
                            </template>
                        </section>
                        <section class="kraftlinieneditor__abschnitt">
                            <!-- Eine Adresse ohne Artikel im Abzug (von Hand getippt) steht für sich; zuweisen ersetzt sie. -->
                            <p v-if="!detail.article && detail.wiki">
                                <a :href="detail.wiki.url" target="_blank" rel="noopener">{{
                                    detail.wiki.title ?? detail.wiki.url
                                }}</a>
                            </p>
                            <WikiBox
                                :id="detail.id"
                                art="kraftlinie"
                                :recht="schreibt && stand !== undefined ? 'schreiben' : 'lesen'"
                                :ungespeichert="wikiBoxUngespeichert"
                                :felder="wikiBoxFelder"
                                :lesestand="wikiBoxLesestand"
                                :kennung="kennung"
                                @geaendert="wikiGeaendert"
                            />
                        </section>
                    </template>
                    <EntwurfVerlauf
                        v-else-if="verlauf"
                        :verlauf="verlauf"
                        :kennung="kennung"
                        :feld-name="verlaufFeldName"
                        :wert="verlaufWert"
                    />
                </div>
            </template>
        </FensterSpalte>
        <template v-if="fussEntwurf" #fuss-hinweis>
            <EntwurfFuss :bearbeitung="fussEntwurf" teil="hinweis" :testid="kennung" />
        </template>
        <template v-if="fussEntwurf" #fuss-haupt>
            <EntwurfFuss :bearbeitung="fussEntwurf" teil="haupt" :testid="kennung" />
        </template>
    </AvmFenster>
</template>

<style scoped>
.kraftlinieneditor__name {
    display: grid;
    gap: var(--space-2);
}

.kraftlinieneditor__name strong {
    color: var(--color-text-strong);
    font-weight: normal;
    font-size: var(--font-size-subhead);
}

.kraftlinieneditor__name small,
.kraftlinieneditor__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.kraftlinieneditor__stand {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
    padding: var(--space-4) var(--space-8);
    border: 1px solid var(--color-warning-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-warning-soft);
    color: var(--color-warning-soft-text);
}

.kraftlinieneditor__wahlen {
    display: grid;
    gap: var(--space-4);
}

.kraftlinieneditor__wahltext {
    display: grid;
    gap: var(--space-2);
}

.kraftlinieneditor__wahltext small {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.kraftlinieneditor__heraus {
    padding: 0 var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
}

.kraftlinieneditor__heraus:hover,
.kraftlinieneditor__heraus:focus-visible {
    border-color: var(--color-danger);
    color: var(--color-danger);
}

.kraftlinieneditor__anfuegen {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.kraftlinieneditor__treffer {
    display: grid;
    gap: var(--space-2);
    max-height: 12rem;
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
}

.kraftlinieneditor__rumpf {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

/* Wie die Abschnitte des Landschaftseditors (`landschaftseditor-fenster.vue`), bis O3 sie in einen Baustein zieht. */
.kraftlinieneditor__abschnitt {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.kraftlinieneditor__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

/* Der Titel von „Identität“ und daneben, warum „↺ Alles auf Wiki-Werte“ gesperrt ist. */
.kraftlinieneditor__kopfzeile {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4) var(--space-6);
}

/* Die Felder (K6, WI-0225): je Feld eine Zeile des Wiki-Felds, untereinander. */
.kraftlinieneditor__felder {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.kraftlinieneditor__feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    color: var(--color-text-muted);
}

.kraftlinieneditor__gestalt {
    margin: 0;
    color: var(--color-text-muted);
}

.kraftlinieneditor__gestalt strong {
    color: var(--color-text-strong);
    font-weight: normal;
}

/* Die Kette: Knoten als Zeilen, die Abschnitte dazwischen eingerückt an einer senkrechten Linie. */
.kraftlinieneditor__kette {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.kraftlinieneditor__knoten {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2) var(--space-4);
}

.kraftlinieneditor__punkt {
    width: var(--space-6);
    height: var(--space-6);
    border-radius: 50%;
    background: var(--color-text-muted);
}

.kraftlinieneditor__punkt[data-nodix] {
    background: var(--color-accent);
}

.kraftlinieneditor__punkt[data-art="missing"] {
    background: transparent;
    border: 1px dashed var(--color-text-muted);
}

.kraftlinieneditor__kname {
    min-width: 0;
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
}

.kraftlinieneditor__kart,
.kraftlinieneditor__trifft {
    grid-column: 2 / -1;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.kraftlinieneditor__kart[data-warnung] {
    color: var(--color-warning-soft-text);
}

.kraftlinieneditor__kante {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    margin-left: calc(var(--space-6) / 2);
    padding: var(--space-2) 0 var(--space-2) var(--space-6);
    border-left: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.kraftlinieneditor__wert {
    font-variant-numeric: tabular-nums;
}

.kraftlinieneditor__zwischen {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.kraftlinieneditor__zeigen,
.kraftlinieneditor__verweis {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
}

.kraftlinieneditor__zeigen:hover,
.kraftlinieneditor__verweis:hover {
    color: var(--color-link-hover);
}

.kraftlinieneditor__zeigen:focus-visible,
.kraftlinieneditor__verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* « » wie im Landschaftseditor (`.landschaftseditor__listenschalter`), bis O3 ihn in einen Baustein zieht. */
.kraftlinieneditor__listenschalter {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--avm-control-h);
    height: var(--avm-control-h);
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-subhead);
    line-height: 1;
    transition:
        background-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.kraftlinieneditor__listenschalter:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.kraftlinieneditor__listenschalter:active {
    background: var(--color-active-wash);
    color: var(--color-text-strong);
}

.kraftlinieneditor__listenschalter:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}
</style>
