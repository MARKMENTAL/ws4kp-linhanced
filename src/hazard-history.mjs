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

/**
 * Generate a stable key for a hazard entry
 * @param {string} location - Formatted location string
 * @param {string} hazardId - Hazard ID
 * @returns {string} Stable key
 */
const generateKey = (location, hazardId) => `${location}::${hazardId}`;

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
	let history = await loadHistory();
	const now = new Date().toISOString();
	
	// Use locationKey for matching if provided, fall back to location for backward compatibility
	const matchKey = locationKey || location;
	
	// Create a set of active hazard keys for this location
	const activeKeys = new Set();
	hazards.forEach((hazard) => {
		const key = generateKey(matchKey, hazard.id);
		activeKeys.add(key);
	});
	
	// Mark previously ongoing hazards for this location as ended if no longer active
	history = history.map((entry) => {
		// Only process entries for this location
		// Use locationKey for matching if available, fall back to location for backward compatibility
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
		const key = generateKey(matchKey, hazard.id);
		const existingIndex = history.findIndex((entry) => entry.key === key);
		
		if (existingIndex >= 0) {
			// Update existing entry
			history[existingIndex] = {
				...history[existingIndex],
				lastSeenAt: now,
				ongoing: true,
				// Update severity if it changed
				severity: hazard.severity || history[existingIndex].severity,
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
			});
		}
	});
	
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
	const history = await loadHistory();
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
