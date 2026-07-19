import { describe, expect, it, beforeEach, vi } from 'vitest'
import { saveSheetId, loadSheetId, clearSheetId, saveAccessToken, loadAccessToken, clearAccessToken } from '../storage.ts'

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
})
