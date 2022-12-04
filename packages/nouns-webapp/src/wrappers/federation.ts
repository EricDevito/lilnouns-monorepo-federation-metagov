import FederationABI from '../abi/federation/DelegateMultiToken.json';
import {
  ChainId,
  useBlockNumber,
  useContractCall,
  useContractCalls,
  useContractFunction,
  useEthers,
} from '@usedapp/core';
import { Contract } from '@ethersproject/contracts';
import { utils, BigNumber as EthersBN } from 'ethers';
import { useLogs } from '../hooks/useLogs';
import { useMemo } from 'react';
import config, { CHAIN_ID } from '../config';
import { useQuery } from '@apollo/client';
import { federationProposalsQuery } from './subgraph';
import { NounsDAOABI, NounsDaoLogicV1Factory } from '@lilnounsdao/sdk';

export const federationGenesisBlock = 12600000;
//TODO: change to lils address
const federationAddress = '0xF23815D7dDC73D5cF34671F373d427414dc39dC9';
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
  UNDETERMINED, // null
}

export enum FederationProposalResult {
  For,
  Against,
  Abstain,
  Undecided,
}

interface FederationProposalVote {
  supportDetailed: 0 | 1 | 2;
  voter: string;
}

export interface FederationProposalVotes {
  votes: FederationProposalVote[];
}

interface FederationProposalCallResult {
  id: EthersBN;
  proposer: string;
  eDAO: string;
  eID: EthersBN;
  quorumVotes: EthersBN;
  startBlock: EthersBN;
  endBlock: EthersBN;
  forVotes: EthersBN;
  againstVotes: EthersBN;
  abstainVotes: EthersBN;
  vetoed: boolean | false;
  executed: boolean | false;
}
export interface FederationProposal {
  id: string | undefined;
  proposer: string | undefined;
  eDAO: string | undefined;
  eID: string | undefined;
  quorumVotes: number;
  startBlock: number;
  endBlock: number;
  forCount: number;
  againstCount: number;
  abstainCount: number;
  vetoed: boolean | false;
  executed: boolean | false;
  status: FederationProposalState;
  executionWindow?: number; //The window in *blocks* that a proposal which has met quorum can be executed
  // result: FederationProposalResult;
}

export interface FederationProposalSubgraphEntity {
  id: string;
  proposer: { id: string };
  eDAO: string;
  eID: string;
  quorumVotes: string;
  startBlock: string;
  endBlock: string;
  forVotes: string;
  againstVotes: string;
  abstainVotes: string;
  vetoed: boolean | false;
  executed: boolean | false;
  status: keyof typeof FederationProposalState;
  // result: keyof typeof FederationProposalResult;
}

export interface FederationProposalData {
  data: FederationProposal[];
  error?: Error;
  loading: boolean;
}

export const useFederationContract = () => {
  const { library } = useEthers();
  const c = new Contract(federationAddress, abi, library);
  return c;
};
//* GOOD
// start the log search at the mainnet deployment block to speed up log queries
const proposalCreatedFilter = (federationContract: Contract) => {
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
//* GOOD
export const useCurrentQuorum = (proposalId: number, skip: boolean): number | undefined => {
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
//* GOOD - same as below
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
//* GOOD
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
//* GOOD
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
//* GOOD
export const useFederationExecutionWindow = (): number | undefined => {
  const [execWindow] =
    useContractCall<[EthersBN]>({
      abi,
      address: federationAddress,
      method: 'execWindow',
      args: [],
    }) || [];
  return execWindow?.toNumber();
};
//* GOOD
const countToIndices = (count: number | undefined) => {
  return typeof count === 'number' ? new Array(count).fill(0).map((_, i) => [i + 1]) : [];
};
//* GOOD
const getFederationProposalState = (
  blockNumber: number,
  proposal: FederationProposalSubgraphEntity,
) => {

  console.log(`blockNumber: ${blockNumber}. endblock:${parseInt(proposal.endBlock)}`);
  
  if (proposal.vetoed) {
    return FederationProposalState.VETOED;
  } else if (proposal.executed) {
    return FederationProposalState.EXECUTED;
  } else if (proposal.status == "EXPIRED") {
    return FederationProposalState.EXPIRED;
  } else if (proposal.status == "ACTIVE") {
    return FederationProposalState.ACTIVE;
  } else {
    return FederationProposalState.UNDETERMINED;
  }
};

//TODO: figure out why this doesn't work
export const useFederationProposalResult = (
  proposalId: string | undefined,
): FederationProposalResult => {
  const { account } = useEthers();

  // Fetch a voting receipt for the passed proposal id
  const [result] =
    useContractCall<[EthersBN]>({
      abi,
      address: federationAddress,
      method: 'result',
      args: [proposalId, account],
    }) || [];

  const voteResult = result?.toNumber();

  if (voteResult === 0) {
    return FederationProposalResult.For;
  } else if (voteResult === 1) {
    return FederationProposalResult.Against;
  } else if (voteResult === 2) {
    return FederationProposalResult.Abstain;
  } else if (voteResult === 3) {
    return FederationProposalResult.Undecided;
  }

  console.log(`voteResult: ${result}.}`);

  return 4;
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
//* GOOD
export const useAllFederationProposalsViaSubgraph = (): FederationProposalData => {
  const { loading, data, error } = useQuery(federationProposalsQuery(), {
    context: { clientName: 'Federation' },
    fetchPolicy: 'no-cache',
  });

  // console.log(`DAA: ${JSON.stringify(data)}. error=${error}. loading=${loading}`);

  const blockNumber = useBlockNumber() ?? 0;

  const proposals = data?.proposals.map((proposal: FederationProposalSubgraphEntity) => {
    return {
      id: proposal.id,
      proposer: proposal.proposer,
      eDAO: proposal.eDAO,
      eID: proposal.eID,
      quorumVotes: parseInt(proposal.quorumVotes),
      startBlock: parseInt(proposal.startBlock),
      endBlock: parseInt(proposal.endBlock),
      forCount: parseInt(proposal.forVotes),
      againstCount: parseInt(proposal.againstVotes),
      abstainCount: parseInt(proposal.abstainVotes),
      status: getFederationProposalState(blockNumber, proposal),
    };
  });

  // console.log(`proposals??:  ${JSON.stringify(data.federationProposals)}`);

  return {
    loading,
    error,
    data: proposals ?? [],
  };
};
//* GOOD
export const useAllFederationProposalsViaChain = (skip = false): FederationProposalData => {
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

  const proposals = useContractCalls<FederationProposalCallResult>(requests('proposals'));
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
          forCount: parseInt(proposal?.forVotes?.toString() ?? '0'),
          againstCount: parseInt(proposal?.againstVotes?.toString() ?? '0'),
          abstainCount: parseInt(proposal?.abstainVotes?.toString() ?? '0'),
          vetoed: proposal?.vetoed || false,
          executed: proposal?.executed || false,
          status: federationproposalStates[i]?.[0] ?? FederationProposalState.UNDETERMINED,
        };
      }),
      loading: false,
    };
  }, [federationproposalStates, proposals]);
};
//* GOOD
export const useAllFederationProposals = (): FederationProposalData => {
  // const subgraph = useAllFederationProposalsViaSubgraph();
  const onchain = useAllFederationProposalsViaChain(false); //(!subgraph.error);
  return onchain; //subgraph?.error ? onchain : subgraph;
};
//* GOOD
export const useFederationProposal = (id: string | number) => {
  const { data } = useAllFederationProposalsViaSubgraph();
  console.log(`data=${JSON.stringify(data.filter(p => p.eID))}`);

  const firstPropID = data?.find(p => p.id === '1')?.eID ?? "179";

  return { firstFederationPropId: firstPropID, federationProposal: data?.find(p => p.eID === id.toString()) };
  // const { data } = useAllFederationProposalsViaChain();
  // console.log(`data=${data}`);
  // return data?.find(p => p.id === id.toString());
};
//* GOOD
export const useCastFederationVoteWithReason = () => {
  const c = useFederationContract();
  const { send: castVoteWithReason, state: castVoteWithReasonState } = useContractFunction(
    c,
    'castVote',
  );
  return { castVoteWithReason, castVoteWithReasonState };
};
//* GOOD
export const useFederationPropose = () => {
  const c = useFederationContract();
  
  const { send: propose, state: proposeState } = useContractFunction(c, 'propose');
  return { propose, proposeState };
};
//* GOOD
export const useFederationExecuteProposal = () => {
  const c = useFederationContract();
  const { send: executeProposal, state: executeFederationProposalState } = useContractFunction(
    c,
    'execute',
  );
  return { executeProposal, executeFederationProposalState };
};
