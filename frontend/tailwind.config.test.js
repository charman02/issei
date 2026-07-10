import { describe, it, expect } from 'vitest'
import config from './tailwind.config.js'

describe('tailwind font families', () => {
  const fam = config.theme.extend.fontFamily
  it('serif is Cormorant Garamond', () => {
    expect(fam.serif[0]).toBe('Cormorant Garamond')
  })
  it('sans is Nunito Sans', () => {
    expect(fam.sans[0]).toBe('Nunito Sans')
  })
  it('hand is Caveat', () => {
    expect(fam.hand[0]).toBe('Caveat')
  })
})
