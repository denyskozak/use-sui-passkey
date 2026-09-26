import {useSuiPasskey} from 'use-sui-passkey';
import {Transaction} from "@mysten/sui/transactions";
import {getFaucetHost, requestSuiFromFaucetV2} from "@mysten/sui/faucet";
import {useEffect, useState} from "react";
import {SuiGrpcClient} from "@mysten/sui/grpc";

const suiClient = new SuiGrpcClient({
    baseUrl: "https://fullnode.devnet.sui.io:443",
    network: "devnet",
});

function mistToSui(mistAmount: bigint | number): number {
    const MIST_PER_SUI = 1_000_000_000; // 1 SUI = 10^9 MIST
    return Number(mistAmount) / MIST_PER_SUI;
}

async function getSuiBalance(owner: string): Promise<number> {
    const coins = await suiClient.listCoins({
        owner,
        coinType: "0x2::sui::SUI",
    });
    const sum = coins.objects.reduce((total, coin) => total + BigInt(coin.balance), 0n);
    return mistToSui(sum);
}

async function waitForUpdatedBalance(owner: string, previousBalance: number): Promise<number> {
    const maxAttempts = 15;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const nextBalance = await getSuiBalance(owner);
        if (nextBalance !== previousBalance) return nextBalance;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    return getSuiBalance(owner);
}

function App() {
    const {
        supported,
        address,
        create,
        recoverTwoStep,
        signTransaction,
        loading,
        error
    } = useSuiPasskey({rpName: 'My Dapp', authenticatorAttachment: 'platform'});

    const [balance, setBalance] = useState(0);
    const [txDigest, setTxDigest] = useState('');
    const [faucetLoading, setFaucetLoading] = useState(false);

    useEffect(() => {
        if (!address) return;
        let cancelled = false;
        void getSuiBalance(address).then((nextBalance) => {
            if (!cancelled) setBalance(nextBalance);
        });
        return () => {
            cancelled = true;
        };
    }, [address]);

    const faucetHandle = async (recipient: string) => {
        setFaucetLoading(true);
        try {
            const previousBalance = await getSuiBalance(recipient);
            const response = await requestSuiFromFaucetV2({
                host: getFaucetHost('devnet'),
                recipient,
            });

            if (response.status !== 'Success' || !response.coins_sent?.length) {
                throw new Error('Faucet did not return any coins.');
            }

            const digests = new Set(response.coins_sent.map((coin) => coin.transferTxDigest));
            await Promise.all([...digests].map((digest) => suiClient.waitForTransaction({
                digest,
                timeout: 30_000,
            })));
            setBalance(await waitForUpdatedBalance(recipient, previousBalance));
        } finally {
            setFaucetLoading(false);
        }
    }

    const executeTestTX = async () => {
        const tx = new Transaction();

        const [coin] = tx.splitCoins(tx.gas, [100]);
        tx.transferObjects(
            [coin],
            "0xfa0f8542f256e669694624aa3ee7bfbde5af54641646a3a05924cf9e329a8a36"
        );
        tx.setSender(address || '');
        const txBlock = await tx.build({client: suiClient});
        const {signature} = await signTransaction(txBlock);
        const result = await suiClient.executeTransaction({
            transaction: txBlock,
            signatures: [signature],
        });
        const {digest} = result.Transaction ?? result.FailedTransaction;
        if (digest) {
            setTxDigest(digest)
        }
        if (address) setBalance(await getSuiBalance(address));
    }

    if (!supported) return <button disabled>Passkeys unsupported</button>;

    return (
        <div>
            {address ? <div>Address: {address}</div> : null}
            {address ? <div>Balance: {balance}</div> : null}
            {txDigest ? <div>TX Digest (dev): <a href={`https://devnet.suivision.xyz/txblock/${txDigest}`}
                                                 target="_blank">{txDigest}</a></div> : null}
            <button disabled={loading} onClick={() => create()}>Create passkey</button>
            <button disabled={loading} onClick={() => recoverTwoStep()}>Recover</button>

            {address ? <button disabled={faucetLoading} onClick={() => {
                faucetHandle(address).catch((e) => console.error(e));
            }}>{faucetLoading ? 'Funding…' : 'Faucet'}</button> : null}
            {address ? <button disabled={loading} onClick={() => {
                executeTestTX().catch((e) => console.error(e));
            }}>Execute Transaction
            </button> : null}

            {error ? <pre>{String(error)}</pre> : null}
        </div>
    );
}

export default App
