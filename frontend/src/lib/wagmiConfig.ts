import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import { injectedWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';

const appName = 'Card War';
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID';
const chains = [base] as const;

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
    [base.id]: http(),
  },
  ssr: true,
});
