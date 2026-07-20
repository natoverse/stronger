import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
	saveSheetId,
	loadSheetId,
	clearSheetId,
	saveAccessToken,
	loadAccessToken,
	clearAccessToken,
	saveAccessTokenExpiry,
	loadAccessTokenExpiry,
	clearAccessTokenExpiry,
	saveUserEmail,
	loadUserEmail,
	clearUserEmail,
} from '../storage.ts'

function mockDocument() {
	const encodedCookieStore = new Map<string, string>()
	return {
		get cookie() {
			return Array.from(encodedCookieStore.entries())
				.map(([k, v]) => `${k}=${v}`)
				.join('; ')
		},
		set cookie(value: string) {
			const [pair, ...attrs] = value.split(';')
			const [rawName, rawVal = ''] = pair.split('=')
			const name = rawName.trim()
			const encodedValue = rawVal.trim()
			const maxAgeAttr = attrs.find((a) => a.trim().toLowerCase().startsWith('max-age='))
			const maxAge = maxAgeAttr ? Number(maxAgeAttr.split('=')[1]) : undefined
			if (maxAge === 0) {
				encodedCookieStore.delete(name)
				return
			}
			encodedCookieStore.set(name, encodedValue)
		},
	} as unknown as Document
}

describe('storage', () => {
	beforeEach(() => {
		vi.stubGlobal('document', mockDocument())
	})

	it('returns null when no sheet ID is stored', () => {
		expect(loadSheetId()).toBeNull()
	})

	it('persists and retrieves a sheet ID', () => {
		saveSheetId('abc123')
		expect(loadSheetId()).toBe('abc123')
	})

	it('overwrites a previously stored sheet ID', () => {
		saveSheetId('first')
		saveSheetId('second')
		expect(loadSheetId()).toBe('second')
	})

	it('clears the stored sheet ID', () => {
		saveSheetId('abc123')
		clearSheetId()
		expect(loadSheetId()).toBeNull()
	})

	it('persists and clears access token', () => {
		saveAccessToken('tok_123')
		expect(loadAccessToken()).toBe('tok_123')
		clearAccessToken()
		expect(loadAccessToken()).toBeNull()
	})

	it('round-trips URL-unsafe token characters', () => {
		const token = 'tok.with/slash+plus=='
		saveAccessToken(token)
		expect(document.cookie).toContain(`stronger_google_access_token=${encodeURIComponent(token)}`)
		expect(loadAccessToken()).toBe(token)
	})

	it('persists and clears the access token expiry', () => {
		expect(loadAccessTokenExpiry()).toBeNull()
		saveAccessTokenExpiry(1_700_000_000_000)
		expect(loadAccessTokenExpiry()).toBe(1_700_000_000_000)
		clearAccessTokenExpiry()
		expect(loadAccessTokenExpiry()).toBeNull()
	})

	it('returns null for an unparseable stored expiry', () => {
		document.cookie = 'stronger_google_access_token_expiry=notanumber'
		expect(loadAccessTokenExpiry()).toBeNull()
	})

	it('persists and clears the signed-in user email', () => {
		expect(loadUserEmail()).toBeNull()
		saveUserEmail('lifter@example.com')
		expect(loadUserEmail()).toBe('lifter@example.com')
		clearUserEmail()
		expect(loadUserEmail()).toBeNull()
	})
})
