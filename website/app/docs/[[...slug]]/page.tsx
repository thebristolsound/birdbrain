import { source } from '@/lib/source'
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page'
import { notFound } from 'next/navigation'
import { getMDXComponents } from '@/components/mdx'
import type { Metadata } from 'next'
import { createRelativeLink } from 'fumadocs-ui/mdx'

/**
 * Renders a documentation page for the requested route.
 *
 * @param props - Route parameters identifying the documentation page
 * @returns The rendered documentation page
 */
export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params
  const page = source.getPage(params.slug)
  if (!page) notFound()

  const MDX = page.data.body

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // Lets pages link to each other with relative paths.
            a: createRelativeLink(source, page)
          })}
        />
      </DocsBody>
    </DocsPage>
  )
}

/**
 * Generates the static route parameters for the documentation pages.
 *
 * @returns The available documentation route parameters.
 */
export async function generateStaticParams() {
  return source.generateParams()
}

/**
 * Generates metadata for a documentation page.
 *
 * @param props - Route properties containing the documentation page slug.
 * @returns Metadata containing the page title and description.
 */
export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params
  const page = source.getPage(params.slug)
  if (!page) notFound()

  return {
    title: page.data.title,
    description: page.data.description
  }
}
