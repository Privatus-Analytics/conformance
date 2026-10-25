import { BASE_URL, MOCK_URL } from './support'

// Waits until the example app and the mock collector answer, so a slow app
// boot is not reported as a failing test.
async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' })
      if (response.status < 500) return
      last = `HTTP ${response.status}`
    } catch (error) {
      last = String((error as Error).cause ?? error)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000}s (last: ${last})`)
}

export default async function globalSetup(): Promise<void> {
  const timeout = Number(process.env.WAIT_SECONDS || 180) * 1000
  await waitFor(`${MOCK_URL}/__health`, timeout)
  await waitFor(`${BASE_URL}/`, timeout)
}
