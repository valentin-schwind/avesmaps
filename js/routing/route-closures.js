/*
 * Der Sperrhinweis im Reiseplan.
 *
 * Entwurf docs/superpowers/specs/2026-09-14-sperrzeiten-routing-design.md §7, Mockup
 * docs/sperrzeiten-routing-mockup.html. Owner 14.09.2026: „go, C und Absage im Panel".
 *
 * 🔴 ZWEI STELLEN, ZWEI AUSSAGEN (Variante C). Oben steht, DASS die Route wegen einer Sperrung anders
 * laeuft und um wie viel laenger; am Abzweig steht, WELCHER Weg gesperrt ist und WARUM. Dieselbe
 * Aussage an beiden Stellen liest sich wie zwei Angaben -- und die Zahlen oben sind ohne den Satz
 * davor ein Raetsel (2.942 Meilen fuer 200 Meilen Drachenflug).
 *
 * ⭐ DIE SATZFORMEN SIND NICHT NEU. Die Reisemittel stehen so, wie die Infobox des Weges sie nennt
 * (avesmapsWegMittelWorte, js/map-features/path-einschraenkung.js); die Monatsnamen kommen aus dem
 * <select> des Planers (routePlanMonthLabel). Eine zweite Formulierung derselben Sperre waere genau
 * die Stelle, an der Karte und Reiseplan auseinanderlaufen.
 *
 * 🪤 ARTIKELFREI, und das ist eine Messung, kein Stil: „Umweg um den Saljethweg" traegt einen Artikel,
 * der am Geschlecht des Namens haengt („um die Eisenstraße") -- und die Namen kommen aus den Daten.
 * Deshalb „Gesperrt: Saljethweg — …".
 *
 * ⚠️ Rein bis auf zoomToRouteClosureWay/bindRouteClosureLinks: kein DOM, kein eigener Zustand.
 */

// Mehraufwand darunter sagt nichts -- „+0,0 Tage" waere Laerm.
const ROUTE_CLOSURE_MIN_EXTRA = 0.05;

function routeClosureDateLabel(datum) {
	if (!datum) {
		return "";
	}
	const kalenderDatum = { day: Number(datum.day) || 1, monthKey: String(datum.month || ""), nameless: datum.nameless === true };
	if (typeof routePlanFormatDate === "function") {
		return routePlanFormatDate(kalenderDatum);
	}
	return `${kalenderDatum.day}. ${kalenderDatum.monthKey}`;
}

/**
 * Wie heisst der umgangene Weg? Die Hausregel der Karte zuerst (getPathTitleName am geladenen Weg),
 * dann der Name vom Server, dann Wegart und Ort -- nie eine Kreuzungsnummer.
 */
function routeClosureWayName(avoided) {
	const ids = Array.isArray(avoided && avoided.public_ids) ? avoided.public_ids : [];
	if (typeof findPathByPublicId === "function" && typeof getPathTitleName === "function") {
		for (const id of ids) {
			const pfad = findPathByPublicId(String(id));
			const name = pfad ? String(getPathTitleName(pfad) || "").trim() : "";
			if (name) {
				return name;
			}
		}
	}
	const serverName = String((avoided && avoided.path_name) || "").trim();
	if (serverName) {
		return serverName;
	}
	const art = typeof routeLegTypeLabel === "function" ? routeLegTypeLabel(avoided && avoided.subtype) : String((avoided && avoided.subtype) || "");
	const ort = String((avoided && avoided.from_node) || "").trim();
	// 💣 `Kreuzung-2777` und `__wp_anchor_3` sind Graphschluessel, keine Orte, die ein Reisender kennt.
	const ortTaugt = ort !== "" && !/^Kreuzung\b/.test(ort) && !/^__/.test(ort);
	return ortTaugt ? tr("planner.closure.wayFrom", "{type} ab {place}", { type: art, place: ort }) : art;
}

/** „am 3. Firun, befahrbar vom 15. Peraine bis zum 30. Efferd" -- oder „mit Kutsche nicht befahrbar, nur zu Fuß". */
function routeClosureReasonText(avoided) {
	if (avoided && avoided.kind === "season") {
		return tr("planner.closure.season", "am {date}, befahrbar vom {from} bis zum {to}", {
			date: routeClosureDateLabel(avoided.reached_on),
			from: routeClosureDateLabel(avoided.open_from),
			to: routeClosureDateLabel(avoided.open_to),
		});
	}
	const worte = (mittel) => (typeof avesmapsWegMittelWorte === "function" ? avesmapsWegMittelWorte(mittel) : mittel);
	const liste = (satzteile) => (typeof avesmapsWegWortListe === "function" ? avesmapsWegWortListe(satzteile) : satzteile.join(", "));
	const gesperrt = liste(worte([String((avoided && avoided.transport) || "")]));
	const erlaubt = Array.isArray(avoided && avoided.allowed) ? worte(avoided.allowed) : [];
	return erlaubt.length
		? tr("planner.closure.transport", "{blocked} nicht befahrbar, nur {allowed}", { blocked: gesperrt, allowed: liste(erlaubt) })
		: tr("planner.closure.transportNone", "{blocked} nicht befahrbar, für kein Reisemittel", { blocked: gesperrt });
}

/** Der Vermerk am Abzweig: „Gesperrt: <Weg> — Grund." Der Wegname zoomt auf den gesperrten Weg. */
function routeClosureNoteMarkup(avoided) {
	const ids = (Array.isArray(avoided && avoided.public_ids) ? avoided.public_ids : []).map(String).filter(Boolean);
	const name = escapeHtml(routeClosureWayName(avoided));
	const weg = ids.length
		? `<button type="button" class="route-plan-sperrung__weg" data-public-ids="${escapeHtml(ids.join(","))}">${name}</button>`
		: name;
	return `${escapeHtml(tr("planner.closure.blocked", "Gesperrt:"))} ${weg} — ${escapeHtml(routeClosureReasonText(avoided))}.`;
}

/** Wie viele VERSCHIEDENE Sperren? Derselbe Weg in zwei Wegpunktpaaren ist eine. */
function routeClosureAvoidedCount(closures) {
	const gesehen = new Set();
	(Array.isArray(closures) ? closures : []).forEach((report) => {
		(report && Array.isArray(report.avoided) ? report.avoided : []).forEach((avoided) => {
			gesehen.add(`${avoided.kind}|${(avoided.public_ids || []).join(",")}|${avoided.path_name || ""}`);
		});
	});
	return gesehen.size;
}

/**
 * „21,9 Tage länger" (Schnellste) oder „24,0 Meilen länger" (Kürzeste) -- in der Einheit, nach der gesucht
 * wurde. Beide Zahlen jeder Etappe stammen aus EINER Rechnung des Servers (echt gegen ohne Sperre).
 */
function routeClosureExtraText(closures, optimize) {
	const meilenJeEinheit = typeof DISTANCE_SCALING_FACTOR === "number" ? DISTANCE_SCALING_FACTOR : 3;
	let extra = 0;
	(Array.isArray(closures) ? closures : []).forEach((report) => {
		if (!report || !report.actual || !report.unrestricted) {
			return;
		}
		extra += optimize === "shortest"
			? ((Number(report.actual.distance_units) || 0) - (Number(report.unrestricted.distance_units) || 0)) * meilenJeEinheit
			: (Number(report.actual.travel_days) || 0) - (Number(report.unrestricted.travel_days) || 0);
	});
	if (!(extra > ROUTE_CLOSURE_MIN_EXTRA)) {
		return "";
	}
	return optimize === "shortest"
		? tr("planner.closure.longerMiles", "{n} Meilen länger", { n: formatDecimalNumber(extra, 1) })
		: tr("planner.closure.longerDays", "{n} Tage länger", { n: formatDecimalNumber(extra, 1) });
}

/** Der Hinweis am Anfang: DASS und wie viel laenger -- der Weg steht bewusst NICHT hier. */
function routeClosureHeadMarkup(closures, optimize) {
	const berichte = (Array.isArray(closures) ? closures : []).filter((report) => report && report.blocked !== true);
	const anzahl = routeClosureAvoidedCount(berichte);
	if (!anzahl) {
		return "";
	}
	const satz = anzahl === 1
		? tr("planner.closure.headOne", "Wegen einer Sperrung anders geführt")
		: anzahl === 2
			? tr("planner.closure.headTwo", "Wegen zweier Sperrungen anders geführt")
			: tr("planner.closure.headMany", "Wegen {n} Sperrungen anders geführt", { n: anzahl });
	const extra = routeClosureExtraText(berichte, optimize);
	const text = extra ? `${satz} · ${extra}` : satz;
	return `<div class="route-plan-sperrung" role="note"><span class="route-plan-sperrung__zeichen" aria-hidden="true">⚠&#xFE0E;</span><span class="route-plan-sperrung__text">${escapeHtml(text)}</span></div>`;
}

/**
 * Welche Etappe traegt welchen Vermerk? Map Etappenindex -> Vermerke.
 *
 * ⭐ Gesucht wird die ABZWEIGKANTE (`diverges_at_edge_id`) in genau dem Ausschnitt des Wegpunktpaares, zu
 * dem der Bericht gehoert (`segmentOffset`/`segmentCount`, route-engine.js), und dann die Etappe, deren
 * `segmentIndexes` sie enthaelt. Nicht der Knotenname: der kann eine Kreuzung sein, und nach dem
 * Verschmelzen der Etappen gibt es ihn im Plan nicht mehr. Wird nichts gefunden, bleibt der Hinweis oben
 * allein -- kein Vermerk an einer geratenen Etappe.
 */
function routeClosureEntryNotes(closures, planEntries, segments) {
	const vermerke = new Map();
	const etappen = Array.isArray(planEntries) ? planEntries : [];
	const segmente = Array.isArray(segments) ? segments : [];
	(Array.isArray(closures) ? closures : []).forEach((report) => {
		if (!report || report.blocked === true) {
			return;
		}
		const kante = String(report.diverges_at_edge_id || "");
		if (!kante) {
			return;
		}
		const ab = Math.max(0, Number(report.segmentOffset) || 0);
		const bis = Number.isFinite(Number(report.segmentCount)) ? Math.min(segmente.length, ab + Number(report.segmentCount)) : segmente.length;
		let segmentIndex = -1;
		for (let index = ab; index < bis; index += 1) {
			if (String((segmente[index] && segmente[index].properties && segmente[index].properties.id) || "") === kante) {
				segmentIndex = index;
				break;
			}
		}
		if (segmentIndex === -1) {
			return;
		}
		const etappenIndex = etappen.findIndex((etappe) => Array.isArray(etappe.segmentIndexes) && etappe.segmentIndexes.includes(segmentIndex));
		if (etappenIndex === -1) {
			return;
		}
		const liste = vermerke.get(etappenIndex) || [];
		(Array.isArray(report.avoided) ? report.avoided : []).forEach((avoided) => liste.push(routeClosureNoteMarkup(avoided)));
		vermerke.set(etappenIndex, liste);
	});
	return vermerke;
}

/**
 * Reisebeginn UNBEKANNT, und auf der Route liegen Wege mit Sperrzeit: gesperrt wird nichts, aber der Plan
 * bittet, den Reisebeginn zu pruefen. Owner 14.09.2026: „bei ‚Unbekanntem' Reisebeginn keine Sperrungen
 * passieren, aber ein Hinweis kommt, dass man die Reisezeit überprüfen sollte".
 *
 * ⭐ Derselbe Kasten wie der Sperrhinweis und derselbe zoombare Wegname -- ein zweites Bauteil fuer „hier
 * koennte gesperrt sein" waere eine zweite Rezeptur fuer dieselbe Aussage.
 */
function routeSeasonalWaysHeadMarkup(ways) {
	const gesehen = new Set();
	const wege = [];
	(Array.isArray(ways) ? ways : []).forEach((weg) => {
		const schluessel = `${(weg && weg.public_ids || []).join(",")}|${(weg && weg.path_name) || ""}`;
		if (!weg || gesehen.has(schluessel)) {
			return;
		}
		gesehen.add(schluessel);
		wege.push(weg);
	});
	if (!wege.length) {
		return "";
	}
	const liste = wege.map((weg) => {
		const ids = (Array.isArray(weg.public_ids) ? weg.public_ids : []).map(String).filter(Boolean);
		const name = escapeHtml(routeClosureWayName(weg));
		const knopf = ids.length
			? `<button type="button" class="route-plan-sperrung__weg" data-public-ids="${escapeHtml(ids.join(","))}">${name}</button>`
			: name;
		const fenster = tr("planner.closure.window", "befahrbar vom {from} bis zum {to}", {
			from: routeClosureDateLabel(weg.open_from),
			to: routeClosureDateLabel(weg.open_to),
		});
		return `${knopf} (${escapeHtml(fenster)})`;
	}).join("; ");
	const vorn = escapeHtml(tr("planner.closure.unknownStart", "Ohne Reisebeginn geplant — auf der Route liegen Sperrzeiten:"));
	const hinten = escapeHtml(tr("planner.closure.checkStart", "Bitte den Reisebeginn prüfen."));
	return `<div class="route-plan-sperrung" role="note"><span class="route-plan-sperrung__zeichen" aria-hidden="true">⚠&#xFE0E;</span>`
		+ `<span class="route-plan-sperrung__text">${vorn} ${liste}. ${hinten}</span></div>`;
}

/** Die Absage im Panel: welche Reise, und warum sie nicht geht (Owner 14.09.2026: „Absage im Panel"). */
function routeClosureRefusalMarkup(refusal) {
	const report = (refusal && refusal.report) || {};
	const titel = tr("planner.closure.refusal", "Keine offene Route von {start} nach {end}", {
		start: (refusal && refusal.start) || "",
		end: (refusal && refusal.end) || "",
	});
	const gruende = (Array.isArray(report.avoided) ? report.avoided : []).map(routeClosureNoteMarkup).join("<br>");
	return `<div class="route-plan-absage"><p class="route-plan-absage__titel">${escapeHtml(titel)}</p>`
		+ `<div class="route-plan-sperrung" role="note"><span class="route-plan-sperrung__zeichen" aria-hidden="true">⚠&#xFE0E;</span>`
		+ `<span class="route-plan-sperrung__text">${gruende}</span></div></div>`;
}

/** Zoomt auf den gesperrten Weg -- alle seine genannten Abschnitte. GeoJSON [x, y] wird [lat, lng] = [y, x]. */
function zoomToRouteClosureWay(publicIdsCsv) {
	if (typeof L === "undefined" || typeof findPathByPublicId !== "function") {
		return;
	}
	const punkte = [];
	String(publicIdsCsv || "").split(",").map((id) => id.trim()).filter(Boolean).forEach((id) => {
		const pfad = findPathByPublicId(id);
		const koordinaten = pfad && pfad.geometry && Array.isArray(pfad.geometry.coordinates) ? pfad.geometry.coordinates : [];
		koordinaten.forEach((punkt) => {
			if (Array.isArray(punkt) && punkt.length >= 2) {
				punkte.push([Number(punkt[1]), Number(punkt[0])]);
			}
		});
	});
	if (!punkte.length) {
		return;
	}
	const grenzen = L.latLngBounds(punkte);
	if (!grenzen.isValid()) {
		return;
	}
	if (typeof fitMapToRouteBounds === "function") {
		fitMapToRouteBounds(grenzen);
	} else if (typeof map !== "undefined" && map) {
		map.fitBounds(grenzen);
	}
}

/**
 * Bindet die Wegnamen im Hinweis. 💣 stopPropagation: der Name steht IN einer Etappenzeile, und deren
 * Klick zoomt auf die Etappe -- ohne das fuehre die Karte erst zum Pass und gleich danach zur Etappe.
 */
function bindRouteClosureLinks($container) {
	$container.find(".route-plan-sperrung__weg").on("click", function (event) {
		event.stopPropagation();
		zoomToRouteClosureWay(this.dataset.publicIds);
	});
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		routeClosureWayName,
		routeClosureReasonText,
		routeClosureNoteMarkup,
		routeClosureHeadMarkup,
		routeClosureEntryNotes,
		routeClosureRefusalMarkup,
		routeSeasonalWaysHeadMarkup,
	};
}
