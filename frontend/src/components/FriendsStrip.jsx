import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getFriends } from '../api/friends'
import Avatar from './Avatar'

// The Feed's presence strip (#75) — a horizontal rail of your friends' faces at the top
// of Home, one tap to each person's profile. Ordered 'active' (see api/friends): whoever
// posted most recently leads, so the strip reads as "who's been cooking lately"; quiet
// friends still appear (all accepted friends), just further along. First names only, to
// keep each cell narrow enough that several fit on a phone.
//
// It authorizes nothing itself: GET /friends already returns only the caller's accepted
// friends, and the 'active' sort counts only posts the caller may see (enforced server-
// side). This component just presents that list.
//
// Renders NOTHING until the fetch lands (no layout jump above the feed) and nothing when
// you have no friends — the Feed's own empty state already points you to "Find friends",
// so a blank rail here would be redundant.
export default function FriendsStrip() {
  const [friends, setFriends] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    getFriends('active')
      .then((res) => setFriends(res.data))
      .catch(() => setFriends([]))
  }, [])

  if (!friends || friends.length === 0) return null

  return (
    <div className="pb-3">
      {/* scrollbar-hide: a phone rail scrolls by touch; the scrollbar is visual noise.
          -mx-4 px-4 lets the row bleed to the screen edge so a face can peek in, cueing
          that it scrolls, while the content still aligns with the feed's padding. */}
      <div className="flex gap-3.5 overflow-x-auto scrollbar-hide -mx-4 px-4">
        {friends.map((f) => (
          <button
            key={f.user_id}
            onClick={() => navigate(`/u/${f.user_id}`)}
            className="flex-none flex flex-col items-center gap-1.5 w-[62px]"
          >
            <Avatar name={f.first_name} photoUrl={f.photo_url} size="md" />
            <span className="w-full truncate text-center font-display font-bold text-[11.5px] text-ink-soft leading-tight pb-px">
              {f.first_name}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
