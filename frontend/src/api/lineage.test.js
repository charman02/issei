import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('./client', () => ({ default: { post: vi.fn(() => Promise.resolve({ data: {} })), get: vi.fn(() => Promise.resolve({ data: {} })) } }))
import client from './client'
import { plantRecipe, remixRecipe, cookRecipe, handoffRecipe, getLineage } from './lineage'

beforeEach(() => { client.post.mockClear(); client.get.mockClear() })

describe('lineage api', () => {
  it('plantRecipe posts to /recipes', () => {
    plantRecipe({ name: 'x' })
    expect(client.post).toHaveBeenCalledWith('/recipes', { name: 'x' })
  })
  it('remixRecipe posts to the remix route', () => {
    remixRecipe(12, { ingredients: [], steps: [], prompt_answer: 'why' })
    expect(client.post).toHaveBeenCalledWith('/recipes/12/remix', { ingredients: [], steps: [], prompt_answer: 'why' })
  })
  it('cookRecipe posts to the cook route with default body', () => {
    cookRecipe(5)
    expect(client.post).toHaveBeenCalledWith('/recipes/5/cook', {})
  })
  it('handoffRecipe posts recipient + note', () => {
    handoffRecipe(5, { to_email: 'a@b.com', note: 'hi' })
    expect(client.post).toHaveBeenCalledWith('/recipes/5/handoff', { to_email: 'a@b.com', note: 'hi' })
  })
  it('getLineage gets the lineage route', () => {
    getLineage(9)
    expect(client.get).toHaveBeenCalledWith('/recipes/9/lineage')
  })
})
