export class OperationTimeoutError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'OperationTimeoutError'
	}
}

export function withTimeout<T>(
	operation: Promise<T>,
	timeoutMs: number,
	message: string,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout>
	const timeout = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => reject(new OperationTimeoutError(message)), timeoutMs)
	})
	return Promise.race([operation, timeout]).finally(() => clearTimeout(timeoutId))
}
