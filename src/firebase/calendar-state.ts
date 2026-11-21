import { mergeDateWindowEntries, type DateWindow } from './store.ts'

/** Retain edits made after a calendar read began, including deleted dates. */
export class CalendarDateState<T extends { date: string }> {
	private entries: T[]
	private editedDates = new Map<string, number>()
	private pendingDates = new Set<string>()
	version = 0

	constructor(entries: T[] = []) {
		this.entries = entries
	}

	load(loaded: T[], window: DateWindow | undefined, readVersion: number): T[] {
		const protectedDates = new Set([...this.pendingDates, ...[...this.editedDates]
			.filter(([, version]) => version > readVersion)
			.map(([date]) => date)])
		const edits = this.currentEdits(protectedDates)
		this.entries = mergeDateWindowEntries(this.entries, loaded, window)
			.filter((entry) => !protectedDates.has(entry.date))
			.concat(edits)
			.sort((left, right) => left.date.localeCompare(right.date))
		return this.entries
	}

	mutationBase(cached: T[] | undefined, window?: DateWindow): T[] {
		if (!cached) return this.entries.filter((entry) =>
			!window || (entry.date >= window.startDate && entry.date < window.endDate))
		const dates = new Set([...this.editedDates.keys()].filter((date) =>
			!window || (date >= window.startDate && date < window.endDate)))
		return cached.filter((entry) => !dates.has(entry.date)).concat(this.currentEdits(dates))
	}

	update(entries: T[], window?: DateWindow, dates?: Iterable<string>, pending = false): T[] {
		this.version += 1
		for (const date of dates ?? new Set([...this.entries, ...entries]
			.filter((entry) => !window || (entry.date >= window.startDate && entry.date < window.endDate))
			.map((entry) => entry.date))) {
			this.editedDates.set(date, this.version)
			if (pending) this.pendingDates.add(date)
		}
		this.entries = mergeDateWindowEntries(this.entries, entries, window)
		return this.entries
	}

	finishMutation(dates: Iterable<string>): void {
		this.version += 1
		for (const date of dates) {
			this.pendingDates.delete(date)
			this.editedDates.set(date, this.version)
		}
	}

	private currentEdits(dates: Set<string>): T[] {
		return this.entries.filter((entry) => dates.has(entry.date))
	}
}
