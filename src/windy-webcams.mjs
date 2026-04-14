import { readFile } from 'fs/promises';

let cachedApiKey = null;

const SEARCH_RADII_KM = [20, 50, 100];

const truncateTitle = (title, maxLength = 21) => {
	if (!title || title.length <= maxLength) return title;
	return `${title.slice(0, maxLength - 3)}...`;
};

const loadWindyApiKey = async () => {
	if (cachedApiKey !== null) return cachedApiKey;
	const key = (await readFile('./windy-api-key.txt', 'utf8')).trim();
	if (!key) {
		throw new Error('Missing Windy API key');
	}
	cachedApiKey = key;
	return cachedApiKey;
};

const buildWindyNearbyUrl = (lat, lon, radiusKm, limit = 10, offset = 0) => {
	const params = new URLSearchParams({
		lang: 'en',
		limit: String(limit),
		offset: String(offset),
		nearby: `${lat},${lon},${radiusKm}`,
		include: 'location,images,player',
	});
	return `https://api.windy.com/webcams/api/v3/webcams?${params.toString()}`;
};

const fetchWindyWebcamsNearby = async (lat, lon, radiusKm, apiKey, options = {}) => {
	const url = buildWindyNearbyUrl(lat, lon, radiusKm, options.limit ?? 10, options.offset ?? 0);
	const response = await fetch(url, {
		headers: {
			accept: 'application/json',
			'x-windy-api-key': apiKey,
		},
	});
	if (!response.ok) {
		throw new Error(`Windy webcams request failed: ${response.status} ${response.statusText}`);
	}
	return response.json();
};

const extractWindyWebcamCoordinates = (webcam) => {
	const lat = webcam?.location?.latitude;
	const lon = webcam?.location?.longitude;
	if (typeof lat !== 'number' || typeof lon !== 'number') return null;
	return { lat, lon };
};

const extractWindyWebcamTitle = (webcam) => webcam?.title?.trim() || 'Nearby Webcam';

const extractWindyWebcamMedia = (webcam) => {
	const imageCandidates = [
		webcam?.images?.current?.preview,
		webcam?.images?.daylight?.preview,
		webcam?.images?.current?.thumbnail,
		webcam?.images?.daylight?.thumbnail,
		webcam?.images?.current?.icon,
		webcam?.images?.daylight?.icon,
	].filter(Boolean);

	const timelapseCandidates = [
		webcam?.player?.day,
		webcam?.player?.month,
		webcam?.player?.year,
		webcam?.player?.lifetime,
	].filter(Boolean);

	const imageUrl = imageCandidates[0] ?? null;
	const timelapseUrl = timelapseCandidates[0] ?? null;

	return {
		imageUrl,
		timelapseUrl,
		mediaType: imageUrl ? 'image' : 'none',
	};
};

const isUsableWindyWebcam = (webcam) => {
	if ((webcam?.status ?? '').toLowerCase() !== 'active') return false;
	if (!extractWindyWebcamCoordinates(webcam)) return false;
	return Boolean(extractWindyWebcamMedia(webcam).imageUrl);
};

const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
	const R = 6371;
	const toRadians = (degrees) => (degrees * Math.PI) / 180;
	const dLat = toRadians(lat2 - lat1);
	const dLon = toRadians(lon2 - lon1);
	const a = Math.sin(dLat / 2) ** 2
		+ Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return R * c;
};

const normalizeWindyWebcam = (webcam, city, sourceLat, sourceLon) => {
	const coords = extractWindyWebcamCoordinates(webcam);
	if (!coords) return null;
	const media = extractWindyWebcamMedia(webcam);
	const title = truncateTitle(extractWindyWebcamTitle(webcam));
	return {
		id: String(webcam.webcamId ?? ''),
		title,
		city,
		label: `${title} - ${city}`,
		distanceKm: calculateDistanceKm(sourceLat, sourceLon, coords.lat, coords.lon),
		imageUrl: media.imageUrl,
		timelapseUrl: media.timelapseUrl,
		mediaType: media.mediaType,
		location: {
			city: webcam?.location?.city ?? '',
			region: webcam?.location?.region ?? '',
			country: webcam?.location?.country ?? '',
		},
		lastUpdatedOn: webcam?.lastUpdatedOn ?? null,
	};
};

const pickBestWindyWebcam = (webcams, city, sourceLat, sourceLon) => webcams
	.filter(isUsableWindyWebcam)
	.map((webcam) => normalizeWindyWebcam(webcam, city, sourceLat, sourceLon))
	.filter(Boolean)
	.sort((a, b) => a.distanceKm - b.distanceKm)[0] ?? null;

const findNearestWindyWebcam = async (lat, lon, city, apiKey) => {
	for (const radiusKm of SEARCH_RADII_KM) {
		const result = await fetchWindyWebcamsNearby(lat, lon, radiusKm, apiKey);
		const webcam = pickBestWindyWebcam(result?.webcams ?? [], city, lat, lon);
		if (webcam) return webcam;
	}
	return null;
};

export {
	loadWindyApiKey,
	buildWindyNearbyUrl,
	fetchWindyWebcamsNearby,
	extractWindyWebcamCoordinates,
	extractWindyWebcamTitle,
	extractWindyWebcamMedia,
	isUsableWindyWebcam,
	calculateDistanceKm,
	normalizeWindyWebcam,
	pickBestWindyWebcam,
	findNearestWindyWebcam,
};
