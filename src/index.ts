import {useCallback, useEffect, useMemo, useState} from 'react';
import type {DependencyList} from 'react';
import {
    BrowserPasskeyProvider,
    PasskeyKeypair,
} from '@mysten/sui/keypairs/passkey';
import {fromBase64, toBase64} from '@mysten/sui/utils';
import type {PublicKey} from "@mysten/sui/cryptography";

/**
 * Minimal, SSR-safe React hook around Sui Passkey.
 *
 * Features:
 * - Create (register) a new passkey wallet for the current origin
 * - Recover an existing passkey wallet (two-message flow recommended by docs)
 * - Sign personal messages & transactions
 * - Cache public key in storage and rehydrate on load (public key is not returned during sign)
 * - Graceful checks for browser/WebAuthn support
 *
 * This hook deliberately avoids storing any private material; only the public key bytes are persisted.
 */

const DEFAULT_STORAGE_KEY = 'sui:passkey:pubkey';

export type AuthenticatorAttachment = 'platform' | 'cross-platform';

export type UseSuiPasskeyOptions = {
    rpName: string; // Human-readable name shown by passkey provider
    rpId?: string; // Defaults to window.location.hostname
    authenticatorAttachment?: AuthenticatorAttachment; // Optional hint to steer UI
    storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; // Defaults to localStorage
    storageKey?: string; // Defaults to DEFAULT_STORAGE_KEY
    autoLoad?: boolean; // If true, tries to rehydrate from storage on mount
};

export type Address = string;

export type SignResult = {
    signature: string; // Base64 signature as returned by Sui SDK
};

export type UseSuiPasskey = {
    supported: boolean; // WebAuthn available in this environment
    initialised: boolean; // Provider constructed (in browser)
    loading: boolean;
    error: unknown | null ;
    address: Address | null;
    keypair: PasskeyKeypair | null;
    create: () => Promise<{ keypair: PasskeyKeypair; address: Address }>; // Register & cache
    recoverTwoStep: (m1?: Uint8Array | string, m2?: Uint8Array | string) => Promise<{
        keypair: PasskeyKeypair;
        address: Address
    }>; // Recover & cache
    signPersonalMessage: (message: Uint8Array | string) => Promise<SignResult>;
    signTransaction: (txBytes: Uint8Array) => Promise<SignResult>;
    clear: () => void; // Removes cached public key & resets state
};

export    type ProviderOptions = {
    rpName: string;
    rpId: string;
    authenticatorSelection?: { authenticatorAttachment: AuthenticatorAttachment }
};

export const isBrowser = () => typeof window !== 'undefined';
export const hasWebAuthn = () => isBrowser() && 'PublicKeyCredential' in window;

export function toBytes(input: Uint8Array | string): Uint8Array {
    if (input instanceof Uint8Array) return input;
    return new TextEncoder().encode(input);
}

export function depsSafe<T extends unknown[]>(value: T): DependencyList {
    // Prevent dependency churn on Storage-like objects by stringifying only primitives we depend on
    return value as unknown as DependencyList;
}

function findCommonPublicKey(a: PublicKey[], b: PublicKey[]) {
    // Compare by raw bytes base64 to avoid subtle object identity differences
    const aSet = new Set(a.map((pk) => toBase64(pk.toRawBytes())));
    const match = b.find((pk) => aSet.has(toBase64(pk.toRawBytes())));
    return match ?? null;
}

export function useSuiPasskey(options: UseSuiPasskeyOptions): UseSuiPasskey {
    const {
        rpName,
        rpId,
        authenticatorAttachment,
        storage = isBrowser() ? window.localStorage : undefined,
        storageKey = DEFAULT_STORAGE_KEY,
        autoLoad = true,
    } = options;

    const supported = hasWebAuthn();

    // Provider instance lives for the lifetime of the hook
    const provider = useMemo(() => {
        if (!supported) return null;
        const effectiveRpId = rpId ?? (isBrowser() ? window.location.hostname : '');

        const providerOptions: ProviderOptions = {
            rpName,
            rpId: effectiveRpId,
        };
        if (authenticatorAttachment) {
            providerOptions.authenticatorSelection = {authenticatorAttachment};
        }
        try {
            return new BrowserPasskeyProvider(rpName, providerOptions);
        } catch (e) {
            // Some non-browser or weird environments might still throw
            return null;
        }
    }, depsSafe([supported, rpName, rpId, authenticatorAttachment]));

    const [keypair, setKeypair] = useState<PasskeyKeypair | null>(null);
    const [address, setAddress] = useState<Address | null>(null);
    const [error, setError] = useState<unknown | null>(null);
    const [loading, setLoading] = useState(false);

    // Rehydrate from storage on mount
    useEffect(() => {
        if (!provider || !storage || !autoLoad) return;
        try {
            const b64 = storage.getItem(storageKey!);
            if (b64) {
                const bytes = fromBase64(b64);
                const kp = new PasskeyKeypair(bytes, provider);
                setKeypair(kp);
                setAddress(kp.getPublicKey().toSuiAddress());
            }
        } catch (e) {
            console.warn('[react-sui-passkey] Failed to rehydrate:', e);
        }
    }, [provider, storage, storageKey, autoLoad]);

    const persist = useCallback(
        (kp: PasskeyKeypair) => {
            if (!storage) return;
            try {
                const b64 = toBase64(kp.getPublicKey().toRawBytes());
                storage.setItem(storageKey!, b64);
            } catch (e) {
                console.warn('[react-sui-passkey] Failed to persist public key:', e);
            }
        },
        [storage, storageKey],
    );

    const create = useCallback(async () => {
        if (!provider) throw new Error('Passkey not available in this environment.');
        setLoading(true);
        setError(null);
        try {
            const kp = await PasskeyKeypair.getPasskeyInstance(provider);
            const addr = kp.getPublicKey().toSuiAddress();
            setKeypair(kp);
            setAddress(addr);
            persist(kp);
            return {keypair: kp, address: addr};
        } catch (e: unknown) {
            setError(e);
            throw e;
        } finally {
            setLoading(false);
        }
    }, [persist, provider]);

    const recoverTwoStep = useCallback(
        async (m1: Uint8Array | string = 'Hello world!', m2: Uint8Array | string = 'Hello world 2!') => {
            if (!provider) throw new Error('Passkey not available in this environment.');
            setLoading(true);
            setError(null);
            try {
                const possible1: PublicKey[] = await PasskeyKeypair.signAndRecover(provider, toBytes(m1));
                const possible2: PublicKey[] = await PasskeyKeypair.signAndRecover(provider, toBytes(m2));
                const common = findCommonPublicKey(possible1, possible2);
                if (!common) throw new Error('Could not determine a unique public key from signatures.');
                const kp = new PasskeyKeypair(common.toRawBytes(), provider);
                const addr = kp.getPublicKey().toSuiAddress();
                setKeypair(kp);
                setAddress(addr);
                persist(kp);
                return {keypair: kp, address: addr};
            } catch (e: unknown) {
                setError(e);
                throw e;
            } finally {
                setLoading(false);
            }
        },
        [persist, provider],
    );

    const signPersonalMessage = useCallback(
        async (message: Uint8Array | string) => {
            if (!keypair) throw new Error('No passkey keypair. Call create() or recoverTwoStep() first.');
            const signature = (await keypair.signPersonalMessage(toBytes(message))).signature;
            return {signature};
        },
        [keypair],
    );

    const signTransaction = useCallback(
        async (txBytes: Uint8Array) => {
            if (!keypair) throw new Error('No passkey keypair. Call create() or recoverTwoStep() first.');
            const {signature} = await keypair.signTransaction(txBytes);
            return {signature};
        },
        [keypair],
    );

    const clear = useCallback(() => {
        try {
            storage?.removeItem(storageKey!);
        } catch {
        }
        setKeypair(null);
        setAddress(null);
        setError(null);
    }, [storage, storageKey]);

    return {
        supported,
        initialised: !!provider,
        loading,
        error,
        address,
        keypair,
        create,
        recoverTwoStep,
        signPersonalMessage,
        signTransaction,
        clear,
    };
}

/**
 * Optional tiny helper: creates a preconfigured hook you can export from your app/library
 * so consumers don't have to pass rpName every time.
 */
export function makeUseSuiPasskey(defaults: UseSuiPasskeyOptions) {
    return function useDefaultedSuiPasskey(overrides?: Partial<UseSuiPasskeyOptions>) {
        return useSuiPasskey({...defaults, ...(overrides ?? {})});
    };
}
