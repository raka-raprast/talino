import type { ElectronApi } from './types/api';

// The single typed handle to the preload-exposed IPC surface. Every renderer
// call to the main process goes through this.
export const api: ElectronApi = window.api;
