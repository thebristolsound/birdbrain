import { defineConfig, defineDocs } from 'fumadocs-mdx/config'
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema'

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema
  },
  meta: {
    schema: metaSchema
  }
})

export default defineConfig()
