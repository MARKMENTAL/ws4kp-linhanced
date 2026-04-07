// hourly forecast list

import STATUS from './status.mjs';
import { DateTime } from '../vendor/auto/luxon.mjs';
import { temperature as temperatureUnit, windSpeed as windUnit } from './utils/units.mjs';
import { directionToNSEW } from './utils/calc.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay, timeZone } from './navigation.mjs';
import calculateScrollTiming from './utils/scroll-timing.mjs';
import { getSmallIconFromWmoCode } from './icons.mjs';

class Hourly extends WeatherDisplay {
	constructor(navId, elemId, defaultActive) {
		super(navId, elemId, 'Hourly Forecast', defaultActive);
		this.scrollCache = {
			displayHeight: 0,
			contentHeight: 0,
			maxOffset: 0,
			hourlyLines: null,
		};
	}

	async getData(weatherParameters, refresh) {
		const superResponse = super.getData(weatherParameters, refresh);
		this.data = parseForecast(this.weatherParameters);

		if (!this.data?.length) {
			if (this.isEnabled) this.setStatus(STATUS.failed);
			this.getDataCallback(undefined);
			return;
		}

		this.getDataCallback();
		if (!superResponse) return;

		this.setStatus(STATUS.loaded);
		this.drawLongCanvas();
	}

	async drawLongCanvas() {
		const list = this.elem.querySelector('.hourly-lines');
		list.innerHTML = '';

		const startingHour = DateTime.local().setZone(timeZone());
		const shortData = this.data.slice(0, 24);
		const lines = shortData.map((data, index) => {
			const hour = startingHour.plus({ hours: index });
			const fillValues = {
				hour: hour.toLocaleString({ weekday: 'short', hour: 'numeric' }),
				temp: data.temperature.toString().padStart(3),
				like: data.apparentTemperature.toString().padStart(3),
				wind: data.windSpeed > 0
					? data.windDirection + (Array(6 - data.windDirection.length - Math.round(data.windSpeed).toString().length).join(' ')) + Math.round(data.windSpeed).toString()
					: 'Calm',
				icon: { type: 'img', src: data.icon },
			};

			const filledRow = this.fillTemplate('hourly-row', fillValues);
			if (data.apparentTemperature < data.temperature) {
				filledRow.querySelector('.like').classList.add('wind-chill');
			} else if (data.apparentTemperature > data.temperature) {
				filledRow.querySelector('.like').classList.add('heat-index');
			}
			return filledRow;
		});

		list.append(...lines);
		this.setTiming(list);
	}

	drawCanvas() {
		super.drawCanvas();
		this.finishDraw();
	}

	showCanvas() {
		this.drawCanvas();
		super.showCanvas();
	}

	screenIndexChange() {
		this.baseCountChange(this.navBaseCount);
	}

	baseCountChange(count) {
		const hourlyLines = this.elem.querySelector('.hourly-lines');
		if (!hourlyLines) return;

		if (this.scrollCache.hourlyLines !== hourlyLines || this.scrollCache.displayHeight === 0) {
			this.scrollCache.displayHeight = this.elem.querySelector('.main').offsetHeight;
			this.scrollCache.contentHeight = hourlyLines.offsetHeight;
			this.scrollCache.maxOffset = Math.max(0, this.scrollCache.contentHeight - this.scrollCache.displayHeight);
			this.scrollCache.hourlyLines = hourlyLines;
			hourlyLines.style.willChange = 'transform';
			hourlyLines.style.backfaceVisibility = 'hidden';
		}

		let offsetY = Math.min(this.scrollCache.maxOffset, (count - this.scrollTiming.initialCounts) * this.scrollTiming.pixelsPerCount);
		if (offsetY < 0) offsetY = 0;
		hourlyLines.style.transform = `translateY(-${Math.round(offsetY)}px)`;
	}

	async getHourlyData(stillWaiting) {
		if (stillWaiting) this.stillWaitingCallbacks.push(stillWaiting);
		this.setAutoReload();
		return new Promise((resolve) => {
			if (this.data) resolve(this.data);
			this.getDataCallbacks.push(() => resolve(this.data));
		});
	}

	setTiming(list) {
		const container = this.elem.querySelector('.main');
		const timingConfig = calculateScrollTiming(list, container);
		this.timing.baseDelay = timingConfig.baseDelay;
		this.timing.delay = timingConfig.delay;
		this.scrollTiming = timingConfig.scrollTiming;
		this.calcNavTiming();
	}
}

const parseForecast = (weatherParameters) => {
	const temperatureConverter = temperatureUnit();
	const windConverter = windUnit();
	const currentTime = new Date();
	const todayKey = currentTime.toLocaleDateString('en-CA', { timeZone: weatherParameters.timeZone });
	const tomorrowKey = DateTime.fromISO(todayKey).plus({ days: 1 }).toISODate();
	const availableTimes = [
		...(weatherParameters.forecast[todayKey]?.hours ?? []),
		...(weatherParameters.forecast[tomorrowKey]?.hours ?? []),
	];
	if (!availableTimes.length) return [];

	let closestIndex = 0;
	let minDiff = Math.abs(new Date(availableTimes[0].time) - currentTime);
	availableTimes.forEach((entry, index) => {
		const diff = Math.abs(new Date(entry.time) - currentTime);
		if (diff < minDiff) {
			minDiff = diff;
			closestIndex = index;
		}
	});

	return availableTimes.slice(closestIndex).map((hour) => ({
		temperature: temperatureConverter(hour.temperature_2m),
		temperatureUnit: temperatureConverter.units,
		apparentTemperature: temperatureConverter(hour.apparent_temperature),
		windSpeed: windConverter(hour.wind_speed_10m),
		windUnit: windConverter.units,
		windDirection: directionToNSEW(hour.wind_direction_10m ?? 0),
		probabilityOfPrecipitation: Math.round(hour.precipitation_probability ?? 0),
		skyCover: Math.round(hour.cloud_cover ?? 0),
		icon: getSmallIconFromWmoCode(hour.weather_code, Boolean(hour.is_day)),
		dewpoint: temperatureConverter(hour.dew_point_2m),
	}));
};

const display = new Hourly(3, 'hourly', true);
registerDisplay(display);

export default display.getHourlyData.bind(display);
