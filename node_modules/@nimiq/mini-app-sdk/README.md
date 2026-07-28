# Nimiq Mini App SDK

TypeScript helpers for Nimiq Mini Apps.

This package is intentionally small:

- `init()` waits for the host app to inject `window.nimiq`
- global typings make `window.nimiq` available in TypeScript
- provider types are re-exported for app-side DX

## Install

```bash
npm install @nimiq/mini-app-sdk
```

## Usage

If your Mini App wants to wait until the host app injects the provider, use `init()`:

```ts
import { init } from '@nimiq/mini-app-sdk'

const nimiq = await init()
const accounts = await nimiq.listAccounts()
```

After that import, `window.nimiq` is typed as `NimiqProvider`.

## Configuration

```ts
import { init, type InitOptions } from '@nimiq/mini-app-sdk'

const options: InitOptions = {
  timeout: 10_000,
}

const nimiq = await init(options)
```

## Provider Access

The injected provider is available in both places:

- `const nimiq = await init()`
- `window.nimiq`

Both are typed as `NimiqProvider`.

## Host context (user language)

Nimiq Pay seeds the user's selected language into every Mini App before the
page script runs. Read it via `getHostLanguage()` (typed helper) or directly
from `window.nimiqPay.language`. Use it to match the host locale so users
don't hit English-only UI when they've chosen another language in Nimiq Pay.

```ts
import { getHostLanguage } from '@nimiq/mini-app-sdk'

// ISO 639-1 code, e.g. 'en' | 'de' | 'es' | 'fr' | 'pt'
const locale = getHostLanguage() ?? navigator.language.split('-')[0] ?? 'en'
```

The value is static for the lifetime of a Mini App session; when the host
language changes, the Mini App picks it up the next time it's opened. Always
fall back to `navigator.language` for Mini Apps that can also run outside
Nimiq Pay (standalone browser dev, etc.).

## Device identifier

For features that need a stable per-device handle (leaderboards, anti-spam,
save slots) request a pseudonymous device identifier. The first call per
origin prompts the user with the `reason` you provide; later calls resolve
silently.

```ts
import { requestDeviceIdentifier } from '@nimiq/mini-app-sdk'

try {
  const id = await requestDeviceIdentifier({ reason: 'Leaderboard ranking' })
  // 64-char hex SHA-256, stable for this Mini App on this device
} catch (err) {
  // user denied, reason was empty, or not running inside Nimiq Pay
}
```

The identifier is derived from a host-side device ID hashed with the Mini
App's origin, so it cannot be correlated across Mini Apps. It is stable
across Nimiq Pay reinstalls and across different user accounts on the same
device — it identifies the device, not the user. Do not use it as a user
identity for authentication; use it for device-scoped state.
