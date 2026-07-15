import client from './client'

export const plantRecipe = (payload) => client.post('/recipes', payload)
export const cookRecipe = (id, body = {}) =>
  client.post(`/recipes/${id}/cook`, body)
export const handoffRecipe = (id, body) =>
  client.post(`/recipes/${id}/handoff`, body)
export const getLineage = (id) => client.get(`/recipes/${id}/lineage`)
export const setVisibility = (id, visibility) =>
  client.patch(`/recipes/${id}`, { visibility })
export const getSharedWithMe = () => client.get('/recipes/shared')
export const getInvitePreview = (token) =>
  client.get(`/recipes/invite/${token}`)
export const claimInvite = (token) =>
  client.post(`/recipes/invite/${token}/claim`)
