import { getPool } from './mysql.mjs';

const MAX_HISTORY_ENTRIES = 7;

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
		ORDER BY last_seen_at DESC
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

		if (validHazards.length === 0) {
			await connection.execute(
				`UPDATE hazard_history
				SET ongoing = 0,
				    last_seen_at = UTC_TIMESTAMP()
				WHERE location_key = ?
				  AND ongoing = 1`,
				[locationKey],
			);
		} else {
			const keepClauses = validHazards.map(() => '(hazard_type = ? AND source = ?)').join(' OR ');
			const keepParams = validHazards.flatMap((hazard) => [hazard.hazardType, hazard.source]);

			await connection.execute(
				`UPDATE hazard_history
				SET ongoing = 0,
				    last_seen_at = UTC_TIMESTAMP()
				WHERE location_key = ?
				  AND ongoing = 1
				  AND NOT (${keepClauses})`,
				[locationKey, ...keepParams],
			);
		}

		for (const hazard of validHazards) {
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
