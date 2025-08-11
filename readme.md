[![NPM Version](https://img.shields.io/npm/v/use-sui-passkey)](https://www.npmjs.com/package/use-sui-passkey)
# use-sui-passkey

`use-sui-passkey` is a lightweight React hook that simplifies integrating [Sui](https://sui.io) Passkey authentication. It exposes helper functions for creating or recovering a passkey, signing messages or transactions and tracks basic state like loading or error information.

[![welcome](https://raw.githubusercontent.com/denyskozak/use-sui-passkey/refs/heads/main/welcome.png)](https://www.npmjs.com/package/use-sui-passkey)


## Installation

```bash
npm install use-sui-passkey
# or
yarn add use-sui-passkey
```

## Quick start
#### Look at `/example` for more

```tsx
import { useSuiPasskey } from 'use-sui-passkey';

export default function App() {
  const {
    supported,
    address,
    create,
    recoverTwoStep,
    clear,
    loading,
    error,
  } = useSuiPasskey({ rpName: 'My Dapp' });

  if (!supported) return <div>Passkeys unsupported</div>;

  return (
    <div>
      <button onClick={() => create()} disabled={loading}>Create passkey</button>
      <button onClick={() => recoverTwoStep()} disabled={loading}>Sign in</button>
      {address && <p>Signed in as {address}</p>}
      {error && <p>{String(error)}</p>}
      {address && <button onClick={clear}>Logout</button>}
    </div>
  );
}
```

## API

### `useSuiPasskey(options: UseSuiPasskeyOptions)`

**Options**

- `rpName: string` – human readable name displayed by the passkey provider.
- `rpId?: string` – relying party ID. Defaults to the current hostname.
- `authenticatorAttachment?: 'platform' | 'cross-platform'` – optional hint for UI.
- `storage?: Storage` – custom persistence. Defaults to `localStorage` in the browser.
- `storageKey?: string` – key used for persistence. Defaults to an internal value.
- `autoLoad?: boolean` – rehydrate keypair from storage on mount. Defaults to `true`.

**Returns**

- `supported: boolean` – whether WebAuthn is available in the environment.
- `initialised: boolean` – whether the underlying provider has been created.
- `loading: boolean` – indicates whether an operation is in progress.
- `error: unknown | null` – last error, if any.
- `address: string | null` – Sui address once authenticated.
- `keypair: PasskeyKeypair | null` – current keypair instance.
- `create(): Promise<{ keypair: PasskeyKeypair; address: string }>` – register a new passkey and cache its public key.
- `recoverTwoStep(m1?: Uint8Array | string, m2?: Uint8Array | string): Promise<{ keypair: PasskeyKeypair; address: string }>` – recover an existing passkey using two signed messages.
- `signPersonalMessage(message: Uint8Array | string): Promise<{ signature: string }>` – sign an arbitrary message.
- `signTransaction(txBytes: Uint8Array): Promise<{ signature: string }>` – sign a transaction block.
- `clear(): void` – remove cached public key and reset the hook state.

## License

[MIT](https://opensource.org/licenses/MIT)

