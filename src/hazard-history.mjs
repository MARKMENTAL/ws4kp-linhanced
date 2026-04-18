import { getPool } from './mysql.mjs';

const MAX_HISTORY_ENTRIES = 7;
const PRACTICAL_LOCATION_RADIUS_KM = 50;

const toIsoString = (value) => {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const mapRowToHistoryEntry = (row) => ({
	location: row.location_label,
	locationKey: row.location_key,
	hazardType: row.hazard_type,
	source: row.source,
	severity: row.severity,
	latestHazardId: row.latest_hazard_id,
	encounteredAt: toIsoString(row.encountered_at),
	lastSeenAt: toIsoString(row.last_seen_at),
	ongoing: Boolean(row.ongoing),
});

const parseLocationKey = (locationKey) => {
	if (typeof locationKey !== 'string') return null;
	const [latText, lonText] = locationKey.split(',');
	const lat = Number.parseFloat(latText);
	const lon = Number.parseFloat(lonText);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	return { lat, lon };
};

const distanceKm = (a, b) => {
	const toRadians = (value) => value * (Math.PI / 180);
	const earthRadiusKm = 6371;
	const dLat = toRadians(b.lat - a.lat);
	const dLon = toRadians(b.lon - a.lon);
	const lat1 = toRadians(a.lat);
	const lat2 = toRadians(b.lat);
	const haversine = Math.sin(dLat / 2) ** 2
		+ Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
	return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

const isSamePracticalLocation = (row, location, locationKey) => {
	if (row.location_key === locationKey) return true;
	if (row.location_label !== location) return false;
	const rowCoords = parseLocationKey(row.location_key);
	const currentCoords = parseLocationKey(locationKey);
	if (!rowCoords || !currentCoords) return false;
	return distanceKm(rowCoords, currentCoords) <= PRACTICAL_LOCATION_RADIUS_KM;
};

const getCandidateRows = async (connection, location, locationKey) => {
	const [rows] = await connection.execute(
		`SELECT
			id,
			location_label,
			location_key,
			hazard_type,
			source,
			severity,
			latest_hazard_id,
			encountered_at,
			last_seen_at,
			ongoing
		FROM hazard_history
		WHERE location_key = ?
		   OR location_label = ?`,
		[locationKey, location],
	);

	return rows.filter((row) => isSamePracticalLocation(row, location, locationKey));
};

const buildHazardIdentity = (hazardType, source) => `${hazardType}::${source}`;

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

	if (countryCode === 'US' || countryCode === 'USA') {
		const cleanState = state?.trim();
		return cleanState ? `${cleanCity}, ${cleanState}` : cleanCity;
	}

	const cleanCountry = country?.trim();
	return cleanCountry ? `${cleanCity}, ${cleanCountry}` : cleanCity;
};

const getHistory = async () => {
	const [rows] = await getPool().query(
		`SELECT
			h.location_label,
			h.location_key,
			h.hazard_type,
			h.source,
			h.severity,
			h.latest_hazard_id,
			h.encountered_at,
			h.last_seen_at,
			h.ongoing
		FROM hazard_history h
		WHERE NOT EXISTS (
			SELECT 1
			FROM hazard_history h2
			WHERE h2.location_key = h.location_key
			  AND (
				h2.last_seen_at > h.last_seen_at
				OR (
					h2.last_seen_at = h.last_seen_at
					AND h2.ongoing > h.ongoing
				)
				OR (
					h2.last_seen_at = h.last_seen_at
					AND h2.ongoing = h.ongoing
					AND h2.id > h.id
				)
			  )
		)
		ORDER BY h.last_seen_at DESC, h.ongoing DESC, h.id DESC
		LIMIT ?`,
		[MAX_HISTORY_ENTRIES],
	);

	return rows.map(mapRowToHistoryEntry);
};

const updateHistory = async (payload) => {
	const { location, locationKey, hazards = [] } = payload;
	const validHazards = hazards.filter((hazard) => hazard?.hazardType && hazard?.source);
	const pool = getPool();
	const connection = await pool.getConnection();

	try {
		await connection.beginTransaction();
		const candidateRows = await getCandidateRows(connection, location, locationKey);
		const activeHazardKeys = new Set(validHazards.map((hazard) => buildHazardIdentity(hazard.hazardType, hazard.source)));

		if (validHazards.length === 0) {
			const idsToEnd = candidateRows.filter((row) => row.ongoing).map((row) => row.id);
			if (idsToEnd.length > 0) {
				const placeholders = idsToEnd.map(() => '?').join(', ');
				await connection.execute(
					`UPDATE hazard_history
					SET ongoing = 0,
					    last_seen_at = UTC_TIMESTAMP()
					WHERE id IN (${placeholders})
					  AND ongoing = 1`,
					idsToEnd,
				);
			}
		} else {
			const idsToEnd = candidateRows
				.filter((row) => row.ongoing && !activeHazardKeys.has(buildHazardIdentity(row.hazard_type, row.source)))
				.map((row) => row.id);
			if (idsToEnd.length > 0) {
				const placeholders = idsToEnd.map(() => '?').join(', ');
				await connection.execute(
					`UPDATE hazard_history
					SET ongoing = 0,
					    last_seen_at = UTC_TIMESTAMP()
					WHERE id IN (${placeholders})
					  AND ongoing = 1`,
					idsToEnd,
				);
			}
		}

		for (const hazard of validHazards) {
			const nearbyMatch = candidateRows.find((row) => row.hazard_type === hazard.hazardType
				&& row.source === hazard.source
				&& row.location_key !== locationKey);

			if (nearbyMatch) {
				await connection.execute(
					`UPDATE hazard_history
					SET location_key = ?,
					    location_label = ?,
					    severity = ?,
					    latest_hazard_id = ?,
					    last_seen_at = UTC_TIMESTAMP(),
					    ongoing = 1
					WHERE id = ?`,
					[
						locationKey,
						location,
						hazard.severity ?? null,
						hazard.id ?? null,
						nearbyMatch.id,
					],
				);
			}

			await connection.execute(
				`INSERT INTO hazard_history (
					location_label,
					location_key,
					hazard_type,
					source,
					severity,
					latest_hazard_id,
					encountered_at,
					last_seen_at,
					ongoing
				) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), 1)
				ON DUPLICATE KEY UPDATE
					location_label = VALUES(location_label),
					severity = VALUES(severity),
					latest_hazard_id = VALUES(latest_hazard_id),
					last_seen_at = UTC_TIMESTAMP(),
					ongoing = 1`,
				[
					location,
					locationKey,
					hazard.hazardType,
					hazard.source,
					hazard.severity ?? null,
					hazard.id ?? null,
				],
			);
		}

		await connection.commit();
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}

	return getHistory();
};

export {
	formatLocation,
	getHistory,
	MAX_HISTORY_ENTRIES,
	updateHistory,
};
