import { describe, it, expect } from 'vitest'
import { stateForRecipe, bloomForRecipe, ownerCookCount } from './growthState'

describe('stateForRecipe', () => {
  it('is seed when never cooked and no children', () => {
    expect(stateForRecipe({ cook_count: 0, child_count: 0 })).toBe('seed')
  })
  it('is sprout when cooked but no children', () => {
    expect(stateForRecipe({ cook_count: 3, child_count: 0 })).toBe('sprout')
  })
  it('is sprout when only the owner has cooked it', () => {
    expect(stateForRecipe({ owner_cook_count: 2, cook_count: 2, child_count: 0 })).toBe('sprout')
  })
  it('is sapling when it has children', () => {
    expect(stateForRecipe({ cook_count: 5, child_count: 2 })).toBe('sapling')
  })
  it('is tree when grandchildren exist', () => {
    expect(stateForRecipe({ child_count: 2, has_grandchildren: true })).toBe('tree')
  })
})

describe('ownerCookCount', () => {
  it('prefers explicit owner_cook_count', () => {
    expect(ownerCookCount({ owner_cook_count: 4 })).toBe(4)
  })
  it('derives from cook_events + user_id when needed', () => {
    const r = { user_id: 7, cook_events: [{ user_id: 7 }, { user_id: 9 }, { user_id: 7 }] }
    expect(ownerCookCount(r)).toBe(2)
  })
  it('is 0 when unknown', () => {
    expect(ownerCookCount({})).toBe(0)
  })
})

describe('bloomForRecipe', () => {
  it('blooms when cooked many times recently', () => {
    expect(bloomForRecipe({ cook_count: 6, last_cooked_at: new Date().toISOString() })).toBe('blooming')
  })
  it('is normal with a few cooks', () => {
    expect(bloomForRecipe({ cook_count: 1, last_cooked_at: new Date().toISOString() })).toBe('normal')
  })
  it('is dormant when cooked long ago', () => {
    const old = new Date('2000-01-01').toISOString()
    expect(bloomForRecipe({ cook_count: 3, last_cooked_at: old })).toBe('dormant')
  })
})
