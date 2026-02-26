import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useState } from 'react';
import contractData from '@/contracts/CardWarRegistry.json';

const CONTRACT_ADDRESS = contractData.address as `0x${string}`;
const CONTRACT_ABI = contractData.abi;

export function useCreateGame() {
  const { writeContract, data: hash, isPending, isError, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const create = (gameId: string) => {
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'createGame',
      args: [gameId],
    });
  };

  return {
    create,
    isPending: isPending || isConfirming,
    isSuccess,
    isError,
    error,
    hash,
  };
}

export function useJoinGame() {
  const { writeContract, data: hash, isPending, isError, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const join = (gameId: string) => {
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'joinGame',
      args: [gameId],
    });
  };

  return {
    join,
    isPending: isPending || isConfirming,
    isSuccess,
    isError,
    error,
    hash,
  };
}

export function useCompleteGame() {
  const { writeContract, data: hash, isPending, isError, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const complete = (gameId: string, winner: `0x${string}`) => {
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'completeGame',
      args: [gameId, winner],
    });
  };

  return {
    complete,
    isPending: isPending || isConfirming,
    isSuccess,
    isError,
    error,
    hash,
  };
}
