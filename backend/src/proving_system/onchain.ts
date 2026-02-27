type OnChainAggregationInput = {
  gameId: string;
  aggregationId: number;
  leaf: string;
  merklePath: string[];
  leafCount: number;
  leafIndex: number;
};

type OnChainAggregationResult = {
  attempted: boolean;
  verified: boolean;
  domainId: number | null;
  txHash: string | null;
  contractAddress: string | null;
  error?: string;
};

const registryAbi = [
  "function domainId() view returns (uint256)",
  "function verifyProofAggregation(uint256,bytes32,bytes32[],uint256,uint256) view returns (bool)",
  "function recordProofAggregationVerification(bytes32,uint256,bytes32,bytes32[],uint256,uint256) returns (bool)",
];

function ensureHexPrefixed(value: string): string {
  return value.startsWith("0x") ? value : `0x${value}`;
}

export async function verifyAndRecordAggregationOnChain(
  input: OnChainAggregationInput,
): Promise<OnChainAggregationResult> {
  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.OPERATOR_PRIVATE_KEY;
  const registryAddress = process.env.CARDWAR_REGISTRY_ADDRESS;

  if (!rpcUrl || !privateKey || !registryAddress) {
    return {
      attempted: false,
      verified: false,
      domainId: null,
      txHash: null,
      contractAddress: registryAddress || null,
      error:
        "Missing RPC_URL, OPERATOR_PRIVATE_KEY, or CARDWAR_REGISTRY_ADDRESS",
    };
  }

  try {
    const ethersMod = await import("ethers");
    const ethers = ethersMod.ethers;

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(registryAddress, registryAbi, wallet);
    const configuredDomainId = Number(await contract.domainId());

    const leaf = ethers.zeroPadValue(ensureHexPrefixed(input.leaf), 32);
    const merklePath = input.merklePath.map((node) =>
      ethers.zeroPadValue(ensureHexPrefixed(node), 32),
    );

    const verified = await contract.verifyProofAggregation(
      input.aggregationId,
      leaf,
      merklePath,
      input.leafCount,
      input.leafIndex,
    );

    if (!verified) {
      return {
        attempted: true,
        verified: false,
        domainId: configuredDomainId,
        txHash: null,
        contractAddress: registryAddress,
      };
    }

    const gameKey = ethers.keccak256(ethers.toUtf8Bytes(input.gameId));
    const tx = await contract.recordProofAggregationVerification(
      gameKey,
      input.aggregationId,
      leaf,
      merklePath,
      input.leafCount,
      input.leafIndex,
    );
    const receipt = await tx.wait();

    return {
      attempted: true,
      verified: true,
      domainId: configuredDomainId,
      txHash: receipt?.hash ?? tx.hash ?? null,
      contractAddress: registryAddress,
    };
  } catch (error: any) {
    return {
      attempted: true,
      verified: false,
      domainId: null,
      txHash: null,
      contractAddress: registryAddress,
      error: error?.message || "On-chain aggregation verification failed",
    };
  }
}
