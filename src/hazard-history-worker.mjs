import deriveHazards from '../server/scripts/modules/utils/derived-hazards.mjs';
import {
	getOngoingHazards,
	markHazardEndedById,
	touchHazardStillOngoing,
} from './hazard-history.mjs';
import { buildWeatherParametersForLocation, parseLocationKey } from './weather-parameters.mjs';

const HAZARD_HISTORY_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const HAZARD_HISTORY_CHECK_CONCURRENCY = 3;
const USER_AGENT = 'WeatherStar 4000+: Linhanced; marky611@gmail.com';

let hazardHistoryWorkerHandle = null;
let isHazardHistoryWorkerRunning = false;

const buildHazardIdentity = (hazardType, source) => `${hazardType}::${source}`;

const groupHazardsByLocationKey = (rows) => rows.reduce((groups, row) => {
	const existing = groups.get(row.locationKey) ?? [];
	existing.push(row);
	groups.set(row.locationKey, existing);
	return groups;
}, new Map());

const fetchJson = async (url) => {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 10000);

	try {
		const response = await fetch(url, {
			headers: {
				'User-Agent': USER_AGENT,
			},
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`Fetch error ${response.status} ${response.statusText} while fetching ${url}`);
		}

		return await response.json();
	} finally {
		clearTimeout(timeoutId);
	}
};

const mapNoaaAlertsToActiveHazards = (alertsResponse) => (alertsResponse?.features ?? []).map((feature) => ({
	hazardType: feature.properties?.event || 'Unknown',
	latestHazardId: feature.id || null,
	severity: feature.properties?.severity || null,
	source: 'noaa',
}));

const mapDerivedHazardsToActiveHazards = (derivedHazards) => (derivedHazards ?? []).map((hazard) => ({
	hazardType: hazard.properties?.event || 'Unknown',
	latestHazardId: hazard.id || null,
	severity: hazard.properties?.severity || null,
	source: 'derived',
}));

const fetchActiveNoaaHazardsForLocation = async ({ latitude, longitude }) => {
	const url = new URL('https://api.weather.gov/alerts/active');
	url.searchParams.set('point', `${latitude},${longitude}`);
	url.searchParams.set('status', 'actual');
	const alerts = await fetchJson(url.toString());
	return mapNoaaAlertsToActiveHazards(alerts);
};

const fetchActiveDerivedHazardsForLocation = async ({ locationKey, locationLabel }) => {
	const weatherParameters = await buildWeatherParametersForLocation({ locationKey, locationLabel });
	return mapDerivedHazardsToActiveHazards(deriveHazards(weatherParameters));
};

const runWithConcurrency = async (items, limit, worker) => {
	const queue = [...items];
	const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
		while (queue.length > 0) {
			const next = queue.shift();
			if (!next) return;
			await worker(next);
		}
	});
	await Promise.all(runners);
};

const reconcileHazardsForLocation = async ({ locationKey, rows }) => {
	const coordinates = parseLocationKey(locationKey);
	if (!coordinates) {
		throw new Error(`Invalid location key '${locationKey}' in hazard history worker`);
	}

	const locationLabel = rows[0]?.locationLabel || 'Unknown';
	const summary = {
		refreshed: 0,
		ended: 0,
	};

	const [activeNoaaHazards, activeDerivedHazards] = await Promise.all([
		rows.some((row) => row.source === 'noaa')
			? fetchActiveNoaaHazardsForLocation({ latitude: coordinates.lat, longitude: coordinates.lon })
			: Promise.resolve([]),
		rows.some((row) => row.source === 'derived')
			? fetchActiveDerivedHazardsForLocation({ locationKey, locationLabel })
			: Promise.resolve([]),
	]);

	const activeHazards = [...activeNoaaHazards, ...activeDerivedHazards];
	const activeHazardMap = new Map(activeHazards.map((hazard) => [buildHazardIdentity(hazard.hazardType, hazard.source), hazard]));

	for (const row of rows) {
		const activeHazard = activeHazardMap.get(buildHazardIdentity(row.hazardType, row.source));
		if (activeHazard) {
			await touchHazardStillOngoing({
				id: row.id,
				severity: activeHazard.severity,
				latestHazardId: activeHazard.latestHazardId,
			});
			summary.refreshed += 1;
		} else {
			await markHazardEndedById(row.id);
			summary.ended += 1;
		}
	}

	return summary;
};

const runHazardHistoryCheckOnce = async () => {
	if (isHazardHistoryWorkerRunning) return;
	isHazardHistoryWorkerRunning = true;

	const totals = {
		locationsChecked: 0,
		refreshed: 0,
		ended: 0,
		failures: 0,
	};

	try {
		const ongoingRows = await getOngoingHazards();
		const grouped = [...groupHazardsByLocationKey(ongoingRows).entries()].map(([locationKey, rows]) => ({ locationKey, rows }));

		await runWithConcurrency(grouped, HAZARD_HISTORY_CHECK_CONCURRENCY, async (group) => {
			try {
				const result = await reconcileHazardsForLocation(group);
				totals.locationsChecked += 1;
				totals.refreshed += result.refreshed;
				totals.ended += result.ended;
			} catch (error) {
				totals.locationsChecked += 1;
				totals.failures += 1;
				console.warn(`Hazard worker location check failed for ${group.locationKey}: ${error.message}`);
			}
		});

		console.log(`Hazard worker: checked ${totals.locationsChecked} locations, refreshed ${totals.refreshed} hazards, ended ${totals.ended} hazards, ${totals.failures} failure${totals.failures === 1 ? '' : 's'}`);
	} finally {
		isHazardHistoryWorkerRunning = false;
	}
};

const startHazardHistoryWorker = () => {
	if (hazardHistoryWorkerHandle) return;
	runHazardHistoryCheckOnce().catch((error) => {
		console.warn(`Hazard worker initial run failed: ${error.message}`);
	});
	hazardHistoryWorkerHandle = setInterval(() => {
		runHazardHistoryCheckOnce().catch((error) => {
			console.warn(`Hazard worker run failed: ${error.message}`);
		});
	}, HAZARD_HISTORY_CHECK_INTERVAL_MS);
	if (typeof hazardHistoryWorkerHandle.unref === 'function') {
		hazardHistoryWorkerHandle.unref();
	}
};

const stopHazardHistoryWorker = () => {
	if (!hazardHistoryWorkerHandle) return;
	clearInterval(hazardHistoryWorkerHandle);
	hazardHistoryWorkerHandle = null;
};

export {
	runHazardHistoryCheckOnce,
	startHazardHistoryWorker,
	stopHazardHistoryWorker,
};
