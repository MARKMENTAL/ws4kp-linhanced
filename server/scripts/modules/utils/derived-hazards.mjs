import { DateTime } from '../../vendor/auto/luxon.mjs';

const LOOKAHEAD_HOURS = 6;
const METERS_PER_MILE = 1609.344;
const KPH_PER_MPH = 1.609344;

const SEVERITY_RANK = {
	Extreme: 2,
	Severe: 1,
};

const RULE_PRIORITY = {
	tropical: 7,
	thunderstorm: 6,
	fog: 5,
	freezing: 4,
	snow: 3,
	rain: 2,
	wind: 1,
};

const WEATHER_CODES = {
	freezing: new Set([56, 57, 66, 67]),
	snow: new Set([71, 73, 75, 77, 85, 86]),
	thunderstorm: new Set([95, 96, 99]),
	rain: new Set([51, 53, 55, 61, 63, 65, 80, 81, 82]),
	fog: new Set([45, 48]),
};

const thresholds = {
	lowVisibilitySevere: 5 * METERS_PER_MILE,
	lowVisibilityExtreme: 2 * METERS_PER_MILE,
	denseFogVisibility: 1000,
	gustSevere: 20 * KPH_PER_MPH,
	gustExtreme: 35 * KPH_PER_MPH,
	highWindSevere: 40 * KPH_PER_MPH,
	highWindExtreme: 55 * KPH_PER_MPH,
	tropicalWindSevere: 50,
	tropicalWindExtreme: 63,
	tropicalGustSevere: 75,
	tropicalGustExtreme: 90,
	tropicalPressureSevere: 1002,
	tropicalPressureExtreme: 998,
	freezingTempC: 1,
};

const buildDerivedHazard = ({
	id,
	severity,
	description,
	priority,
	event = 'Severe Weather Alert',
}) => ({
	id,
	priority,
	properties: {
		event,
		severity,
		urgency: 'Expected',
		description: `This is a derived local alert based on forecast conditions. ${description}`,
	},
});

const getUpcomingHours = (weatherParameters) => {
	const zone = weatherParameters?.timeZone || 'UTC';
	const now = DateTime.now().setZone(zone);
	const end = now.plus({ hours: LOOKAHEAD_HOURS });
	const allHours = Object.values(weatherParameters?.forecast ?? {})
		.flatMap((day) => day?.hours ?? [])
		.map((hour) => ({
			...hour,
			forecastTime: DateTime.fromISO(hour.time, { zone }),
		}))
		.filter((hour) => hour.forecastTime.isValid)
		.sort((a, b) => a.forecastTime.toMillis() - b.forecastTime.toMillis());

	return allHours.filter((hour) => hour.forecastTime >= now && hour.forecastTime <= end);
};

const getWorstHour = (hours, evaluator) => hours.reduce((worst, hour) => {
	const candidate = evaluator(hour);
	if (!candidate) return worst;
	if (!worst) return candidate;
	if (SEVERITY_RANK[candidate.severity] > SEVERITY_RANK[worst.severity]) return candidate;
	return worst;
}, null);

const evaluateThunderstorm = (hours) => getWorstHour(hours, (hour) => {
	const code = Number(hour.weather_code ?? 0);
	if (!WEATHER_CODES.thunderstorm.has(code)) return null;
	const visibility = hour.visibility ?? Number.POSITIVE_INFINITY;
	const lowVisibility = visibility < thresholds.lowVisibilitySevere;

	if (code === 96 || code === 99) {
		return {
			severity: 'Extreme',
			description: lowVisibility
				? 'Thunderstorms with hail and very low visibility are expected in the next several hours and may create dangerous outdoor and travel conditions.'
				: 'Thunderstorms with hail are possible in the next several hours and may create dangerous outdoor conditions.',
		};
	}
	return {
		severity: 'Severe',
		description: lowVisibility
			? 'Thunderstorms with reduced visibility are expected in the next several hours and may create hazardous outdoor and travel conditions.'
			: 'Thunderstorms are possible in the next several hours and may create hazardous outdoor conditions.',
	};
});

const evaluateFreezing = (hours) => getWorstHour(hours, (hour) => {
	const code = Number(hour.weather_code ?? 0);
	if (!WEATHER_CODES.freezing.has(code)) return null;
	const temperature = hour.temperature_2m ?? Number.POSITIVE_INFINITY;
	if (temperature > thresholds.freezingTempC) return null;
	const visibility = hour.visibility ?? Number.POSITIVE_INFINITY;
	const gusts = hour.wind_gusts_10m ?? 0;
	const isExtreme = visibility <= thresholds.lowVisibilityExtreme || gusts >= thresholds.gustExtreme;
	return {
		severity: isExtreme ? 'Extreme' : 'Severe',
		description: isExtreme
			? 'Freezing precipitation with poor visibility or strong gusts is expected in the next several hours and may create dangerous travel conditions.'
			: 'Freezing precipitation is expected in the next several hours and may create slippery travel conditions.',
	};
});

const evaluateSnow = (hours) => getWorstHour(hours, (hour) => {
	const code = Number(hour.weather_code ?? 0);
	if (!WEATHER_CODES.snow.has(code)) return null;
	const visibility = hour.visibility ?? Number.POSITIVE_INFINITY;
	const gusts = hour.wind_gusts_10m ?? 0;
	if (visibility <= thresholds.lowVisibilitySevere && gusts >= thresholds.gustSevere) {
		return {
			severity: visibility <= thresholds.lowVisibilityExtreme ? 'Extreme' : 'Severe',
			description: visibility <= thresholds.lowVisibilityExtreme
				? 'Snow, poor visibility, and gusty winds are expected in the next several hours and may create dangerous travel conditions.'
				: 'Snow, reduced visibility, and gusty winds are expected in the next several hours and may create hazardous travel conditions.',
		};
	}
	return null;
});

const evaluateRain = (hours) => getWorstHour(hours, (hour) => {
	const code = Number(hour.weather_code ?? 0);
	const visibility = hour.visibility ?? Number.POSITIVE_INFINITY;
	const gusts = hour.wind_gusts_10m ?? 0;
	const hasRain = WEATHER_CODES.rain.has(code) || (hour.rain ?? 0) > 0 || (hour.showers ?? 0) > 0;
	if (!hasRain) return null;
	if (visibility <= thresholds.lowVisibilityExtreme && gusts >= thresholds.gustExtreme) {
		return {
			severity: 'Extreme',
			description: 'Heavy rain, very low visibility, and strong gusts are expected in the next several hours and may create dangerous travel conditions.',
		};
	}
	if (visibility <= thresholds.lowVisibilitySevere && gusts >= thresholds.gustSevere) {
		return {
			severity: 'Severe',
			description: 'Heavy rain, reduced visibility, and gusty winds are expected in the next several hours and may create hazardous travel conditions.',
		};
	}
	return null;
});

const evaluateTropical = (hours) => getWorstHour(hours, (hour) => {
	const code = Number(hour.weather_code ?? 0);
	const sustainedWind = hour.wind_speed_10m ?? 0;
	const gusts = hour.wind_gusts_10m ?? 0;
	const pressureHpa = hour.pressure_msl ?? Number.POSITIVE_INFINITY;
	const visibility = hour.visibility ?? Number.POSITIVE_INFINITY;
	const hasRain = WEATHER_CODES.rain.has(code) || (hour.rain ?? 0) > 0 || (hour.showers ?? 0) > 0;

	if (!hasRain) return null;

	const meetsExtreme = (
		(sustainedWind >= thresholds.tropicalWindExtreme || gusts >= thresholds.tropicalGustExtreme)
		&& pressureHpa <= thresholds.tropicalPressureExtreme
	);
	if (meetsExtreme) {
		return {
			severity: 'Extreme',
			description: visibility <= thresholds.lowVisibilitySevere
				? 'Tropical storm conditions are expected in the next several hours, with very strong winds, heavy rain, poor visibility, and dangerous travel conditions.'
				: 'Tropical storm conditions are expected in the next several hours, with very strong winds, heavy rain, and dangerous travel conditions.',
		};
	}

	const meetsSevere = (
		(sustainedWind >= thresholds.tropicalWindSevere || gusts >= thresholds.tropicalGustSevere)
		&& pressureHpa <= thresholds.tropicalPressureSevere
	);
	if (meetsSevere) {
		return {
			severity: 'Severe',
			description: 'Tropical storm conditions are possible in the next several hours, including heavy rain, strong winds, and dangerous travel conditions.',
		};
	}

	return null;
});

const evaluateWind = (hours) => getWorstHour(hours, (hour) => {
	const gusts = hour.wind_gusts_10m ?? 0;
	if (gusts >= thresholds.highWindExtreme) {
		return {
			severity: 'Extreme',
			description: 'Very strong wind gusts are expected in the next several hours and may create dangerous conditions for travel and outdoor activity.',
		};
	}
	if (gusts >= thresholds.highWindSevere) {
		return {
			severity: 'Severe',
			description: 'Strong wind gusts are expected in the next several hours and may create hazardous conditions for travel and outdoor activity.',
		};
	}
	return null;
});

const evaluateFog = (hours) => getWorstHour(hours, (hour) => {
	const code = Number(hour.weather_code ?? 0);
	if (!WEATHER_CODES.fog.has(code)) return null;
	const visibility = hour.visibility ?? Number.POSITIVE_INFINITY;

	if (visibility <= thresholds.denseFogVisibility) {
		return {
			severity: 'Extreme',
			description: 'Dense fog with very low visibility is expected in the next several hours and may create dangerous travel conditions.',
			event: 'Dense Fog Warning',
		};
	}
	if (visibility < thresholds.lowVisibilitySevere) {
		return {
			severity: 'Severe',
			description: 'Reduced visibility with mist or low cloud is expected in the next several hours and may create hazardous travel conditions.',
			event: 'Reduced Visibility Advisory',
		};
	}
	return null;
});

const deriveHazards = (weatherParameters) => {
	const upcomingHours = getUpcomingHours(weatherParameters);
	if (upcomingHours.length === 0) return [];
	const tropicalCandidate = evaluateTropical(upcomingHours);
	const thunderstormCandidate = evaluateThunderstorm(upcomingHours);
	const fogCandidate = evaluateFog(upcomingHours);
	const freezingCandidate = evaluateFreezing(upcomingHours);
	const snowCandidate = evaluateSnow(upcomingHours);
	const rainCandidate = evaluateRain(upcomingHours);
	const windCandidate = evaluateWind(upcomingHours);

	const candidates = [
		tropicalCandidate && buildDerivedHazard({
			id: 'derived-severe-weather-alert-tropical',
			priority: RULE_PRIORITY.tropical,
			event: 'Tropical Storm Alert',
			...tropicalCandidate,
		}),
		thunderstormCandidate && buildDerivedHazard({
			id: 'derived-severe-weather-alert-thunderstorm',
			priority: RULE_PRIORITY.thunderstorm,
			...thunderstormCandidate,
		}),
		fogCandidate && buildDerivedHazard({
			id: 'derived-severe-weather-alert-fog',
			priority: RULE_PRIORITY.fog,
			...fogCandidate,
		}),
		freezingCandidate && buildDerivedHazard({
			id: 'derived-severe-weather-alert-freezing',
			priority: RULE_PRIORITY.freezing,
			...freezingCandidate,
		}),
		snowCandidate && buildDerivedHazard({
			id: 'derived-severe-weather-alert-snow',
			priority: RULE_PRIORITY.snow,
			...snowCandidate,
		}),
		rainCandidate && buildDerivedHazard({
			id: 'derived-severe-weather-alert-rain',
			priority: RULE_PRIORITY.rain,
			...rainCandidate,
		}),
		windCandidate && buildDerivedHazard({
			id: 'derived-severe-weather-alert-wind',
			priority: RULE_PRIORITY.wind,
			...windCandidate,
		}),
	].filter(Boolean);

	if (candidates.length === 0) return [];

	candidates.sort((a, b) => {
		const severityDiff = SEVERITY_RANK[b.properties.severity] - SEVERITY_RANK[a.properties.severity];
		if (severityDiff !== 0) return severityDiff;
		return b.priority - a.priority;
	});

	return [candidates[0]];
};

export default deriveHazards;
