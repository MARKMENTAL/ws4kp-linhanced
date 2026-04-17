import largeIcon from './icons/icons-large.mjs';
import smallIcon from './icons/icons-small.mjs';
import hourlyIcon from './icons/icons-hourly.mjs';
import { withBasePath } from './utils/base-path.mjs';
import { getWindDescriptor } from './utils/weather.mjs';

const getWeatherGovTokenFromWmoCode = (code) => {
	switch (Number(code)) {
		case 0: return 'skc';
		case 1: return 'few';
		case 2: return 'sct';
		case 3: return 'ovc';
		case 45:
		case 48:
			return 'fog';
		case 51:
		case 53:
		case 55:
		case 80:
			return 'rain_showers';
		case 56:
		case 57:
		case 66:
		case 67:
			return 'fzra';
		case 61:
		case 63:
		case 65:
		case 81:
		case 82:
			return 'rain';
		case 71:
		case 73:
		case 75:
		case 85:
		case 86:
			return 'snow';
		case 77:
			return 'sleet';
		case 95:
		case 96:
		case 99:
			return 'tsra';
		default:
			return 'ovc';
	}
};

const buildSyntheticIconUrl = (code, isDaytime = true) => withBasePath(`icons/land/${isDaytime ? 'day' : 'night'}/${getWeatherGovTokenFromWmoCode(code)}`);

const getLargeIconFromWmoCode = (code, isDaytime = true) => largeIcon(buildSyntheticIconUrl(code, isDaytime), !isDaytime);
const getSmallIconFromWmoCode = (code, isDaytime = true) => smallIcon(buildSyntheticIconUrl(code, isDaytime), !isDaytime);

// Wind-aware icon selection
const getWeatherGovTokenFromWmoCodeWithWind = (code, windSpeedKmh, windGustsKmh) => {
	const baseToken = getWeatherGovTokenFromWmoCode(code);
	const windDesc = getWindDescriptor(windSpeedKmh, windGustsKmh);
	const windCapableTokens = new Set(['skc', 'few', 'sct', 'bkn', 'ovc']);

	if (windDesc && windCapableTokens.has(baseToken)) {
		return `wind_${baseToken}`;
	}
	return baseToken;
};

const buildSyntheticIconUrlWithWind = (code, isDaytime, windSpeedKmh, windGustsKmh) => {
	const token = getWeatherGovTokenFromWmoCodeWithWind(code, windSpeedKmh, windGustsKmh);
	return withBasePath(`icons/land/${isDaytime ? 'day' : 'night'}/${token}`);
};

const getLargeIconFromWmoCodeWithWind = (code, isDaytime, windSpeedKmh, windGustsKmh) => {
	const iconUrl = buildSyntheticIconUrlWithWind(code, isDaytime, windSpeedKmh, windGustsKmh);
	return largeIcon(iconUrl, !isDaytime);
};

const getSmallIconFromWmoCodeWithWind = (code, isDaytime, windSpeedKmh, windGustsKmh) => {
	const iconUrl = buildSyntheticIconUrlWithWind(code, isDaytime, windSpeedKmh, windGustsKmh);
	return smallIcon(iconUrl, !isDaytime);
};

export {
	largeIcon as getLargeIcon,
	smallIcon as getSmallIcon,
	hourlyIcon as getHourlyIcon,
	getLargeIconFromWmoCode,
	getSmallIconFromWmoCode,
	getLargeIconFromWmoCodeWithWind,
	getSmallIconFromWmoCodeWithWind,
};
