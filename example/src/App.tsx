import {useSuiPasskey} from 'use-sui-passkey';
import {Transaction} from "@mysten/sui/transactions";
import {getFaucetHost, requestSuiFromFaucetV2} from "@mysten/sui/faucet";
import {useCallback, useLayoutEffect, useState} from "react";
import {SuiClient} from "@mysten/sui/client";

const FULLNODE_URL = "https://fullnode.devnet.sui.io/";
const suiClient = new SuiClient({url: FULLNODE_URL});

function mistToSui(mistAmount: bigint | number): number {
    const MIST_PER_SUI = 1_000_000_000; // 1 SUI = 10^9 MIST
    return Number(mistAmount) / MIST_PER_SUI;
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

    const getSuiCoins = useCallback(async () => {
      const coins = await suiClient.getCoins({
            owner: address || '',
            coinType: "0x2::sui::SUI"
        });

        const sum = coins?.data?.reduce((sum, coin) => sum + Number(coin.balance), 0) || 0;
        setBalance(mistToSui(sum))
    }, [address]);

    useLayoutEffect(() => {
        getSuiCoins()
    }, [address]);

    const faucetHandle = async (recipient: string) => {
        console.log("normalizeSuiAddress: ",address);
        await requestSuiFromFaucetV2({
            host: getFaucetHost('devnet'),
            recipient,
        });
        getSuiCoins();
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
        const {digest} = await suiClient.executeTransactionBlock({
            transactionBlock: txBlock,
            signature
        })
        if (digest) {
            setTxDigest(digest)
        }
        getSuiCoins();
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

            {address ? <button disabled={!address} onClick={() => faucetHandle(address)}>Faucet</button> : null}
            {address ? <button disabled={loading} onClick={() => {
                executeTestTX().catch((e) => console.error(e));
            }}>Execute Transaction
            </button> : null}

            {error ? <pre>{String(error)}</pre> : null}
        </div>
    );
}

export default App
