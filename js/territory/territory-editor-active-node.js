"use strict";

/*
 * Globaler, beobachtbarer Zustand für den aktiven Breadcrumb-Knoten des
 * politischen Herrschaftsgebiet-Editors.
 *
 * Hintergrund: Bisher war "welcher Breadcrumb-Knoten ist aktiv" nur als
 * Closure-Variable (editedNode) in territory-editor-embedded.js vorhanden.
 * Andere Module (Außengrenzen-Editor, Eigenschaften) haben den aktiven Knoten
 * über einen DOM-MutationObserver auf #manualEditPath rekonstruiert -- mit
 * Race-Conditions und Fallback auf "letztes Pfad-Element". Daran sind
 * Vorgaenger gescheitert.
 *
 * Dieses Modul macht den aktiven Knoten zu EINER beobachtbaren Wahrheit:
 *   set(node)        -> aktiven Knoten setzen, Subscriber synchron benachrichtigen
 *   get()            -> aktuellen aktiven Knoten lesen (oder null)
 *   subscribe(fn)    -> bei Änderung benachrichtigt werden; liefert unsubscribe()
 *   clear()          -> Zustand leeren (Editor geschlossen)
 *
 * WICHTIG (Identitaets-/Schichten-Vertrag): Der Pfad/Baum stammt aus der
 * Wiki-Affiliation (territory-wiki-tree.js wird aus political-territory-wiki.php
 * gespeist) -- nicht aus political_territory.parent_id. Dieses Modul haelt nur
 * den Laufzeit-Zustand; die Pfad-Wahrheit liegt im Wiki-Baum.
 */
(function initAvesmapsEditorActiveNodeStore() {
	let activeNode = null;
	const subscribers = new Set();

	function nodeKeyOf(node) {
		if (!node || typeof node !== "object") return "";
		return String(
			node.territoryPublicId
			|| node.territory_public_id
			|| node.wikiKey
			|| node.wiki_key
			|| node.key
			|| node.id
			|| ""
		).trim();
	}

	function notify() {
		for (const fn of subscribers) {
			try {
				fn(activeNode);
			} catch (error) {
				console.warn("Active-Node-Subscriber fehlgeschlagen:", error);
			}
		}
	}

	function set(node) {
		const nextKey = nodeKeyOf(node);
		const prevKey = nodeKeyOf(activeNode);
		activeNode = node || null;
		// Nur benachrichtigen, wenn sich die Identitaet wirklich ändert
		// (verhindert Re-Render-Schleifen bei identischer Auswahl).
		if (nextKey !== prevKey) {
			notify();
		}
	}

	function get() {
		return activeNode;
	}

	function getKey() {
		return nodeKeyOf(activeNode);
	}

	function clear() {
		if (activeNode === null) return;
		activeNode = null;
		notify();
	}

	function subscribe(fn) {
		if (typeof fn !== "function") return () => {};
		subscribers.add(fn);
		return function unsubscribe() {
			subscribers.delete(fn);
		};
	}

	window.AvesmapsEditorActiveNode = {
		set,
		get,
		getKey,
		clear,
		subscribe,
		nodeKeyOf,
	};
})();
