import { readdir } from 'fs/promises';
import path from 'path';

const THEMES_DIR = path.resolve('./themes');

const discoverThemes = async () => {
	try {
		const entries = await readdir(THEMES_DIR, { withFileTypes: true });
		const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
		const themeAssets = {};

		await Promise.all(directories.map(async (themeName) => {
			const files = await readdir(path.join(THEMES_DIR, themeName));
			themeAssets[themeName] = {
				background1: files.includes('1.png'),
				background1Chart: files.includes('1-chart.png'),
				background2: files.includes('2.png'),
				background3: files.includes('3.png'),
				background4: files.includes('4.png'),
				background5: files.includes('5.png'),
				logoCorner: files.includes('logo-corner.png'),
			};
		}));

		return {
			themes: ['default', ...directories],
			themeAssets,
		};
	} catch {
		return {
			themes: ['default'],
			themeAssets: {},
		};
	}
};

export {
	THEMES_DIR,
	discoverThemes,
};
