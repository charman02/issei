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
    expect(c.action).toBe('#BD5A2C')
  })
  it('growth maps to herb', () => {
    expect(c.growth).toBe('#6F8A4D')
  })
  it('keeps the heirloom palette', () => {
    expect(c.paper).toBe('#EFE4D2')
    expect(c.terra).toBe('#BD5A2C')
    expect(c.herb).toBe('#6F8A4D')
  })
})
