import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
import { appName, gitConfig } from './shared'

/**
 * Builds the shared layout configuration with the application title and GitHub repository URL.
 *
 * @returns The base layout configuration
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: appName
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`
  }
}
