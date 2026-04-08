const THEME_STORAGE_KEY = 'settings-theme-select';
const DEFAULT_THEME = 'default';
const BUILTIN_ASSETS = {
	background1: '../images/backgrounds/1.png',
	background1Chart: '../images/backgrounds/1-chart.png',
	background2: '../images/backgrounds/2.png',
	background3: '../images/backgrounds/3.png',
	background4: '../images/backgrounds/4.png',
	background5: '../images/backgrounds/5.png',
	logoCorner: 'images/logos/logo-corner.png',
};

const getThemeAssets = () => window.WS4KP_THEME_ASSETS ?? {};
const getAvailableThemes = () => window.WS4KP_THEMES ?? [DEFAULT_THEME];

const getStoredTheme = () => {
	const storedTheme = localStorage.getItem(THEME_STORAGE_KEY) ?? DEFAULT_THEME;
	return getAvailableThemes().includes(storedTheme) ? storedTheme : DEFAULT_THEME;
};

const getThemeAssetUrl = (themeName, assetKey) => {
	if (themeName === DEFAULT_THEME) {
		return BUILTIN_ASSETS[assetKey];
	}

	const themeAssetAvailability = getThemeAssets()[themeName] ?? {};
	if (!themeAssetAvailability[assetKey]) {
		return BUILTIN_ASSETS[assetKey];
	}

		switch (assetKey) {
		case 'background1':
			return `../themes/${themeName}/1.png`;
		case 'background1Chart':
			return `../themes/${themeName}/1-chart.png`;
		case 'background2':
			return `../themes/${themeName}/2.png`;
		case 'background3':
			return `../themes/${themeName}/3.png`;
		case 'background4':
			return `../themes/${themeName}/4.png`;
		case 'background5':
			return `../themes/${themeName}/5.png`;
		case 'logoCorner':
			return `themes/${themeName}/logo-corner.png`;
		default:
			return BUILTIN_ASSETS[assetKey];
	}
};

const applyTheme = (themeName) => {
	const selectedTheme = getAvailableThemes().includes(themeName) ? themeName : DEFAULT_THEME;
	localStorage.setItem(THEME_STORAGE_KEY, selectedTheme);

	document.documentElement.style.setProperty('--theme-background-1', `url('${getThemeAssetUrl(selectedTheme, 'background1')}')`);
	document.documentElement.style.setProperty('--theme-background-1-chart', `url('${getThemeAssetUrl(selectedTheme, 'background1Chart')}')`);
	document.documentElement.style.setProperty('--theme-background-2', `url('${getThemeAssetUrl(selectedTheme, 'background2')}')`);
	document.documentElement.style.setProperty('--theme-background-3', `url('${getThemeAssetUrl(selectedTheme, 'background3')}')`);
	document.documentElement.style.setProperty('--theme-background-4', `url('${getThemeAssetUrl(selectedTheme, 'background4')}')`);
	document.documentElement.style.setProperty('--theme-background-5', `url('${getThemeAssetUrl(selectedTheme, 'background5')}')`);

	document.querySelectorAll('.theme-logo').forEach((img) => {
		img.src = getThemeAssetUrl(selectedTheme, 'logoCorner');
	});

	const select = document.querySelector('#theme-select');
	if (select && select.value !== selectedTheme) {
		select.value = selectedTheme;
	}
	return selectedTheme;
};

document.addEventListener('DOMContentLoaded', () => {
	applyTheme(getStoredTheme());
	const select = document.querySelector('#theme-select');
	if (!select) return;
	select.addEventListener('change', (event) => applyTheme(event.target.value));
	select.value = getStoredTheme();
	applyTheme(select.value);
});

export {
	applyTheme,
	getStoredTheme,
};
