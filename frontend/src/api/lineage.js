import client from './client'

export const plantRecipe = (payload) => client.post('/recipes', payload)
export const remixRecipe = (id, body) => client.post(`/recipes/${id}/remix`, body)
export const cookRecipe = (id, body = {}) => client.post(`/recipes/${id}/cook`, body)
export const handoffRecipe = (id, body) => client.post(`/recipes/${id}/handoff`, body)
export const getLineage = (id) => client.get(`/recipes/${id}/lineage`)
export const setVisibility = (id, visibility) => client.patch(`/recipes/${id}`, { visibility })
