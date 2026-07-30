import type { PulseRNDesktopApi } from '../../preload/api.js';

declare global {
  interface Window {
    pulseRN: PulseRNDesktopApi;
  }
}

export {};
