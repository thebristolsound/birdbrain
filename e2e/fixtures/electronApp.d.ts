import { type ElectronApplication, type Page } from '@playwright/test';
type ElectronFixtures = {
    electronApp: ElectronApplication;
    page: Page;
};
export declare const test: import("@playwright/test").TestType<import("@playwright/test").PlaywrightTestArgs & import("@playwright/test").PlaywrightTestOptions & ElectronFixtures, import("@playwright/test").PlaywrightWorkerArgs & import("@playwright/test").PlaywrightWorkerOptions>;
export { expect } from '@playwright/test';
