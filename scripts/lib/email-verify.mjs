// MillionVerifier wrapper. Throws loudly on any provider error — never maps
// to "unknown" silently (Prospeo's deprecated /email-verifier silently mapped
// every call to "unknown" and poisoned ~100 rows in Apr 2026 — never again).
//
// Public:
//   verifyEmail(email, apiKey) → { status, raw }
//   shouldSkip(currentStatus, verifiedAt) → boolean
//
// Status mapping (MV result values per API v3 docs):
//   result === "ok"          → "valid"
//   result === "invalid"     → "invalid"  (mailbox doesn't exist)
//   result === "disposable"  → "invalid"  (temp address — treat as unusable)
//   result === "catch_all"   → "catch_all"
//   subresult === "catchall" → "catch_all"  (some responses set only subresult)
//   result === "unknown"     → "risky"
//   result === "error"       → throws  (transient API/SMTP failure — halt run)
//   anything else            → throws
//
// Freshness cache: skip if valid <90d, invalid <30d, risky <7d.
// catch_all and unknown always re-verify.

const MV_ENDPOINT = 'https://api.millionverifier.com/api/v3/'

export async function verifyEmail(email, apiKey) {
  if (!email) throw new Error('verifyEmail: email is required')
  if (!apiKey) throw new Error('verifyEmail: MILLIONVERIFIER_API_KEY is required')

  const url = `${MV_ENDPOINT}?api=${apiKey}&email=${encodeURIComponent(email)}`
  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(`MV HTTP ${res.status}: ${await res.text().catch(() => '')}`)
  }

  let data
  try {
    data = await res.json()
  } catch (e) {
    throw new Error(`MV JSON parse failed: ${e.message}`)
  }

  // MV responds with non-empty `error` field on quota/auth/credit problems.
  // Treat as fatal — halts the run rather than burning credits blind.
  if (data.error && String(data.error).trim() !== '') {
    throw new Error(`MV provider error for ${email}: ${data.error}`)
  }

  const result = data.result
  const subresult = data.subresult

  let status
  if (subresult === 'catchall' || result === 'catch_all') {
    status = 'catch_all'
  } else if (result === 'ok') {
    status = 'valid'
  } else if (result === 'invalid' || result === 'disposable') {
    status = 'invalid'
  } else if (result === 'unknown') {
    status = 'risky'
  } else if (result === 'error') {
    throw new Error(`MV transient error for ${email}: subresult=${subresult} — halt and retry later`)
  } else {
    throw new Error(`MV unrecognized result for ${email}: result=${result} subresult=${subresult}`)
  }

  return { status, raw: data }
}

export function shouldSkip(currentStatus, verifiedAt) {
  if (!verifiedAt || !currentStatus) return false
  const ageDays = (Date.now() - new Date(verifiedAt).getTime()) / 86400000
  if (currentStatus === 'valid' && ageDays < 90) return true
  if (currentStatus === 'invalid' && ageDays < 30) return true
  if (currentStatus === 'risky' && ageDays < 7) return true
  return false
}
