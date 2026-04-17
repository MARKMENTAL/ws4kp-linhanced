import { rewriteUrl } from './url-rewrite.mjs';

const DEFAULT_REQUEST_TIMEOUT = 15000; // For example, with 3 retries: 15s+1s+15s+2s+15s+5s+15s = 68s
const inflightRequests = new Map();
const responseCache = new Map();

// Centralized utilities for handling errors in Promise contexts
const safeJson = async (url, params) => {
	try {
		const result = await json(url, params);
		// Return an object with both data and url if params.returnUrl is true
		if (params?.returnUrl) {
			return result;
		}
		// If caller didn't specify returnUrl, result is the raw API response
		return result;
	} catch (_error) {
		// Error already logged in fetchAsync; return null to be "safe"
		return null;
	}
};

const safeText = async (url, params) => {
	try {
		const result = await text(url, params);
		// Return an object with both data and url if params.returnUrl is true
		if (params?.returnUrl) {
			return result;
		}
		// If caller didn't specify returnUrl, result is the raw API response
		return result;
	} catch (_error) {
		// Error already logged in fetchAsync; return null to be "safe"
		return null;
	}
};

const safeBlob = async (url, params) => {
	try {
		const result = await blob(url, params);
		// Return an object with both data and url if params.returnUrl is true
		if (params?.returnUrl) {
			return result;
		}
		// If caller didn't specify returnUrl, result is the raw API response
		return result;
	} catch (_error) {
		// Error already logged in fetchAsync; return null to be "safe"
		return null;
	}
};

const safePromiseAll = async (promises) => {
	try {
		const results = await Promise.allSettled(promises);

		return results.map((result, index) => {
			if (result.status === 'fulfilled') {
				return result.value;
			}
			// Log rejected promises for debugging (except AbortErrors which are expected)
			if (result.reason?.name !== 'AbortError') {
				console.warn(`Promise ${index} rejected:`, result.reason?.message || result.reason);
			}
			return null;
		});
	} catch (error) {
		console.error('safePromiseAll encountered an unexpected error:', error);
		// Return array of nulls matching the input length
		return new Array(promises.length).fill(null);
	}
};

const json = (url, params) => fetchAsync(url, 'json', params);
const text = (url, params) => fetchAsync(url, 'text', params);
const blob = (url, params) => fetchAsync(url, 'blob', params);

// Hosts that don't allow custom User-Agent headers due to CORS restrictions
const USER_AGENT_EXCLUDED_HOSTS = [
	'geocode.arcgis.com',
	'services.arcgis.com',
];

const classifyRequest = (_url) => {
	const url = new URL(_url, window.location.origin);
	if (url.hostname.includes('api.weather.gov')) {
		if (url.pathname.includes('/alerts/active')) return 'weatherGovAlerts';
		return 'weatherGovGeneral';
	}
	if (url.hostname.includes('api.open-meteo.com')) {
		return 'openMeteo';
	}
	return 'default';
};

const getRequestPolicy = (requestClass, providedParams = {}) => {
	const defaults = {
		default: {
			timeout: DEFAULT_REQUEST_TIMEOUT,
			retryCount: 3,
			cacheTtlMs: 0,
		},
		weatherGovAlerts: {
			timeout: 8000,
			retryCount: 1,
			cacheTtlMs: 30000,
		},
		weatherGovGeneral: {
			timeout: 10000,
			retryCount: 2,
			cacheTtlMs: 60000,
		},
		openMeteo: {
			timeout: 8000,
			retryCount: 1,
			cacheTtlMs: 60000,
		},
	};

	const policy = defaults[requestClass] ?? defaults.default;
	return {
		timeout: providedParams.timeout ?? policy.timeout,
		retryCount: providedParams.retryCount ?? policy.retryCount,
		cacheTtlMs: providedParams.cacheTtlMs ?? policy.cacheTtlMs,
	};
};

const buildRequestKey = (url, responseType, params) => `${(params.method ?? 'GET').toUpperCase()}:${responseType}:${url.toString()}`;

const getCachedResponse = (key) => {
	const cached = responseCache.get(key);
	if (!cached) return null;
	if (Date.now() >= cached.expiresAt) {
		responseCache.delete(key);
		return null;
	}
	return cached.data;
};

const setCachedResponse = (key, data, ttlMs) => {
	if (!ttlMs || ttlMs <= 0) return;
	responseCache.set(key, {
		data,
		expiresAt: Date.now() + ttlMs,
	});
};

const isTransientError = (error) => error?.name === 'TimeoutError'
	|| error?.message?.includes('429')
	|| error?.message?.includes('500')
	|| error?.message?.includes('502')
	|| error?.message?.includes('503')
	|| error?.message?.includes('504');

const fetchAsync = async (_url, responseType, _params = {}) => {
	const headers = {};
	const requestClass = classifyRequest(_url);
	const policy = getRequestPolicy(requestClass, _params);

	const checkUrl = new URL(_url, window.location.origin);
	const shouldExcludeUserAgent = USER_AGENT_EXCLUDED_HOSTS.some((host) => checkUrl.hostname.includes(host));

	// User-Agent handling:
	// - Server mode (with caching proxy): Add User-Agent for all requests except excluded hosts
	// - Static mode (direct requests): Only add User-Agent for api.weather.gov, avoiding CORS preflight issues with other services
	const shouldAddUserAgent = !shouldExcludeUserAgent && (window.WS4KP_SERVER_AVAILABLE || _url.toString().match(/api\.weather\.gov/));
	if (shouldAddUserAgent) {
		headers['user-agent'] = 'WeatherStar 4000+: Linhanced; marky611@gmail.com';
	}

	// combine default and provided parameters
	const params = {
		method: 'GET',
		mode: 'cors',
		type: 'GET',
		retryCount: policy.retryCount,
		timeout: policy.timeout,
		cacheTtlMs: policy.cacheTtlMs,
		..._params,
		headers,
		requestClass,
	};

	// rewrite URLs for various services to use the backend proxy server for proper caching (and request logging)
	const url = rewriteUrl(_url);
	// match the security protocol when not on localhost
	// url.protocol = window.location.hostname === 'localhost' ? url.protocol : window.location.protocol;
	// add parameters if necessary
	if (params.data) {
		Object.keys(params.data).forEach((key) => {
			// get the value
			const value = params.data[key];
			// add to the url
			url.searchParams.append(key, value);
		});
	}

	const shouldUseTransportCache = params.method.toUpperCase() === 'GET' && !params.returnUrl;
	const requestKey = shouldUseTransportCache ? buildRequestKey(url, responseType, params) : null;
	const cachedData = shouldUseTransportCache ? getCachedResponse(requestKey) : null;
	if (cachedData !== null) return cachedData;
	if (shouldUseTransportCache && inflightRequests.has(requestKey)) {
		return inflightRequests.get(requestKey);
	}

	const executeFetch = async () => {
		// make the request
		try {
			const response = await doFetch(url, params);

			// check for ok response
			if (!response.ok) throw new Error(`Fetch error ${response.status} ${response.statusText} while fetching ${response.url}`);
			// process the response based on type
			let result;
			switch (responseType) {
				case 'json':
					result = await response.json();
					break;
				case 'text':
					result = await response.text();
					break;
				case 'blob':
					result = await response.blob();
					break;
				default:
					result = response;
			}

			if (shouldUseTransportCache) {
				setCachedResponse(requestKey, result, params.cacheTtlMs);
			}

			// Return both data and URL if requested
			if (params.returnUrl) {
				return {
					data: result,
					url: response.url,
				};
			}

			return result;
		} catch (error) {
			if (shouldUseTransportCache && cachedData !== null && isTransientError(error)) {
				return cachedData;
			}

			// Enhanced error handling for different error types
			if (error.name === 'AbortError') {
				console.log(`🛑 Fetch aborted for ${_url} (background tab throttling?)`);
				return null;
			} if (error.name === 'TimeoutError') {
				console.warn(`⏱️  Request timeout for ${_url} (${error.message})`);
			} else if (error.message.includes('429')) {
				console.warn(`🐢 Rate limited for ${_url}`);
			} else if (error.message.includes('502')) {
				console.warn(`🚪 Bad Gateway error for ${_url}`);
			} else if (error.message.includes('503')) {
				console.warn(`⌛ Temporarily unavailable for ${_url}`);
			} else if (error.message.includes('504')) {
				console.warn(`⏱️  Gateway Timeout for ${_url}`);
			} else if (error.message.includes('500')) {
				console.warn(`💥 Internal Server Error for ${_url}`);
			} else if (error.message.includes('CORS') || error.message.includes('Access-Control')) {
				console.warn(`🔒 CORS or Access Control error for ${_url}`);
			} else {
				console.warn(`❌ Fetch failed for ${_url} (${error.message})`);
			}

			if (!error.status) error.status = 0;
			if (!error.responseJSON) error.responseJSON = null;

			throw error;
		}
	};

	if (!shouldUseTransportCache) return executeFetch();

	const inflightPromise = executeFetch().finally(() => {
		inflightRequests.delete(requestKey);
	});
	inflightRequests.set(requestKey, inflightPromise);
	return inflightPromise;
};

// fetch with retry and back-off
const doFetch = (url, params, originalRetryCount = null) => new Promise((resolve, reject) => {
	// On the first call, store the retry count for later logging
	const initialRetryCount = originalRetryCount ?? params.retryCount;

	// Create AbortController for timeout
	const controller = new AbortController();
	const startTime = Date.now();
	const timeoutId = setTimeout(() => {
		controller.abort();
	}, params.timeout);

	// Add signal to fetch params
	const fetchParams = {
		...params,
		signal: controller.signal,
	};

	// Shared retry logic to avoid duplication
	const attemptRetry = (reason, retryAfterMs = null) => {
		// Safety check for params
		if (!params || typeof params.retryCount !== 'number') {
			console.error(`❌ Invalid params for retry: ${url}`);
			return reject(new Error('Invalid retry parameters'));
		}

		const retryAttempt = initialRetryCount - params.retryCount + 1;
		const remainingRetries = params.retryCount - 1;
		const delayMs = retryDelay(retryAttempt, params.requestClass, retryAfterMs);

		console.warn(`🔄 Retry ${retryAttempt}/${initialRetryCount} for ${url} - ${reason} (retrying in ${delayMs}ms, ${remainingRetries} retr${remainingRetries === 1 ? 'y' : 'ies'} left)`);

		// call the "still waiting" function on first retry
		if (params && params.stillWaiting && typeof params.stillWaiting === 'function' && retryAttempt === 1) {
			try {
				params.stillWaiting();
			} catch (callbackError) {
				console.warn(`⚠️ stillWaiting callback error for ${url}:`, callbackError.message);
			}
		}
		// decrement and retry with safe parameter copying
		const newParams = {
			...params,
			retryCount: Math.max(0, params.retryCount - 1), // Ensure retryCount doesn't go negative
		};
		// Use setTimeout directly instead of the delay wrapper to avoid Promise resolution issues
		setTimeout(() => {
			doFetch(url, newParams, initialRetryCount).then(resolve).catch(reject);
		}, delayMs);
		return undefined; // Explicit return for linter
	};

	fetch(url, fetchParams).then((response) => {
		clearTimeout(timeoutId); // Clear timeout on successful response

		if (params && params.retryCount > 0 && response.status === 429) {
			const retryAfterHeader = response.headers.get('Retry-After');
			const retryAfterSeconds = Number.parseInt(retryAfterHeader, 10);
			const retryAfterMs = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : null;
			return attemptRetry(`Rate limited 429 ${response.statusText}`, retryAfterMs);
		}

		// Retry 500 status codes if we have retries left
		if (params && params.retryCount > 0 && response.status >= 500 && response.status <= 599) {
			let errorType = 'Server error';
			if (response.status === 502) {
				errorType = 'Bad Gateway';
			} else if (response.status === 503) {
				errorType = 'Service Unavailable';
			} else if (response.status === 504) {
				errorType = 'Gateway Timeout';
			}
			return attemptRetry(`${errorType} ${response.status} ${response.statusText}`);
		}

		// Log when we're out of retries for server errors
		// if (response.status >= 500 && response.status <= 599) {
		// 	console.warn(`⚠️ Server error ${response.status} ${response.statusText} for ${url} - no retries remaining`);
		// }

		// successful response or out of retries
		return resolve(response);
	}).catch((error) => {
		clearTimeout(timeoutId); // Clear timeout on error

		// Enhance AbortError detection by checking if we're near the timeout duration
		if (error.name === 'AbortError') {
			const duration = Date.now() - startTime;
			const isLikelyTimeout = duration >= (params.timeout - 1000); // Within 1 second of timeout

			// Convert likely timeouts to TimeoutError for better error reporting
			if (isLikelyTimeout) {
				const reason = `Request timeout after ${Math.round(duration / 1000)}s`;
				if (params && params.retryCount > 0) {
					return attemptRetry(reason);
				}
				// Convert to a timeout error for better error reporting
				const timeoutError = new Error(`Request timeout after ${Math.round(duration / 1000)}s`);
				timeoutError.name = 'TimeoutError';
				reject(timeoutError);
				return undefined;
			}
		}

		// Retry network errors if we have retries left
		if (params && params.retryCount > 0 && error.name !== 'AbortError') {
			const reason = error.name === 'TimeoutError' ? 'Request timeout' : `Network error: ${error.message}`;
			return attemptRetry(reason);
		}

		// out of retries or AbortError - reject
		reject(error);
		return undefined; // Explicit return for linter
	});
});

const retryDelay = (retryNumber, requestClass = 'default', retryAfterMs = null) => {
	if (retryAfterMs !== null) {
		return retryAfterMs + Math.floor(Math.random() * 400);
	}

	if (requestClass === 'openMeteo') {
		return 5000 + Math.floor(Math.random() * 400);
	}

	switch (retryNumber) {
		case 1: return 1000 + Math.floor(Math.random() * 400);
		case 2: return 2000 + Math.floor(Math.random() * 400);
		case 3: return 5000 + Math.floor(Math.random() * 600);
		case 4: return 10_000 + Math.floor(Math.random() * 1000);
		default: return 30_000 + Math.floor(Math.random() * 1000);
	}
};

export {
	json,
	text,
	blob,
	safeJson,
	safeText,
	safeBlob,
	safePromiseAll,
};
