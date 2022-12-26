import { Proposal, ProposalState, useProposalThreshold } from '../../wrappers/nounsDao';
import { Alert, Button } from 'react-bootstrap';
import ProposalStatus from '../ProposalStatus';
import classes from './Proposals.module.css';
import { useHistory } from 'react-router-dom';
import { useBlockNumber, useEthers } from '@usedapp/core';
import { isMobileScreen } from '../../utils/isMobile';
import clsx from 'clsx';
import { useNounTokenBalance, useUserDelegatee, useUserVotes } from '../../wrappers/nounToken';
import { ClockIcon } from '@heroicons/react/solid';
import proposalStatusClasses from '../ProposalStatus/ProposalStatus.module.css';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useState } from 'react';
import DelegationModal from '../DelegationModal';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import advanced from 'dayjs/plugin/advancedFormat';
import { AVERAGE_BLOCK_TIME_IN_SECS } from '../../utils/constants';
import {
  FederationProposal,
  FederationProposalState,
  useFederationCurrentQuorum,
} from '../../wrappers/federation';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advanced);
dayjs.extend(relativeTime);

const getCountdownCopy = (
  proposal: Proposal,
  currentBlock: number,
  propState?: ProposalState,
  snapshotProp?: SnapshotProposal,
  federationProposal?: FederationProposal,
) => {
  const timestamp = Date.now();
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

  const expiresDate = proposal && dayjs(proposal.eta).add(14, 'days');

  const now = dayjs();

  if (
    snapshotProp &&
    !federationProposal &&
    (propState == ProposalState.METAGOV_ACTIVE || propState == ProposalState.METAGOV_CLOSED)
  ) {
    const snapshotPropEndDate = dayjs.unix(snapshotProp.end);
    const snapshotPropStartDate = dayjs.unix(snapshotProp.start);

    if (snapshotPropStartDate?.isBefore(now) && snapshotPropEndDate?.isAfter(now)) {
      return `Lil Nouns Voting Ends ${snapshotPropEndDate.fromNow()}`;
    }
    if (snapshotPropEndDate?.isBefore(now)) {
      return `Nouns Voting Ends ${endDate?.fromNow()}`;
    }
    return `Lil Nouns Voting Starts ${snapshotPropStartDate.fromNow()}`;
  }

  if (
    federationProposal &&
    (propState == ProposalState.METAGOV_ACTIVE ||
      propState == ProposalState.METAGOV_CLOSED ||
      propState == ProposalState.METAGOV_AWAITING_EXECUTION)
  ) {
    //DONE: FEDERATION - fetch voting window to allow for proposal execution during voting window
    // const federationPropEndDate = dayjs.unix(federationProposal.endBlock);
    // const federationPropStartDate = dayjs.unix(federationProposal.startBlock);

    const federationPropStartDate =
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
              (federationProposal.endBlock - federationPropExecutionWindow - currentBlock),
            'seconds',
          )
        : undefined;

    console.log(`federationPropStartDate: ${federationPropStartDate}`);

    if (
      federationProposal.status == FederationProposalState.ACTIVE &&
      federationPropStartDate?.isBefore(now) &&
      federationEndDate?.isAfter(now) &&
      federationPropExecutionWindowDate
    ) {
      //* Federation voting lasts up until endblock if quroum is not met
      if (federationProposal.quorumVotes > federationProposal.forCount && federationPropExecutionWindowDate.isBefore(now)) {
        return `Lil Nouns Voting Ends ${federationEndDate.fromNow()}`;
      }

      return `Lil Nouns Voting Ends ${federationPropExecutionWindowDate.fromNow()}`;
    }

    //DONE: FEDERATION - REFACTOR END BLOCK EXECUTIONWINDOW CONDITIONALS
    //DONE: FEDERATION - EXECUTION WINDOW = ENDBLOCK - 2500 BLOCKS
    // BETWEEN ENDBLOCK AND EXECUTION WINDOW
    // AWAITING CONFIRMATION FROM WIZ

    //* Execution Window
    if (
      !federationProposal.executed &&
      federationProposal.status == FederationProposalState.ACTIVE &&
      now?.isAfter(federationPropExecutionWindowDate) &&
      now?.isBefore(federationEndDate)
    ) {
      return `Expires ${endDate?.fromNow()}`;
    }

    //DONE: FEDERATION - only show post execution
    //DONE: FEDERATION - if nouns voting has ended and fed is still active - call expired and remove countdown
    if (
      // federationPropExecutionWindowDate?.isBefore(now) &&
      // now?.isAfter(federationPropExecutionWindowDate) &&
      federationProposal.executed ||
      (now?.isAfter(federationEndDate) &&
        federationProposal.status == FederationProposalState.EXPIRED) ||
      federationProposal.status == FederationProposalState.VETOED ||
      federationProposal.status == FederationProposalState.EXECUTED ||
      federationProposal.status == FederationProposalState.UNDETERMINED
    ) {
      return `Nouns Voting Ends ${endDate?.fromNow()}`;
    }

    return `Lil Nouns Voting Starts ${federationPropStartDate?.fromNow()}`;
  }

  if (startDate?.isBefore(now) && endDate?.isAfter(now)) {
    return `Ends ${endDate.fromNow()}`;
  }
  if (endDate?.isBefore(now)) {
    return `Expires ${expiresDate.fromNow()}`;
  }
  return `Starts ${dayjs(startDate).fromNow()}`;
};

export enum Vote_ {
  AGAINST = 0,
  FOR = 1,
  ABSTAIN = 2,
}

export enum ProposalState_ {
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
}

export interface SnapshotProposal {
  id: string;
  title: string;
  body: string;
  state: 'active' | 'closed' | 'pending';
  choices: 'For' | 'Against' | 'Abstain';
  start: number;
  end: number;
  snapshot: string;
  author: string; //proposer
  proposalNo: number;

  scores_total: number;
  scores: number[];

  transactionHash: string;
  [key: string]: any;
}

export const LilNounProposalRow = ({ proposal }: { proposal: Proposal }) => {
  const currentBlock = useBlockNumber();

  const isPropInStateToHaveCountDown =
    proposal.status === ProposalState.PENDING ||
    proposal.status === ProposalState.ACTIVE ||
    proposal.status === ProposalState.QUEUED;

  const countdownPill = (
    <div className={classes.proposalStatusWrapper}>
      <div className={clsx(proposalStatusClasses.proposalStatus, classes.countdownPill)}>
        <div className={classes.countdownPillContentWrapper}>
          <span className={classes.countdownPillClock}>
            <ClockIcon height={16} width={16} />
          </span>{' '}
          <span className={classes.countdownPillText}>
            {getCountdownCopy(proposal, currentBlock || 0)}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <a
      className={clsx(classes.proposalLink, classes.proposalLinkWithCountdown)}
      href={`/vote/${proposal.id}`}
      key={proposal.id}
    >
      <div className={classes.proposalInfoWrapper}>
        <span className={classes.proposalTitle}>
          <span className={classes.proposalId}>{proposal.id}</span> <span>{proposal.title}</span>
        </span>

        {isPropInStateToHaveCountDown && (
          <div className={classes.desktopCountdownWrapper}>{countdownPill}</div>
        )}
        <div className={clsx(classes.proposalStatusWrapper, classes.votePillWrapper)}>
          <ProposalStatus status={proposal.status}></ProposalStatus>
        </div>
      </div>

      {isPropInStateToHaveCountDown && (
        <div className={classes.mobileCountdownWrapper}>{countdownPill}</div>
      )}
    </a>
  );
};

export const bigNounsPropStatus = (proposal: Proposal, snapshotVoteObject?: SnapshotProposal) => {
  let propStatus = proposal.status;

  if (snapshotVoteObject && !proposal.snapshotForCount) {
    proposal.snapshotProposalId = snapshotVoteObject.id;

    if (snapshotVoteObject.scores_total) {
      const scores = snapshotVoteObject.scores;
      proposal.snapshotForCount == scores[0];
      proposal.snapshotAgainstCount == scores[1];
      proposal.snapshotAbstainCount == scores[2];
    }

    switch (snapshotVoteObject.state) {
      case 'active':
        proposal.snapshotEnd = snapshotVoteObject.end;
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
        propStatus = proposal.status;
        break;
    }
  } else if (!snapshotVoteObject) {
    if (proposal.status == ProposalState.ACTIVE) {
      propStatus = ProposalState.METAGOV_PENDING;
    } else {
      propStatus = proposal.status;
    }
  }

  return propStatus;
};

export const BigNounProposalRow = ({
  proposal,
  snapshotProposals,
}: {
  proposal: Proposal;
  snapshotProposals: SnapshotProposal[];
}) => {
  const currentBlock = useBlockNumber();

  const snapshotVoteObject = snapshotProposals.find(spi =>
    spi.body.includes(proposal.transactionHash),
  );

  const propStatus = bigNounsPropStatus(proposal, snapshotVoteObject);

  const isPropInStateToHaveCountDown =
    propStatus === ProposalState.PENDING ||
    propStatus === ProposalState.METAGOV_ACTIVE ||
    propStatus === ProposalState.METAGOV_CLOSED ||
    propStatus === ProposalState.ACTIVE ||
    propStatus === ProposalState.QUEUED;

  //if lil nouns vote is active, change countdown pill to reflect snapshot voting window

  const countdownPill = (
    <div className={classes.proposalStatusWrapper}>
      <div className={clsx(proposalStatusClasses.proposalStatus, classes.countdownPill)}>
        <div className={classes.countdownPillContentWrapper}>
          <span className={classes.countdownPillClock}>
            <ClockIcon height={16} width={16} />
          </span>{' '}
          <span className={classes.countdownPillText}>
            {getCountdownCopy(proposal, currentBlock || 0, propStatus, snapshotVoteObject)}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <a
      className={clsx(classes.proposalLink, classes.proposalLinkWithCountdown)}
      href={`/vote/nounsdao/${proposal.id}`}
      key={proposal.id}
    >
      <div className={classes.proposalInfoWrapper}>
        <span className={classes.proposalTitle}>
          <span className={classes.proposalId}>{proposal.id}</span> <span>{proposal.title}</span>
        </span>

        {isPropInStateToHaveCountDown && (
          <div className={classes.desktopCountdownWrapper}>{countdownPill}</div>
        )}
        <div className={clsx(classes.proposalStatusWrapper, classes.votePillWrapper)}>
          <ProposalStatus status={propStatus}></ProposalStatus>
        </div>
      </div>

      {isPropInStateToHaveCountDown && (
        <div className={classes.mobileCountdownWrapper}>{countdownPill}</div>
      )}
    </a>
  );
};

const Proposals = ({
  proposals,
  nounsDAOProposals,
  snapshotProposals,
  federationProposals,
  isNounsDAOProp,
}: {
  proposals: Proposal[];
  nounsDAOProposals: Proposal[];
  snapshotProposals: SnapshotProposal[] | undefined;
  federationProposals: FederationProposal[] | null;
  isNounsDAOProp: boolean;
}) => {
  const history = useHistory();
  const timestamp = Date.now();

  const { account } = useEthers();
  const connectedAccountNounVotes = useUserVotes() || 0;
  const currentBlock = useBlockNumber();
  const isMobile = isMobileScreen();
  const [showDelegateModal, setShowDelegateModal] = useState(false);

  const threshold = (useProposalThreshold() ?? 0) + 1;
  const hasEnoughVotesToPropose = account !== undefined && connectedAccountNounVotes >= threshold;
  const hasNounBalance = (useNounTokenBalance(account || undefined) ?? 0) > 0;
  const userDelegatee = useUserDelegatee();
  const hasDelegatedVotes = account !== undefined && userDelegatee != account;

  const firstFederationProp = federationProposals?.at(0) || undefined;

  const nullStateCopy = () => {
    if (account !== null) {
      if (connectedAccountNounVotes > 0) {
        return hasDelegatedVotes
          ? 'Your votes have been delegated'
          : `Making a proposal requires ${threshold} votes`;
      }

      return 'You have no Votes.';
    }
    return 'Connect wallet to make a proposal.';
  };

  return (
    <>
      {!isNounsDAOProp ? (
        <div className={classes.proposals}>
          {showDelegateModal && <DelegationModal onDismiss={() => setShowDelegateModal(false)} />}
          <div
            className={clsx(
              classes.headerWrapper,
              !hasEnoughVotesToPropose ? classes.forceFlexRow : '',
            )}
          >
            <h3 className={classes.heading}>Proposals</h3>
            {hasEnoughVotesToPropose ? (
              <div className={classes.nounInWalletBtnWrapper}>
                <div className={classes.submitProposalButtonWrapper}>
                  <Button
                    className={classes.generateBtn}
                    onClick={() => history.push('create-proposal')}
                  >
                    Submit Proposal
                  </Button>
                </div>

                {hasNounBalance && (
                  <div className={classes.delegateBtnWrapper}>
                    <Button
                      className={classes.changeDelegateBtn}
                      onClick={() => setShowDelegateModal(true)}
                    >
                      Delegate
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className={clsx('d-flex', classes.nullStateSubmitProposalBtnWrapper)}>
                {!isMobile && <div className={classes.nullStateCopy}>{nullStateCopy()}</div>}
                <div className={classes.nullBtnWrapper}>
                  <Button className={classes.generateBtnDisabled}>Submit Proposal</Button>
                </div>
                {!isMobile && hasNounBalance && (
                  <div className={classes.delegateBtnWrapper}>
                    <Button
                      className={classes.changeDelegateBtn}
                      onClick={() => setShowDelegateModal(true)}
                    >
                      {!hasDelegatedVotes ? 'Delegate' : 'Update Delegate'}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
          {isMobile && <div className={classes.nullStateCopy}>{nullStateCopy()}</div>}
          {isMobile && hasNounBalance && (
            <div>
              <Button
                className={classes.changeDelegateBtn}
                onClick={() => setShowDelegateModal(true)}
              >
                {!hasDelegatedVotes ? 'Delegate' : 'Update Delegate'}
              </Button>
            </div>
          )}
          {proposals?.length ? (
            proposals
              .slice(0)
              .reverse()
              .map(p => <LilNounProposalRow proposal={p} key={p.id} />)
          ) : (
            <Alert variant="secondary">
              <Alert.Heading>No proposals found</Alert.Heading>
              <p>Proposals submitted by community members will appear here.</p>
            </Alert>
          )}
        </div>
      ) : (
        <div className={classes.proposals}>
          {showDelegateModal && <DelegationModal onDismiss={() => setShowDelegateModal(false)} />}
          <div
            className={clsx(
              classes.headerWrapper,
              !hasEnoughVotesToPropose ? classes.forceFlexRow : '',
            )}
          >
            <h3 className={classes.heading}>Proposals</h3>
          </div>
          {nounsDAOProposals?.length && snapshotProposals?.length ? (
            nounsDAOProposals
              .slice(0)
              .reverse()
              .map((p, i) => {
                //DONE: FEDERATION - fetch first federation prop id
                const isFederationProp = () => {
                  if (p.id !== undefined && firstFederationProp?.eID !== undefined) {
                    if (parseInt(p.id) >= parseInt(firstFederationProp.eID)) {
                      return true;
                    }
                    return false
                  }

                  return false
                };

                const snapshotVoteObject = snapshotProposals.find(spi =>
                  spi.body.includes(p.transactionHash),
                );

                const federationVoteObject = federationProposals?.find(spi => spi.eID == p.id);

                let propStatus = p.status;

                //DONE: find out why !p.snapshotForCount
                if (snapshotVoteObject && !p.snapshotForCount && !isFederationProp()) {
                  propStatus = ProposalState.METAGOV_PENDING;
                  p.snapshotProposalId = snapshotVoteObject.id;

                  //TODO: find out why this exists
                  if (snapshotVoteObject.scores_total) {
                    const scores = snapshotVoteObject.scores;
                    p.snapshotForCount == scores[0];
                    p.snapshotAgainstCount == scores[1];
                    p.snapshotAbstainCount == scores[2];
                  }

                  switch (snapshotVoteObject.state) {
                    case 'active':
                      p.snapshotEnd = snapshotVoteObject.end;
                      if (p.status == ProposalState.PENDING || p.status == ProposalState.ACTIVE) {
                        propStatus = ProposalState.METAGOV_ACTIVE;
                      } else {
                        propStatus = p.status;
                      }

                      break;

                    case 'closed':
                      if (p.status == ProposalState.ACTIVE) {
                        propStatus = ProposalState.METAGOV_CLOSED;
                        break;
                      }
                      propStatus = p.status;
                      break;

                    case 'pending':
                      propStatus = ProposalState.PENDING;
                      break;

                    default:
                      propStatus = p.status;
                      break;
                  }
                } else if (isFederationProp() && federationVoteObject) {
                  //DONE: FEDERATION - fetch federation prop result and states

                  const now = dayjs();

                  switch (federationVoteObject.status) {
                    case FederationProposalState.ACTIVE:
                      /**
                       * DONE: FEDERATION - if within voting window - voting
                       * DONE: FEDERATION - if within voting window but past endblock - waiting to be casted in
                       * */

                      p.snapshotEnd = federationVoteObject.endBlock;

                      if (p.status == ProposalState.PENDING || p.status == ProposalState.ACTIVE) {
                        const federationPropStartDate =
                          federationVoteObject && timestamp && currentBlock
                            ? dayjs(timestamp).add(
                                AVERAGE_BLOCK_TIME_IN_SECS *
                                  (federationVoteObject.startBlock - currentBlock),
                                'seconds',
                              )
                            : undefined;

                        const federationEndDate =
                          federationVoteObject && timestamp && currentBlock
                            ? dayjs(timestamp).add(
                                AVERAGE_BLOCK_TIME_IN_SECS *
                                  (federationVoteObject.endBlock - currentBlock),
                                'seconds',
                              )
                            : undefined;

                        const federationPropExecutionWindow =
                          federationVoteObject?.executionWindow ?? 2500;

                        console.log(
                          `federationPropExecutionWindow: = ${federationPropExecutionWindow}`,
                        );

                        const federationPropExecutionWindowDate =
                          federationVoteObject && timestamp && currentBlock
                            ? dayjs(timestamp).add(
                                AVERAGE_BLOCK_TIME_IN_SECS *
                                  (federationVoteObject.endBlock -
                                    federationPropExecutionWindow -
                                    currentBlock),
                                'seconds',
                              )
                            : undefined;

                        //if within voting period - active
                        if (
                          !federationVoteObject.executed &&
                          federationEndDate?.isAfter(now) &&
                          federationPropExecutionWindowDate?.isAfter(now)
                        ) {
                          propStatus = ProposalState.METAGOV_ACTIVE;
                        }
                        //if not within voitng period
                        else if (
                          !federationVoteObject.executed &&
                          federationEndDate?.isAfter(now) &&
                          federationPropExecutionWindowDate?.isBefore(now)
                        ) {
                          //if quroum is not met, voting period is pushed to end block
                          if (federationVoteObject.forCount < federationVoteObject.quorumVotes) {
                            propStatus = ProposalState.METAGOV_ACTIVE;
                          } else {
                            propStatus = ProposalState.METAGOV_AWAITING_EXECUTION;
                          }
                        }
                      } else {
                        propStatus = p.status;
                      }

                      break;

                    case FederationProposalState.EXECUTED:
                      if (p.status == ProposalState.ACTIVE) {
                        propStatus = ProposalState.METAGOV_CLOSED;
                        break;
                      }
                      propStatus = p.status;
                      break;

                    case FederationProposalState.UNDETERMINED:
                      propStatus = ProposalState.PENDING;
                      break;

                    //DONE: FEDERATION - check why are some props expired here but active when fetched via subgraph site?
                    case FederationProposalState.EXPIRED:
                      //DONE: FEDERATION - if expired then show nouns status
                      propStatus = p.status;
                      // ProposalState.METAGOV_EXPIRED;
                      break;

                    default:
                      propStatus = p.status;
                      break;
                  }

                  // propStatus === ProposalState.PENDING ||
                  // propStatus === ProposalState.METAGOV_ACTIVE ||
                  // propStatus === ProposalState.METAGOV_CLOSED ||
                  // propStatus === ProposalState.METAGOV_AWAITING_EXECUTION ||
                  // propStatus === ProposalState.ACTIVE ||
                  // propStatus === ProposalState.QUEUED;
                  // propStatus = ProposalState.METAGOV_AWAITING_INITIATION;
                } else if (isFederationProp() && !federationVoteObject) {
                  propStatus = ProposalState.METAGOV_AWAITING_INITIATION;
                } else if (!snapshotVoteObject && !federationVoteObject) {
                  if (p.status == ProposalState.ACTIVE) {
                    propStatus = ProposalState.METAGOV_PENDING;
                  } else {
                    propStatus = p.status;
                  }
                }

                const isPropInStateToHaveCountDown =
                  propStatus === ProposalState.PENDING ||
                  propStatus === ProposalState.METAGOV_ACTIVE ||
                  propStatus === ProposalState.METAGOV_CLOSED ||
                  propStatus === ProposalState.METAGOV_AWAITING_EXECUTION ||
                  propStatus === ProposalState.ACTIVE ||
                  propStatus === ProposalState.QUEUED;

                //if lil nouns vote is active, change countdown pill to reflect snapshot voting window

                const countdownPill = (
                  <div className={classes.proposalStatusWrapper}>
                    <div
                      className={clsx(proposalStatusClasses.proposalStatus, classes.countdownPill)}
                    >
                      <div className={classes.countdownPillContentWrapper}>
                        <span className={classes.countdownPillClock}>
                          <ClockIcon height={16} width={16} />
                        </span>{' '}
                        <span className={classes.countdownPillText}>
                          {getCountdownCopy(
                            p,
                            currentBlock || 0,
                            propStatus,
                            snapshotVoteObject,
                            federationVoteObject,
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                );

                return (
                  <a
                    className={clsx(classes.proposalLink, classes.proposalLinkWithCountdown)}
                    href={`/vote/nounsdao/${p.id}`}
                    key={i}
                  >
                    <div className={classes.proposalInfoWrapper}>
                      <span className={classes.proposalTitle}>
                        <span className={classes.proposalId}>{p.id}</span> <span>{p.title}</span>
                      </span>

                      {isPropInStateToHaveCountDown && (
                        <div className={classes.desktopCountdownWrapper}>{countdownPill}</div>
                      )}
                      <div className={clsx(classes.proposalStatusWrapper, classes.votePillWrapper)}>
                        <ProposalStatus status={propStatus}></ProposalStatus>
                      </div>
                    </div>

                    {isPropInStateToHaveCountDown && (
                      <div className={classes.mobileCountdownWrapper}>{countdownPill}</div>
                    )}
                  </a>
                );
              })
          ) : (
            <Alert variant="secondary">
              <Alert.Heading>No proposals found</Alert.Heading>
              <p>Proposals submitted by community members will appear here.</p>
            </Alert>
          )}
        </div>
      )}
    </>
  );
};
export default Proposals;
