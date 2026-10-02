/** /api/health — backend liveness. */
import { API_BASE } from '../config';

/** True when the backend answers /health with 200. Never throws. */
export async function isBackendHealthy(): Promise<boolean> {
  try {
    return (await fetch(`${API_BASE}/health`)).ok;
  } catch {
    return false;
  }
}

/** Display form of the backend origin, e.g. "http://127.0.0.1:48000". */
export const BACKEND_ORIGIN = API_BASE.replace(/\/api\/?$/, '');
