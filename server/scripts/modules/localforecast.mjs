// display text based local forecast

import STATUS from './status.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';
import { temperature, windSpeed } from './utils/units.mjs';
import { directionToNSEW } from './utils/calc.mjs';
import { getConditionText } from './utils/weather.mjs';

class LocalForecast extends WeatherDisplay {
	constructor(navId, elemId) {
		super(navId, elemId, 'Local Forecast', true);
		this.timing.baseDelay = 5000;
	}

	async getData(weatherParameters) {
		if (!super.getData(weatherParameters)) return;

		const conditions = buildLocalForecastPages(this.weatherParameters);
		if (!conditions.length) {
			if (this.isEnabled) this.setStatus(STATUS.failed);
			return;
		}

		this.screenTexts = conditions.map((condition) => `${condition.DayName.toUpperCase()}...${condition.Text.toUpperCase()}`);
		const templates = this.screenTexts.map((text) => this.fillTemplate('forecast', { text }));
		const forecastsElem = this.elem.querySelector('.forecasts');
		forecastsElem.innerHTML = '';
		forecastsElem.append(...templates);

		this.pageHeight = forecastsElem.parentNode.scrollHeight;
		templates.forEach((forecast) => {
			const newHeight = Math.ceil(forecast.scrollHeight / this.pageHeight) * this.pageHeight;
			forecast.style.height = `${newHeight}px`;
		});

		this.timing.totalScreens = forecastsElem.scrollHeight / this.pageHeight;
		this.calcNavTiming();
		this.setStatus(STATUS.loaded);
	}

	async drawCanvas() {
		super.drawCanvas();
		const top = -this.screenIndex * this.pageHeight;
		this.elem.querySelector('.forecasts').style.top = `${top}px`;
		this.finishDraw();
	}
}

const buildLocalForecastPages = (weatherParameters) => {
	const days = Object.entries(weatherParameters.forecast).slice(0, 3);
	const temperatureConverter = temperature();
	const windConverter = windSpeed();

	return days.map(([date, day]) => {
		const dayName = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', timeZone: weatherParameters.timeZone });
		const high = temperatureConverter(day.temperature_2m_max);
		const low = temperatureConverter(day.temperature_2m_min);
		const precip = Math.round(day.precipitation_probability ?? 0);
		const windDirection = directionToNSEW(day.wind_direction_10m ?? 0);
		const wind = windConverter(day.wind_speed_10m ?? 0);
		const condition = getConditionText(day.weather_code ?? 0);
		let text = `${condition}. High ${high}. Low ${low}.`;
		if (precip > 20) {
			text += ` Chance of precipitation ${precip} percent.`;
		}
		if (wind > 0) {
			text += ` Wind ${windDirection} ${wind} ${windConverter.units}.`;
		}

		return {
			DayName: dayName,
			Text: text,
		};
	});
};

registerDisplay(new LocalForecast(7, 'local-forecast'));
