/**
 * Storage reference parsing (audit S1).
 *
 * This parser decides which object a caller gets a signed URL for. A bug here
 * is either a broken gallery or — worse — signing something the caller
 * shouldn't see, so the edge cases are pinned deliberately.
 */
import { describe, it, expect } from 'vitest'
import {
  parseStorageRef,
  orgIdFromPath,
  jobIdFromPath,
  isPrivateBucket,
} from './storage-paths'

const ORG = '11111111-1111-1111-1111-111111111111'
const JOB = '22222222-2222-2222-2222-222222222222'
const PUBLIC_URL = `https://abc.supabase.co/storage/v1/object/public/job-photos/${ORG}/jobs/${JOB}/photo.jpg`

describe('parseStorageRef', () => {
  it('parses a legacy public URL (the shape actually stored in the DB)', () => {
    expect(parseStorageRef(PUBLIC_URL)).toEqual({
      bucket: 'job-photos',
      path: `${ORG}/jobs/${JOB}/photo.jpg`,
    })
  })

  it('parses an already-signed URL and drops the token', () => {
    const signed = `https://abc.supabase.co/storage/v1/object/sign/job-photos/${ORG}/x.jpg?token=abc.def`
    expect(parseStorageRef(signed)).toEqual({ bucket: 'job-photos', path: `${ORG}/x.jpg` })
  })

  it('parses a bare bucket/path string', () => {
    expect(parseStorageRef(`equipment-photos/${ORG}/equipment/u-unit.jpg`)).toEqual({
      bucket: 'equipment-photos',
      path: `${ORG}/equipment/u-unit.jpg`,
    })
  })

  it('URL-decodes the object path', () => {
    const encoded = `https://abc.supabase.co/storage/v1/object/public/job-photos/${ORG}/my%20photo.jpg`
    expect(parseStorageRef(encoded)?.path).toBe(`${ORG}/my photo.jpg`)
  })

  it('returns null for buckets that are still public (pass-through)', () => {
    expect(
      parseStorageRef('https://abc.supabase.co/storage/v1/object/public/company-assets/logo.png')
    ).toBeNull()
    expect(parseStorageRef('company-assets/logo.png')).toBeNull()
  })

  it('returns null for empty / non-string / malformed input', () => {
    expect(parseStorageRef(null)).toBeNull()
    expect(parseStorageRef(undefined)).toBeNull()
    expect(parseStorageRef('')).toBeNull()
    expect(parseStorageRef('   ')).toBeNull()
    expect(parseStorageRef('not a url')).toBeNull()
    expect(parseStorageRef('job-photos')).toBeNull() // bucket with no path
    expect(parseStorageRef('https://example.com/nope.jpg')).toBeNull()
  })

  it('refuses path traversal', () => {
    expect(parseStorageRef(`job-photos/${ORG}/../other-org/secret.jpg`)).toBeNull()
  })
})

describe('orgIdFromPath', () => {
  it('extracts the tenant prefix used for isolation', () => {
    expect(orgIdFromPath(`${ORG}/jobs/${JOB}/p.jpg`)).toBe(ORG)
  })
})

describe('jobIdFromPath', () => {
  it('extracts the job id from a job-photo path', () => {
    expect(jobIdFromPath(`${ORG}/jobs/${JOB}/p.jpg`)).toBe(JOB)
  })

  it('returns null for equipment paths (no owning id encoded)', () => {
    expect(jobIdFromPath(`${ORG}/equipment/uuid-unit.jpg`)).toBeNull()
  })

  it('returns null for a short or unexpected shape', () => {
    expect(jobIdFromPath(`${ORG}/jobs`)).toBeNull()
    expect(jobIdFromPath(`${ORG}/other/${JOB}/p.jpg`)).toBeNull()
  })
})

describe('isPrivateBucket', () => {
  it('covers exactly the two private photo buckets', () => {
    expect(isPrivateBucket('job-photos')).toBe(true)
    expect(isPrivateBucket('equipment-photos')).toBe(true)
    expect(isPrivateBucket('company-assets')).toBe(false)
    expect(isPrivateBucket('public')).toBe(false)
  })
})
