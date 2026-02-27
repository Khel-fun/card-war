import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import { injectedWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';
import { mainnet, sepolia, hardhat } from 'wagmi/chains';

const appName = 'Card War';
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID';
const chains = [hardhat, sepolia, mainnet] as const;

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Recommended',
      wallets: [injectedWallet, walletConnectWallet],
    },
  ],
  {
    appName,
    projectId,
  },
);

export const wagmiConfig = createConfig({
  chains,
  connectors,
  transports: {
    [hardhat.id]: http(),
    [sepolia.id]: http(),
    [mainnet.id]: http(),
  },
  ssr: true,
});
