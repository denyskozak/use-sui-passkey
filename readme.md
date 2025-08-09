[![NPM Version](https://img.shields.io/npm/v/use-sui-passkey)](https://www.npmjs.com/package/use-sui-passkey)
# use-sui-passkey

`use-sui-passkey` is a lightweight React hook that simplifies integrating [Sui](https://sui.io) Passkey authentication. It exposes helper functions for registering and signing in with a Passkey and tracks basic state like loading or error information.

[![welcome](https://raw.githubusercontent.com/denyskozak/use-sui-passkey/refs/heads/main/welcome.png)](https://www.npmjs.com/package/use-sui-passkey)


## Installation

```bash
npm install use-sui-passkey
# or
yarn add use-sui-passkey
```

## Quick start
#### Look /example for more

```tsx
import { useSuiPasskey } from 'use-sui-passkey';

export default function App() {
  const { register, signIn, address, error, isLoading, logout } = useSuiPasskey();

  return (
    <div>
      <button onClick={register} disabled={isLoading}>Create passkey</button>
      <button onClick={signIn} disabled={isLoading}>Sign in</button>
      {address && <p>Signed in as {address}</p>}
      {error && <p>{error.message}</p>}
      {address && <button onClick={logout}>Logout</button>}
    </div>
  );
}
```

## API

The `useSuiPasskey` hook returns:

- `register(): Promise<void>` – register a new passkey for the current user.
- `signIn(): Promise<void>` – authenticate using an existing passkey.
- `address: string | null` – Sui address once authenticated.
- `error: Error | null` – last error, if any.
- `isLoading: boolean` – indicates whether an operation is in progress.
- `logout(): void` – clear local session information.

## License

[MIT](https://opensource.org/licenses/MIT)

