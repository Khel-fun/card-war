import { useWriteContract, useReadContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import contractData from '@/contracts/CardWarEscrow.json';

const CONTRACT_ADDRESS = contractData.address as `0x${string}`;
const ABI = contractData.abi;

export function useCreateGame(gameId: string, wagerEth: string) {
  const { writeContract, data: hash, isPending, error } = useWriteContract();

  const create = () => {
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: ABI,
      functionName: 'createGame',
      args: [gameId],
      value: parseEther(wagerEth || '0'),
    });
  };

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  return { create, isPending, isConfirming, isSuccess, error };
}

export function useJoinGame(gameId: string, wagerEth: string) {
  const { writeContract, data: hash, isPending, error } = useWriteContract();

  const join = () => {
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: ABI,
      functionName: 'joinGame',
      args: [gameId],
      value: parseEther(wagerEth || '0'),
    });
  };

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  return { join, isPending, isConfirming, isSuccess, error };
}

export function useGetGame(gameId: string) {
  const { data, isLoading, refetch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ABI,
    functionName: 'getGame',
    args: [gameId],
    query: { enabled: !!gameId && CONTRACT_ADDRESS !== '0x' },
  });

  return { gameData: data, isLoading, refetch };
}
