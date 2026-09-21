import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  // Reset DOM attributes that tests apply via the settings system.
  if (typeof document !== 'undefined') {
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.motion;
  }
});
