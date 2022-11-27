import FederationABI from '../abi/federation/DelegateMultiToken.json';
import {
  ChainId,
  useContractCall,
  useContractCalls,
  useContractFunction,
  useEthers,
} from '@usedapp/core';
import { Contract } from '@ethersproject/contracts';
import { utils, BigNumber as EthersBN } from 'ethers';
import { useLogs } from '../hooks/useLogs';
import { useMemo } from 'react';
import { CHAIN_ID } from '../config';

export const federationGenesisBlock = 12600000;
const federationAddress = "0x0";
const fromBlock = CHAIN_ID === ChainId.Mainnet ? federationGenesisBlock : 0;
const abi = new utils.Interface(FederationABI);

enum Vote {
  AGAINST = 0,
  FOR = 1,
  ABSTAIN = 2,
}

export enum FederationProposalState {
  ACTIVE,  
  EXPIRED,
  EXECUTED,
  VETOED,
}

export interface FederationProposal {
  id: string | undefined;
  proposer: string | undefined;
  eDAO: string | undefined;
  eID: string | undefined;
  quorumVotes: number;
  startBlock: number;
  endBlock: number;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  vetoed: boolean | false;
  executed: boolean | false;
}

export interface FederationProposalData {
  data: FederationProposal[];
  error?: Error;
  loading: boolean;
}


export const useFederationContract = () => {
  const { library } = useEthers();
  const c = new Contract(federationAddress, abi, library);
  return c
}

// start the log search at the mainnet deployment block to speed up log queries
const proposalCreatedFilter = (federationContract: Contract)  => {  
  return {
  ...federationContract.filters?.ProposalCreated(
    null, // newProposal.id,
    null, // msg.sender,
    null, // newProposal.eDAO,
    null, // newProposal.eID,
    null, // newProposal.startBlock,
    null, // newProposal.endBlock,
    null, // newProposal.quorumVotes
  ),
  fromBlock,
  };
};

export const useCurrentQuorum = (  
  proposalId: number,
  skip: boolean,
): number | undefined => {
  const request = () => {
    if (skip) return false;
    return {
      abi,      
      method: 'proposals',
      args: [proposalId],
    };
  };
  const [quorumVotes] = useContractCall<[EthersBN]>(request()) || [];
  return quorumVotes?.toNumber();
};

export const useHasVotedOnFederationProposal = (proposalId: string | undefined): boolean => {
  const { account } = useEthers();

  // fetch a voting receipt for the passed proposal id
  const [receipt] =
    useContractCall<[any]>({
      abi,
      address: federationAddress,
      method: 'getReceipt',
      args: [proposalId, account],
    }) || [];
  return receipt?.hasVoted ?? false;
};

export const useFederationProposalVote = (proposalId: string | undefined): string => {
  const { account } = useEthers();

  // Fetch a voting receipt for the passed proposal id
  const [receipt] =
    useContractCall<[any]>({
      abi,
      address: federationAddress,
      method: 'getReceipt',
      args: [proposalId, account],
    }) || [];

  const voteStatus = receipt?.support ?? -1;
  if (voteStatus === 0) {
    return 'Against';
  }
  if (voteStatus === 1) {
    return 'For';
  }
  if (voteStatus === 2) {
    return 'Abstain';
  }

  return '';
};

export const useFederationProposalCount = (): number | undefined => {
  const [count] =
    useContractCall<[EthersBN]>({
      abi,
      address: federationAddress,
      method: 'proposalCount',
      args: [],
    }) || [];
  return count?.toNumber();
};

const countToIndices = (count: number | undefined) => {
  return typeof count === 'number' ? new Array(count).fill(0).map((_, i) => [i + 1]) : [];
};

const getFederationProposalState = (
  blockNumber: number | undefined,
  proposal: FederationProposal,
) => {
  if (proposal.vetoed) {
    return FederationProposalState.VETOED;
  } else if (proposal.executed) {
    return FederationProposalState.EXECUTED;
  } else if (blockNumber||0 > proposal.endBlock) {
    return FederationProposalState.EXPIRED;
  } else {
    return FederationProposalState.ACTIVE;
  }  
};

// get active proposals in federation contract
const useFederationProposalCreatedLogs = (skip: boolean, fromBlock?: number) => {
  const c = useFederationContract();

  const filter = useMemo(
    () => ({
      ...proposalCreatedFilter(c),
      ...(fromBlock ? { fromBlock } : {}),
    }),
    [fromBlock],
  );

  const useLogsResult = useLogs(!skip ? filter : undefined);

  return useMemo(() => {
    return useLogsResult?.logs?.map(log => {
      const { args: parsed } = abi.parseLog(log);
      return {
        id: parsed.id,
        proposer: parsed.proposer,
        eDAO: parsed.eDAO,
        ePropID: parsed.ePropID,
        startBlock: parsed.startBlock,
        endBlock: parsed.endBlock,
        quorumVotes: parsed.quorumVotes,
      };
    });
  }, [useLogsResult]);
};

export const useAllFederationProposalsViaChain = (
  skip = false,
): FederationProposalData => {
  const proposalCount = useFederationProposalCount();

  const govProposalIndexes = useMemo(() => {
    return countToIndices(proposalCount);
  }, [proposalCount]);

  const requests = (method: string) => {
    if (skip) return [false];
    return govProposalIndexes.map(index => ({
      abi,
      method,
      address: federationAddress,
      args: [index],
    }));
  };

  const proposals = useContractCalls<FederationProposal>(requests('proposals'));
  const federationproposalStates = useContractCalls<[FederationProposalState]>(requests('state'));
  const createdLogs = useFederationProposalCreatedLogs(skip);

  // Early return until events are fetched
  return useMemo(() => {
    const logs = createdLogs ?? [];
    if (proposals.length && !logs.length) {
      return { data: [], loading: true };
    }

    return {
      data: proposals.map((proposal, i) => {
        return {
          id: proposal?.id?.toString(),
          proposer: proposal?.proposer,
          eDAO: proposal?.eDAO,
          eID: proposal?.eID?.toString(),
          quorumVotes: parseInt(proposal?.quorumVotes?.toString() ?? '0'),
          startBlock: parseInt(proposal?.startBlock?.toString() ?? ''),
          endBlock: parseInt(proposal?.endBlock?.toString() ?? ''),
          forVotes: parseInt(proposal?.forVotes?.toString() ?? '0'),
          againstVotes: parseInt(proposal?.againstVotes?.toString() ?? '0'),
          abstainVotes: parseInt(proposal?.abstainVotes?.toString() ?? '0'),
          vetoed: proposal?.vetoed || false,
          executed: proposal?.executed || false,
        };
      }),
      loading: false,
    };
  }, [federationproposalStates, proposals]);
};

export const useAllFederationProposals = () : FederationProposalData => {
  return useAllFederationProposalsViaChain(false);
};

export const useFederationProposal = (id: string | number): FederationProposal | undefined => {
  const { data } = useAllFederationProposals();
  return data?.find(p => p.id === id.toString());
};

export const useCastFederationVoteWithReason = () => {
  const c = useFederationContract();
  const { send: castVoteWithReason, state: castVoteWithReasonState } = useContractFunction(
    c,
    'castVote',
  );
  return { castVoteWithReason, castVoteWithReasonState };
};

export const useFederationPropose = () => {
  const c = useFederationContract();
  const { send: propose, state: proposeState } = useContractFunction(c, 'propose');
  return { propose, proposeState };
};

export const useFederationExecuteProposal = () => {
  const c = useFederationContract();
  const { send: executeProposal, state: executeFederationProposalState } = useContractFunction(
    c,
    'execute',
  );
  return { executeProposal, executeFederationProposalState };
};
