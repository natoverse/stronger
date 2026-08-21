/**
 * Google Calendar integration.
 *
 * Provides helpers to list the user's writable calendars, push
 * workout events as all-day entries with deep links back to the app,
 * and perform two-way sync between the schedule sheet and Google Calendar.
 */

import type { CalendarListEntry, CalendarEventResource, CalendarEventItem } from './types.ts'
import type { WorkoutScheduleEntry } from '../model/types.ts'
import { REST_ID } from '../model/types.ts'

/** Returns true for schedule entries that have no in-app workout to deep-link to (cardio, rest). */
function hasNoDeepLink(workoutId: string): boolean {
	return workoutId.startsWith('cardio:') || workoutId === REST_ID
}

/* ------------------------------------------------------------------ */
/*  Stronger ID generation                                             */
/* ------------------------------------------------------------------ */

/** Prefix used to identify Stronger IDs embedded in calendar event descriptions. */
export const STRONGER_ID_PREFIX = '[stronger:'

/** Suffix for the Stronger ID tag in event descriptions. */
export const STRONGER_ID_SUFFIX = ']'

/**
 * Generate a unique Stronger ID for a schedule row.
 * Format: `s-{timestamp}-{random}` — short, URL-safe, unique enough.
 */
export function generateStrongerId(): string {
	const ts = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `s-${ts}-${rand}`
}

/**
 * Embed a Stronger ID into an event description string.
 * Appends `\n[stronger:<id>]` to the description.
 */
export function embedStrongerId(description: string, strongerId: string): string {
	return `${description}\n${STRONGER_ID_PREFIX}${strongerId}${STRONGER_ID_SUFFIX}`
}

/**
 * Extract a Stronger ID from a calendar event description, if present.
 * Returns `undefined` if no ID is found.
 */
export function extractStrongerId(description: string | undefined): string | undefined {
	if (!description) return undefined
	const start = description.indexOf(STRONGER_ID_PREFIX)
	if (start === -1) return undefined
	const idStart = start + STRONGER_ID_PREFIX.length
	const end = description.indexOf(STRONGER_ID_SUFFIX, idStart)
	if (end === -1) return undefined
	const id = description.slice(idStart, end).trim()
	return id || undefined
}

/**
 * Returns true if a calendar event was created by Stronger.
 * Checks for a [stronger:...] ID tag or a deep link in the description.
 */
export function isStrongerEvent(event: CalendarEventItem): boolean {
	const desc = event.description ?? ''
	if (extractStrongerId(desc)) return true
	if (desc.includes('#/workout/')) return true
	return false
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface WeeklySlot {
	/** 0 = Monday, 6 = Sunday */
	dayIndex: number
	workoutId: string
	workoutName: string
}

export interface CalendarPushRequest {
	calendarId: string
	slots: WeeklySlot[]
	/** Start date in YYYY-MM-DD format (should be a Monday). */
	startDate: string
	/** Number of weeks to generate events for. */
	weeks: number
}

export interface CalendarPushResult {
	created: number
	skipped: number
	failed: number
	errors: string[]
}

/* ------------------------------------------------------------------ */
/*  Calendar list                                                      */
/* ------------------------------------------------------------------ */

/**
 * List Google Calendars the user can write to.
 * Returns entries where accessRole is 'writer' or 'owner'.
 */
export async function listWritableCalendars(): Promise<CalendarListEntry[]> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.calendar.calendarList.list()
	const items = response.result.items ?? []
	return items.filter(
		(c: CalendarListEntry) => c.accessRole === 'writer' || c.accessRole === 'owner',
	)
}

/* ------------------------------------------------------------------ */
/*  Existing event lookup                                              */
/* ------------------------------------------------------------------ */

/**
 * Fetch all events in a date range from a Google Calendar.
 *
 * Returns the raw event items so the caller can check for duplicates.
 */
export async function listEventsInRange(
	calendarId: string,
	startDate: string,
	endDate: string,
): Promise<CalendarEventItem[]> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const response = await gapi.client.calendar.events.list({
		calendarId,
		timeMin: `${startDate}T00:00:00Z`,
		timeMax: `${endDate}T00:00:00Z`,
		singleEvents: true,
		maxResults: 2500,
	})
	return response.result.items ?? []
}

/**
 * Build a set of "date|summary" keys from existing calendar events
 * for fast duplicate lookup.
 */
function buildExistingEventKeys(events: CalendarEventItem[]): Set<string> {
	const keys = new Set<string>()
	for (const e of events) {
		const date = e.start?.date ?? e.start?.dateTime?.slice(0, 10)
		const summary = e.summary
		if (date && summary) {
			keys.add(`${date}|${summary}`)
		}
	}
	return keys
}

/* ------------------------------------------------------------------ */
/*  Date formatting                                                    */
/* ------------------------------------------------------------------ */

/** Format a Date object as a YYYY-MM-DD string. */
function formatDateISO(d: Date): string {
	const yyyy = d.getFullYear()
	const mm = String(d.getMonth() + 1).padStart(2, '0')
	const dd = String(d.getDate()).padStart(2, '0')
	return `${yyyy}-${mm}-${dd}`
}

/* ------------------------------------------------------------------ */
/*  Event creation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Build a deep link URL for a workout.
 *
 * In the browser, derives the base URL from `window.location.href`.
 * An explicit `baseUrl` can be passed for testing environments where
 * `window.location` is not available.
 */
export function buildDeepLink(
	workoutId: string,
	baseUrl?: string,
): string {
	const base = baseUrl ?? window.location.href.split('#')[0]
	return `${base}#/workout/${encodeURIComponent(workoutId)}`
}

/**
 * Build an event description that includes the deep link (for strength
 * workouts) and the Stronger ID tag for two-way sync tracking.
 */
function buildEventDescription(workoutId: string, workoutName: string, strongerId: string): string {
	const deepLink = hasNoDeepLink(workoutId) ? null : buildDeepLink(workoutId)
	const base = deepLink ? `Open workout: ${deepLink}` : workoutName
	return embedStrongerId(base, strongerId)
}

/**
 * Generate the list of dates (YYYY-MM-DD) for a weekly slot across N weeks.
 *
 * `startDate` is the Monday of the first week. `dayIndex` is 0-based
 * from Monday (0 = Mon, 6 = Sun). Returns one date per week.
 */
export function generateEventDates(
	startDate: string,
	dayIndex: number,
	weeks: number,
): string[] {
	const [y, m, d] = startDate.split('-').map(Number)
	const base = new Date(y, m - 1, d)
	const dates: string[] = []
	for (let w = 0; w < weeks; w++) {
		const date = new Date(
			base.getFullYear(),
			base.getMonth(),
			base.getDate() + w * 7 + dayIndex,
		)
		const yyyy = date.getFullYear()
		const mm = String(date.getMonth() + 1).padStart(2, '0')
		const dd = String(date.getDate()).padStart(2, '0')
		dates.push(`${yyyy}-${mm}-${dd}`)
	}
	return dates
}

/** A single date→workout entry to push as a calendar event. */
export interface ScheduleCalendarEntry {
	date: string
	workoutId: string
	workoutName: string
}

export interface SchedulePushRequest {
	calendarId: string
	entries: ScheduleCalendarEntry[]
}

/**
 * Push individual schedule entries to a Google Calendar.
 *
 * Creates one all-day event per entry. Skips entries whose
 * workout name already exists on the same date (duplicate detection).
 */
export async function pushScheduleToCalendar(
	request: SchedulePushRequest,
): Promise<CalendarPushResult> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const result: CalendarPushResult = { created: 0, skipped: 0, failed: 0, errors: [] }
	if (request.entries.length === 0) return result

	// Compute the date range for existing-event query.
	const dates = request.entries.map((e) => e.date).sort()
	const startDate = dates[0]
	const [ey, em, ed] = dates[dates.length - 1].split('-').map(Number)
	const rangeEnd = new Date(ey, em - 1, ed + 1)
	const endDate = formatDateISO(rangeEnd)

	// Fetch existing events in the range to avoid duplicates.
	let existingKeys: Set<string>
	try {
		const existing = await listEventsInRange(request.calendarId, startDate, endDate)
		existingKeys = buildExistingEventKeys(existing)
	} catch {
		existingKeys = new Set()
	}

	for (const entry of request.entries) {
		if (existingKeys.has(`${entry.date}|${entry.workoutName}`)) {
			result.skipped++
			continue
		}

		const deepLink = hasNoDeepLink(entry.workoutId) ? null : buildDeepLink(entry.workoutId)
		const event: CalendarEventResource = {
			summary: entry.workoutName,
			description: deepLink ? `Open workout: ${deepLink}` : entry.workoutName,
			start: { date: entry.date },
			end: { date: entry.date },
		}

		try {
			await gapi.client.calendar.events.insert({
				calendarId: request.calendarId,
				resource: event,
			})
			result.created++
		} catch (err: unknown) {
			result.failed++
			const message = err instanceof Error ? err.message : String(err)
			result.errors.push(`${entry.workoutName} on ${entry.date}: ${message}`)
		}
	}

	return result
}

/**
 * Push workout events to a Google Calendar.
 *
 * Creates one all-day event per scheduled slot per week. Each event
 * title is the workout name, and the description contains a deep link.
 */
export async function pushEventsToCalendar(
	request: CalendarPushRequest,
): Promise<CalendarPushResult> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const result: CalendarPushResult = { created: 0, skipped: 0, failed: 0, errors: [] }

	// Compute the end date of the entire range for the existing-event query.
	const [sy, sm, sd] = request.startDate.split('-').map(Number)
	const rangeEnd = new Date(sy, sm - 1, sd + request.weeks * 7)
	const endDate = formatDateISO(rangeEnd)

	// Fetch existing events in the range to avoid duplicates.
	let existingKeys: Set<string>
	try {
		const existing = await listEventsInRange(request.calendarId, request.startDate, endDate)
		existingKeys = buildExistingEventKeys(existing)
	} catch {
		// If listing fails, proceed without dedup rather than blocking the push.
		existingKeys = new Set()
	}

	for (const slot of request.slots) {
		const dates = generateEventDates(request.startDate, slot.dayIndex, request.weeks)
		const deepLink = hasNoDeepLink(slot.workoutId) ? null : buildDeepLink(slot.workoutId)

		for (const date of dates) {
			// Skip if this workout already exists on this date.
			if (existingKeys.has(`${date}|${slot.workoutName}`)) {
				result.skipped++
				continue
			}

			const event: CalendarEventResource = {
				summary: slot.workoutName,
				description: deepLink ? `Open workout: ${deepLink}` : slot.workoutName,
				start: { date },
				end: { date },
			}

			try {
				await gapi.client.calendar.events.insert({
					calendarId: request.calendarId,
					resource: event,
				})
				result.created++
			} catch (err: unknown) {
				result.failed++
				const message = err instanceof Error ? err.message : String(err)
				result.errors.push(`${slot.workoutName} on ${date}: ${message}`)
			}
		}
	}

	return result
}

/* ------------------------------------------------------------------ */
/*  Two-way calendar sync                                              */
/* ------------------------------------------------------------------ */

/** Result of a two-way sync operation. */
export interface CalendarSyncResult {
	/** Events created in Google Calendar (new schedule entries pushed). */
	created: number
	/** Events updated in Google Calendar (date changed in sheet). */
	updated: number
	/** Events deleted from Google Calendar (removed from sheet). */
	deleted: number
	/** Schedule entries created from calendar events (pulled from Google). */
	pulledCreations: number
	/** Schedule entries updated from calendar changes (date moved in calendar). */
	pulledDateChanges: number
	/** Schedule entries removed because their calendar event was deleted. */
	pulledDeletions: number
	/** Errors encountered during sync. */
	errors: string[]
}

/** Resolves a workoutId to a human-readable name. Returns null for unknown IDs. */
export type WorkoutNameResolver = (workoutId: string) => string | null

/** Resolves a workout name back to a workoutId. Returns null for unknown names. */
export type WorkoutIdResolver = (name: string) => string | null

/**
 * Build a Map from calendar event ID → CalendarEventItem for fast lookup.
 */
function buildEventMap(events: CalendarEventItem[]): Map<string, CalendarEventItem> {
	const map = new Map<string, CalendarEventItem>()
	for (const e of events) {
		if (e.id) map.set(e.id, e)
	}
	return map
}

/**
 * Build a Map from strongerId → CalendarEventItem for events that have one.
 */
function buildStrongerIdToEventMap(events: CalendarEventItem[]): Map<string, CalendarEventItem> {
	const map = new Map<string, CalendarEventItem>()
	for (const e of events) {
		const sid = extractStrongerId(e.description)
		if (sid) map.set(sid, e)
	}
	return map
}

/**
 * Extract the event date (YYYY-MM-DD) from a calendar event.
 */
export function getEventDate(event: CalendarEventItem): string | undefined {
	return event.start?.date ?? event.start?.dateTime?.slice(0, 10)
}

/**
 * Perform a two-way sync between the workout schedule (sheet) and Google Calendar.
 *
 * Uses the Stronger ID (`strongerId`) as the primary matching key between
 * sheet rows and calendar events. The stronger ID is embedded in the
 * event description as `[stronger:<id>]`.
 *
 * Sync rules:
 * - Sheet rows with strongerId but no calendarEventId → push to calendar.
 * - Sheet rows with both strongerId and calendarEventId → reconcile
 *   (detect date moves, deletions in either direction).
 * - Calendar events with no strongerId → created in Google, pull to sheet.
 * - Blanked rows (calendarEventId but no workoutId) → delete from calendar.
 * - After sync, deduplicate by strongerId (one row per strongerId).
 */
export async function syncScheduleWithCalendar(
	calendarId: string,
	schedule: WorkoutScheduleEntry[],
	resolveWorkoutName: WorkoutNameResolver,
	resolveWorkoutId?: WorkoutIdResolver,
): Promise<{ updatedSchedule: WorkoutScheduleEntry[]; result: CalendarSyncResult }> {
	const gapi = window.gapi
	if (!gapi) throw new Error('gapi not loaded')

	const result: CalendarSyncResult = {
		created: 0,
		updated: 0,
		deleted: 0,
		pulledCreations: 0,
		pulledDateChanges: 0,
		pulledDeletions: 0,
		errors: [],
	}

	// --- Classify schedule entries ---
	// Syncable: has a real workoutId
	const syncable = schedule.filter((e) => e.workoutId)
	// Blanked: had a calendar event but workout was removed
	const blanked = schedule.filter((e) => !e.workoutId && e.calendarEventId)
	// Inactive: no workoutId, no calendarEventId (orphan/empty rows)
	const inactive = schedule.filter(
		(e) => !e.workoutId && !e.calendarEventId,
	)

	// Assign strongerIds to any syncable entries that don't have one yet
	const syncableWithIds = syncable.map((e) =>
		e.strongerId ? e : { ...e, strongerId: generateStrongerId() },
	)

	// Compute date range for the calendar query
	const allDates = [...syncableWithIds, ...blanked].map((e) => e.date).sort()
	if (allDates.length === 0) {
		return { updatedSchedule: schedule, result }
	}

	// Extend range: 30 days back to catch moved events, 90 days forward to
	// discover events planned further in advance (e.g., multi-month schedules).
	const firstDate = allDates[0]
	const lastDate = allDates[allDates.length - 1]
	const [fy, fm, fd] = firstDate.split('-').map(Number)
	const [ly, lm, ld] = lastDate.split('-').map(Number)
	const rangeStart = new Date(fy, fm - 1, fd - 30)
	const rangeEnd = new Date(ly, lm - 1, ld + 91)
	const startStr = formatDateISO(rangeStart)
	const endStr = formatDateISO(rangeEnd)

	// Fetch all calendar events in the range
	let calendarEvents: CalendarEventItem[]
	try {
		calendarEvents = await listEventsInRange(calendarId, startStr, endStr)
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		result.errors.push(`Failed to list calendar events: ${msg}`)
		return { updatedSchedule: schedule, result }
	}

	// Filter out cancelled events
	calendarEvents = calendarEvents.filter((e) => e.status !== 'cancelled')

	const eventMap = buildEventMap(calendarEvents)
	const strongerIdToEvent = buildStrongerIdToEventMap(calendarEvents)

	// Track which calendar event IDs we've accounted for (to detect orphans)
	const accountedEventIds = new Set<string>()

	// --- Phase 1: Delete calendar events for blanked entries ---
	const updatedBlanked: WorkoutScheduleEntry[] = []
	for (const entry of blanked) {
		if (entry.calendarEventId) {
			const calEvent = eventMap.get(entry.calendarEventId)
			if (calEvent) {
				try {
					await gapi.client.calendar.events.delete({
						calendarId,
						eventId: entry.calendarEventId,
					})
					result.deleted++
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err)
					result.errors.push(`Delete event ${entry.calendarEventId}: ${msg}`)
				}
			}
			if (entry.calendarEventId) accountedEventIds.add(entry.calendarEventId)
			// Clear calendar linkage since the event is gone
			updatedBlanked.push({ ...entry, calendarEventId: undefined, strongerId: undefined })
		} else {
			updatedBlanked.push(entry)
		}
	}

	// --- Phase 2: Reconcile syncable entries ---
	const updatedSyncable: WorkoutScheduleEntry[] = []

	for (const entry of syncableWithIds) {
		const sid = entry.strongerId!

		// Try to find the matching calendar event by strongerId first, then calendarEventId
		let calEvent: CalendarEventItem | undefined
		calEvent = strongerIdToEvent.get(sid)
		if (!calEvent && entry.calendarEventId) {
			calEvent = eventMap.get(entry.calendarEventId)
		}

		if (calEvent && calEvent.id) {
			accountedEventIds.add(calEvent.id)

			// A custom label always wins over the workout/activity name as the title.
			const name = resolveWorkoutName(entry.workoutId)
			const desiredTitle = entry.label?.trim() || name || calEvent.summary

			// Check if the date moved in Google Calendar
			const calDate = getEventDate(calEvent)
			const dateMoved = !!calDate && calDate !== entry.date
			const titleStale = !!desiredTitle && calEvent.summary !== desiredTitle

			if (titleStale) {
				const eventDate = calDate ?? entry.date
				try {
					await gapi.client.calendar.events.update({
						calendarId,
						eventId: calEvent.id,
						resource: {
							summary: desiredTitle,
							description: calEvent.description,
							start: { date: eventDate },
							end: { date: eventDate },
						},
					})
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err)
					result.errors.push(`Update title for event ${calEvent.id}: ${msg}`)
				}
			}

			if (dateMoved) {
				// Date was moved in Google Calendar → update the sheet entry
				updatedSyncable.push({
					...entry,
					date: calDate,
					calendarEventId: calEvent.id,
				})
				result.pulledDateChanges++
			} else {
				// Ensure calendarEventId is up to date
				updatedSyncable.push({
					...entry,
					calendarEventId: calEvent.id,
				})
			}
			if (titleStale) result.updated++
		} else if (entry.calendarEventId) {
			// Had a calendarEventId but event no longer exists → deleted from Google
			result.pulledDeletions++
			// Remove the entry (don't add to updatedSyncable)
			continue
		} else {
			// New entry — push to Google Calendar
			const name = resolveWorkoutName(entry.workoutId)
			if (!name) {
				// Unknown workout, keep the entry but skip pushing
				updatedSyncable.push(entry)
				continue
			}

			const title = entry.label?.trim() || name
			const description = buildEventDescription(entry.workoutId, name, sid)
			const event: CalendarEventResource = {
				summary: title,
				description,
				start: { date: entry.date },
				end: { date: entry.date },
			}

			try {
				const resp = await gapi.client.calendar.events.insert({
					calendarId,
					resource: event,
				})
				updatedSyncable.push({
					...entry,
					calendarEventId: resp.result.id,
				})
				accountedEventIds.add(resp.result.id)
				result.created++
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				result.errors.push(`Create event for ${name} on ${entry.date}: ${msg}`)
				updatedSyncable.push(entry)
			}
		}
	}

	// --- Phase 3: Pull new events created in Google Calendar ---
	// Events without a strongerId that we haven't accounted for
	if (resolveWorkoutId) {
		for (const calEvent of calendarEvents) {
			if (!calEvent.id || accountedEventIds.has(calEvent.id)) continue

			const sid = extractStrongerId(calEvent.description)
			if (sid) continue // Has a strongerId — already handled or belongs to another sheet

			const calDate = getEventDate(calEvent)
			const summary = calEvent.summary
			if (!calDate || !summary) continue

			// Try to resolve the event name to a workoutId
			const workoutId = resolveWorkoutId(summary)
			if (!workoutId) continue // Not a recognized workout name, skip

			// Check if we already have this workout on this date (dedup)
			const isDupe = updatedSyncable.some(
				(e) => e.date === calDate && e.workoutId === workoutId,
			)
			if (isDupe) continue

			// Create a new schedule entry and stamp the event with a strongerId
			const newSid = generateStrongerId()
			const newEntry: WorkoutScheduleEntry = {
				date: calDate,
				workoutId,
				calendarEventId: calEvent.id,
				strongerId: newSid,
			}

			// Update the Google Calendar event description to include the strongerId
			try {
				const updatedDescription = embedStrongerId(
					calEvent.description ?? summary,
					newSid,
				)
				await gapi.client.calendar.events.update({
					calendarId,
					eventId: calEvent.id,
					resource: {
						summary,
						description: updatedDescription,
						start: { date: calDate },
						end: { date: calDate },
					},
				})
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				result.errors.push(`Update event ${calEvent.id} with strongerId: ${msg}`)
			}

			updatedSyncable.push(newEntry)
			accountedEventIds.add(calEvent.id)
			result.pulledCreations++
		}
	}

	// --- Phase 4: Dedup the syncable entries ---
	// If the same strongerId appears multiple times, keep the first.
	// Entries without a strongerId are only deduped by date+workoutId.
	const seenStrongerIds = new Set<string>()
	const seenDateWorkoutKeys = new Set<string>()
	const dedupedSyncable: WorkoutScheduleEntry[] = []
	for (const entry of updatedSyncable) {
		if (entry.strongerId) {
			if (seenStrongerIds.has(entry.strongerId)) continue
			seenStrongerIds.add(entry.strongerId)
		}
		// Also dedup by date + workoutId (same workout on same date = keep first)
		const dateWorkoutKey = `${entry.date}|${entry.workoutId}`
		if (seenDateWorkoutKeys.has(dateWorkoutKey)) continue
		seenDateWorkoutKeys.add(dateWorkoutKey)
		dedupedSyncable.push(entry)
	}

	// Reassemble: inactive + blanked + synced
	const updatedSchedule = [...inactive, ...updatedBlanked, ...dedupedSyncable]

	return { updatedSchedule, result }
}