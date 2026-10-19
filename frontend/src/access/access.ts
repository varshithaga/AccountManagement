import { jwtDecode } from 'jwt-decode';
import axios from 'axios';
import { COMPANY_HEADER, companyStore } from './company';

// Global type declaration for API_URL
declare const __API_URL__: string;

// Type definitions
interface JwtPayload {
    exp: number;
    [key: string]: any;
}

interface RefreshTokenResponse {
    access: string;
    refresh?: string;
}

interface AuthHeaders {
    'Content-Type': string;
    'Authorization': string;
    [key: string]: string;
}

interface FileUploadHeaders {
    'Content-Type': string;
    'Authorization': string;
    [key: string]: string;
}

const API_URL: string = __API_URL__;

const createApiUrl = (path: string): string => {
    const cleanPath = path.startsWith('/api') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`;
    const url = `${API_URL}${cleanPath}`;
    return url;
};

/**
 * Clears stored auth/session data and sends the user back to the sign-in
 * page. Used when the refresh token itself is invalid/expired (e.g. after a
 * long idle period) so the app never gets stuck showing "failed to fetch"
 * errors on a dead session.
 */
let isRedirectingToLogin = false;

const redirectToLogin = (): void => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user_id');
    localStorage.removeItem('userRole');
    localStorage.removeItem('user');

    if (isRedirectingToLogin || window.location.pathname === '/') {
        return;
    }
    isRedirectingToLogin = true;
    window.location.href = '/';
};

// Endpoints where a 401 is an expected outcome (bad credentials, no session
// yet) rather than a sign that an existing session has expired.
const AUTH_ENDPOINTS_EXCLUDED_FROM_REDIRECT = ['/login/', '/register/', '/token/refresh/', '/auth/token/refresh/'];

// Every request made with a plain `axios` import goes to the company being worked in.
axios.interceptors.request.use((config) => {
    config.headers.set(COMPANY_HEADER, companyStore.get());
    return config;
});

// Global safety net: any request made with a plain `axios` import (used
// throughout this app's api modules) that comes back 401 means the session
// is no longer valid server-side, even if the locally-cached token looked
// unexpired. Send the user back to sign-in instead of leaving pages stuck
// showing "failed to fetch" errors.
axios.interceptors.response.use(
    (response) => response,
    (error) => {
        const status = error?.response?.status;
        const url: string = error?.config?.url || '';
        const isExcluded = AUTH_ENDPOINTS_EXCLUDED_FROM_REDIRECT.some((path) => url.includes(path));

        if (status === 401 && !isExcluded) {
            redirectToLogin();
        }
        return Promise.reject(error);
    }
);

// A page fires several requests at once. The backend blacklists a refresh token
// after one use, so they must all share a single refresh - a second one with the
// same token would fail and sign the user out.
// The api/client.ts axios instance uses the same refresh (refreshSession), never its own.
let refreshInFlight: Promise<string> | null = null;

/** Gets a new access token with the stored refresh token - one request at a time, shared by every caller. */
const refreshSession = (): Promise<string> => {
    if (!refreshInFlight) {
        refreshInFlight = refreshAccessToken(localStorage.getItem('refresh_token'))
            .then((newAccessToken) => {
                localStorage.setItem('access_token', newAccessToken);
                return newAccessToken;
            })
            .finally(() => {
                refreshInFlight = null;
            });
    }
    return refreshInFlight;
};

const getValidAccessToken = async (): Promise<string | null> => {
    const access_token: string | null = localStorage.getItem('access_token');
    if (!isAccessTokenExpired(access_token)) {
        return access_token;
    }

    try {
        return await refreshSession();
    } catch (error) {
        redirectToLogin();
        throw error;
    }
};

/** A valid access token when someone is signed in (refreshing it if needed), else null - for
 * requests that may also run signed out (sign-in, sign-up). */
const getAccessTokenIfSignedIn = async (): Promise<string | null> => {
    if (!localStorage.getItem('access_token') && !localStorage.getItem('refresh_token')) {
        return null;
    }
    return getValidAccessToken();
};

const getAuthHeaders = async (): Promise<AuthHeaders> => {
    const access_token = await getValidAccessToken();

    const headers: AuthHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${access_token}`,
    };
    return headers;
};

const getAuthHeadersFile = async (): Promise<FileUploadHeaders> => {
    const access_token = await getValidAccessToken();

    const headers: FileUploadHeaders = {
        'Content-Type': 'multipart/form-data',
        'Authorization': `Bearer ${access_token}`,
    };
    return headers;
};

const isAccessTokenExpired = (access_token: string | null): boolean => {
    if (!access_token) {
        return true;
    }

    try {
        const decoded = jwtDecode<JwtPayload>(access_token);
        // Treated as expired 30 seconds early, so it can't run out while a request is on its way.
        const currentTime = Date.now() / 1000 + 30;
        return decoded.exp < currentTime;
    } catch {
        return true;
    }
};

const refreshAccessToken = async (refresh_token: string | null): Promise<string> => {
    if (!refresh_token) {
        throw new Error('No refresh token available');
    }

    const refreshUrl = createApiUrl('/auth/token/refresh/');

    const response = await fetch(refreshUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            [COMPANY_HEADER]: companyStore.get(),
        },
        body: JSON.stringify({
            refresh: refresh_token,
        }),
    });

    if (!response.ok) {
        throw new Error('Failed to refresh access token');
    }

    const data: RefreshTokenResponse = await response.json();

    // The backend rotates refresh tokens and blacklists the one just used, so the
    // new one must be kept - reusing the old one next time would fail and sign the user out.
    if (data.refresh) {
        localStorage.setItem('refresh_token', data.refresh);
    }
    const accessToken = data.access;

    if (!accessToken) {
        throw new Error('No access token received in response');
    }

    return accessToken;
};

export { createApiUrl, getAccessTokenIfSignedIn, getAuthHeaders, getAuthHeadersFile, refreshSession };
export type { AuthHeaders, FileUploadHeaders, JwtPayload, RefreshTokenResponse };
