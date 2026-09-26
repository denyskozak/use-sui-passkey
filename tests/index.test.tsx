import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const suiMocks = vi.hoisted(() => ({
    constructKeypair: vi.fn(),
    createKeypair: vi.fn(),
    createProvider: vi.fn(),
    recoverPublicKeys: vi.fn(),
}));

vi.mock('@mysten/sui/keypairs/passkey', () => ({
    BrowserPasskeyProvider: class BrowserPasskeyProvider {
        constructor(rpName: string, options: unknown) {
            return suiMocks.createProvider(rpName, options);
        }
    },
    PasskeyKeypair: class PasskeyKeypair {
        static getPasskeyInstance = suiMocks.createKeypair;
        static signAndRecover = suiMocks.recoverPublicKeys;

        constructor(bytes: Uint8Array, provider: unknown) {
            return suiMocks.constructKeypair(bytes, provider);
        }
    },
}));

import {hasWebAuthn, isBrowser, makeUseSuiPasskey, toBytes, useSuiPasskey} from '../src/index';

type MemoryStorage = Storage & {snapshot: () => Record<string, string>};

function createStorage(initial: Record<string, string> = {}): MemoryStorage {
    const values = new Map(Object.entries(initial));
    return {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => void values.delete(key),
        setItem: (key, value) => void values.set(key, value),
        snapshot: () => Object.fromEntries(values),
    };
}

function publicKey(bytes: number[], address: string) {
    return {
        toRawBytes: () => Uint8Array.from(bytes),
        toSuiAddress: () => address,
    };
}

function keypair(key = publicKey([1, 2, 3], '0x123')) {
    return {
        getPublicKey: () => key,
        signPersonalMessage: vi.fn().mockResolvedValue({signature: 'personal-signature'}),
        signTransaction: vi.fn().mockResolvedValue({signature: 'transaction-signature'}),
    };
}

function setWebAuthnSupported(supported: boolean) {
    if (supported) {
        Object.defineProperty(window, 'PublicKeyCredential', {
            configurable: true,
            value: class PublicKeyCredential {},
        });
    } else {
        Reflect.deleteProperty(window, 'PublicKeyCredential');
    }
}

describe('environment and byte helpers', () => {
    it('detects browser and WebAuthn support', () => {
        setWebAuthnSupported(true);
        expect(isBrowser()).toBe(true);
        expect(hasWebAuthn()).toBe(true);

        setWebAuthnSupported(false);
        expect(hasWebAuthn()).toBe(false);
    });

    it('encodes strings and preserves Uint8Array values', () => {
        const bytes = Uint8Array.from([7, 8]);
        expect(toBytes(bytes)).toBe(bytes);
        expect([...toBytes('Sui')]).toEqual([83, 117, 105]);
    });
});

describe('useSuiPasskey', () => {
    const provider = {kind: 'provider'};

    beforeEach(() => {
        vi.unstubAllGlobals();
        setWebAuthnSupported(true);
        suiMocks.createProvider.mockReturnValue(provider);
        suiMocks.constructKeypair.mockReset();
        suiMocks.createKeypair.mockReset();
        suiMocks.recoverPublicKeys.mockReset();
    });

    it('reports unsupported environments and rejects provider operations', async () => {
        setWebAuthnSupported(false);
        const {result} = renderHook(() => useSuiPasskey({rpName: 'Test app'}));

        expect(result.current.supported).toBe(false);
        expect(result.current.initialised).toBe(false);
        await expect(result.current.create()).rejects.toThrow('Passkey not available');
        await expect(result.current.recoverTwoStep()).rejects.toThrow('Passkey not available');
        await expect(result.current.signPersonalMessage('hello')).rejects.toThrow('No passkey keypair');
    });

    it('creates a provider, registers a keypair and persists its public key', async () => {
        const storage = createStorage();
        const created = keypair();
        suiMocks.createKeypair.mockResolvedValue(created);

        const {result} = renderHook(() => useSuiPasskey({
            rpName: 'Test app',
            rpId: 'wallet.example',
            authenticatorAttachment: 'platform',
            storage,
        }));

        expect(suiMocks.createProvider).toHaveBeenCalledWith('Test app', {
            rpName: 'Test app',
            rpId: 'wallet.example',
            authenticatorSelection: {authenticatorAttachment: 'platform'},
        });
        expect(result.current.initialised).toBe(true);

        await act(async () => {
            await expect(result.current.create()).resolves.toEqual({keypair: created, address: '0x123'});
        });

        expect(result.current.address).toBe('0x123');
        expect(result.current.keypair).toBe(created);
        expect(storage.snapshot()).toEqual({'sui:passkey:pubkey': 'AQID'});
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeNull();
    });

    it('records create errors and always clears loading', async () => {
        const failure = new Error('registration cancelled');
        suiMocks.createKeypair.mockRejectedValue(failure);
        const {result} = renderHook(() => useSuiPasskey({rpName: 'Test app'}));

        await act(async () => {
            await expect(result.current.create()).rejects.toBe(failure);
        });

        expect(result.current.error).toBe(failure);
        expect(result.current.loading).toBe(false);
    });

    it('recovers the public key common to both signature results', async () => {
        const firstOnly = publicKey([1], '0x1');
        const commonA = publicKey([9, 9], '0x9');
        const commonB = publicKey([9, 9], '0x9');
        const secondOnly = publicKey([2], '0x2');
        const recovered = keypair(commonB);
        suiMocks.recoverPublicKeys
            .mockResolvedValueOnce([firstOnly, commonA])
            .mockResolvedValueOnce([secondOnly, commonB]);
        suiMocks.constructKeypair.mockReturnValue(recovered);

        const {result} = renderHook(() => useSuiPasskey({rpName: 'Test app', storage: createStorage()}));
        await act(async () => {
            await expect(result.current.recoverTwoStep('one', Uint8Array.from([2])))
                .resolves.toEqual({keypair: recovered, address: '0x9'});
        });

        expect(suiMocks.recoverPublicKeys).toHaveBeenNthCalledWith(1, provider, toBytes('one'));
        expect(suiMocks.recoverPublicKeys).toHaveBeenNthCalledWith(2, provider, Uint8Array.from([2]));
        expect(suiMocks.constructKeypair).toHaveBeenCalledWith(Uint8Array.from([9, 9]), provider);
    });

    it('rejects recovery when signature candidates have no common key', async () => {
        suiMocks.recoverPublicKeys
            .mockResolvedValueOnce([publicKey([1], '0x1')])
            .mockResolvedValueOnce([publicKey([2], '0x2')]);
        const {result} = renderHook(() => useSuiPasskey({rpName: 'Test app'}));

        await act(async () => {
            await expect(result.current.recoverTwoStep()).rejects.toThrow('Could not determine');
        });
        expect(result.current.error).toBeInstanceOf(Error);
    });

    it('rehydrates, signs and clears a cached keypair', async () => {
        const storage = createStorage({'custom-key': 'AQID'});
        const restored = keypair();
        suiMocks.constructKeypair.mockReturnValue(restored);

        const useConfiguredPasskey = makeUseSuiPasskey({
            rpName: 'Configured app',
            storage,
            storageKey: 'custom-key',
        });
        const {result} = renderHook(() => useConfiguredPasskey());

        await waitFor(() => expect(result.current.address).toBe('0x123'));
        await expect(result.current.signPersonalMessage('hello')).resolves.toEqual({signature: 'personal-signature'});
        await expect(result.current.signTransaction(Uint8Array.from([4]))).resolves.toEqual({signature: 'transaction-signature'});
        expect(restored.signPersonalMessage).toHaveBeenCalledWith(toBytes('hello'));

        act(() => result.current.clear());
        expect(result.current.address).toBeNull();
        expect(result.current.keypair).toBeNull();
        expect(storage.snapshot()).toEqual({});
    });

    it('does not read storage when autoLoad is disabled', () => {
        const storage = createStorage({'sui:passkey:pubkey': 'AQID'});
        renderHook(() => useSuiPasskey({rpName: 'Test app', storage, autoLoad: false}));
        expect(suiMocks.constructKeypair).not.toHaveBeenCalled();
    });
});
