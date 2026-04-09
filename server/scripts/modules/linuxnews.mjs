import { safeJson } from './utils/fetch.mjs';
import STATUS from './status.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';
import { debugFlag } from './utils/debug.mjs';
import { withBasePath } from './utils/base-path.mjs';

const STORIES_PER_PAGE = 2;
const PAGE_DURATION_MS = 9000;

class LinuxNews extends WeatherDisplay {
	constructor(navId, elemId) {
		super(navId, elemId, 'Linux News: LWN', true);
		this.timing.baseDelay = PAGE_DURATION_MS;
	}

	async getData(weatherParameters, refresh) {
		if (!super.getData(weatherParameters, refresh)) return;

		try {
			const response = await safeJson(withBasePath('api/linux-news'), {
				retryCount: 0,
			});

			if (!response?.success || !response.stories?.length) {
				if (debugFlag('linuxnews')) {
					console.log('Linux News: no stories available');
				}
				this.setStatus(STATUS.noData);
				return;
			}

			this.data = response.stories.slice(0, 8);
			this.setStatus(STATUS.loaded);
		} catch (error) {
			if (debugFlag('linuxnews')) {
				console.log('Linux News: error fetching data:', error.message);
			}
			this.setStatus(STATUS.noData);
		}
	}

	async drawCanvas() {
		super.drawCanvas();

		const outputElem = this.elem.querySelector('.news-output');
		const container = this.elem.querySelector('.container');
		const pages = [];

		for (let i = 0; i < this.data.length; i += STORIES_PER_PAGE) {
			pages.push(this.data.slice(i, i + STORIES_PER_PAGE));
		}

		outputElem.innerHTML = '';
		pages.forEach((pageStories) => {
			const pageElem = document.createElement('div');
			pageElem.className = 'news-page';

			pageStories.forEach((story) => {
				const storyElem = document.createElement('div');
				storyElem.className = 'story';

				const headlineElem = document.createElement('div');
				headlineElem.className = 'headline';
				headlineElem.textContent = story.headline;

				const blurbElem = document.createElement('div');
				blurbElem.className = 'blurb';
				blurbElem.textContent = story.blurb;

				storyElem.append(headlineElem, blurbElem);
				pageElem.appendChild(storyElem);
			});

			outputElem.appendChild(pageElem);
		});

		this.pageHeight = container.offsetHeight;
		this.timing.totalScreens = Math.max(1, pages.length);
		this.timing.delay = new Array(this.timing.totalScreens).fill(1);
		this.calcNavTiming();

		const top = -this.screenIndex * this.pageHeight;
		outputElem.style.top = `${top}px`;

		this.finishDraw();
	}
}

registerDisplay(new LinuxNews(14, 'linux-news'));
