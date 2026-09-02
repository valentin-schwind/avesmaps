// Die Lore-Liste: Abruf, Nachladen und Reiter der Vorkommen (Fauna/Flora/Ware/Spezies).
// Am 2026-09-02 aus review-wiki-sync.js herausgeloest -- reine Verschiebung, kein Verhalten
// geaendert; geladen in index.html direkt hinter der Ursprungsdatei.
// 💣 Hier steht NUR Funktionsrumpf. Zustand (avesmapsLoreCountsCache, ...ListPage,
// ...ListToken, ...FilterState) und der Ladezeit-Block (document.__avesmapsLoreListBound)
// bleiben drueben: globale Funktionen werden nur INNERHALB ihres Skripts gehoben, ein
// mitgewanderter Ladezeit-Ausdruck fiele hier auf einen unbekannten Namen.

function renderWikiSyncLoreViewTabs(countsByKind) {
	var host = wikiSyncViewTabsHostFor("lore");
	if (!host) {
		return;
	}
	if (countsByKind) {
		avesmapsLoreCountsCache = countsByKind;
	}
	var counts = avesmapsLoreCountsCache || {};
	var activeKind = avesmapsLoreListKind.panel;
	// Bewusst OHNE data-lore-count: die Zahlen setzt diese Funktion selbst (deutsch gruppiert).
	// Ein data-lore-count hier würde von der Zähler-Schleife in loadLoreList überschrieben und
	// die Gruppierung wieder verlieren. Die Chips des FENSTERS tragen data-lore-dlg-count und
	// werden dort weiterhin bedient.
	host.innerHTML = wikiSyncSubjectViewTabs("lore").map(function (viewTab) {
		// „Alle" ohne bekannte Zahlen ist „?", NICHT 0: eine Summe über ein leeres Objekt ist
		// rechnerisch null, behauptet aber „es gibt keine" -- und das weiß hier noch niemand.
		var count = viewTab.key === "all"
			? (avesmapsLoreCountsCache
				? Object.keys(counts).reduce(function (sum, k) { return sum + Number(counts[k] || 0); }, 0)
				: undefined)
			: counts[viewTab.key];
		return '<button type="button" data-lore-kind="' + viewTab.key + '"'
			+ ' class="wiki-sync-panel__tab' + (viewTab.off ? " is-off" : "")
			+ (activeKind === viewTab.key ? " is-active" : "") + '"'
			+ (viewTab.off ? ' title="' + escapeHtml(viewTab.reason) + '"' : "")
			+ '>' + escapeHtml(viewTab.label)
			+ ' <span class="wiki-sync-panel__tab-count">('
			+ (typeof count === "number" && Number.isFinite(count) ? count.toLocaleString("de-DE") : "?")
			+ ')</span></button>';
	}).join("");
}

// Endlos-Scroll je Ansicht EINMAL verdrahten. Der Container steht in index.html; der
// Handler wird hier idempotent gesetzt (dataset-Flag), damit er auch nach einem Umbau
// oder Neurendern genau einmal hängt.
function avesmapsLoreEnsureInfiniteScroll(view) {
	var ids = AVESMAPS_LORE_VIEWS[view];
	if (!ids) {
		return;
	}
	var scroll = document.getElementById(ids.scroll);
	if (!scroll || scroll.dataset.avmLoreScroll === "1") {
		return;
	}
	scroll.dataset.avmLoreScroll = "1";
	scroll.addEventListener("scroll", function () {
		// Nah genug am Ende? Dann die nächste Seite holen. 200px Vorlauf, damit es sich
		// flüssig anfühlt und nicht erst am allerletzten Pixel nachlädt.
		if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 200) {
			avesmapsLoreLoadMore(view);
		}
	});
}

// Nächste Seite anfordern (Scroll ans Ende). Nur, wenn nicht schon eine unterwegs ist und
// überhaupt noch etwas fehlt.
function avesmapsLoreLoadMore(view) {
	view = view === "dialog" ? "dialog" : "panel";
	var page = avesmapsLoreListPage[view];
	if (!page || page.loading || page.loaded >= page.total) {
		return;
	}
	avesmapsLoreFetchList(view, true);
}

// Erst-Laden. Setzt den Seitenstand zurück und holt Seite 0.
function loadLoreList(view) {
	avesmapsLoreFetchList(view === "dialog" ? "dialog" : "panel", false);
}

// Erst-Laden (append=false) und Nachladen (append=true) teilen sich einen Codeweg. Der
// Unterschied: der Offset und dass Nachladen die Rahmen-Elemente (Art-Zähler, „zuletzt
// gesynct", Reiterstreifen) NICHT neu zeichnet -- die ändern sich zwischen zwei Seiten
// derselben Liste nicht.
function avesmapsLoreFetchList(view, append) {
	view = view === "dialog" ? "dialog" : "panel";
	var ids = AVESMAPS_LORE_VIEWS[view];
	var scroll = document.getElementById(ids.scroll);
	if (!scroll) {
		return;
	}
	avesmapsLoreEnsureInfiniteScroll(view);
	var page = avesmapsLoreListPage[view] || (avesmapsLoreListPage[view] = { loaded: 0, total: 0, loading: false });
	if (!append) {
		// Frischer Lauf: Seitenstand zurücksetzen, damit ein Scroll-Ereignis während des
		// Ladens nicht mit veraltetem total schon eine Folgeseite auslöst.
		page.loaded = 0;
		page.total = 0;
		if (view === "panel") {
			// Sofort zeichnen, damit der Streifen beim Subjektwechsel nicht leer bleibt, bis die
			// Antwort da ist. Die Zahlen kommen aus dem Zwischenspeicher.
			renderWikiSyncLoreViewTabs(null);
		}
	}
	var input = document.getElementById(ids.search);
	var query = input ? input.value.trim() : "";
	// Staleness-Token JE ANSICHT: sonst würde ein Abruf im Fenster die Antwort für den
	// Reiter verwerfen (und umgekehrt), weil beide denselben Zähler hochzählen. Nachladen
	// erhält den aktuellen Token, damit ein frischer Lauf (Suche/Reiterwechsel) eine noch
	// laufende Folgeseite verwirft, statt sie unten anzuhängen.
	var token = append ? avesmapsLoreListToken[view] : (++avesmapsLoreListToken[view]);
	var offset = append ? page.loaded : 0;
	// „Alle" heißt: keine Art-Einschränkung, also ein LEERER kind-Parameter. Ausdrücklich, nicht
	// dem Zufall überlassen: der Katalog verwirft zwar jeden Wert, der nicht in
	// AVESMAPS_LORE_KINDS steht (api/_internal/app/lore.php:142), und täte damit versehentlich
	// das Richtige -- aber ein Verhalten, das auf einer Whitelist-Lücke beruht, ist kein Vertrag.
	var kindParam = avesmapsLoreListKind[view] === "all" ? "" : avesmapsLoreListKind[view];
	var url = "api/app/lore.php?catalog=1&kind=" + encodeURIComponent(kindParam)
		+ "&q=" + encodeURIComponent(query)
		+ "&limit=" + AVESMAPS_LORE_PAGE_SIZE
		+ "&offset=" + offset;
	// Trichter-Facetten mitschicken -- AUCH auf Scroll-Folgeseiten, damit die Abfrage identisch
	// bleibt und nicht auf halber Liste ihre Filterung verliert. Kontinent/Herkunft mehrwertig
	// (|-getrennt), Ortsangabe/Quelle dreiwertig (1 = nur mit, 0 = nur ohne, leer = egal).
	var filter = avesmapsLoreFilterState[view];
	if (filter) {
		var continentParam = Array.from(filter.continent).join("|");
		var originParam = Array.from(filter.origin).join("|");
		if (continentParam) { url += "&continent=" + encodeURIComponent(continentParam); }
		if (originParam) { url += "&origin=" + encodeURIComponent(originParam); }
		if (filter.place.value) { url += "&has_place=" + encodeURIComponent(filter.place.value); }
		if (filter.source.value) { url += "&has_source=" + encodeURIComponent(filter.source.value); }
		// 💣 Serverseitig, wie alle anderen vier: die Liste laedt seitenweise nach, ein
		//    Browser-Filter saehe nur das geladene Fenster -- und die Bilanzzeile darunter
		//    („200 von 5.104") zaehlt ohnehin das, was der Server meldet.
		if (filter.mapStatus.value) { url += "&map_status=" + encodeURIComponent(filter.mapStatus.value); }
		if (filter.sourceKind.value) { url += "&source_kind=" + encodeURIComponent(filter.sourceKind.value); }
	}
	page.loading = true;
	avesmapsLoreFetchWithTimeout(url, { credentials: "same-origin", headers: { Accept: "application/json" } })
		.then(function (r) { return r.ok ? r.json() : null; })
		.then(function (data) {
			page.loading = false;
			if (token !== avesmapsLoreListToken[view]) {
				return;
			}
			renderLoreList(view, data && data.ok ? data : null, append);
			if (append) {
				// Beim Nachladen bleibt alles Übrige stehen -- die Rahmen-Daten ändern sich nicht.
				// Nur prüfen, ob die frisch angehängte Seite den Container scrollbar gemacht hat.
				avesmapsLoreMaybeAutoFill(view);
				return;
			}
			renderLoreLastSynced(data);
			renderLoreKindToggles(data && data.ok ? data.kinds_enabled : null);
			// Trichter-Optionen aus DIESER Antwort uebernehmen und den Trichter neu zeichnen
			// (frische Zaehler + Aktiv-Badge). Nur beim Erst-Laden -- Scroll-Folgeseiten liefern
			// sie bewusst leer, sie aendern sich zwischen zwei Seiten derselben Liste nicht.
			if (data && data.ok && avesmapsLoreFilterOptions[view]) {
				avesmapsLoreFilterOptions[view].continents = Array.isArray(data.continents) ? data.continents : [];
				avesmapsLoreFilterOptions[view].origins = Array.isArray(data.origins) ? data.origins : [];
				if (typeof avesmapsLoreFilterRebuild[view] === "function") {
					avesmapsLoreFilterRebuild[view]();
				}
			}
			// ALLE Reiterzahlen setzen, nicht nur die des geladenen: sonst bleiben die
			// übrigen leer, bis man sie einzeln anklickt. Die Zahlen zeigen den
			// Gesamtbestand und bleiben deshalb auch während einer Suche stehen.
			// Beide Reitersätze auf einmal -- Reiter und Fenster zeigen denselben Bestand,
			// und ein Abruf reicht für beide.
			var counts = (data && data.ok && data.counts_by_kind) || null;
			if (counts) {
				Object.keys(counts).forEach(function (kind) {
					document
						.querySelectorAll('[data-lore-count="' + kind + '"], [data-lore-dlg-count="' + kind + '"]')
						.forEach(function (chip) { chip.textContent = "(" + counts[kind] + ")"; });
				});
				// 💣 „Alle" hat keinen Schlüssel in counts_by_kind -- der Reiter im Fenster bliebe
				// ohne diese Summe dauerhaft ohne Zahl, während seine vier Nachbarn eine tragen.
				// Sie steht bewusst INNERHALB von `if (counts)`: eine Summe über ein leeres Objekt
				// ist rechnerisch 0 und behauptet „es gibt keine", obwohl noch niemand nachgesehen
				// hat. Solange nichts bekannt ist, bleibt der Chip leer -- genau wie die anderen.
				var alle = Object.keys(counts).reduce(function (summe, kind) {
					return summe + (Number(counts[kind]) || 0);
				}, 0);
				document
					.querySelectorAll('[data-lore-dlg-count="all"]')
					.forEach(function (chip) { chip.textContent = "(" + alle + ")"; });
			}
			if (view === "panel") {
				// Der gemeinsame Streifen zeichnet sich mit den frischen Zahlen neu -- er trägt
				// bewusst keine data-lore-count-Chips, die die Schleife oben bedienen könnte.
				renderWikiSyncLoreViewTabs(counts);
				// Das Datum der Auswahlzeile kommt aus DIESER Antwort. Vorkommen ist keine
				// sync_kind des Dump-Endpunkts; sein Datum steht in app_setting und reist mit dem
				// Katalog mit -- deshalb wird es hier eingehaengt statt dort abgefragt.
				if (data && data.ok) {
					wikiSyncKindSyncedRaw = Object.assign({}, wikiSyncKindSyncedRaw, { lore: data.last_synced || null });
					renderWikiSyncSubjectRail();
				}
			}
			// Kurze Liste in hohem Container: sofort die nächste Seite, sonst gäbe es keinen
			// Scrollbalken, mit dem man die restlichen Einträge je erreichen könnte.
			avesmapsLoreMaybeAutoFill(view);
		})
		.catch(function () {
			page.loading = false;
			if (token === avesmapsLoreListToken[view] && !append) {
				scroll.innerHTML = '<p class="wiki-sync-panel__summary">Liste konnte nicht geladen werden.</p>';
			}
		});
}

// Füllen die geladenen Zeilen den sichtbaren Bereich nicht aus, gibt es keinen
// Scrollbalken -- und ohne den käme man nie an die nächste Seite. Dann hier sofort
// nachziehen. Begrenzt durch loaded<total (in avesmapsLoreLoadMore), also kein Endlos-Lauf;
// bei verstecktem Container (clientHeight 0) NICHT feuern, sonst zieht ein unsichtbarer
// Reiter im Hintergrund den ganzen Bestand seitenweise herein.
function avesmapsLoreMaybeAutoFill(view) {
	var ids = AVESMAPS_LORE_VIEWS[view];
	var scroll = ids && document.getElementById(ids.scroll);
	if (!scroll || scroll.clientHeight <= 0) {
		return;
	}
	if (scroll.scrollHeight <= scroll.clientHeight + 4) {
		avesmapsLoreLoadMore(view);
	}
}
