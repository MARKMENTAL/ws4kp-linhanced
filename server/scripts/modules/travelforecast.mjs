// travel forecast display
import STATUS from './status.mjs';
import { safePromiseAll } from './utils/fetch.mjs';
import { getSmallIconFromWmoCode } from './icons.mjs';
import { DateTime } from '../vendor/auto/luxon.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';
import calculateScrollTiming from './utils/scroll-timing.mjs';
import { debugFlag } from './utils/debug.mjs';
import { temperature } from './utils/units.mjs';
import { getAggregatedOpenMeteoForecast } from './utils/weather.mjs';

class TravelForecast extends WeatherDisplay {
	constructor(navId, elemId, defaultActive) {
		// special height and width for scrolling
		super(navId, elemId, 'Travel Forecast', defaultActive);

		// add previous data cache
		this.previousData = [];

		// cache for scroll calculations
		// This cache is essential because baseCountChange() is called 25 times per second (every 40ms)
		// during scrolling. Travel forecast scroll duration varies based on the number of cities configured.
		// Without caching, we'd perform hundreds of expensive DOM layout queries during each scroll cycle.
		// The cache reduces this to one calculation when content changes, then reuses cached values to try
		// and get smoother scrolling.
		this.scrollCache = {
			displayHeight: 0,
			contentHeight: 0,
			maxOffset: 0,
			travelLines: null,
		};
	}

	resetScrollCache() {
		this.scrollCache = {
			displayHeight: 0,
			contentHeight: 0,
			maxOffset: 0,
			travelLines: null,
		};
	}

	async getData(weatherParameters, refresh) {
		// super checks for enabled
		if (!super.getData(weatherParameters, refresh)) return;

		// clear stored data if not refresh
		if (!refresh) {
			this.previousData = [];
		}

		const temperatureConverter = temperature();
		const selectedTravelCities = getTravelCitiesForLocation(this.weatherParameters);

		const forecastPromises = selectedTravelCities.map(async (city, index) => {
			try {
				let forecast;
				forecast = await getAggregatedOpenMeteoForecast(city.Latitude, city.Longitude);

				if (forecast) {
					// store for the next run
					this.previousData[index] = forecast;
				} else if (this.previousData?.[index]) {
					// if there's previous data use it
					if (debugFlag('travelforecast')) {
						console.warn(`Using previous forecast data for ${city.Name} travel forecast`);
					}
					forecast = this.previousData?.[index];
				} else {
					// no current data and no previous data available
					if (debugFlag('verbose-failures')) {
						console.warn(`No travel forecast for ${city.Name} available`);
					}
					return { name: city.Name, error: true };
				}

				const [todayKey, tomorrowKey] = Object.keys(forecast.aggregatedForecast);
				const todayForecast = forecast.aggregatedForecast[todayKey];
				const tomorrowForecast = forecast.aggregatedForecast[tomorrowKey] ?? todayForecast;
				if (!todayForecast) {
					throw new Error('No aggregated travel forecast available');
				}

				const firstHour = todayForecast.hours[0] ?? {};
				const today = Boolean(firstHour.is_day ?? 1);
				// return a pared-down forecast
				return {
					today,
					high: temperatureConverter(todayForecast.temperature_2m_max),
					low: temperatureConverter(tomorrowForecast.temperature_2m_min),
					name: city.Name,
					icon: getSmallIconFromWmoCode(todayForecast.weather_code, today),
				};
			} catch (error) {
				console.error(`Unexpected error getting Travel Forecast for ${city.Name}: ${error.message}`);
				return { name: city.Name, error: true };
			}
		});

		// wait for all forecasts using centralized safe Promise handling
		const forecasts = await safePromiseAll(forecastPromises);
		this.data = forecasts;

		// test for some data available in at least one forecast
		const hasData = this.data.some((forecast) => forecast.high);
		if (!hasData) {
			this.setStatus(STATUS.noData);
			return;
		}

		this.setStatus(STATUS.loaded);
		this.drawLongCanvas();
	}

	async drawLongCanvas() {
		// get the element and populate
		const list = this.elem.querySelector('.travel-lines');
		list.innerHTML = '';
		this.resetScrollCache();

		// set up variables
		const cities = this.data;

		const lines = cities.map((city) => {
			if (city.error) return false;
			const fillValues = {
				city,
			};

			// check for forecast data
			if (city.icon) {
				fillValues.city = city.name;
				// get temperatures and convert if necessary
				const { low, high } = city;

				// convert to strings with no decimal
				const lowString = Math.round(low).toString();
				const highString = Math.round(high).toString();

				fillValues.low = lowString;
				fillValues.high = highString;
				const { icon } = city;

				fillValues.icon = { type: 'img', src: icon };
			} else {
				fillValues.error = 'NO TRAVEL DATA AVAILABLE';
			}
			return this.fillTemplate('travel-row', fillValues);
		}).filter((d) => d);
		list.append(...lines);

		// update timing based on actual content
		this.setTiming(list);
	}

	async drawCanvas() {
		// there are technically 2 canvases: the standard canvas and the extra-long canvas that contains the complete
		// list of cities. The second canvas is copied into the standard canvas to create the scroll
		super.drawCanvas();

		// set up variables
		const cities = this.data;

		this.elem.querySelector('.header .title.dual .bottom').innerHTML = `For ${getTravelCitiesDayName(cities)}`;

		this.finishDraw();
	}

	async showCanvas() {
		// special to travel forecast to draw the remainder of the canvas
		await this.drawCanvas();
		super.showCanvas();
	}

	// screen index change callback just runs the base count callback
	screenIndexChange() {
		this.baseCountChange(this.navBaseCount);
	}

	// base count change callback
	baseCountChange(count) {
		// get the travel lines element and cache measurements if needed
		const travelLines = this.elem.querySelector('.travel-lines');
		if (!travelLines) return;
		const displayHeight = getTravelDisplayHeight(this.elem);

		// update cache if needed (when content changes or first run)
		if (this.scrollCache.travelLines !== travelLines || this.scrollCache.displayHeight !== displayHeight) {
			this.scrollCache.displayHeight = displayHeight;
			this.scrollCache.contentHeight = travelLines.scrollHeight;
			this.scrollCache.maxOffset = Math.max(0, this.scrollCache.contentHeight - this.scrollCache.displayHeight);
			this.scrollCache.travelLines = travelLines;

			// Set up hardware acceleration on the travel lines element
			travelLines.style.willChange = 'transform';
			travelLines.style.backfaceVisibility = 'hidden';
		}

		// calculate scroll offset and don't go past end
		let offsetY = Math.min(this.scrollCache.maxOffset, (count - this.scrollTiming.initialCounts) * this.scrollTiming.pixelsPerCount);

		// don't let offset go negative
		if (offsetY < 0) offsetY = 0;

		// use transform instead of scrollTo for hardware acceleration
		travelLines.style.transform = `translateY(-${Math.round(offsetY)}px)`;
	}

	// necessary to get the lastest long canvas when scrolling
	getLongCanvas() {
		return this.longCanvas;
	}

	setTiming(list) {
		const timingConfig = calculateScrollTiming(list, {
			offsetHeight: getTravelDisplayHeight(this.elem),
		}, {
			staticDisplay: 5.0, // special static display time for travel forecast
		});

		// Apply the calculated timing
		this.timing.baseDelay = timingConfig.baseDelay;
		this.timing.delay = timingConfig.delay;
		this.scrollTiming = timingConfig.scrollTiming;

		this.calcNavTiming();
	}
}

const REGION_BY_COUNTRY_CODE = {
	US: 'north-america',
	CA: 'north-america',
	MX: 'north-america',
	BR: 'south-america',
	AR: 'south-america',
	CL: 'south-america',
	PE: 'south-america',
	CO: 'south-america',
	EC: 'south-america',
	UY: 'south-america',
	PY: 'south-america',
	BO: 'south-america',
	VE: 'south-america',
	GB: 'europe',
	IE: 'europe',
	FR: 'europe',
	DE: 'europe',
	ES: 'europe',
	PT: 'europe',
	IT: 'europe',
	NL: 'europe',
	BE: 'europe',
	LU: 'europe',
	CH: 'europe',
	AT: 'europe',
	DK: 'europe',
	NO: 'europe',
	SE: 'europe',
	FI: 'europe',
	PL: 'europe',
	CZ: 'europe',
	SK: 'europe',
	HU: 'europe',
	RO: 'europe',
	BG: 'europe',
	GR: 'europe',
	HR: 'europe',
	SI: 'europe',
	RS: 'europe',
	BA: 'europe',
	ME: 'europe',
	AL: 'europe',
	MK: 'europe',
	EE: 'europe',
	LV: 'europe',
	LT: 'europe',
	IS: 'europe',
	UA: 'europe',
	MD: 'europe',
	JP: 'east-asia',
	KR: 'east-asia',
	CN: 'east-asia',
	TW: 'east-asia',
	HK: 'east-asia',
	MO: 'east-asia',
	AU: 'oceania',
	NZ: 'oceania',
	EG: 'africa',
	NG: 'africa',
	KE: 'africa',
	ZA: 'africa',
	MA: 'africa',
	TZ: 'africa',
	GH: 'africa',
	DZ: 'africa',
	AE: 'middle-east',
	SA: 'middle-east',
	IL: 'middle-east',
	JO: 'middle-east',
	QA: 'middle-east',
	KW: 'middle-east',
	OM: 'middle-east',
	BH: 'middle-east',
	LB: 'middle-east',
	IQ: 'middle-east',
};

const getTravelCitiesForLocation = (weatherParameters) => {
	if (Array.isArray(TravelCities)) return TravelCities;

	const countryCode = (weatherParameters?.countryCode ?? '').toUpperCase();
	const selectedRegion = REGION_BY_COUNTRY_CODE[countryCode];
	return TravelCities[selectedRegion] ?? TravelCities.global ?? TravelCities['north-america'] ?? [];
};

const getTravelDisplayHeight = (elem) => {
	const main = elem.querySelector('.main');
	const header = elem.querySelector('.column-headers');
	if (!main) return 0;
	return Math.max(0, main.offsetHeight - (header?.offsetHeight ?? 0));
};

// effectively returns early on the first found date
const getTravelCitiesDayName = (cities) => cities.reduce((dayName, city) => {
	if (city && dayName === '') {
		// today or tomorrow
		const day = DateTime.local().plus({ days: (city.today) ? 0 : 1 });
		// return the day
		return day.toLocaleString({ weekday: 'long' });
	}
	return dayName;
}, '');

// register display, not active by default
registerDisplay(new TravelForecast(5, 'travel', false));
