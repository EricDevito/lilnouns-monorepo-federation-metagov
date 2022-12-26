import { Row, Col, Button, Card, Spinner } from 'react-bootstrap';
import Section from '../../layout/Section';
import { ProposalState, usePropose, useQueueProposal } from '../../wrappers/nounsDao';
import {
  useCurrentQuorum,
  useExecuteBigNounProposal,
  useBigNounProposal,
  useQueueBigNounProposal,
} from '../../wrappers/bigNounsDao';
import { useUserVotesAsOfBlock } from '../../wrappers/nounToken';
import classes from './NounsVote.module.css';
import { RouteComponentProps } from 'react-router-dom';
import { TransactionStatus, useBlockNumber } from '@usedapp/core';
import { AlertModal, setAlertModal } from '../../state/slices/application';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import advanced from 'dayjs/plugin/advancedFormat';
import SnapshotVoteModalModal from '../../components/SnapshotVoteModal';
import React, { useCallback, useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks';
import clsx from 'clsx';
import ProposalHeader from '../../components/ProposalHeader';
import ProposalContent from '../../components/ProposalContent';
import VoteCard, { VoteCardVariant } from '../../components/VoteCard';

//TODO: votes query refetch on succesfull snapshot vote.
// https://www.apollographql.com/docs/react/data/queries/#refetching

import {
  proposalVotesQuery,
  delegateNounsAtBlockQuery,
  delegateLilNounsAtBlockQuery,
  ProposalVotes,
  Delegates,
  propUsingDynamicQuorum,
  snapshotSingularProposalVotesQuery,
  snapshotProposalsQuery,
  lilNounsHeldByVoterQuery,
  federationProposalVotesQuery,
  federationDelegateNounsAtBlockQuery,
} from '../../wrappers/subgraph';
import { getNounVotes } from '../../utils/getNounsVotes';
import { useQuery } from '@apollo/client';
import { SnapshotProposal } from '../../components/Proposals';
import { AVERAGE_BLOCK_TIME_IN_SECS } from '../../utils/constants';
import { SearchIcon } from '@heroicons/react/solid';
import ReactTooltip from 'react-tooltip';
import DynamicQuorumInfoModal from '../../components/DynamicQuorumInfoModal';
import config from '../../config';
import {
  FederationProposalResult,
  FederationProposalState,
  FederationProposalVotes,
  useFederationExecuteProposal,
  useFederationExecutionWindow,
  useFederationProposal,
  useFederationProposalResult,
  useFederationPropose
} from '../../wrappers/federation';
import { getMetagovNounVotes } from '../../utils/getMetagovNounsVotes';
import VoteModal from '../../components/VoteModal';
import { useUserGnarsVotesAsOfBlock } from '../../wrappers/gnars';
import { isMobileScreen } from '../../utils/isMobile';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advanced);

export interface SnapshotVoters {
  voter: string;
  vp: number;
  choice: number;
  nounIds: string[];
}

interface MetagovProp {
  forMetagovNounIds: string[];
  againstMetagovNounIds: string[];
  abstainMetagovNounIds: string[];

  metagovPropEndDate: dayjs.Dayjs | undefined;
  metagovPropExecutionWindowDate: dayjs.Dayjs | undefined;
  metagovPropStartDate: dayjs.Dayjs | undefined;
  metagovQuroum: number;
  propStatus: ProposalState;
  metagovForCountAmt: number;
  metagovAgainstCountAmt: number;
  metagovAbstainCountAmt: number;
  snapshotVoters: SnapshotVoters[];
}

const NounsVotePage = ({
  match: {
    params: { id },
  },
}: RouteComponentProps<{ id: string }>) => {
  const proposal = useBigNounProposal(id);

  const activeAccount = useAppSelector(state => state.account.activeAccount);
  const {
    loading,
    error,
    data: voters,
  } = useQuery<ProposalVotes>(proposalVotesQuery(proposal?.id ?? '0'), {
    context: { clientName: 'NounsDAO' },
  });

  const voterIds = voters?.votes?.map(v => v.voter.id);
  const { data: delegateSnapshot } = useQuery<Delegates>(
    delegateNounsAtBlockQuery(voterIds ?? [], proposal?.createdBlock ?? 0),
    {
      skip: !voters?.votes?.length,
      context: { clientName: 'NounsDAO' },
      //* no cache to mitigate against object mutation between lils and nouns
      fetchPolicy: 'no-cache',
    },
  );

  const { delegates } = delegateSnapshot || {};
  const delegateToNounIds = delegates?.reduce<Record<string, string[]>>((acc, curr) => {
    acc[curr.id] = curr?.nounsRepresented?.map(nr => nr.id) ?? [];
    return acc;
  }, {});

  const data = voters?.votes?.map(v => ({
    delegate: v.voter.id,
    supportDetailed: v.supportDetailed,
    nounsRepresented: delegateToNounIds?.[v.voter.id] ?? [],
  }));

  const {
    loading: snapshotProposalLoading,
    error: snapshotProposalError,
    data: snapshotProposalData,
  } = useQuery(snapshotProposalsQuery(), {
    context: { clientName: 'NounsDAOSnapshot' },
    skip: !proposal,
  });

  const {
    loading: snapshotVoteLoading,
    error: snapshotVoteError,
    data: snapshotVoteData,
  } = useQuery(
    snapshotSingularProposalVotesQuery(
      snapshotProposalData?.proposals?.find((spi: SnapshotProposal) =>
        spi.body.includes(proposal?.transactionHash ?? ''),
      ) !== undefined
        ? snapshotProposalData?.proposals?.find((spi: SnapshotProposal) =>
            spi.body.includes(proposal?.transactionHash ?? ''),
          ).id
        : '',
    ),
    {
      skip: !snapshotProposalData?.proposals?.find((spi: SnapshotProposal) =>
        spi.body.includes(proposal?.transactionHash ?? ''),
      ),
      context: { clientName: 'NounsDAOSnapshot' },
    },
  );

  const snapProp = snapshotProposalData?.proposals.find((spi: SnapshotProposal) =>
    spi.body.includes(proposal?.transactionHash ?? ''),
  );
  const { loading: lilnounsDelegatedVotesLoading, data: lilnounsDelegatedVotesData } =
    useQuery<Delegates>(
      delegateLilNounsAtBlockQuery(
        snapshotVoteData?.votes.map((a: { voter: string }) => a.voter.toLowerCase()) ?? [],
        snapProp?.snapshot ?? 0,
      ),
      {
        skip: !snapshotProposalData?.proposals?.find((spi: SnapshotProposal) =>
          spi.body.includes(proposal?.transactionHash ?? ''),
        ),
        // fetchPolicy: 'no-cache',
      },
    );

  const isMobile = isMobileScreen();

  //* FEDERATION
  // const firstFederationPropId = useFederationProposal("0")?.eID ?? "166" // ?? 166//166; //TODO: fetch eID of proposal 0 from contract/subgraph
  const { firstFederationPropId, federationProposal }  = useFederationProposal(id);
  // console.log(`SSA federationProposal: ${federationProposal?.eID ?? 'no'}`);

  const isFederationProp = (() => {
    if (id !== undefined && firstFederationPropId !== undefined) {
      if (parseInt(id) >= parseInt(firstFederationPropId)) {
        return true;
      }
      return false;
    }

    return false;
  })()

  //* FEDERATION (subgraph call)
  const isAwaitingFederationPropCreation = isFederationProp && !federationProposal == true;

  //* FEDERATION - prop voters (subgraph call) (fetch from lil nouns)
  const {
    loading: federationVotesLoading,
    error: federationVotesError,
    data: federationVoters,
  } = useQuery<FederationProposalVotes>(
    federationProposalVotesQuery(federationProposal?.id ?? '0'),
    {
      context: { clientName: 'Federation' },
      fetchPolicy: 'no-cache',
    },
  );

  const federationVoterIds = federationVoters?.votes?.map(v => v.voter.toLowerCase());

  //* FEDERATION - delegateSnapshot (subgraph call) (fetch from lil nouns)
  const {
    loading: federationDelegatesLoading,
    error: federationDelegatesError,
    data: federationDelegateSnapshot,
  } = useQuery<Delegates>(
    federationDelegateNounsAtBlockQuery(
      federationVoterIds ?? [],
      federationProposal?.startBlock ?? 0,
    ),
    {
      skip: !federationVoters?.votes?.length,
    },
  );

  //* FEDERATION - delegateToNounIds (fetch from lil nouns)
  const { delegates: federationDelegates } = federationDelegateSnapshot || {};
  const federationDelegateToNounIds = federationDelegates?.reduce<Record<string, string[]>>(
    (acc, curr) => {
      acc[curr.id] = curr?.nounsRepresented?.map(nr => nr.id) ?? [];
      return acc;
    },
    {},
  );

  //* FEDERATION - data
  const federationData = federationVoters?.votes?.map(v => ({
    delegate: v.voter,
    supportDetailed: v.supportDetailed,
    nounsRepresented: federationDelegateToNounIds?.[v.voter] ?? [],
  }));

  const [showVoteModal, setShowVoteModal] = useState<boolean>(false);
  const [showDynamicQuorumInfoModal, setShowDynamicQuorumInfoModal] = useState<boolean>(false);
  const [isDelegateView, setIsDelegateView] = useState(false);
  const [isLilNounView, setIsLilNounView] = useState(true);

  const [isQueuePending, setQueuePending] = useState<boolean>(false);
  const [isExecutePending, setExecutePending] = useState<boolean>(false);

  //DONE: Add Pending state for metagov vote start
  const [isCreateFederationPending, setCreateFederationPending] = useState<boolean>(false);

  //DONE: Add Pending state for metagov vote execute
  const [isFederationExecutePending, setExecuteFederationPending] = useState<boolean>(false);

  const dispatch = useAppDispatch();
  const setModal = useCallback((modal: AlertModal) => dispatch(setAlertModal(modal)), [dispatch]);
  const {
    data: dqInfo,
    loading: loadingDQInfo,
    error: dqError,
  } = useQuery(propUsingDynamicQuorum(id ?? '0'), {
    context: { clientName: 'NounsDAO' },
    skip: !proposal,
  });

  const { queueProposal, queueProposalState } = useQueueBigNounProposal();
  const { executeProposal, executeProposalState } = useExecuteBigNounProposal();

  const { propose, proposeState } = useFederationPropose();
  const { executeProposal: executeFederationProposal, executeFederationProposalState } =
    useFederationExecuteProposal();

  const timestamp = Date.now();
  const currentBlock = useBlockNumber();
  const startDate =
    proposal && timestamp && currentBlock
      ? dayjs(timestamp).add(
          AVERAGE_BLOCK_TIME_IN_SECS * (proposal.startBlock - currentBlock),
          'seconds',
        )
      : undefined;

  const endDate =
    proposal && timestamp && currentBlock
      ? dayjs(timestamp).add(
          AVERAGE_BLOCK_TIME_IN_SECS * (proposal.endBlock - currentBlock),
          'seconds',
        )
      : undefined;
  const now = dayjs();

  // Get total votes and format percentages for UI
  const totalVotes = proposal
    ? proposal.forCount + proposal.againstCount + proposal.abstainCount
    : undefined;
  const forPercentage = proposal && totalVotes ? (proposal.forCount * 100) / totalVotes : 0;
  const againstPercentage = proposal && totalVotes ? (proposal.againstCount * 100) / totalVotes : 0;
  const abstainPercentage = proposal && totalVotes ? (proposal.abstainCount * 100) / totalVotes : 0;

  //* FEDERATION
  //DONE: (REVIEW) FEDERATION - PROP VOTING WINDOW
  const federationStartDate =
    federationProposal && timestamp && currentBlock
      ? dayjs(timestamp).add(
          AVERAGE_BLOCK_TIME_IN_SECS * (federationProposal.startBlock - currentBlock),
          'seconds',
        )
      : undefined;

  const federationEndDate =
    federationProposal && timestamp && currentBlock
      ? dayjs(timestamp).add(
          AVERAGE_BLOCK_TIME_IN_SECS * (federationProposal.endBlock - currentBlock),
          'seconds',
        )
      : undefined;

  const federationPropExecutionWindow = federationProposal?.executionWindow ?? 2500;

  const federationPropExecutionWindowDate =
    federationProposal && timestamp && currentBlock
      ? dayjs(timestamp).add(
          AVERAGE_BLOCK_TIME_IN_SECS *
          ((federationProposal.endBlock - federationPropExecutionWindow) - currentBlock),
          'seconds',
        )
      : undefined;

  //DONE: (REVIEW) FEDERATION - total votes and percentages (pass into revised VoteCard)
  const federationTotalVotes = federationProposal
    ? federationProposal.forCount +
      federationProposal.againstCount +
      federationProposal.abstainCount
    : undefined;
  const federationForPercentage =
    federationProposal && federationTotalVotes
      ? (federationProposal.forCount * 100) / federationTotalVotes
      : 0;
  const federationAgainstPercentage =
    federationProposal && federationTotalVotes
      ? (federationProposal.againstCount * 100) / federationTotalVotes
      : 0;
  const federationAbstainPercentage =
    federationProposal && federationTotalVotes
      ? (federationProposal.abstainCount * 100) / federationTotalVotes
      : 0;
      
  // Only count available votes as of the proposal created block
  //TODO: (REVIEW) FEDERATION - if metagov is via federation useUserVotesAsOfBlock(federation startblock)
  const availableVotes = !isLilNounView
    ? useUserVotesAsOfBlock(proposal?.createdBlock ?? undefined)
    : isFederationProp
    ? //TODO: TEMP change to gnars address useUserVotesAsOfBlock(federationProposal?.startBlock ?? undefined)
    useUserGnarsVotesAsOfBlock(federationProposal?.startBlock ?? undefined)
    : useUserVotesAsOfBlock(snapProp?.snapshot ?? undefined);

  const currentQuorum = useCurrentQuorum(
    config.bigNounsAddresses.nounsDAOProxy,
    proposal && proposal.id ? parseInt(proposal.id) : 0,
    dqInfo && dqInfo.proposal ? dqInfo.proposal.quorumCoefficient === '0' : true,
  );

  const hasSucceeded = proposal?.status === ProposalState.SUCCEEDED;
  const isAwaitingStateChange = () => {
    if (hasSucceeded) {
      return true;
    }
    if (proposal?.status === ProposalState.QUEUED) {
      return new Date() >= (proposal?.eta ?? Number.MAX_SAFE_INTEGER);
    }
    return false;
  };

  const startOrEndTimeCopy = () => {
    if (startDate?.isBefore(now) && endDate?.isAfter(now)) {
      return 'Ends';
    }
    if (endDate?.isBefore(now)) {
      return 'Ended';
    }
    return 'Starts';
  };

  const startOrEndTimeTime = () => {
    if (!startDate?.isBefore(now)) {
      return startDate;
    }
    return endDate;
  };

  //TODO: Find out why this doesn't work
  const federationProposalResult = useFederationProposalResult(federationProposal?.id, [federationProposal?.forCount ?? 0, federationProposal?.againstCount ?? 0, federationProposal?.abstainCount ?? 0], federationProposal?.quorumVotes);
 

  const moveStateButtonAction = hasSucceeded ? 'Queue' : 'Execute';
  const moveStateAction = (() => {
    if (hasSucceeded) {
      return () => {
        if (proposal?.id) {
          return queueProposal(proposal.id);
        }
      };
    }
    return () => {
      if (proposal?.id) {
        return executeProposal(proposal.id);
      }
    };
  })();

  const execWindow = useFederationExecutionWindow();
  //TODO: (REVIEW) check if metagov prop has passed (votes casted into nouns dao)

  const isExecutable = (() => {
    if (federationProposal?.status == FederationProposalState.EXPIRED || federationProposal?.status == FederationProposalState.VETOED) return false;

    console.log(`execWindow: ${execWindow}`);
    

    if (currentBlock && execWindow && federationProposal) {
      if (
        currentBlock >= federationProposal?.endBlock - execWindow &&
        federationProposalResult == FederationProposalResult.Undecided &&
        federationProposal?.executed !== true
      ) {
        if (federationProposal?.totalVotes ?? 0 < federationProposal?.quorumVotes) {
          return false;
        }

        return true;
      }
    }

    return false;
  })();

  console.log(`federationProposalResult: ${federationProposalResult}. prop ${federationProposal?.id}. propno ${federationProposal?.eID}. isExecutable=${isExecutable}`);
  

  const voteDirection = (() => {
    if (!federationProposal) return;

    if (
      federationProposal?.forCount > federationProposal?.againstCount &&
      federationProposal?.forCount > federationProposal?.abstainCount
    ) {
      return "'For'";
    } else if (
      federationProposal?.againstCount > federationProposal?.forCount &&
      federationProposal?.againstCount > federationProposal?.abstainCount
    ) {
      return "'Against'";
    } else if (
      federationProposal?.abstainCount > federationProposal?.forCount &&
      federationProposal?.abstainCount > federationProposal?.againstCount
    ) {
      return "'Abstain'";
    }

    return '';
  })();

  const isAwaitingMetagovStateChange = () => {
    console.log(`federationProposalResult = ${federationProposalResult}`);

    if (isExecutable) {
      return true;
    }

    //propose metagov proposal
    if (isAwaitingFederationPropCreation && availableVotes) {
      return true;
    }

    return false;
  };

  //DONE: FEDERATION - Create "Start Vote" button action for federation props (isFederationProp)
  const metagovStateButtonAction = isAwaitingFederationPropCreation
    ? 'Start Vote'
    : isExecutable
    ? `Cast '${voteDirection}' Vote into Nouns DAO`
    : '';

  const metagovStateAction = (() => {
    if (isExecutable) {
      return () => {
        if (proposal?.id && federationProposal?.eID) {
          return executeFederationProposal(proposal.id);
        }
      };
    }

    //DONE: FEDERATION - Change !federationProposal in isAwaitingFederationPropCreation for a better way to check if metagov proposal has been proposed
    if (isAwaitingFederationPropCreation) {
      return async () => {
        if (proposal?.id) {
          console.log(`FF: ${proposal?.id}`);
           return await propose("0x6f3e6272a167e8accb32072d08e0957f9c79223d", proposal?.id)
        }
      };
    }

    return () => {
      if (proposal?.id && federationProposal?.eID) {
        return executeFederationProposal(proposal.id);
      }
    };
  })();

  const onTransactionStateChange = useCallback(
    (
      tx: TransactionStatus,
      successMessage?: string,
      errorExplanation?: string,
      setPending?: (isPending: boolean) => void,
      getErrorMessage?: (error?: string) => string | undefined,
      onFinalState?: () => void,
    ) => {
      console.log(`proposeState: ${JSON.stringify(proposeState)}. ${tx?.errorMessage}`);
      
      switch (tx.status) {
        case 'None':
          setPending?.(false);
          break;
        case 'Mining':
          setPending?.(true);
          break;
        case 'Success':
          setModal({
            title: 'Success',
            message: successMessage || 'Transaction Successful!',
            show: true,
          });
          setPending?.(false);
          onFinalState?.();
          break;
        case 'Fail':
          setModal({
            title: 'Transaction Failed',
            message: tx?.errorMessage || 'Please try again.',
            show: true,
          });
          setPending?.(false);
          onFinalState?.();
          break;
        case 'Exception':
          setModal({
            title: 'Error',
            message: getErrorMessage?.(tx?.errorMessage) || 'Please try again.',
            explanation: errorExplanation || "",
            show: true,
          });
          setPending?.(false);
          onFinalState?.();
          break;
      }
    },
    [setModal],
  );

  useEffect(
    () => onTransactionStateChange(queueProposalState, 'Proposal Queued!', "Couldn't queue proposal", setQueuePending),
    [queueProposalState, onTransactionStateChange, setModal],
  );

  useEffect(
    () => onTransactionStateChange(executeProposalState, 'Proposal Executed!', "Couldn't execute proposal", setExecutePending),
    [executeProposalState, onTransactionStateChange, setModal],
  );

  //TODO: FEDERATION - (REVIEW) Federation prop creation txn (propose)
  useEffect(
    () => onTransactionStateChange(proposeState, 'Vote Started!', "Couldn't start vote", setCreateFederationPending),
    [proposeState, onTransactionStateChange, setModal],
  );

  //TODO: FEDERATION - (REVIEW) Federation execute prop txn (execute)
  useEffect(
    () =>
      onTransactionStateChange(
        executeFederationProposalState,
        'Metagov Proposal Executed!',
        "",
        setExecuteFederationPending,
      ),
    [executeFederationProposalState, onTransactionStateChange, setModal],
  );

  const metagovStartOrEndTimeTime = () => {
    if (fetchedValues.metagovPropStartDate !== undefined) {
      if (fetchedValues.metagovPropStartDate?.isAfter(now)) {
        return fetchedValues.metagovPropStartDate;
      }

      if (fetchedValues.metagovPropEndDate?.isBefore(now)) {
        return fetchedValues.metagovPropEndDate;
      } else if (
        federationProposal &&
        federationProposal?.forCount < federationProposal.quorumVotes
      ) {
        return fetchedValues.metagovPropEndDate;
      } else {
        return fetchedValues.metagovPropExecutionWindowDate;
      }
    }

    return undefined;
  };

  const [showToast, setShowToast] = useState(true);
  useEffect(() => {
    if (showToast) {
      setTimeout(() => {
        setShowToast(false);
      }, 5000);
    }
  }, [showToast]);

  const federationLoading = federationVotesLoading || federationDelegatesLoading;
  const federationError = federationVotesError || federationDelegatesError;

  if (
    !proposal ||
    loading ||
    !data ||
    snapshotProposalLoading ||
    snapshotVoteLoading ||
    lilnounsDelegatedVotesLoading ||
    loadingDQInfo ||
    !dqInfo ||
    federationLoading ||
    federationVotesLoading
  ) {
    return (
      <div className={classes.spinner}>
        <Spinner animation="border" />
      </div>
    );
  }

  const forNouns = getNounVotes(data, 1);
  const againstNouns = getNounVotes(data, 0);
  const abstainNouns = getNounVotes(data, 2);
  const isV2Prop = dqInfo.proposal.quorumCoefficient > 0;

  if (
    error ||
    snapshotProposalError ||
    snapshotVoteError ||
    dqError ||
    federationError ||
    federationVotesError
  ) {
    return <>{'Failed to fetch'}</>;
  }

  const isWalletConnected = !(activeAccount === undefined);

  const isActiveForVoting = (() => {
    if (!snapProp && !isFederationProp) return false;

    //DONE: include an if statement: isFederationProp && !isExecutable
    if (federationProposal?.status == FederationProposalState.ACTIVE) {
      console.log(
        `isActiveForVoting: 000  propid=${federationProposal?.id} status=${federationProposal?.status}. isExecutable=${isExecutable}`,
      );

      return true;
    }
    
    if (snapProp?.state == 'active' && !federationProposal) {
      return true;
    }

    return false;
  })();

  // const isActiveForVoting = !snapProp ? false : snapProp.state == 'active' ? true : false;


  //DONE: (REVIEW) Change to prepareMetagov() and if check snapshot/federation
  const prepareMetagov = (): MetagovProp => {
    let propStatus = proposal.status;
    const metagovState = isFederationProp ? federationProposal?.status : snapProp.state;
    console.log(`metagovState: ${metagovState}. ${isFederationProp}. ${federationProposal?.eID}`);

    if (isFederationProp && federationProposal) {
      //DONE: (REVIEW) prepare federation object

      switch (metagovState) {
        case FederationProposalState.ACTIVE:
          if (proposal.status == ProposalState.PENDING || proposal.status == ProposalState.ACTIVE) {
            //TODO: checks if within window (current block is before execution and end date range) or not within voting window but within execution window
            if (
              federationEndDate?.isAfter(now) &&
              federationPropExecutionWindowDate?.isAfter(now)
            ) {
              propStatus = ProposalState.METAGOV_ACTIVE;
            }

            //TODO: check is not within voting window but within execution window
            //DONE
             if (
              now?.isAfter(federationPropExecutionWindowDate) &&
              now?.isBefore(federationEndDate)
            ) {

              if (federationProposal.forCount < federationProposal.quorumVotes) {
                propStatus = ProposalState.METAGOV_ACTIVE;
              } else {
                propStatus = ProposalState.METAGOV_AWAITING_EXECUTION;
              }
              
            }
          } else {
            propStatus = proposal.status;
          }
          break;

        case FederationProposalState.EXECUTED:
          if (proposal.status == ProposalState.ACTIVE) {
            propStatus = ProposalState.METAGOV_CLOSED; // pending nouns vote
            break;
          }
          propStatus = proposal.status;
          break;

        case FederationProposalState.EXPIRED:
          if (proposal.status == ProposalState.PENDING || proposal.status == ProposalState.ACTIVE) {
            propStatus = ProposalState.METAGOV_EXPIRED;
            break;
          }
          propStatus = proposal.status;
          break;

        case FederationProposalState.VETOED:
          if (proposal.status == ProposalState.PENDING || proposal.status == ProposalState.ACTIVE) {
            propStatus = ProposalState.METAGOV_VETOED;
            break;
          }
          propStatus = proposal.status;
          break;

        case FederationProposalState.UNDETERMINED:
          if (proposal.status == ProposalState.PENDING || proposal.status == ProposalState.ACTIVE) {
            propStatus = ProposalState.METAGOV_AWAITING_INITIATION;
            break;
          }
          propStatus = proposal.status;
          break;

        default:
          propStatus = proposal.status;
          break;
      }

      const snap: MetagovProp = {
        forMetagovNounIds: federationData ? getMetagovNounVotes(federationData, 1) : [],
        againstMetagovNounIds: federationData ? getMetagovNounVotes(federationData, 0) : [],
        abstainMetagovNounIds: federationData ? getMetagovNounVotes(federationData, 2) : [],
        metagovPropEndDate: federationEndDate,
        metagovPropExecutionWindowDate: federationPropExecutionWindowDate,
        metagovPropStartDate: federationStartDate,
        propStatus: propStatus,
        metagovQuroum: federationProposal?.quorumVotes ?? 0,
        metagovForCountAmt: federationProposal?.forCount ?? 0,
        metagovAgainstCountAmt: federationProposal?.againstCount ?? 0,
        metagovAbstainCountAmt: federationProposal?.abstainCount ?? 0,
        snapshotVoters: [],
      };

      return snap;
    } else if (isFederationProp && !federationProposal) {
      propStatus = ProposalState.METAGOV_AWAITING_INITIATION;
    } else if (snapProp && !isFederationProp) {
      const snapVotes: SnapshotVoters[] = Object.values(
        snapshotVoteData?.votes.reduce((res: any, obj: SnapshotVoters, i: number) => {
          const delegatedVoterRepresentedNounIds = lilnounsDelegatedVotesData?.delegates
            .filter((d: any) => d.id === obj.voter.toLowerCase())
            .flatMap((d: any) => d.nounsRepresented)
            .map((d: any) => d.id);

          res[obj.voter] = res[obj.voter] || {
            voter: obj.voter,
            vp: obj.vp,
            choice: obj.choice,
            nounIds: delegatedVoterRepresentedNounIds,
          };

          return res;
        }, []),
      );

      switch (metagovState) {
        case 'active':
          if (proposal.status == ProposalState.PENDING || proposal.status == ProposalState.ACTIVE) {
            propStatus = ProposalState.METAGOV_ACTIVE;
          } else {
            propStatus = proposal.status;
          }
          break;

        case 'closed':
          if (proposal.status == ProposalState.ACTIVE) {
            propStatus = ProposalState.METAGOV_CLOSED;
            break;
          }
          propStatus = proposal.status;
          break;

        case 'pending':
          propStatus = ProposalState.PENDING;
          break;

        default:
          if (proposal.status) {
          }

          propStatus = ProposalState.METAGOV_PENDING; //proposal.status;
          break;
      }

      const snap: MetagovProp = {
        forMetagovNounIds: snapVotes.filter(opt => opt.choice == 1).flatMap(a => a.nounIds),
        againstMetagovNounIds: snapVotes.filter(opt => opt.choice == 2).flatMap(a => a.nounIds),
        abstainMetagovNounIds: snapVotes.filter(opt => opt.choice == 3).flatMap(a => a.nounIds),
        metagovPropEndDate: dayjs.unix(snapProp.end),
        metagovPropExecutionWindowDate: dayjs.unix(snapProp.end),
        metagovPropStartDate: dayjs.unix(snapProp.start),
        propStatus: propStatus,
        metagovQuroum: 0,
        metagovForCountAmt: snapProp.scores[0],
        metagovAgainstCountAmt: snapProp.scores[1],
        metagovAbstainCountAmt: snapProp.scores[2],
        snapshotVoters: snapVotes,
      };

      return snap;
    }

    const snap: MetagovProp = {
      forMetagovNounIds: [],
      againstMetagovNounIds: [],
      abstainMetagovNounIds: [],
      metagovPropEndDate: undefined,
      metagovPropExecutionWindowDate: undefined,
      metagovPropStartDate: undefined,
      propStatus: propStatus,
      metagovQuroum: 0,
      metagovForCountAmt: 0,
      metagovAgainstCountAmt: 0,
      metagovAbstainCountAmt: 0,
      snapshotVoters: [],
    };

    return snap;
  };

  const fetchedValues = prepareMetagov();

  const metagovStartOrEndTimeCopy = () => {
    if (
      fetchedValues.metagovPropStartDate?.isBefore(now) &&
      fetchedValues.metagovPropExecutionWindowDate?.isAfter(now) &&
      fetchedValues.metagovPropEndDate?.isAfter(now)
    ) {
      return 'Ends';
    } else if (
      fetchedValues.metagovPropEndDate?.isAfter(now) &&
      fetchedValues.metagovPropExecutionWindowDate?.isBefore(now)
      ) {
      //if quroum is not met, voting period is pushed to end block
      if (fetchedValues && fetchedValues.metagovForCountAmt < fetchedValues.metagovQuroum) {
        return 'Ends';
      } else {
        return 'Ended';
      }
    } else if (fetchedValues.metagovPropEndDate?.isBefore(now)) {
      return 'Ended';
    }

   


    return 'Starts';
  };

  proposal.status = fetchedValues.propStatus;

  //TODO: fix wallet disconnect white screen (UI related below - comment out and see)
  return (
    <Section fullWidth={false} className={classes.votePage}>
      {showDynamicQuorumInfoModal && (
        <DynamicQuorumInfoModal
          proposal={proposal}
          isNounsDAOProp={true}
          againstVotesAbsolute={againstNouns.length}
          onDismiss={() => setShowDynamicQuorumInfoModal(false)}
        />
      )}

      {federationProposal !== undefined ? (
        <VoteModal
          show={showVoteModal}
          onHide={() => setShowVoteModal(false)}
          proposalId={proposal?.id}
          federationProposal={federationProposal}
          availableVotes={availableVotes || 0}
        />
      ) : (
        <SnapshotVoteModalModal
          show={showVoteModal}
          onHide={() => setShowVoteModal(false)}
          proposalId={proposal?.id}
          snapshotProposal={snapProp}
          federationProposal={federationProposal}
          availableVotes={availableVotes || 0}
        />
      )}

      <Col lg={10} className={classes.wrapper}>
        {proposal && (
          <ProposalHeader
            snapshotProposal={snapProp}
            federationProposal={federationProposal}
            // isFederationProp={isFederationProp}
            proposal={proposal}
            isNounsDAOProp={true}
            isActiveForVoting={isActiveForVoting}
            isWalletConnected={isWalletConnected}
            submitButtonClickHandler={() => setShowVoteModal(true)}
          />
        )}
      </Col>
      <Col lg={10} className={clsx(classes.proposal, classes.wrapper)}>
        {/* //DONE: FEDERATION - {REVIEW) FEDERATION - REFACTOR FOR EXECUTE AND PROPOSE */}

        {isAwaitingMetagovStateChange() && (
          <Row className={clsx(classes.section, classes.transitionStateButtonSection)}>
            <Col className="d-grid">
              <Button
                onClick={metagovStateAction}
                disabled={isCreateFederationPending || isFederationExecutePending}
                variant="dark"
                className={classes.transitionStateButton}
              >
                {isCreateFederationPending || isFederationExecutePending ? (
                  <Spinner animation="border" />
                ) : (
                  `${metagovStateButtonAction} ⌐◧-◧`
                )}
              </Button>
            </Col>
          </Row>
        )}

        {isAwaitingStateChange() && (
          <Row className={clsx(classes.section, classes.transitionStateButtonSection)}>
            <Col className="d-grid">
              <Button
                onClick={moveStateAction}
                disabled={isQueuePending || isExecutePending}
                variant="dark"
                className={classes.transitionStateButton}
              >
                {isQueuePending || isExecutePending ? (
                  <Spinner animation="border" />
                ) : (
                  `${moveStateButtonAction} Proposal ⌐◧-◧`
                )}
              </Button>
            </Col>
          </Row>
        )}

        <p
          onClick={() => {
            //TODO: implement delegate view
            if (isDelegateView) {
              setIsDelegateView(false);
              if (snapProp) {
                setIsLilNounView(true);
              }
            }

            if (!isDelegateView && !isLilNounView) {
              !isMobile ? setIsDelegateView(true) : setIsLilNounView(true);
            }

            if (isLilNounView) {
              setIsLilNounView(false);
            }
          }}
          className={classes.toggleVoteView}
        >
          {!snapProp
            ? isDelegateView
              ? 'Switch to Noun view'
              : 'Switch to Noun delegate view'
            : !isMobile
            ? isDelegateView
              ? 'Switch to Lil Noun view'
              : isLilNounView
              ? 'Switch to Noun view'
              : 'Switch to Noun delegate view'
            : isLilNounView
            ? 'Switch to Noun view'
            : 'Switch to Lil Noun view'}

          {/* {isLilNounView ? 'Switch to Noun view' : 'Switch to Lil Noun view'} */}
        </p>

        <Row>
          <VoteCard
            proposal={proposal}
            percentage={
              isLilNounView && isFederationProp ? federationForPercentage : forPercentage
            }
            isLilNounView={isLilNounView}
            nounIds={forNouns}
            lilnounIds={fetchedValues.forMetagovNounIds}
            variant={VoteCardVariant.FOR}
            delegateView={isDelegateView}
            snapshotView={isLilNounView}
            delegateGroupedVoteData={data}
            isNounsDAOProp={true}
            snapshotVoteCount={fetchedValues.metagovForCountAmt}
          />
          <VoteCard
            proposal={proposal}
            percentage={
              isLilNounView && isFederationProp ? federationAgainstPercentage : againstPercentage
            }
            isLilNounView={isLilNounView}
            nounIds={againstNouns}
            lilnounIds={fetchedValues.againstMetagovNounIds}
            variant={VoteCardVariant.AGAINST}
            delegateView={isDelegateView}
            snapshotView={isLilNounView}
            delegateGroupedVoteData={data}
            isNounsDAOProp={true}
            snapshotVoteCount={fetchedValues.metagovAgainstCountAmt}
          />
          <VoteCard
            proposal={proposal}
            percentage={
              isLilNounView && isFederationProp ? federationAbstainPercentage : abstainPercentage
            }
            isLilNounView={isLilNounView}
            nounIds={abstainNouns}
            lilnounIds={fetchedValues.abstainMetagovNounIds}
            variant={VoteCardVariant.ABSTAIN}
            delegateView={isDelegateView}
            snapshotView={isLilNounView}
            delegateGroupedVoteData={data}
            isNounsDAOProp={true}
            snapshotVoteCount={fetchedValues.metagovAbstainCountAmt}
          />
        </Row>

        {/* TODO abstract this into a component  */}
        <Row>
          <Col xl={4} lg={12}>
            <Card className={classes.voteInfoCard}>
              <Card.Body className="p-2">
                <div className={classes.voteMetadataRow}>
                  <div className={classes.voteMetadataRowTitle}>
                    <h1>Threshold</h1>
                  </div>
                  {!isLilNounView && isV2Prop && (
                    <ReactTooltip
                      id={'view-dq-info'}
                      className={classes.delegateHover}
                      getContent={dataTip => {
                        return <a>View Dynamic Quorum Info</a>;
                      }}
                    />
                  )}
                  <div
                    data-for="view-dq-info"
                    data-tip="View Dynamic Quorum Info"
                    onClick={() =>
                      setShowDynamicQuorumInfoModal(true && isV2Prop && !isLilNounView)
                    }
                    className={clsx(classes.thresholdInfo, isV2Prop ? classes.cursorPointer : '')}
                  >
                    <span>{isLilNounView ? 'Quorum' : isV2Prop ? 'Current Quorum' : 'Quorum'}</span>
                    {isLilNounView ? (
                      <h3>{fetchedValues.metagovQuroum ?? "N/A"}</h3>
                    ) : (
                      <h3>
                        {isV2Prop ? currentQuorum ?? 0 : proposal.quorumVotes} votes
                        {isV2Prop && <SearchIcon className={classes.dqIcon} />}
                      </h3>
                    )}
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
          <Col xl={4} lg={12}>
            <Card className={classes.voteInfoCard}>
              <Card.Body className="p-2">
                <Row className={classes.voteMetadataRow}>
                  <Col className={classes.voteMetadataRowTitle}>
                    <h1>{!isLilNounView ? startOrEndTimeCopy() : metagovStartOrEndTimeCopy()}</h1>
                  </Col>
                  <Col className={classes.voteMetadataTime}>
                    <span>
                      {metagovStartOrEndTimeTime() !== undefined
                        ? !isLilNounView
                          ? startOrEndTimeTime() && startOrEndTimeTime()?.format('h:mm A z')
                          : metagovStartOrEndTimeTime() &&
                            metagovStartOrEndTimeTime()?.format('h:mm A z')
                        : !isLilNounView
                        ? startOrEndTimeTime() && startOrEndTimeTime()?.format('h:mm A z')
                        : 'Time'}
                    </span>
                    <h3>
                      {metagovStartOrEndTimeTime() !== undefined
                        ? !isLilNounView
                          ? startOrEndTimeTime() && startOrEndTimeTime()?.format('MMM D, YYYY')
                          : metagovStartOrEndTimeTime() &&
                            metagovStartOrEndTimeTime()?.format('MMM D, YYYY')
                        : !isLilNounView
                        ? startOrEndTimeTime() && startOrEndTimeTime()?.format('MMM D, YYYY')
                        : 'N/A'}
                    </h3>
                  </Col>
                </Row>
              </Card.Body>
            </Card>
          </Col>
          <Col xl={4} lg={12}>
            <Card className={classes.voteInfoCard}>
              <Card.Body className="p-2">
                <Row className={classes.voteMetadataRow}>
                  <Col className={classes.voteMetadataRowTitle}>
                    <h1>Snapshot</h1>
                  </Col>
                  <Col className={classes.snapshotBlock}>
                    <span>Taken at block</span>
                    <h3>{proposal.createdBlock}</h3>
                  </Col>
                </Row>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        <ProposalContent proposal={proposal} />
      </Col>
      
    </Section>
  );
};

export default NounsVotePage;
