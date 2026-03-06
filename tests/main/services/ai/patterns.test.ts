import { describe, it, expect } from 'vitest'
import { parseAnalysisResponse } from '../../../../src/main/services/ai/patterns'

describe('patterns', () => {
  describe('parseAnalysisResponse', () => {
    it('parses clean JSON analysis', () => {
      const json = JSON.stringify({
        clusters: [{ name: 'Test', entities: ['A'], summary: 'test' }],
        timeline: [{ observation: 'obs', significance: 'sig' }],
        suggestions: [{ type: 'investigate', description: 'desc', relatedCaptures: [] }],
        summary: 'Overall summary'
      })
      const result = parseAnalysisResponse(json)
      expect(result).not.toBeNull()
      expect(result!.summary).toBe('Overall summary')
      expect(result!.clusters).toHaveLength(1)
      expect(result!.timeline).toHaveLength(1)
      expect(result!.suggestions).toHaveLength(1)
    })

    it('parses JSON in code fences', () => {
      const content = '```json\n{"clusters":[],"timeline":[],"suggestions":[],"summary":"test"}\n```'
      const result = parseAnalysisResponse(content)
      expect(result).not.toBeNull()
      expect(result!.summary).toBe('test')
    })

    it('parses JSON with surrounding text', () => {
      const content = 'Here is the analysis:\n{"clusters":[],"timeline":[],"suggestions":[],"summary":"found it"}\nDone.'
      const result = parseAnalysisResponse(content)
      expect(result).not.toBeNull()
      expect(result!.summary).toBe('found it')
    })

    it('returns null for invalid content', () => {
      expect(parseAnalysisResponse('no json here')).toBeNull()
    })

    it('returns null for JSON without summary field', () => {
      expect(parseAnalysisResponse('{"data": "something"}')).toBeNull()
    })
  })
})
