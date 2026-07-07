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
