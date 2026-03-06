import { describe, it, expect } from 'vitest'
import { parseEntitiesResponse } from '../../../../src/main/services/ai/entityExtraction'

describe('entityExtraction', () => {
  describe('parseEntitiesResponse', () => {
    it('parses clean JSON response', () => {
      const json = JSON.stringify({
        entities: [
          { type: 'person', value: 'John Smith', context: 'contacted John Smith', confidence: 0.95 },
          { type: 'email', value: 'john@example.com', context: 'email: john@example.com', confidence: 0.99 }
        ]
      })
      const result = parseEntitiesResponse(json)
      expect(result).toHaveLength(2)
      expect(result![0].type).toBe('person')
      expect(result![0].value).toBe('John Smith')
      expect(result![1].type).toBe('email')
    })

    it('parses JSON wrapped in code fences', () => {
      const content = '```json\n{"entities": [{"type": "domain", "value": "example.com", "confidence": 0.9}]}\n```'
      const result = parseEntitiesResponse(content)
      expect(result).toHaveLength(1)
      expect(result![0].type).toBe('domain')
    })

    it('parses JSON with surrounding text', () => {
      const content = 'Here are the entities:\n{"entities": [{"type": "person", "value": "Jane Doe", "confidence": 0.8}]}\nDone.'
      const result = parseEntitiesResponse(content)
      expect(result).toHaveLength(1)
      expect(result![0].value).toBe('Jane Doe')
    })

    it('handles trailing commas', () => {
      const content = '{"entities": [{"type": "phone", "value": "555-1234", "confidence": 0.7,},]}'
      const result = parseEntitiesResponse(content)
      expect(result).toHaveLength(1)
      expect(result![0].type).toBe('phone')
    })

    it('returns null for completely invalid content', () => {
      const result = parseEntitiesResponse('This is just text with no JSON.')
      expect(result).toBeNull()
    })

    it('handles empty entities array', () => {
      const json = '{"entities": []}'
      const result = parseEntitiesResponse(json)
      expect(result).toEqual([])
    })

    it('handles bare array response', () => {
      const json = '[{"type": "organization", "value": "Acme Corp", "confidence": 0.85}]'
      const result = parseEntitiesResponse(json)
      expect(result).toHaveLength(1)
      expect(result![0].value).toBe('Acme Corp')
    })
  })
})
