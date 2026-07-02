/**
 * Environment variable filtering for child processes (shell, hooks, runners).
 *
 * Strategy: deny-list with conservative additions. Secrets that pass this
 * filter are forwarded to hook executors that may run untrusted plugin code,
 * so the list intentionally casts a wide net.
 *
 * Known gaps in any deny-list: custom org-specific secret names (e.g.
 * MY_CORP_VAULT_TOKEN) will still leak. A future hardening step should move
 * hooks to an allow-list (PATH/HOME/SHELL/LANG/TERM only).
 */
const SENSITIVE_ENV_KEY_RE =
  /(API[_-]?KEY|ACCESS[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|PRIVATE[_-]?KEY|SESSION|AUTH|BEARER|CLIENT[_-]?SECRET|SIGNING|OPENAI|ANTHROPIC|GEMINI|GOOGLE[_-]?KEY|DEEPSEEK|HUGGINGFACE|HF[_-]?TOKEN|NPM[_-]?TOKEN|GH[_-]?TOKEN|GITHUB[_-]?TOKEN|AWS[_-]?|GCP[_-]?|AZURE[_-]?|WEBHOOK|ENCRYPT|DATABASE_URL|DB_URL|MONGO_URI|PGPASSWORD|MYSQL_PWD|_PASS$)/i

export function isSensitiveEnvKey(key: string): boolean {
  return SENSITIVE_ENV_KEY_RE.test(key)
}

export function safeChildEnv(
  overrides?: Record<string, string>,
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const safe: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (isSensitiveEnvKey(key)) continue
    safe[key] = value
  }
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      // Overrides must pass the same filter as the source environment.
      // Without this guard a hook-provided env could re-introduce a secret
      // that was stripped from process.env (e.g. by naming it differently).
      if (isSensitiveEnvKey(key)) continue
      if (process.platform === 'win32') {
        const existingKey = Object.keys(safe).find(
          (existing) => existing.toLowerCase() === key.toLowerCase()
        )
        if (existingKey && existingKey !== key) delete safe[existingKey]
      }
      safe[key] = value
    }
  }
  return safe
}
