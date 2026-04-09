const normalizeBasePath = (pathname) => {
	if (!pathname) return '/';
	if (pathname.endsWith('/index.html')) {
		const trimmed = pathname.slice(0, -'index.html'.length);
		return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
	}
	if (pathname.endsWith('/')) return pathname;
	const lastSlash = pathname.lastIndexOf('/');
	if (lastSlash === -1) return '/';
	return `${pathname.slice(0, lastSlash + 1)}`;
};

const getBasePath = () => normalizeBasePath(window.location.pathname);

const withBasePath = (relativePath = '') => {
	const sanitizedPath = relativePath.replace(/^\/+/, '');
	const basePath = getBasePath();
	if (basePath === '/') return `/${sanitizedPath}`;
	return `${basePath}${sanitizedPath}`;
};

export {
	getBasePath,
	withBasePath,
};
