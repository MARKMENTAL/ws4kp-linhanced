/**
 * Hazard History persistence module
 * Tracks the last 7 hazard alerts encountered by this server instance
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

const HISTORY_FILE = path.resolve('./data/hazard-history.json');
const MAX_HISTORY_ENTRIES = 7;

/**
 * Ensure the cache directory exists
 */
const ensureCacheDir = async () => {
	const cacheDir = path.dirname(HISTORY_FILE);
	try {
		await mkdir(cacheDir, { recursive: true });
	} catch (error) {
		// Directory may already exist
	}
};

/**
 * Load hazard history from disk
 * @returns {Array} Array of hazard history entries
 */
const loadHistory = async () => {
	try {
		await ensureCacheDir();
		const data = await readFile(HISTORY_FILE, 'utf8');
		const parsed = JSON.parse(data);
		return Array.isArray(parsed) ? parsed : [];
	} catch (error) {
		// File doesn't exist or is corrupted, return empty array
		return [];
	}
};

/**
 * Save hazard history to disk
 * @param {Array} history - Array of hazard history entries
 */
const saveHistory = async (history) => {
	try {
		await ensureCacheDir();
		await writeFile(HISTORY_FILE, JSON.stringify(history, null, '\t'));
	} catch (error) {
		console.error('Failed to save hazard history:', error.message);
	}
};

const isCoordinateLocationKey = (value) => /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(value ?? '');

/**
 * Generate a stable identity for a hazard entry.
 * This intentionally ignores upstream alert ids so alert revisions
 * continue updating the same logical history row.
 * @param {string} locationKey - Stable location key
 * @param {string} hazardType - Hazard/event name
 * @param {string} source - Hazard source
 * @returns {string} Stable identity key
 */
const generateKey = (locationKey, hazardType, source) => `${locationKey}::${hazardType}::${source}`;

const normalizeTimestamp = (value, fallback) => {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
};

const isSameLogicalHazard = (left, right) => left.location === right.location
	&& left.hazardType === right.hazardType
	&& left.source === right.source;

const mergeEntries = (existing, incoming) => {
	const existingEncountered = normalizeTimestamp(existing.encounteredAt, incoming.encounteredAt);
	const incomingEncountered = normalizeTimestamp(incoming.encounteredAt, existing.encounteredAt);
	const existingLastSeen = normalizeTimestamp(existing.lastSeenAt, incoming.lastSeenAt);
	const incomingLastSeen = normalizeTimestamp(incoming.lastSeenAt, existing.lastSeenAt);
	const keepIncomingLocationKey = isCoordinateLocationKey(incoming.locationKey) && !isCoordinateLocationKey(existing.locationKey);
	const latestHazardId = new Date(incomingLastSeen) >= new Date(existingLastSeen)
		? (incoming.latestHazardId ?? existing.latestHazardId)
		: (existing.latestHazardId ?? incoming.latestHazardId);

	return {
		...existing,
		location: keepIncomingLocationKey ? incoming.location : (existing.location || incoming.location),
		locationKey: keepIncomingLocationKey ? incoming.locationKey : (existing.locationKey || incoming.locationKey),
		key: keepIncomingLocationKey ? incoming.key : existing.key,
		encounteredAt: new Date(existingEncountered) <= new Date(incomingEncountered) ? existingEncountered : incomingEncountered,
		lastSeenAt: new Date(existingLastSeen) >= new Date(incomingLastSeen) ? existingLastSeen : incomingLastSeen,
		ongoing: Boolean(existing.ongoing || incoming.ongoing),
		severity: incoming.severity || existing.severity,
		source: incoming.source || existing.source,
		latestHazardId,
	};
};

const normalizeHistory = (history = []) => {
	const normalized = [];

	for (const rawEntry of history) {
		if (!rawEntry?.hazardType || !rawEntry?.source) continue;
		const locationKey = rawEntry.locationKey || rawEntry.location;
		const entry = {
			...rawEntry,
			locationKey,
			key: generateKey(locationKey, rawEntry.hazardType, rawEntry.source),
			encounteredAt: normalizeTimestamp(rawEntry.encounteredAt, new Date().toISOString()),
			lastSeenAt: normalizeTimestamp(rawEntry.lastSeenAt ?? rawEntry.encounteredAt, new Date().toISOString()),
			latestHazardId: rawEntry.latestHazardId ?? rawEntry.hazardId ?? rawEntry.id ?? rawEntry.key,
		};

		const existingIndex = normalized.findIndex((candidate) => candidate.key === entry.key || isSameLogicalHazard(candidate, entry));
		if (existingIndex >= 0) {
			normalized[existingIndex] = mergeEntries(normalized[existingIndex], entry);
		} else {
			normalized.push(entry);
		}
	}

	return normalized;
};

/**
 * Format location label from weather parameters
 * @param {string} city - City name
 * @param {string} state - State name
 * @param {string} country - Country name
 * @param {string} countryCode - Country code
 * @returns {string} Formatted location label
 */
const formatLocation = (city, state, country, countryCode) => {
	const cleanCity = city?.trim() || 'Unknown';
	
	// US locations: "City, State"
	if (countryCode === 'US' || countryCode === 'USA') {
		const cleanState = state?.trim();
		return cleanState ? `${cleanCity}, ${cleanState}` : cleanCity;
	}
	
	// Non-US locations: "City, Country"
	const cleanCountry = country?.trim();
	return cleanCountry ? `${cleanCity}, ${cleanCountry}` : cleanCity;
};

/**
 * Update hazard history with current active hazards for a location
 * @param {Object} payload - Request payload
 * @param {string} payload.location - Formatted location label (for display)
 * @param {string} payload.locationKey - Stable location key from lat/lon (for matching)
 * @param {Array} payload.hazards - Array of active hazards
 * @returns {Array} Updated history
 */
const updateHistory = async (payload) => {
	const { location, locationKey, hazards = [] } = payload;
	
	// Load existing history
	let history = normalizeHistory(await loadHistory());
	const now = new Date().toISOString();
	
	// Use locationKey for matching if provided, fall back to location for backward compatibility
	const matchKey = locationKey || location;
	
	// Create a set of active hazard identities for this location
	const activeKeys = new Set(hazards.map((hazard) => generateKey(matchKey, hazard.hazardType, hazard.source)));
	
	// Mark previously ongoing hazards for this location as ended if no longer active
	history = history.map((entry) => {
		const entryMatchKey = entry.locationKey || entry.location;
		if (entryMatchKey !== matchKey) return entry;
		
		// If this entry is ongoing but not in the current active set, mark it as ended
		if (entry.ongoing && !activeKeys.has(entry.key)) {
			return {
				...entry,
				ongoing: false,
				lastSeenAt: now,
			};
		}
		return entry;
	});
	
	// Add or update active hazards
	hazards.forEach((hazard) => {
		const key = generateKey(matchKey, hazard.hazardType, hazard.source);
		const existingIndex = history.findIndex((entry) => entry.key === key);
		
		if (existingIndex >= 0) {
			// Update existing entry
			history[existingIndex] = {
				...history[existingIndex],
				lastSeenAt: now,
				ongoing: true,
				// Update severity if it changed
				severity: hazard.severity || history[existingIndex].severity,
				latestHazardId: hazard.id,
			};
		} else {
			// Create new entry
			history.push({
				key,
				location,
				locationKey: matchKey,
				hazardType: hazard.hazardType,
				encounteredAt: now,
				lastSeenAt: now,
				ongoing: true,
				severity: hazard.severity,
				source: hazard.source,
				latestHazardId: hazard.id,
			});
		}
	});

	history = normalizeHistory(history);
	
	// Sort by lastSeenAt descending (newest first)
	history.sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
	
	// Trim to max entries
	if (history.length > MAX_HISTORY_ENTRIES) {
		history = history.slice(0, MAX_HISTORY_ENTRIES);
	}
	
	// Save updated history
	await saveHistory(history);
	
	return history;
};

/**
 * Get current hazard history
 * @returns {Array} Current history entries
 */
const getHistory = async () => {
	const history = normalizeHistory(await loadHistory());
	// Ensure sorted by lastSeenAt descending
	return history.sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
};

export {
	loadHistory,
	saveHistory,
	updateHistory,
	getHistory,
	formatLocation,
	generateKey,
	MAX_HISTORY_ENTRIES,
};
