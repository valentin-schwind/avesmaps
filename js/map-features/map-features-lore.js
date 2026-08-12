// Natur & Waren im Infopanel: Pflanzen, Tiere, Spezies und Handelswaren eines Ortes.
// Design: docs/flora-fauna-handelswaren-design.md. Backend: api/app/lore.php.
//
// WARUM KEIN VORGELADENER KATALOG (anders als Abenteuer/Kartensammlung): deren Kataloge
// sind klein genug, um komplett zum Client zu reisen. Hier sind es 5.104 Einträge mit
// 7.748 Ortsverknüpfungen -- das würde jeder Kartenbesucher mitladen, um es fast nie zu
// öffnen. Stattdessen wird PRO ORT geholt, sobald ein Panel ihn zeigt, und das Ergebnis
// im Speicher behalten.
//
// 💣 KEIN PANEL-NEUAUFBAU: buildLoreMarkup() liefert SOFORT einen leeren, markierten
// Container zurück und stößt den Abruf an; die Antwort füllt genau die Container mit
// passendem data-lore-place. Damit gibt es kein „Refresh ≠ Show"-Rennen wie beim
// Infopanel-Katalog -- ein spät eintreffender Ort überschreibt nichts, was inzwischen
// woanders steht, und ein bereits geschlossenes Panel hat einfach keinen Container mehr.

"use strict";

var AVESMAPS_LORE_API_URL = "api/app/lore.php";

// 🚨 NOT-AUS. Auf false gesetzt feuert der Client KEINE Lore-Abrufe mehr: keine
// Infobox-Zeilen, kein Dialog. Alles andere auf der Karte bleibt unberührt.
//
// Warum es den Schalter GIBT (2026-07-21, PHP-Pool gesättigt): die Abrufe starteten
// beim BAUEN des Markups, und bindPopup baut das für jedes Label schon beim
// Kartenaufbau -- hunderte gleichzeitige Anfragen, ohne Zeitlimit. Ein Request, der
// auf einem vollen Pool hängt, belegt bis zum Servertimeout einen Worker; danach hing
// die ganze API, auch game-literature.php, das damit nichts zu tun hat.
//
// Warum er wieder AUF TRUE steht: die Ursachen sind behoben -- geladen wird nur noch
// über den DOM-Beobachter (also je geöffnetem Panel einmal), jeder Abruf bricht nach
// 8 s ab, die Katalogliste braucht 3 statt 600 Abfragen, und die Hierarchietabellen
// werden je Anfrage nur einmal gelesen. Der Schalter bleibt trotzdem: er wirkt sofort
// und ohne PHP, weil ein reiner JS-Deploy ihn ausrollt.
// Anschalten OHNE Deploy, damit der Schalter auch dem Owner gehört und nicht nur dem
// nächsten Commit:
//   ?lore=1   schaltet für DIESEN Aufruf ein (zum gefahrlosen Nachmessen)
//   ?lore=0   schaltet aus, auch wenn der Default unten wieder true ist
//   localStorage: avesmaps.lore.enabled = "1" | "0"  -- gilt dauerhaft in diesem Browser
// Ist nichts gesetzt, gilt der Default darunter.
var AVESMAPS_LORE_DEFAULT_ENABLED = true;

var AVESMAPS_LORE_ENABLED = (function () {
	try {
		// 💣 avesmapsSearchParams(), NICHT new URLSearchParams(): die App parst URLs
		// TOLERANT -- ein zweites „?" gilt wie „&" (url-tolerant-parsing). Bei
		// „?siedlung=Punin?lore=1" liest der Standard-Parser den Schalter GAR NICHT,
		// und dann sieht es aus, als würde das Feature bei gesetztem Parameter
		// aussetzen. Fallback nur, falls die Hilfe noch nicht geladen ist.
		var params = typeof window.avesmapsSearchParams === "function"
			? window.avesmapsSearchParams()
			: new URLSearchParams(window.location.search);
		var fromUrl = params.get("lore");
		if (fromUrl === "1" || fromUrl === "0") {
			return fromUrl === "1";
		}
		var stored = window.localStorage.getItem("avesmaps.lore.enabled");
		if (stored === "1" || stored === "0") {
			return stored === "1";
		}
	} catch (error) {
		// Privater Modus o. ä.: dann eben der Default.
	}
	return AVESMAPS_LORE_DEFAULT_ENABLED;
})();

// Nie länger als das auf eine Antwort warten. Ein abgebrochener Request gibt den
// Worker frei; ohne Limit hält ein einziger hängender Aufruf ihn bis zum Servertimeout.
var AVESMAPS_LORE_TIMEOUT_MS = 8000;

// placeKey -> { data } | { pending: Promise }. Ein Ort wird höchstens einmal geholt.
var avesmapsLoreCache = new Map();

function avesmapsLoreEscape(value) {
	return String(value == null ? "" : value)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Server-wiki_key -> Ortsschlüssel der Lore-Tabellen. Territorien tragen die
// 'wiki:'-Form (avesmapsPoliticalBuildWikiKey), lore_place führt den reinen Slug.
// Ein Schlüssel -- oder mehrere, kommagetrennt. api/app/lore.php nimmt Listen schon
// entgegen (es teilt selbst an Kommas) und avesmapsLoreFetch reicht sie durch; nur
// hier fielen sie bisher durch, weil die Zeichenklasse kein Komma kannte. V10 braucht
// das: eine Routen-Etappe hat mehrere Landschaften und soll EINEN Abruf auslösen, nicht
// drei -- das Fan-out je Popup ist genau das, was 2026-07-21 den PHP-Pool sättigte.
//
// 💣 Jeder Teil wird EINZELN geprüft, und ein schlechter Teil verwirft nur sich selbst.
// „darpatien,<script>" wird „darpatien" -- ein kaputter Name darf nicht die Flora der
// ganzen Etappe verstummen lassen.
function avesmapsLoreNormalizeKey(raw) {
	var parts = String(raw == null ? "" : raw).split(",");
	var keys = [];
	for (var index = 0; index < parts.length; index++) {
		var key = parts[index].trim().toLowerCase();
		if (key.indexOf("wiki:") === 0) {
			key = key.slice(5);
		}
		if (key.indexOf("name:") === 0) {
			key = key.slice(5);
		}
		if (/^[a-z0-9_-]{1,190}$/.test(key) && keys.indexOf(key) < 0) {
			keys.push(key);
		}
	}
	return keys.join(",");
}

// 💣 Jeder Wert hier stammt aus dem Wiki, also aus FREMDINHALT: ein Artikel könnte
// alles Mögliche in einem Infobox-Feld stehen haben. Escapen allein reicht für ein
// href nicht -- "javascript:…" überlebt jedes Escaping. Deshalb wird eine URL nur
// akzeptiert, wenn sie auf die Wiki-Domain zeigt; alles andere wird zu "" und der
// Eintrag erscheint als reiner Text statt als Link.
var AVESMAPS_LORE_URL_PREFIX = "https://de.wiki-aventurica.de/";

function avesmapsLoreSafeUrl(raw) {
	var url = String(raw == null ? "" : raw).trim();
	return url.indexOf(AVESMAPS_LORE_URL_PREFIX) === 0 ? url : "";
}

// Holt die Lore eines Ortes (einmal je Ort). Mehrere Schlüssel werden kommagetrennt
// übergeben -- so kann Abschnitt 3 die Territorienkette hereinreichen, ohne dass sich
// hier etwas ändert.
function avesmapsLoreFetch(placeKey, full, titles, goods) {
	if (!AVESMAPS_LORE_ENABLED) {
		return Promise.resolve(null); // Not-Aus: kein Request, keine Zeile
	}
	var cacheKey = placeKey + (titles ? "|t:" + titles : "") + (goods ? "|g:" + goods : "") + (full ? "|full" : "");
	var cached = avesmapsLoreCache.get(cacheKey);
	if (cached) {
		return cached.pending || Promise.resolve(cached.data);
	}
	var url = AVESMAPS_LORE_API_URL + "?place=" + encodeURIComponent(placeKey)
		+ (titles ? "&title=" + encodeURIComponent(titles) : "")
		+ (goods ? "&goods=" + encodeURIComponent(goods) : "")
		+ (full ? "&full=1" : "");
	// Hartes Zeitlimit: ein hängender Request hält sonst bis zum Servertimeout einen
	// PHP-Worker fest, und mehrere offene Panels legen damit die ganze API lahm.
	var controller = typeof AbortController === "function" ? new AbortController() : null;
	var timer = controller ? window.setTimeout(function () { controller.abort(); }, AVESMAPS_LORE_TIMEOUT_MS) : null;
	var pending = fetch(url, {
		credentials: "same-origin",
		headers: { Accept: "application/json" },
		signal: controller ? controller.signal : undefined,
	})
		.then(function (response) {
			if (timer) { window.clearTimeout(timer); }
			return response;
		})
		.then(function (response) {
			return response.ok ? response.json() : null;
		})
		.then(function (data) {
			var payload = data && data.ok === true ? data : null;
			avesmapsLoreCache.set(cacheKey, { data: payload });
			return payload;
		})
		.catch(function () {
			// Ein Netzfehler darf das Panel nicht mitreißen: Abschnitt entfällt still,
			// wie bei der Kartensammlung ohne Katalog.
			avesmapsLoreCache.set(cacheKey, { data: null });
			return null;
		});
	avesmapsLoreCache.set(cacheKey, { pending: pending });
	return pending;
}

// Reihenfolge und Beschriftung der Infobox-ZEILEN (Owner): Waren, Fauna, Flora,
// Spezies -- als Zeilen in derselben Feldliste wie Oberhaupt/Einwohner/Verkehrswege,
// nicht als eigene Blöcke daneben.
//
// SPEZIES WIRD NICHT ANGEZEIGT (Owner 2026-07-21): das Feld „Regionen" der
// {{Infobox Spezies}} ist in Wiki Aventurica schlecht gepflegt, die Zuordnungen sind
// zu unzuverlässig für eine Infobox-Zeile. Das ist eine Aussage über die
// DATENGRUNDLAGE, nicht über die Technik -- der Rang-3-Filter unten hatte den
// auffälligsten Auswuchs („überall Tiefzwerg") bereits behoben.
//
// Die Daten bleiben vollständig erhalten: Katalog, Editor-Reiter und der Endpoint
// führen Spezies weiter. Nur die öffentliche Anzeige verzichtet darauf, bis die
// Pflege im Wiki besser ist.
// Der Satz unter jedem Deckel, in Mehrzahl und Einzahl (Owner 2026-08-12, sein Wortlaut).
//
// ⚠️ „hier" und nicht „in der Nähe": dieselbe Zeile steht an FÜNF Oberflächen -- Siedlung,
// Landschaftsregion, Herrschaftsgebiet, Weg und Routen-Etappe. „Tierarten leben in der Nähe" liest
// sich an einer Straße richtig, bei einem Königreich aber schief; dort leben sie darin. „hier" trägt
// Punkt, Fläche und Linie gleichermaßen.
var AVESMAPS_LORE_ROWS = [
	{ kind: "ware", label: "Waren", singular: "Ware wird hier gehandelt", plural: "Waren werden hier gehandelt" },
	{ kind: "fauna", label: "Fauna", singular: "Tierart lebt hier", plural: "Tierarten leben hier" },
	{ kind: "flora", label: "Flora", singular: "Pflanzenart wächst hier", plural: "Pflanzenarten wachsen hier" },
];

// EINE Infobox-Zeile im Hausformat (.region-info-box__row + dt/dd), damit sie sich in
// die bestehende Feldliste einreiht statt daneben zu stehen. Leere Arten entfallen.
//
// 💣 KONTINENTWEITE EINTRÄGE (rank 3) STEHEN NICHT IN DER VORSCHAU. „Tiefzwerg" ist für ganz
// [[Aventurien]] gelistet und erschien deshalb bei JEDEM Ort -- formal richtig, praktisch wertlos:
// was überall gilt, sagt über diesen Ort nichts. Im AUFGEKLAPPTEN stehen sie weiterhin, dort unter
// ihrer eigenen Überschrift, wo die Einordnung mitgeliefert wird.

// So viele Namen zeigt die eingedampfte Fassung. Bewusst wenig: je kürzer die zugeklappte Zeile,
// desto sichtbarer der Öffner darin -- das war der ganze Befund vom 2026-08-12 („die Leute sehen
// nicht, dass sie draufklicken können"). Acht von 51 waren zu wenig für eine Liste und zu viel, um
// den Öffner noch zu sehen.
var AVESMAPS_LORE_PREVIEW_NAMES = 3;

// Ab so vielen Einträgen lohnt das Eindampfen. Darunter steht ohnehin alles da, und ein Öffner für
// zwei versteckte Namen ist genau das „+2", das den Anlass gab.
var AVESMAPS_LORE_LID_MIN = 6;

// Ein Name als Markup -- verlinkt, wo es einen Wiki-Artikel gibt. EINE Stelle, damit ein Eintrag in
// der Vorschau nicht anders aussieht als im Aufgeklappten.
function avesmapsLoreNameMarkup(item) {
	var href = avesmapsLoreSafeUrl(item && item.wiki_url);
	var name = avesmapsLoreEscape(item && item.name);
	return href
		? '<a class="avesmaps-lore__name" href="' + avesmapsLoreEscape(href) + '" target="_blank" rel="noopener">' + name + "</a>"
		: name;
}

// Die Gliederung des aufgeklappten Inhalts (Owner 2026-08-12: „geht das nicht überall?").
//
// 🔴 NACH NÄHE, UND DAS GILT FÜR ALLE DREI ARTEN. Gemessen am Live-Bestand: von 21 Tierarten und
// 10 Pflanzen trägt im Wiki KEINE eine Herkunft, alle nur eine Verbreitung -- „Von hier / Hier
// erhältlich" dort hinzuschreiben wäre eine erfundene Unterscheidung. Was überall trägt, ist der
// Rang: direkt hier, aus einem Untergebiet, oder überall in Aventurien.
//
// ⭐ „Von hier" ist der ZUSATZ, den nur die Waren hergeben (relation `herkunft`, 3 von 51 an der
// gemessenen Etappe) -- und weil das die stärkste Aussage über einen Ort ist, steht sie oben. Ein
// Eintrag mit Herkunft erscheint NUR dort, nie zusätzlich in seiner Rang-Gruppe.
var AVESMAPS_LORE_GROUPS = [
	{ key: "origin", label: "Von hier" },
	{ key: "rank0", label: "Direkt hier" },
	{ key: "rank1", label: "Aus Untergebieten" },
	{ key: "rank3", label: "Überall in Aventurien" },
];

function avesmapsLoreGroupOf(entry) {
	if ((entry.relations || []).indexOf("herkunft") >= 0) {
		return "origin";
	}
	var rank = Number(entry && entry.rank);
	return rank >= 3 ? "rank3" : (rank >= 1 ? "rank1" : "rank0");
}

// Der volle Inhalt eines Deckels: alle Einträge, nach Nähe gegliedert.
//
// ⚠️ Eine leere Gruppe entfällt samt Überschrift -- eine Überschrift ohne Inhalt ist kein Aufbau,
// sondern Lärm. Bei den meisten Orten bleibt genau eine Gruppe übrig, und dann steht deren
// Überschrift auch nicht da: eine einzige Gruppe gliedert nichts.
function avesmapsLoreGroupedMarkup(entries, lead) {
	var buckets = {};
	(entries || []).forEach(function (entry) {
		var key = avesmapsLoreGroupOf(entry);
		(buckets[key] = buckets[key] || []).push(entry);
	});
	// Die Freitext-Handelswaren führen die erste Gruppe an -- erst die Gattungen der Gegend
	// („Vieh, Holz, Wolltuch"), dann die Stücke mit Namen („Bräubier"). Getrennt lasen sie sich wie
	// ein widersprüchlicher Doppeleintrag (Owner 2026-07-22).
	var leadMarkup = (lead || []).map(avesmapsLoreNameMarkup);

	var used = AVESMAPS_LORE_GROUPS.filter(function (group) {
		return (buckets[group.key] || []).length > 0;
	});
	var single = used.length <= 1;

	var out = "";
	used.forEach(function (group, index) {
		var names = (buckets[group.key] || []).map(avesmapsLoreNameMarkup);
		if (index === 0) {
			names = leadMarkup.concat(names);
		}
		out += (single ? "" : '<span class="avesmaps-lore__group">' + avesmapsLoreEscape(group.label) + "</span>")
			+ '<span class="avesmaps-lore__names">' + names.join(", ") + "</span>";
	});
	if (out === "" && leadMarkup.length) {
		out = '<span class="avesmaps-lore__names">' + leadMarkup.join(", ") + "</span>";
	}
	return out;
}

// EINE Infobox-Zeile im Hausformat (.region-info-box__row + dt/dd) -- ihr Wert ist ein Deckel.
function avesmapsLoreInfoRowMarkup(row, entries, total, placeKey, extras) {
	if (typeof buildInfoboxLid !== "function") {
		return "";   // Bauteil nicht geladen: lieber keine Zeile als eine kaputte
	}
	var all = entries || [];
	// Doppelungen vermeiden: „Salz" kann als Freitext-Ware UND im Katalog stehen.
	var seen = {};
	(extras || []).forEach(function (item) {
		seen[String((item && item.name) || "").toLowerCase()] = true;
	});
	all = all.filter(function (entry) {
		return !seen[String((entry && entry.name) || "").toLowerCase()];
	});
	var lead = extras || [];
	if (all.length === 0 && lead.length === 0) {
		return "";
	}

	// 🔴 DIE ZAHL IM SATZ IST, WAS AUFGEKLAPPT DASTEHT -- nicht die Serverzahl `total`. Seit der
	// Abruf vollständig ist (full=1), sind beide gleich; auseinander liefen sie nur, wenn jemand die
	// Grenze wieder einzöge. Ein Satz, der mehr verspricht als das Aufgeklappte zeigt, ist genau die
	// stille Lüge, die niemand bemerkt.
	var count = lead.length + all.length;
	var local = all.filter(function (entry) { return Number(entry && entry.rank) < 3; });
	var previewItems = lead.concat(local).slice(0, AVESMAPS_LORE_PREVIEW_NAMES);
	var openable = count >= AVESMAPS_LORE_LID_MIN;

	var lid = buildInfoboxLid({
		preview: openable
			? previewItems.map(avesmapsLoreNameMarkup).join(", ") + " …"
			: avesmapsLoreGroupedMarkup(all, lead),
		full: avesmapsLoreGroupedMarkup(all, lead),
		count: count,
		singular: row.singular,
		plural: row.plural,
		openable: openable,
	});
	return '<div class="region-info-box__row avesmaps-lore__row"><dt>' + avesmapsLoreEscape(row.label)
		+ "</dt><dd>" + lid + "</dd></div>";
}

// Füllt jeden offenen Container dieses Ortes. Wird nach dem Abruf aufgerufen und ist
// idempotent -- ein zweiter Lauf schreibt dasselbe.
function avesmapsLoreFillContainers(placeKey, placeName, data) {
	var containers = document.querySelectorAll('[data-lore-place="' + placeKey + '"]');
	if (!containers.length) {
		return; // Panel inzwischen geschlossen -- nichts zu tun
	}
	var markup = "";
	if (data && data.sections) {
		// Die aufgelösten Handelswaren gehen VORNE in die Waren-Zeile. Reihenfolge wie
		// im Infobox-Feld, damit man sie wiedererkennt; verlinkt, wo es einen Artikel gibt.
		var goodsLead = [];
		if (data.goods_order && data.goods_order.length) {
			data.goods_order.forEach(function (name) {
				var hit = data.goods && data.goods[name];
				goodsLead.push({ name: name, wiki_url: hit ? hit.wiki_url : "" });
			});
		}
		// Welche Zeilen dieser Container zeigen will. Ohne Angabe: alle -- jede bestehende
		// Aufrufstelle (Siedlung, Region, Label) bleibt damit unverändert.
		//
		// 💣 AVESMAPS_LORE_ROWS WIRD NICHT ANGEFASST. Die Liste steht auf Modulebene und
		// speist AUCH die Siedlungs-Infobox; wer die Waren dort herausnähme, nähme sie
		// überall heraus, und niemand sähe den Zusammenhang. Die Auswahl gehört an den
		// Container. (V10: eine Routen-Etappe zeigt nur Flora und Fauna, Owner 2026-07-29.)
		var wantedKinds = null;
		for (var kindIndex = 0; kindIndex < containers.length; kindIndex++) {
			var declared = containers[kindIndex].getAttribute("data-lore-kinds") || "";
			if (declared) {
				wantedKinds = declared.split("|");
				break;
			}
		}
		AVESMAPS_LORE_ROWS.forEach(function (row) {
			if (wantedKinds && wantedKinds.indexOf(row.kind) < 0) {
				return;
			}
			markup += avesmapsLoreInfoRowMarkup(
				row,
				data.sections[row.kind] || [],
				(data.counts && data.counts[row.kind]) || 0,
				placeKey,
				row.kind === "ware" ? goodsLead : null
			);
		});
	}
	for (var i = 0; i < containers.length; i++) {
		containers[i].innerHTML = markup;
	}
}

// Lädt die Lore für jeden Container, der NEU im Dokument steht. Das ist der einzige
// Ort, an dem ein Abruf startet.
//
// Warum überhaupt ein Beobachter: das Markup entsteht lange bevor es angezeigt wird
// (bindPopup bekommt fertiges HTML für JEDES Label). Erst wenn ein Container wirklich
// im DOM hängt, schaut jemand hin -- und nur dann lohnt der Abruf. So wird aus
// „hunderte Anfragen beim Kartenaufbau" „eine Anfrage pro geöffnetem Panel".
function avesmapsLoreLoadPendingContainers() {
	if (!AVESMAPS_LORE_ENABLED) {
		return;
	}
	var pending = document.querySelectorAll("[data-lore-place]:not([data-lore-loaded])");
	for (var i = 0; i < pending.length; i++) {
		var el = pending[i];
		el.setAttribute("data-lore-loaded", "1"); // sofort markieren: kein Doppelabruf
		(function (element) {
			var containerKey = element.getAttribute("data-lore-place") || "";
			var name = element.getAttribute("data-lore-name") || "";
			avesmapsLoreFetch(
				element.getAttribute("data-lore-fetch") || "",
				// 🔴 VOLLSTÄNDIG, seit der Deckel den „+N"-Dialog ersetzt hat (2026-08-12). Der Deckel
				// trägt seinen ganzen Inhalt im Dokument -- nur so findet ihn Strg+F im zugeklappten
				// Zustand, und nur so kann er ohne zweiten Abruf aufklappen. Es ist derselbe EINE
				// Abruf wie vorher: `full` steuert allein, ob der Server seine Liste noch beschneidet
				// (array_slice in avesmapsLoreReadForPlaces), nicht wie er sie holt. Die Abfrage ist
				// Zeile für Zeile dieselbe, nur die Antwort ist länger.
				true,
				element.getAttribute("data-lore-titles") || "",
				element.getAttribute("data-lore-goods") || ""
			).then(function (data) {
				if (data && data.total > 0) {
					avesmapsLoreFillContainers(containerKey, name, data);
				}
			});
		})(el);
	}
}

if (typeof document !== "undefined" && !document.__avesmapsLoreObserverBound) {
	document.__avesmapsLoreObserverBound = true;
	var avesmapsLoreScanTimer = null;
	var scheduleScan = function () {
		// Entprellt: ein geöffnetes Popup löst viele Mutationen aus, gescannt wird einmal.
		window.clearTimeout(avesmapsLoreScanTimer);
		avesmapsLoreScanTimer = window.setTimeout(avesmapsLoreLoadPendingContainers, 120);
	};
	if (typeof MutationObserver === "function") {
		new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
	}
	document.addEventListener("DOMContentLoaded", scheduleScan);
}

// Ortsreferenz aus einem regionEntry des Infopanels. Zwei Quellen, wie beim
// Abenteuer-Block: ein politisches Territorium trägt seinen Server-wiki_key erst in
// regionEntry.detail (territory-detail.php), eine Landschaftsregion in
// properties.wiki_region. Vor dem Detail-Fetch gibt es noch keinen Schlüssel -> "" ->
// kein Abschnitt; die zweite Renderrunde holt ihn nach.
function avesmapsLorePlaceRefFromRegion(regionEntry) {
	if (!regionEntry) {
		return null;
	}
	var detail = (regionEntry.detail && regionEntry.detail.ok) ? regionEntry.detail : null;
	var wikiRegion = regionEntry.wikiRegion || regionEntry.wiki_region || null;
	var raw = (detail && detail.wiki_key)
		|| (wikiRegion && wikiRegion.wiki_key)
		|| regionEntry.wikiKey || regionEntry.wiki_key || "";
	var key = avesmapsLoreNormalizeKey(raw);
	if (!key) {
		return null;
	}
	return { key: key, name: regionEntry.displayName || regionEntry.name || "" };
}

// Wiki-Titel aus einer Wiki-URL: „…/wiki/Thorwal_(Siedlung)" -> „Thorwal (Siedlung)".
// Der Titel geht an den Server, DER sluggt -- siehe Umlaut-Falle in api/app/lore.php.
function avesmapsLoreTitleFromUrl(wikiUrl) {
	var url = String(wikiUrl || "");
	if (url.indexOf(AVESMAPS_LORE_URL_PREFIX) !== 0 || url.indexOf("/wiki/") < 0) {
		return "";
	}
	try {
		return decodeURIComponent(url.split("/wiki/")[1] || "").replace(/_/g, " ").trim();
	} catch (error) {
		return "";
	}
}

// Öffentlicher Einstieg: liefert SOFORT den (leeren) Container und stößt den Abruf an.
// placeRef: { key, name, titles } -- key ist ein fertiger Server-Schlüssel, titles sind
// Wiki-Titel, die der Server selbst sluggt (mit | getrennt).
function buildLoreMarkup(placeRef) {
	if (!AVESMAPS_LORE_ENABLED) {
		return ""; // Not-Aus: gar kein Container, also auch kein Abruf
	}
	var key = avesmapsLoreNormalizeKey(placeRef && (placeRef.key || placeRef.wikiKey || placeRef.wiki_key));
	var titles = (placeRef && placeRef.titles) || "";
	if (!key && !titles) {
		return "";
	}
	// Container-Id: bei reiner Titel-Anfrage der Titel selbst, sonst der Schlüssel.
	var containerKey = key || titles.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase().slice(0, 190);
	var name = (placeRef && (placeRef.name || placeRef.displayName)) || "";
	// 💣 HIER WIRD NICHT GELADEN. buildLoreMarkup() läuft für JEDES Label schon beim
	// Anlegen des Markers (map-features-labels.js:469 ruft bindPopup mit fertigem
	// HTML), nicht erst beim Öffnen. Ein Abruf an dieser Stelle bedeutete hunderte
	// gleichzeitige Anfragen beim Kartenaufbau -- genau das hat den PHP-Pool
	// gesättigt. Geladen wird erst, wenn der Container WIRKLICH im DOM steht; darum
	// kümmert sich der Beobachter weiter unten.
	// Container OHNE eigene Hülle: er sitzt mitten in der Feldliste der Infobox und
	// füllt sich mit .region-info-box__row-Zeilen. display:contents lässt seine Kinder
	// direkt ins Zeilenraster greifen, statt es zu brechen.
	// Die Freitext-Handelswaren reisen mit, damit der Server sie gegen den Warenkatalog
	// auflösen kann -- Ergebnis: eine Zeile statt zweier, mit Links wo es Artikel gibt.
	var goods = String((placeRef && placeRef.tradeGoods) || "").split(/\s*[,;]\s*/)
		.map(function (part) { return part.trim(); }).filter(Boolean).join("|");

	// Welche Arten dieser Container zeigen soll („flora|fauna" an einer Routen-Etappe).
	// Leer = alle, also unverändert für jede bestehende Aufrufstelle.
	var kinds = String((placeRef && placeRef.kinds) || "");

	return '<div class="avesmaps-lore-rows" data-lore-place="' + avesmapsLoreEscape(containerKey)
		+ '" data-lore-fetch="' + avesmapsLoreEscape(key)
		+ '" data-lore-name="' + avesmapsLoreEscape(name)
		+ '" data-lore-kinds="' + avesmapsLoreEscape(kinds)
		+ '" data-lore-goods="' + avesmapsLoreEscape(goods)
		+ '" data-lore-titles="' + avesmapsLoreEscape(titles) + '"></div>';
}

// Ortsreferenz einer SIEDLUNG. Zwei Wege, beide gebraucht:
//   1. die Siedlung selbst -- manche sind direkt gelistet (Ork nennt „Thorwal (Siedlung)")
//   2. ihr Territorium aus dem Raycast -- darüber erreicht sie die Lore ihrer Region,
//      denn Siedlungen tragen selbst kein Region-Feld im Staging
// Beides geht als TITEL an den Server, der sluggt (Umlaut-Falle, siehe lore.php).
function avesmapsLorePlaceRefFromLocation(location) {
	if (!location) {
		return null;
	}
	var wiki = location.wikiSettlement || {};
	var titles = [];
	var ownTitle = avesmapsLoreTitleFromUrl(wiki.wiki_url || location.wiki_url || location.wikiUrl || "");
	if (ownTitle) {
		titles.push(ownTitle);
	}
	var territoryKey = avesmapsLoreNormalizeKey(
		location.territoryWikiKey || location.territory_wiki_key
		|| (location.properties && location.properties.territory_wiki_key) || ""
	);
	if (!titles.length && !territoryKey) {
		return null;
	}
	return {
		key: territoryKey,
		titles: titles.join("|"),
		name: wiki.name || location.name || "",
	};
}
