import STATUS from './status.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';
import { safeJson } from './utils/fetch.mjs';
import { withBasePath } from './utils/base-path.mjs';

class GroundView extends WeatherDisplay {
	constructor(navId, elemId) {
		super(navId, elemId, 'Ground View', true);
		this.refreshTime = 5 * 60 * 1000;
		this.requestToken = 0;
	}

	async getData(weatherParameters, refresh) {
		const superResult = super.getData(weatherParameters, refresh);
		this.setAutoReload();
		const requestToken = ++this.requestToken;
		if (!this.weatherParameters?.latitude || !this.weatherParameters?.longitude || !this.weatherParameters?.city) {
			this.setStatus(STATUS.noData);
			return superResult;
		}

		const url = new URL(withBasePath('api/ground-view'), window.location.origin);
		url.searchParams.set('lat', this.weatherParameters.latitude);
		url.searchParams.set('lon', this.weatherParameters.longitude);
		url.searchParams.set('city', this.weatherParameters.city);

		const response = await safeJson(url.toString(), {
			retryCount: 1,
		});

		if (requestToken !== this.requestToken) {
			return superResult;
		}

		if (!response?.success) {
			this.data = null;
			this.setStatus(STATUS.failed);
			return superResult;
		}

		this.data = {
			webcam: response.webcam,
			hasWebcam: Boolean(response.webcam?.imageUrl),
		};
		this.setStatus(STATUS.loaded);
		return superResult;
	}

	resetViewState() {
		const image = this.elem.querySelector('.ground-view-image');
		const label = this.elem.querySelector('.ground-view-label');
		const empty = this.elem.querySelector('.ground-view-empty');
		const media = this.elem.querySelector('.ground-view-media');

		image.removeAttribute('src');
		image.alt = '';
		label.textContent = '';
		empty.textContent = '';
		media.classList.add('hidden');
		label.classList.add('hidden');
		empty.classList.add('hidden');
	}

	drawCanvas() {
		super.drawCanvas();
		const image = this.elem.querySelector('.ground-view-image');
		const label = this.elem.querySelector('.ground-view-label');
		const empty = this.elem.querySelector('.ground-view-empty');
		const media = this.elem.querySelector('.ground-view-media');

		this.resetViewState();

		if (this.data?.hasWebcam) {
			image.src = this.data.webcam.imageUrl;
			image.alt = this.data.webcam.label;
			label.textContent = this.data.webcam.label;
			media.classList.remove('hidden');
			label.classList.remove('hidden');
			empty.classList.add('hidden');
		} else {
			image.removeAttribute('src');
			label.textContent = '';
			media.classList.add('hidden');
			label.classList.add('hidden');
			empty.classList.remove('hidden');
			empty.textContent = 'No Ground View Available';
		}

		this.finishDraw();
	}
}

registerDisplay(new GroundView(12, 'ground-view'));
