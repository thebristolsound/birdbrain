import { test as base, _electron } from '@playwright/test';
import { mkdtemp, rm, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
export const test = base.extend({
    electronApp: async ({}, use) => {
        const tempDir = await mkdtemp(join(tmpdir(), 'birdbrain-test-'));
        const mainPath = join(__dirname, '../../out/main/index.js');
        try {
            await access(mainPath);
        }
        catch {
            throw new Error(`Electron main entrypoint not found at "${mainPath}". ` +
                'Make sure the application is built (e.g. run your build script) before running E2E tests.');
        }
        const app = await _electron.launch({
            args: [mainPath],
            env: {
                ...process.env,
                BIRDBRAIN_USER_DATA: tempDir
            }
        });
        await use(app);
        await app.close();
        await rm(tempDir, { recursive: true, force: true });
    },
    page: async ({ electronApp }, use) => {
        const page = await electronApp.firstWindow();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForSelector('[data-testid="app-ready"]', { timeout: 15000 });
        await use(page);
    }
});
export { expect } from '@playwright/test';
