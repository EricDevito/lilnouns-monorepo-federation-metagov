import { FederationABI } from '...';
import {
  ChainId,
  useBlockMeta,
  useBlockNumber,
  useContractCall,
  useContractCalls,
  useContractFunction,
  useEthers,
} from '@usedapp/core';
import { utils, BigNumber as EthersBN } from 'ethers';
import { defaultAbiCoder, Result } from 'ethers/lib/utils';
import { useMemo } from 'react';
import { useLogs } from '../hooks/useLogs';
import * as R from 'ramda';
import config, { CHAIN_ID } from '../config';
import { useQuery } from '@apollo/client';
import { federationProposalsQuery } from './subgraph';
import BigNumber from 'bignumber.js';
import { useBlockTimestamp } from '../hooks/useBlockTimestamp';
import { ProposalData } from './nounsDao';

//*FEDERATION TYPES
enum Vote {
  AGAINST = 0,
  FOR = 1,
  ABSTAIN = 2,
}

enum FederationProposalState {
  UNDETERMINED = -1,
  PENDING,
  ACTIVE,
  CANCELLED,
  DEFEATED,
  SUCCEEDED,
  QUEUED,
  EXPIRED,
  EXECUTED,
  VETOED,

  METAGOV_ACTIVE,
  METAGOV_CLOSED,
  METAGOV_PENDING,
  METAGOV_VETOED,
}

interface ProposalCallResult {
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
}
interface FederationProposal {
  id: string | undefined;
  proposer: string | undefined;
  eDAO: string | undefined;
  eID: number;
  quorumVotes: number;
  startBlock: number;
  endBlock: number;
  forCount: number;
  againstCount: number;
  abstainCount: number;
  status: FederationProposalState;
}

interface ProposalSubgraphEntity {
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
  status: keyof typeof FederationProposalState;
}

interface FederationProposalData {
  data: FederationProposal[];
  error?: Error;
  loading: boolean;
}

const abi = new utils.Interface(FederationABI);
const federationContract = new FederationLogicFactory().attach('federationAddress');

// Start the log search at the mainnet deployment block to speed up log queries
const fromBlock = CHAIN_ID === ChainId.Mainnet ? 12985453 : 0;
const proposalCreatedFilter = {
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

//TODO: REVIEW (quorumBPS via prop or default?)
export const useCurrentQuorum = (
  dao: string,
  proposalId: number,
  skip: boolean,
): number | undefined => {
  const request = () => {
    if (skip) return false;
    return {
      abi,
      address: dao,
      method: 'quorumVotes',
      args: [proposalId],
    };
  };
  const [quorum] = useContractCall<[EthersBN]>(request()) || [];
  return quorum?.toNumber();
};

//TODO: REVIEW
export const useHasVotedOnFederationProposal = (proposalId: string | undefined): boolean => {
  const { account } = useEthers();

  // Fetch a voting receipt for the passed proposal id
  const [receipt] =
    useContractCall<[any]>({
      abi,
      address: federationContract.address,
      method: 'getReceipt',
      args: [proposalId, account],
    }) || [];
  return receipt?.hasVoted ?? false;
};

//TODO: REVIEW
export const useFederationProposalVote = (proposalId: string | undefined): string => {
  const { account } = useEthers();

  // Fetch a voting receipt for the passed proposal id
  const [receipt] =
    useContractCall<[any]>({
      abi,
      address: federationContract.address,
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

//TODO: REVIEW
export const useFederationProposalCount = (): number | undefined => {
  const [count] =
    useContractCall<[EthersBN]>({
      abi,
      address: federationContract.address,
      method: 'proposalCount',
      args: [],
    }) || [];
  return count?.toNumber();
};

//TODO: REVIEW
export const useFederationProposalThreshold = (): number | undefined => {
  const [count] =
    useContractCall<[EthersBN]>({
      abi,
      address: federationContract.address,
      method: 'proposalThreshold',
      args: [],
    }) || [];
  return count?.toNumber();
};

//TODO: REVIEW
const useVotingDelay = (dao: string): number | undefined => {
  const [blockDelay] =
    useContractCall<[EthersBN]>({
      abi,
      address: dao,
      method: 'votingDelay',
      args: [],
    }) || [];
  return blockDelay?.toNumber();
};

const countToIndices = (count: number | undefined) => {
  return typeof count === 'number' ? new Array(count).fill(0).map((_, i) => [i + 1]) : [];
};

//TODO: REVIEW
const getFederationProposalState = (
  blockNumber: number | undefined,
  blockTimestamp: Date | undefined,
  proposal: ProposalSubgraphEntity,
) => {
  const status = FederationProposalState[proposal.status];
  if (status === FederationProposalState.PENDING) {
    if (!blockNumber) {
      return FederationProposalState.UNDETERMINED;
    }
    if (blockNumber <= parseInt(proposal.startBlock)) {
      return FederationProposalState.PENDING;
    }
    return FederationProposalState.ACTIVE;
  }
  if (status === FederationProposalState.ACTIVE) {
    if (!blockNumber) {
      return FederationProposalState.UNDETERMINED;
    }
    if (blockNumber > parseInt(proposal.endBlock)) {
      const forVotes = new BigNumber(proposal.forVotes);
      if (forVotes.lte(proposal.againstVotes) || forVotes.lt(proposal.quorumVotes)) {
        return FederationProposalState.DEFEATED;
      }
    }
    return status;
  }
  if (status === FederationProposalState.QUEUED) {
    if (!blockTimestamp) {
      return FederationProposalState.UNDETERMINED;
    }
    // const GRACE_PERIOD = 14 * 60 * 60 * 24;
    // if (blockTimestamp.getTime() / 1_000 >= parseInt(proposal.executionETA) + GRACE_PERIOD) {
    //   return FederationProposalState.EXPIRED;
    // }
    return status;
  }
  return status;
};

//TODO: SETUP FEDERATION X LIL NOUNS SUBGRAPH
export const useFederationProposalsViaSubgraph = (): FederationProposalData => {
  const { loading, data, error } = useQuery(federationProposalsQuery(), {
    context: { clientName: 'Federation' },
    fetchPolicy: 'no-cache',
  });

  const blockNumber = useBlockNumber();
  const { timestamp } = useBlockMeta();

  const proposals = data?.federationProposals.map((proposal: ProposalSubgraphEntity) => {
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
      status: getFederationProposalState(blockNumber, timestamp, proposal),
    };
  });

  // console.log(`proposals??:  ${JSON.stringify(data.federationProposals)}`);

  return {
    loading,
    error,
    data: proposals ?? [],
  };
};

//TODO: REVIEW
export const useFederationProposalsViaChain = (
  skip = false,
): FederationProposalData => {
  const proposalCount = useFederationProposalCount(); //? To fetch from federation or nouns dao?
  const votingDelay = useVotingDelay(federationContract.address);

  const govProposalIndexes = useMemo(() => {
    return countToIndices(proposalCount);
  }, [proposalCount]);

  const requests = (method: string) => {
    if (skip) return [false];
    return govProposalIndexes.map(index => ({
      abi,
      method,
      address: federationContract.address,
      args: [index],
    }));
  };

  const proposals = useContractCalls<ProposalCallResult>(requests('proposals'));
  const federationproposalStates = useContractCalls<[FederationProposalState]>(requests('state'));

  // Early return until events are fetched
  return useMemo(() => {
    if (proposals.length) {
      return { data: [], loading: true };
    }

    return {
      data: proposals.map((proposal, i) => {
        return {
          id: proposal?.id.toString(),
          proposer: proposal?.proposer,
          eDAO: proposal?.eDAO,
          eID: parseInt(proposal?.eID?.toString() ?? '0'),
          quorumVotes: parseInt(proposal?.quorumVotes?.toString() ?? '0'),
          startBlock: parseInt(proposal?.startBlock?.toString() ?? ''),
          endBlock: parseInt(proposal?.endBlock?.toString() ?? ''),
          forCount: parseInt(proposal?.forVotes?.toString() ?? '0'),
          againstCount: parseInt(proposal?.againstVotes?.toString() ?? '0'),
          abstainCount: parseInt(proposal?.abstainVotes?.toString() ?? '0'),
          status: federationproposalStates[i]?.[0] ?? FederationProposalState.UNDETERMINED,
        };
      }),
      loading: false,
    };
  }, [federationproposalStates, proposals, votingDelay]);
};

//TODO: REVIEW (SUBGRAPH)
export const useAllFederationProposals = (id: string | number): FederationProposalData => {
  // const subgraph = useFederationProposalsViaSubgraph();
  const onchain = useFederationProposalsViaChain(false); //(!subgraph.error);
  return onchain; //subgraph?.error ? onchain : subgraph;
};
//TODO: REVIEW (SUBGRAPH)
export const useFederationProposal = (id: string | number): FederationProposal | undefined => {
  const { data } = useFederationProposalsViaSubgraph();
  return data?.find(p => p.id === id.toString());
};

export const useCastFederationVote = () => {
  const { send: castVote, state: castVoteState } = useContractFunction(
    federationContract,
    'castVote',
  );
  return { castVote, castVoteState };
};

export const useCastFederationVoteWithReason = () => {
  const { send: castVoteWithReason, state: castVoteWithReasonState } = useContractFunction(
    federationContract,
    'castVote',
  );
  return { castVoteWithReason, castVoteWithReasonState };
};

export const useFederationPropose = () => {
  const { send: propose, state: proposeState } = useContractFunction(federationContract, 'propose');
  return { propose, proposeState };
};

export const useFederationExecuteProposal = () => {
  const { send: executeProposal, state: executeFederationProposalState } = useContractFunction(
    federationContract,
    'execute',
  );
  return { executeProposal, executeFederationProposalState };
};
