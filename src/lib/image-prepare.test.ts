/**
 * HEIC detection (audit B1).
 *
 * The detection has to survive the awkward real-world case that motivated the
 * bug: Chrome frequently reports an EMPTY `file.type` for .heic files, so a
 * MIME-only check both fails to convert them AND (in the picker) rejects them
 * as "not a supported format".
 *
 * The conversion itself needs libheif + canvas and is exercised on a real
 * device rather than here; this pins the routing decision that precedes it.
 */
import { describe, it, expect } from 'vitest'
import { isHeic } from './image-prepare'

function fakeFile(name: string, type: string): File {
  return { name, type, size: 1024 } as File
}

describe('isHeic', () => {
  it('detects by MIME type', () => {
    expect(isHeic(fakeFile('IMG_0292.HEIC', 'image/heic'))).toBe(true)
    expect(isHeic(fakeFile('x.heif', 'image/heif'))).toBe(true)
    expect(isHeic(fakeFile('X.HEIC', 'IMAGE/HEIC'))).toBe(true)
  })

  it('detects by extension when the browser reports no MIME type', () => {
    // This is the actual Chrome behaviour that made the bug bite.
    expect(isHeic(fakeFile('IMG_0292.HEIC', ''))).toBe(true)
    expect(isHeic(fakeFile('photo.heif', ''))).toBe(true)
    expect(isHeic(fakeFile('lower.heic', ''))).toBe(true)
  })

  it('leaves formats browsers can already render alone', () => {
    expect(isHeic(fakeFile('a.jpg', 'image/jpeg'))).toBe(false)
    expect(isHeic(fakeFile('b.png', 'image/png'))).toBe(false)
    expect(isHeic(fakeFile('c.webp', 'image/webp'))).toBe(false)
  })

  it('does not misfire on a filename that merely mentions heic', () => {
    expect(isHeic(fakeFile('heic-converted.jpg', 'image/jpeg'))).toBe(false)
    expect(isHeic(fakeFile('my-heic-photos.png', 'image/png'))).toBe(false)
  })

  it('trusts an explicit non-HEIC image MIME over a misleading extension', () => {
    // Already transcoded upstream but the name was kept.
    expect(isHeic(fakeFile('IMG_0292.HEIC', 'image/jpeg'))).toBe(false)
  })
})
