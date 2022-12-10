import GnarsABI from '../abi/federation/gnars.json';
import {
  useContractCall,
  useEthers,
} from '@usedapp/core';
import { utils, BigNumber as EthersBN } from 'ethers';
const abi = new utils.Interface(GnarsABI);

export const useUserGnarsVotesAsOfBlock = (block: number | undefined): number | undefined => {
    const { account } = useEthers();  
    // Check for available votes
    const [votes] =
      useContractCall<[EthersBN]>({
        abi,
        address: "0x558bfff0d583416f7c4e380625c7865821b8e95c",
        method: 'getPriorVotes',
        args: [account, block],
      }) || [];
    return votes?.toNumber();
  };