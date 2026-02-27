import { describe, expect, it } from 'vitest'
import { formatRelative, parseJsonObject } from '@/utils/format'

describe('format utilities', () => {
  it('parses JSON object', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 })
  })

  it('throws for non-object JSON', () => {
    expect(() => parseJsonObject('[1,2]')).toThrowError()
  })

  it('formats null relative time', () => {
    expect(formatRelative(null)).toBe('从未')
  })
})
