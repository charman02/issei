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

describe('tailwind color roles', () => {
  const c = config.theme.extend.colors
  it('action maps to terra', () => {
    expect(c.action).toBe('#B5502A')
    expect(c.action).toBe(c.terra)
  })
  it('growth maps to the lead green', () => {
    expect(c.growth).toBe('#5C7A3F')
    expect(c.growth).toBe(c.herb)
  })
  it('uses the garden palette', () => {
    expect(c.paper).toBe('#F3EAD6')
    expect(c.terra).toBe('#B5502A')
    expect(c.herb).toBe('#5C7A3F')
  })
})
