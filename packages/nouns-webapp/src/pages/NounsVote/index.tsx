import { Row, Col, Button, Card, Spinner } from 'react-bootstrap';
import Section from '../../layout/Section';
import { ProposalState } from '../../wrappers/nounsDao';
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
} from '../../wrappers/subgraph';
import { getNounVotes } from '../../utils/getNounsVotes';
import { useQuery } from '@apollo/client';
import { SnapshotProposal } from '../../components/Proposals';
// import { isMobileScreen } from '../../utils/isMobile';
import { AVERAGE_BLOCK_TIME_IN_SECS } from '../../utils/constants';
import { SearchIcon } from '@heroicons/react/solid';
import ReactTooltip from 'react-tooltip';
import DynamicQuorumInfoModal from '../../components/DynamicQuorumInfoModal';
import config from '../../config';
import {
  FederationProposalState,
  useFederationExecuteProposal,
  useFederationProposal,
  useFederationPropose,
} from '../../wrappers/federation';
import { getMetagovNounVotes } from '../../utils/getMetagovNounsVotes';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advanced);

export interface SnapshotVoters {
  voter: string;
  vp: number;
  choice: number;
  nounIds: string[];
}

interface SnapshotProp {
  forSnapshotNounIds: string[];
  againstSnapshotNounIds: string[];
  abstainSnapshotNounIds: string[];

  snapshotPropEndDate: dayjs.Dayjs | undefined;
  snapshotPropStartDate: dayjs.Dayjs | undefined;
  propStatus: ProposalState;
  snapshotForCountAmt: number;
  snapshotAgainstCountAmt: number;
  snapshotAbstainCountAmt: number;
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

  //* FEDERATION
  const firstFederationPropId = 110; //TODO: fetch eID of proposal 0 from contract/subgraph
  const isFederationProp = firstFederationPropId > firstFederationPropId;

  //* FEDERATION
  const federationProposal = useFederationProposal(id);
  const isAwaitingFederationPropCreation = isFederationProp && !federationProposal == true;

  //* FEDERATION - prop voters
  const {
    loading: federationVotesLoading,
    error: federationVotesError,
    data: federationVoters,
  } = useQuery<ProposalVotes>(proposalVotesQuery(federationProposal?.id ?? '0'));
  const federationVoterIds = federationVoters?.votes?.map(v => v.voter.id);

  //* FEDERATION - delegateSnapshot
  const {
    loading: federationDelegatesLoading,
    error: federationDelegatesError,
    data: federationDelegateSnapshot,
  } = useQuery<Delegates>(delegateNounsAtBlockQuery(federationVoterIds ?? [], federationProposal?.startBlock ?? 0), {
    skip: !voters?.votes?.length,
  });

  //* FEDERATION - delegateToNounIds
  const { delegates: federationDelegates } = federationDelegateSnapshot || {};
  const federationDelegateToNounIds = federationDelegates?.reduce<Record<string, string[]>>((acc, curr) => {
    acc[curr.id] = curr?.nounsRepresented?.map(nr => nr.id) ?? [];
    return acc;
  }, {});

  //* FEDERATION - data
  const federationData = federationVoters?.votes?.map(v => ({
    delegate: v.voter.id,
    supportDetailed: v.supportDetailed,
    nounsRepresented: federationDelegateToNounIds?.[v.voter.id] ?? [],
  }));


  //TODO: Only fetch snapshot data if prop is pre federation metagov upgrade
  //* SNAPSHOT
  const {
    loading: snapshotProposalLoading,
    error: snapshotProposalError,
    data: snapshotProposalData,
  } = useQuery(snapshotProposalsQuery(), {
    context: { clientName: 'NounsDAOSnapshot' },
    skip: !proposal && !isFederationProp,
  });

  //* SNAPSHOT
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

  const [showVoteModal, setShowVoteModal] = useState<boolean>(false);
  const [showDynamicQuorumInfoModal, setShowDynamicQuorumInfoModal] = useState<boolean>(false);
  const [isDelegateView, setIsDelegateView] = useState(false);
  const [isLilNounView, setIsLilNounView] = useState(true);

  const [isQueuePending, setQueuePending] = useState<boolean>(false);
  const [isExecutePending, setExecutePending] = useState<boolean>(false);

  //TODO: Add Pending state for metagov vote start
  const [isCreateFederationPending, setCreateFederationPending] = useState<boolean>(false);

  //TODO: Add Pending state for metagov vote execute
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

  //TODO: (REVIEW) Add Execute metagov prop
  const { executeFederationProposal, executeFederationProposalState } =
    useFederationExecuteProposal();

  //TODO: (REVIEW) Add Start metagov prop
  const { createFederationProposal, createFederationProposalState } = useFederationPropose();

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

  //* FEDERATION
  //TODO: (REVIEW) FEDERATION - PROP VOTING WINDOW
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

  //* Get total votes and format percentages for UI
  const totalVotes = proposal
    ? proposal.forCount + proposal.againstCount + proposal.abstainCount
    : undefined;
  const forPercentage = proposal && totalVotes ? (proposal.forCount * 100) / totalVotes : 0;
  const againstPercentage = proposal && totalVotes ? (proposal.againstCount * 100) / totalVotes : 0;
  const abstainPercentage = proposal && totalVotes ? (proposal.abstainCount * 100) / totalVotes : 0;

  //TODO: (REVIEW) FEDERATION - total votes and percentages (pass into revised VoteCard)
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

  //* Only count available votes as of the proposal created block
  //TODO: (REVIEW) FEDERATION - if metagov is via federation useUserVotesAsOfBlock(federation startblock)
  const availableVotes = !isLilNounView
    ? useUserVotesAsOfBlock(proposal?.createdBlock ?? undefined)
    : isFederationProp
    ? useUserVotesAsOfBlock(federationProposal?.startBlock ?? undefined)
    : useUserVotesAsOfBlock(snapProp?.snapshot ?? undefined);

  const currentQuorum = useCurrentQuorum(
    config.bigNounsAddresses.nounsDAOProxy,
    proposal && proposal.id ? parseInt(proposal.id) : 0,
    dqInfo && dqInfo.proposal ? dqInfo.proposal.quorumCoefficient === '0' : true,
  );

  //TODO: Fetch Federation metagov currentQuorum

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

  //TODO: (REVIEW) check if metagov prop has passed (votes casted into nouns dao)
  const hasMetagovSucceeded = federationProposal?.status === FederationProposalState.SUCCEEDED;
  const isAwaitingMetagovStateChange = () => {
    if (hasMetagovSucceeded) {
      return true;
    }

    //?QUEUED, SUCCEEDED or EXECUTED?
    if (federationProposal?.status === FederationProposalState.SUCCEEDED) {
      return new Date() >= (proposal?.eta ?? Number.MAX_SAFE_INTEGER);
    }

    //propose metagov proposal
    //TODO: (REVIEW) - Change !federationProposal in isAwaitingFederationPropCreation for a better way to check if metagove proposal has been proposed
    if (isAwaitingFederationPropCreation) {
      return true;
    }

    return false;
  };

  //TODO: (REVIEW) - Create "Start Vote" button action for federation props (isFederationProp)
  const metagovStateButtonAction = isAwaitingFederationPropCreation
    ? 'Start Voting'
    : hasMetagovSucceeded
    ? 'Cast Vote into Nouns DAO'
    : '';
  const metagovStateAction = (() => {
    if (hasMetagovSucceeded) {
      return () => {
        if (proposal?.id) {
          //TODO: FEDERATION - execute or queue?
          return executeFederationProposal(proposal.id);
        }
      };
    }

    //propose metagov proposal
    //TODO: (REVIEW) - Change !federationProposal in isAwaitingFederationPropCreation for a better way to check if metagove proposal has been proposed
    if (isAwaitingFederationPropCreation) {
      return () => {
        if (proposal?.id) {
          return createFederationProposal('eDAO', proposal?.id);
        }
      };
    }

    return () => {
      if (proposal?.id) {
        return executeFederationProposal(proposal.id);
      }
    };
  })();

  const onTransactionStateChange = useCallback(
    (
      tx: TransactionStatus,
      successMessage?: string,
      setPending?: (isPending: boolean) => void,
      getErrorMessage?: (error?: string) => string | undefined,
      onFinalState?: () => void,
    ) => {
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
    () => onTransactionStateChange(queueProposalState, 'Proposal Queued!', setQueuePending),
    [queueProposalState, onTransactionStateChange, setModal],
  );

  useEffect(
    () => onTransactionStateChange(executeProposalState, 'Proposal Executed!', setExecutePending),
    [executeProposalState, onTransactionStateChange, setModal],
  );

  //TODO: (REVIEW) Federation prop creation txn (propose)
  useEffect(
    () =>
      onTransactionStateChange(
        createFederationProposalState,
        'Proposal Created!',
        setCreateFederationPending,
      ),
    [createFederationProposalState, onTransactionStateChange, setModal],
  );

  //TODO: (REVIEW) Federation execute prop txn (execute)
  useEffect(
    () =>
      onTransactionStateChange(
        executeFederationProposalState,
        'Metagov Proposal Executed!',
        setExecuteFederationPending,
      ),
    [executeFederationProposalState, onTransactionStateChange, setModal],
  );

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
    !dqInfo || federationLoading || federationError
    
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

  if (error || snapshotProposalError || snapshotVoteError || dqError) {
    return <>{'Failed to fetch'}</>;
  }

  const isWalletConnected = !(activeAccount === undefined);
  const isActiveForVoting = !snapProp ? false : snapProp.state == 'active' ? true : false;

  //TODO: (REVIEW) Change to prepareMetagov() and if check snapshot/federation
  const prepareSnapshot = (): SnapshotProp => {
    let propStatus = proposal.status;
    const metagovState = isFederationProp ? federationProposal?.status : snapProp.state;

    if (!snapProp && isFederationProp) {
      const snap: SnapshotProp = {
        forSnapshotNounIds: [],
        againstSnapshotNounIds: [],
        abstainSnapshotNounIds: [],
        snapshotPropEndDate: undefined,
        snapshotPropStartDate: undefined,
        propStatus: propStatus,
        snapshotForCountAmt: 0,
        snapshotAgainstCountAmt: 0,
        snapshotAbstainCountAmt: 0,
        snapshotVoters: [],
      };

      return snap;
    }
    //TODO: FEDERATION - Find out how to fetch vote
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

    if (isFederationProp) {
      //TODO: (REVIEW) prepare federation object
      //* Available federation states
      //   if (proposal.vetoed) {
      //     return ProposalState.Vetoed;
      // } else if (proposal.executed) {
      //     return ProposalState.Executed;
      // } else if (block.number > proposal.endBlock) {
      //     return ProposalState.Expired;
      // } else {
      //     return ProposalState.Active;
      // }

      //TODO: Override in the event nouns prop is cancelled
      switch (metagovState) {
        case FederationProposalState.ACTIVE:
          if (proposal.status == ProposalState.PENDING || proposal.status == ProposalState.ACTIVE) {
            propStatus = ProposalState.METAGOV_ACTIVE; // active metagov vote
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
          propStatus = ProposalState.METAGOV_CLOSED; //TODO: METAGOV_EXPIRED
          break;

        case FederationProposalState.VETOED:
          if (proposal.status == ProposalState.ACTIVE) {
            propStatus = ProposalState.VETOED;
            break;
          }
          propStatus = proposal.status;
          break;

        // case 'pending':
        //   propStatus = ProposalState.PENDING;
        //   break;

        default:
          if (proposal.status) {
          }
          propStatus = proposal.status;
          break;
      }

      const snap: SnapshotProp = {
        forSnapshotNounIds: getMetagovNounVotes(federationData, 1),
        againstSnapshotNounIds: getMetagovNounVotes(federationData, 0),
        abstainSnapshotNounIds: getMetagovNounVotes(federationData, 2),
        snapshotPropEndDate: federationStartDate,
        snapshotPropStartDate: federationEndDate,
        propStatus: propStatus,
        snapshotForCountAmt: federationProposal?.forCount ?? 0,
        snapshotAgainstCountAmt: federationProposal?.againstCount ?? 0,
        snapshotAbstainCountAmt: federationProposal?.abstainCount ?? 0,
        snapshotVoters: [],
      };

      return snap;
    }

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
        propStatus = proposal.status;
        break;
    }

    const snap: SnapshotProp = {
      forSnapshotNounIds: snapVotes.filter(opt => opt.choice == 1).flatMap(a => a.nounIds),
      againstSnapshotNounIds: snapVotes.filter(opt => opt.choice == 2).flatMap(a => a.nounIds),
      abstainSnapshotNounIds: snapVotes.filter(opt => opt.choice == 3).flatMap(a => a.nounIds),
      snapshotPropEndDate: dayjs.unix(snapProp.end),
      snapshotPropStartDate: dayjs.unix(snapProp.start),
      propStatus: propStatus,
      snapshotForCountAmt: snapProp.scores[0],
      snapshotAgainstCountAmt: snapProp.scores[1],
      snapshotAbstainCountAmt: snapProp.scores[2],
      snapshotVoters: snapVotes,
    };

    return snap;
  };

  const fetchedValues = prepareSnapshot();

  //TODO: (REVIEW) Check if prop metagov is via snapshot or federation
  const metagovStartOrEndTimeCopy = () => {
    if (
      fetchedValues.snapshotPropStartDate?.isBefore(now) &&
      fetchedValues.snapshotPropEndDate?.isAfter(now)
    ) {
      return 'Snapshot Ends';
    }
    if (fetchedValues.snapshotPropEndDate?.isBefore(now)) {
      return 'Ended';
    }
    return 'Starts';
  };

  //TODO: (REVIEW) Check if prop metagov is via snapshot or federation
  const metagovStartOrEndTimeTime = () => {
    if (fetchedValues.snapshotPropStartDate !== undefined) {
      if (!fetchedValues.snapshotPropStartDate?.isBefore(now)) {
        return fetchedValues.snapshotPropStartDate;
      }
      return fetchedValues.snapshotPropEndDate;
    }

    return undefined;
  };

  proposal.status = fetchedValues.propStatus;

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
      <SnapshotVoteModalModal
        show={showVoteModal}
        onHide={() => setShowVoteModal(false)}
        proposalId={proposal?.id}
        snapshotProposal={snapProp}
        availableVotes={availableVotes || 0}
      />
      <Col lg={10} className={classes.wrapper}>
        {proposal && (
          <ProposalHeader
            snapshotProposal={snapProp}
            proposal={proposal}
            isNounsDAOProp={true}
            isActiveForVoting={isActiveForVoting}
            isWalletConnected={isWalletConnected}
            submitButtonClickHandler={() => setShowVoteModal(true)}
          />
        )}
      </Col>
      <Col lg={10} className={clsx(classes.proposal, classes.wrapper)}>
        {/* //TODO: {REVIEW) FEDERATION - REFACTOR FOR EXECUTE AND PROPOSE */}
        {isAwaitingMetagovStateChange() && (
          <Button
            onClick={metagovStateAction}
            disabled={isCreateFederationPending || isFederationExecutePending}
            variant="danger"
            className={classes.metagovTransitionStateButton}
          >
            {isCreateFederationPending || isFederationExecutePending ? (
              <Spinner animation="border" />
            ) : (
              `${metagovStateButtonAction} ⌐◧-◧`
            )}
          </Button>
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
            if (isLilNounView) {
              setIsLilNounView(false);
            }

            if (!isLilNounView) {
              setIsLilNounView(true);
            }
          }}
          className={classes.toggleVoteView}
        >
          {isLilNounView ? 'Switch to Noun view' : 'Switch to Lil Noun view'}
        </p>

        <Row>
          <VoteCard
            proposal={proposal}
            percentage={isLilNounView && isFederationProp ? forPercentage : federationForPercentage}
            nounIds={forNouns}
            lilnounIds={fetchedValues.forSnapshotNounIds}
            variant={VoteCardVariant.FOR}
            delegateView={isDelegateView}
            snapshotView={isLilNounView}
            delegateGroupedVoteData={data}
            isNounsDAOProp={true}
            snapshotVoteCount={fetchedValues.snapshotForCountAmt}
          />
          <VoteCard
            proposal={proposal}
            percentage={
              isLilNounView && isFederationProp ? againstPercentage : federationAgainstPercentage
            }
            nounIds={againstNouns}
            lilnounIds={fetchedValues.againstSnapshotNounIds}
            variant={VoteCardVariant.AGAINST}
            delegateView={isDelegateView}
            snapshotView={isLilNounView}
            delegateGroupedVoteData={data}
            isNounsDAOProp={true}
            snapshotVoteCount={fetchedValues.snapshotAgainstCountAmt}
          />
          <VoteCard
            proposal={proposal}
            percentage={
              isLilNounView && isFederationProp ? abstainPercentage : federationAbstainPercentage
            }
            nounIds={abstainNouns}
            lilnounIds={fetchedValues.abstainSnapshotNounIds}
            variant={VoteCardVariant.ABSTAIN}
            delegateView={isDelegateView}
            snapshotView={isLilNounView}
            delegateGroupedVoteData={data}
            isNounsDAOProp={true}
            snapshotVoteCount={fetchedValues.snapshotAbstainCountAmt}
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
                      <h3>N/A</h3>
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
