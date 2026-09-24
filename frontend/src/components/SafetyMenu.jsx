import { useState } from 'react'
import { toUserMessage } from '../api/client'
import { blockUser, reportUser } from '../api/friends'

// The safety menu — report and block, behind a ⋯ (#85 block, #87 report, extracted #87 part two).
//
// EXTRACTED RATHER THAN COPIED, and that is the whole reason this file exists. All of this lived
// inline in `UserProfile.jsx` until a report could name a post or a recipe; adding it to two more
// screens by copy-paste is exactly the pattern that let #98 ship a photo field with no host check and
// #106 miss three of five write surfaces — "the inline copy in the first router never reached the
// second". `services/media.py` and `lib/shareLink.js` are the same lesson on the backend and in the
// share path. So the component is the one place this behaviour lives, and every page renders it.
//
// The placement decisions survive the move, because they were all learned the hard way:
//
//   · BOTTOM of the page, below the content, behind a ⋯. It used to sit directly under the friend
//     button, which put a safety control inside the social one's blast radius — the two most
//     consequential taps on the page adjacent to each other. And it used to be a red "Block" chip in
//     the open, which reads as the page SUGGESTING something about a person you were only looking at.
//   · A ⋯ is not a faint control, it is an UNLABELLED one, which is different: a universally
//     understood affordance you reach by deciding to, rather than a quiet version of a loud one.
//   · REPORT ABOVE BLOCK, in escalation order — a report asks somebody else to act, a block acts
//     yourself and deletes a friendship.
//   · BOTH NAME THE PERSON, so neither can be tapped without knowing who it lands on.
//   · "Never mind" closes the WHOLE menu rather than returning to it. Backing out of "Block Ana?"
//     into a menu that still offers Block leaves you one tap from what you just declined.
//   · After a report it offers the block as the obvious next step, because the person who just
//     reported someone very often wants them gone too, and making them hunt for the ⋯ again would be
//     the app being obtuse about it.
//
// WHAT THE SUBJECT CHANGES, and it is deliberately very little (#87 part two). `subject` names the
// post or recipe the report is about; `subjectLabel` is what the copy calls it ("this meal", "this
// recipe"). With no subject this is the profile's menu, unchanged. With one:
//   · the menu and the confirm read "Report this meal" rather than "Report Ana", because on a post
//     page the thing in front of you is the meal and reporting the PERSON from there would be a
//     different act than the one the label promised;
//   · BLOCK STILL NAMES THE PERSON. A block is never about a post, and "Block this meal" would be
//     nonsense — so that item keeps the name even on a content page, which is also the honest
//     disclosure that the act reaches further than the thing you were looking at.
// The report itself is always about the person either way: `user_id` is required by the API, and the
// subject is why, not instead of who.
//
// AND `personName` IS OPTIONAL WHEN A SUBJECT IS SET, which is the one asymmetry with real teeth.
// `RecipePage` has to FETCH the cook's name (`RecipeResponse` carries none, and `origin_attribution`
// is the byline — frequently not the account holder), and the fetch 404s across a BLOCK. The first
// version gated the whole menu on having the name, which meant: a cook hands you a recipe, harasses
// you, blocks you — an accepted grant survives a block (#85), so you can still open the recipe, and
// the ⋯ was gone. That is the block becoming cover for the person who earned it, which is the exact
// thing `report_user`'s missing block check exists to prevent, reintroduced one layer up. A ship gate
// caught it. So with no name: the REPORT item still renders (it names the subject), and the BLOCK
// item is SUPPRESSED rather than guessed at — "Block them" with no name breaks the rule that a
// safety control must never be tappable without knowing who it lands on, and a block is recoverable
// from `/u/{id}` later while a report about content you can see right now is not.
//
// NO `can_view` ANYWHERE IN THIS FLOW, on purpose, mirroring the router: a report is not a read. The
// component renders wherever its page renders, and the server records the id whether or not the
// reporter can still resolve it.
export default function SafetyMenu({
  userId,
  personName,
  friendState,
  subject = null,
  subjectLabel = null,
  onBlocked,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmingBlock, setConfirmingBlock] = useState(false)
  const [blocking, setBlocking] = useState(false)
  const [blockError, setBlockError] = useState('')
  const [reporting, setReporting] = useState(false)
  const [reportReason, setReportReason] = useState('harassment')
  const [reportNote, setReportNote] = useState('')
  const [reportSending, setReportSending] = useState(false)
  const [reportError, setReportError] = useState('')
  const [reportSent, setReportSent] = useState(false)
  const [blocked, setBlocked] = useState(false)

  // What the REPORT items call their target. Block deliberately always names the person — see above.
  const reportTarget = subject ? subjectLabel : personName
  // Whether the block item can be offered at all. With a subject we can report a thing without
  // knowing whose it is; a block can never be offered without naming the person. See the note above
  // — this is what keeps a blocked cook reportable from a recipe they handed over.
  const canBlock = Boolean(personName)
  // Who the confirmation panels refer to. "They" is deliberately vague rather than wrong.
  const them = personName || 'They'

  // Blocking (#85) — two taps, because it deletes the friendship and can't be undone from here.
  async function confirmBlock() {
    setBlockError('')
    setBlocking(true)
    try {
      await blockUser(Number(userId))
      // A SUCCESS STATE OF ITS OWN, and it exists because the inline original did not need one: on a
      // profile the success path ALWAYS navigated away, so leaving `blocking` true and showing no
      // confirmation was invisible. A ship gate found what that cost once the component had callers
      // that don't navigate — blocking from a meal page left "Blocking…" disabled forever with
      // "Never mind" also disabled, no confirmation, the blocked person's content still on screen,
      // and the browser back button the only way out. That is the "did that work, or did I just
      // remove them?" failure #80 fixed elsewhere.
      //
      // So the component always answers for itself, and `onBlocked` is an ADDITION for callers whose
      // page is now a 404 for the viewer. Order matters: clear the flag and show the panel BEFORE
      // calling out, so a caller that navigates leaves a coherent screen behind and one that doesn't
      // gets a real confirmation.
      setBlocking(false)
      setConfirmingBlock(false)
      setBlocked(true)
      onBlocked?.()
    } catch (err) {
      setBlockError(toUserMessage(err, 'Couldn’t block them just now. Try again.'))
      setBlocking(false)
    }
  }

  // Reporting (#87). One tap fewer than blocking, on purpose: a report doesn't change anything the
  // reporter can see, so there is nothing to warn them about — the second tap on a block is there
  // because a block has consequences.
  async function sendReport() {
    setReportError('')
    setReportSending(true)
    try {
      await reportUser(Number(userId), reportReason, reportNote, subject)
      setReportSent(true)
    } catch (err) {
      setReportError(toUserMessage(err, 'Couldn’t send that just now. Try again.'))
    } finally {
      setReportSending(false)
    }
  }

  return (
    // text-center because this sits below the page's content rather than inside a centred column —
    // without it the control renders flush to the left edge, orphaned. The panels keep their own
    // text-left, since a paragraph of consequences shouldn't be centred.
    <div className="mt-8 text-center">
      {blocked ? (
        /* State 5: blocked. Only ever seen by a caller that does NOT navigate away — on a profile
           the page is gone before this paints. It says what happened and what it did not, because
           a block is the one act here with consequences the person cannot see from this screen. */
        <div className="sticker bg-card p-3 text-left">
          <p className="font-display font-bold text-[14px] text-ink leading-snug">
            Blocked. You won&rsquo;t see each other anymore.
          </p>
          <p className="font-display text-[13px] text-ink-soft leading-snug mt-1">
            {them} wasn&rsquo;t told. Anything still on this screen will be gone next time you look.
            You can undo this under You &rarr; Blocked.
          </p>
        </div>
      ) : reportSent ? (
        /* State 4: reported. */
        <div className="sticker bg-card p-3 text-left">
          <p className="font-display font-bold text-[14px] text-ink leading-snug">
            Thanks — we&rsquo;ll take a look.
          </p>
          <p className="font-display text-[13px] text-ink-soft leading-snug mt-1">
            {them} hasn&rsquo;t been told, and nothing about your account has changed.
            {canBlock
              ? ' If you\u2019d also rather not see each other, you can block them.'
              : ''}
          </p>
          <div className="flex gap-2 mt-3">
            {canBlock && (
            <button
              onClick={() => {
                setReportSent(false)
                setReporting(false)
                setConfirmingBlock(true)
              }}
              className="flex-1 rounded-full bg-cream text-brick border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform"
            >
              Block them too
            </button>
            )}
            <button
              onClick={() => {
                setReportSent(false)
                setReporting(false)
                setMenuOpen(false)
                // Clear BOTH, for the reason the "Never mind" path documents: a reason left behind
                // attaches an account of one thing to whatever is reported next. This path used to
                // clear only the note, which was faithful to the inline original and wrong.
                setReportNote('')
                setReportReason('harassment')
              }}
              className="flex-1 rounded-full bg-cream text-ink border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform"
            >
              Done
            </button>
          </div>
        </div>
      ) : reporting ? (
        /* State 3: the report form. The note is optional because demanding an explanation is
           friction in front of someone who may be upset, and a reason alone is a valid report. */
        <div className="sticker bg-card p-3 text-left">
          <p className="font-display font-bold text-[14px] text-ink leading-snug">
            Report {reportTarget}?
          </p>
          <p className="font-display text-[13px] text-ink-soft leading-snug mt-1">
            This goes to us, not to them — they won&rsquo;t be told, and reporting on its own
            doesn&rsquo;t hide either of you from the other.
          </p>
          <label className="section-label block mt-3 mb-1" htmlFor="report-reason">
            What&rsquo;s wrong?
          </label>
          <select
            id="report-reason"
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            className="field w-full"
          >
            <option value="harassment">They&rsquo;re harassing someone</option>
            <option value="inappropriate">They posted something inappropriate</option>
            <option value="spam">Spam or scams</option>
            <option value="impersonation">They&rsquo;re pretending to be someone else</option>
            <option value="other">Something else</option>
          </select>
          <label className="section-label block mt-3 mb-1" htmlFor="report-note">
            Anything you want to add? (optional)
          </label>
          <textarea
            id="report-note"
            value={reportNote}
            onChange={(e) => setReportNote(e.target.value)}
            rows={3}
            maxLength={1000}
            className="field w-full"
            placeholder="What happened?"
          />
          {reportError && (
            <p className="mt-2">
              <span className="error-pill">{reportError}</span>
            </p>
          )}
          <div className="flex gap-2 mt-3">
            <button
              onClick={sendReport}
              disabled={reportSending}
              className="flex-1 rounded-full bg-terra text-cream border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
            >
              {reportSending ? 'Sending…' : 'Send report'}
            </button>
            <button
              onClick={() => {
                setReporting(false)
                setReportError('')
                setMenuOpen(false)
                // Clear the draft too. Without this, backing out and reopening Report later shows
                // the old text still in the box — and sending would attach an account of one thing
                // to whatever reason you pick the second time.
                setReportNote('')
                setReportReason('harassment')
              }}
              disabled={reportSending}
              className="flex-1 rounded-full bg-cream text-ink border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
            >
              Never mind
            </button>
          </div>
        </div>
      ) : confirmingBlock ? (
        /* State 2: the block confirm. Names the person AND every consequence, rather than asking
           "are you sure?" about nothing. */
        <div className="sticker bg-card p-3 text-left">
          <p className="font-display font-bold text-[14px] text-ink leading-snug">
            Block {personName}?
          </p>
          <p className="font-display text-[13px] text-ink-soft leading-snug mt-1">
            You won&rsquo;t see each other anywhere, and they can&rsquo;t ask you for a recipe. It
            also removes them as a friend
            {friendState === 'accepted' ? '' : ' if you\u2019re friends'} — unblocking later won&rsquo;t
            bring that back. A recipe you already sent them stays theirs.
          </p>
          {blockError && (
            <p className="mt-2">
              <span className="error-pill">{blockError}</span>
            </p>
          )}
          <div className="flex gap-2 mt-3">
            <button
              onClick={confirmBlock}
              disabled={blocking}
              className="flex-1 rounded-full bg-brick text-cream border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
            >
              {blocking ? 'Blocking…' : 'Block them'}
            </button>
            <button
              onClick={() => {
                setConfirmingBlock(false)
                setBlockError('')
                setMenuOpen(false)
              }}
              disabled={blocking}
              className="flex-1 rounded-full bg-cream text-ink border-2 border-ink px-3 py-2 font-display font-bold text-[13px] shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform disabled:opacity-50"
            >
              Never mind
            </button>
          </div>
        </div>
      ) : menuOpen ? (
        /* State 1: the menu. Report above Block, in escalation order. Report names the SUBJECT when
           there is one; Block always names the PERSON, because a block is never about a post and
           saying so is the honest disclosure that it reaches past the thing you were looking at. */
        <div className="sticker bg-card p-1.5 text-left">
          <button
            onClick={() => setReporting(true)}
            className="w-full text-left rounded-xl px-3 py-2.5 font-display font-bold text-[14px] text-ink active:bg-peach/40"
          >
            Report {reportTarget}
          </button>
          {canBlock && (
            <>
              <div className="h-[2px] bg-line mx-3" />
              <button
                onClick={() => setConfirmingBlock(true)}
                className="w-full text-left rounded-xl px-3 py-2.5 font-display font-bold text-[14px] text-brick active:bg-peach/40"
              >
                Block {personName}
              </button>
            </>
          )}
          <div className="h-[2px] bg-line mx-3" />
          <button
            onClick={() => setMenuOpen(false)}
            className="w-full text-left rounded-xl px-3 py-2.5 font-display text-[14px] text-ink-soft active:bg-peach/40"
          >
            Never mind
          </button>
        </div>
      ) : (
        /* State 0: just the ⋯. Cream, not brick — at rest this control makes no suggestion about
           the person or the thing you are looking at. */
        <button
          onClick={() => setMenuOpen(true)}
          aria-label={`More options for ${subject ? subjectLabel : personName}`}
          className="inline-flex items-center justify-center w-11 h-8 rounded-full bg-cream text-ink border-2 border-ink font-display font-black text-[15px] leading-none shadow-[0_2px_0_#2E3A24] active:translate-y-[1px] active:shadow-none transition-transform"
        >
          &middot;&middot;&middot;
        </button>
      )}
    </div>
  )
}
