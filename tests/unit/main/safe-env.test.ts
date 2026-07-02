import { describe, expect, it } from 'vitest'
import { isSensitiveEnvKey, safeChildEnv } from '@main/safe-env'

describe('main/safe-env', () => {
  describe('isSensitiveEnvKey', () => {
    it('blocks well-known provider and token keys', () => {
      for (const key of [
        'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY',
        'AWS_SECRET_ACCESS_KEY',
        'AWS_ACCESS_KEY_ID',
        'GH_TOKEN',
        'GITHUB_TOKEN',
        'NPM_TOKEN',
        'HF_TOKEN',
        'DEEPSEEK_API_KEY',
        'GOOGLE_KEY',
        'AZURE_CLIENT_SECRET',
        'GCP_SERVICE_KEY'
      ]) {
        expect(isSensitiveEnvKey(key), key).toBe(true)
      }
    })

    it('blocks newly-added patterns (regression coverage)', () => {
      for (const key of [
        'SLACK_WEBHOOK',
        'DISCORD_WEBHOOK',
        'DATABASE_URL',
        'DB_URL',
        'MONGO_URI',
        'PGPASSWORD',
        'MYSQL_PWD',
        'ENCRYPTION_KEY',
        'DB_PASS',
        'ADMIN_PASS',
        'MY_PASSPHRASE'
      ]) {
        expect(isSensitiveEnvKey(key), key).toBe(true)
      }
    })

    it('allows safe common variables', () => {
      for (const key of [
        'PATH',
        'HOME',
        'SHELL',
        'LANG',
        'TERM',
        'NODE_ENV',
        'PORT',
        'HOST',
        'DEBUG',
        'LOG_LEVEL',
        'TZ',
        'EDITOR'
      ]) {
        expect(isSensitiveEnvKey(key), key).toBe(false)
      }
    })
  })

  describe('safeChildEnv', () => {
    it('strips sensitive keys from source', () => {
      const env = safeChildEnv(undefined, {
        PATH: '/usr/bin',
        OPENAI_API_KEY: 'sk-secret',
        AWS_SECRET_ACCESS_KEY: 'supersecret',
        NODE_ENV: 'production'
      })
      expect(env).not.toHaveProperty('OPENAI_API_KEY')
      expect(env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
      expect(env.PATH).toBe('/usr/bin')
      expect(env.NODE_ENV).toBe('production')
    })

    it('strips sensitive keys from overrides — overrides cannot bypass the filter', () => {
      const env = safeChildEnv(
        { OPENAI_API_KEY: 'bypass-attempt', SLACK_WEBHOOK: 'https://hooks.slack.com/secret' },
        { PATH: '/usr/bin' }
      )
      expect(env).not.toHaveProperty('OPENAI_API_KEY')
      expect(env).not.toHaveProperty('SLACK_WEBHOOK')
      expect(env.PATH).toBe('/usr/bin')
    })

    it('allows safe overrides through', () => {
      const env = safeChildEnv({ PORT: '3000', LOG_LEVEL: 'debug' }, { PATH: '/usr/bin' })
      expect(env.PORT).toBe('3000')
      expect(env.LOG_LEVEL).toBe('debug')
    })

    it('overrides can update safe keys that are already in source', () => {
      const env = safeChildEnv({ NODE_ENV: 'test' }, { NODE_ENV: 'production', PATH: '/usr/bin' })
      expect(env.NODE_ENV).toBe('test')
    })

    it('works with no overrides', () => {
      const env = safeChildEnv(undefined, { PATH: '/bin', SECRET_KEY: 'x' })
      expect(env.PATH).toBe('/bin')
      expect(env).not.toHaveProperty('SECRET_KEY')
    })
  })
})
