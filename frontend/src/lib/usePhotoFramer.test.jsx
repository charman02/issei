import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePhotoFramer } from './usePhotoFramer'

// The join between the upload pipeline (which awaits a promise) and a component (which decides from
// a click). Tested without PhotoFramer so the PROTOCOL is the subject: three outcomes, and each one
// means something different to `photoUpload`.
//
//   a File     → upload this instead
//   undefined  → couldn't crop, upload the original
//   null       → the person cancelled; upload nothing at all
//
// Conflating the last two is the bug this file exists to prevent: a browser with no canvas encoder
// would look identical to someone changing their mind, and the pick would be silently dropped.

const FILE = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
const CROPPED = new File(['y'], 'a-cropped.jpg', { type: 'image/jpeg' })

function Harness({ onSettled }) {
  const { frame, framerProps, framing } = usePhotoFramer()
  return (
    <div>
      <button onClick={async () => onSettled(await frame('avatar')(FILE))}>start</button>
      <span data-testid="framing">{String(framing)}</span>
      <span data-testid="shape">{framerProps.shape}</span>
      <span data-testid="hasFile">{String(Boolean(framerProps.file))}</span>
      <button onClick={() => framerProps.onDone(CROPPED)}>done-cropped</button>
      <button onClick={() => framerProps.onDone(undefined)}>done-nocrop</button>
      <button onClick={() => framerProps.onCancel()}>cancel</button>
    </div>
  )
}

describe('usePhotoFramer (#103)', () => {
  it('exposes the picked file and the requested shape while open', async () => {
    render(<Harness onSettled={() => {}} />)
    expect(screen.getByTestId('framing')).toHaveTextContent('false')

    await userEvent.click(screen.getByText('start'))

    expect(screen.getByTestId('framing')).toHaveTextContent('true')
    expect(screen.getByTestId('hasFile')).toHaveTextContent('true')
    expect(screen.getByTestId('shape')).toHaveTextContent('avatar')
  })

  it('resolves with the cropped File when the person accepts', async () => {
    const settled = vi.fn()
    render(<Harness onSettled={settled} />)
    await userEvent.click(screen.getByText('start'))

    await userEvent.click(screen.getByText('done-cropped'))

    await waitFor(() => expect(settled).toHaveBeenCalledWith(CROPPED))
    expect(screen.getByTestId('framing')).toHaveTextContent('false')
  })

  it('resolves UNDEFINED — not null — when it could not crop', async () => {
    // `undefined` means "upload the original". If this resolved null, a browser with no canvas
    // encoder would silently discard a perfectly good pick.
    const settled = vi.fn()
    render(<Harness onSettled={settled} />)
    await userEvent.click(screen.getByText('start'))

    await userEvent.click(screen.getByText('done-nocrop'))

    await waitFor(() => expect(settled).toHaveBeenCalledWith(undefined))
  })

  it('resolves NULL on cancel, which is what aborts the pick', async () => {
    const settled = vi.fn()
    render(<Harness onSettled={settled} />)
    await userEvent.click(screen.getByText('start'))

    await userEvent.click(screen.getByText('cancel'))

    await waitFor(() => expect(settled).toHaveBeenCalledWith(null))
  })

  it('never leaves an earlier promise dangling when a second pick arrives', async () => {
    // `photoUpload` AWAITS this promise. An unresolved one would hang that slot's upload forever
    // with its busy flag off and no error on screen — a pick that vanishes.
    const settled = vi.fn()
    render(<Harness onSettled={settled} />)
    await userEvent.click(screen.getByText('start'))
    await userEvent.click(screen.getByText('start'))

    // The first resolved as a cancel; only the second is still open.
    await waitFor(() => expect(settled).toHaveBeenCalledWith(null))
    expect(screen.getByTestId('framing')).toHaveTextContent('true')

    await userEvent.click(screen.getByText('done-cropped'))
    await waitFor(() => expect(settled).toHaveBeenCalledWith(CROPPED))
    expect(settled).toHaveBeenCalledTimes(2)
  })
})
