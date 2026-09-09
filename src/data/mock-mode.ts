export function isMockMode(search = window.location.search): boolean {
	const value = new URLSearchParams(search).get('mock')
	return value === '1' || value === 'true'
}
