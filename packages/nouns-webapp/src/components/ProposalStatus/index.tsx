import classes from './ProposalStatus.module.css';
import { ProposalState } from '../../wrappers/nounsDao';
import React from 'react';
import clsx from 'clsx';

const statusVariant = (status: ProposalState | undefined) => {
  switch (status) {
    case ProposalState.PENDING:
    case ProposalState.ACTIVE:
    case ProposalState.METAGOV_ACTIVE:
    case ProposalState.METAGOV_PENDING:
      return classes.primary;
    case ProposalState.METAGOV_CLOSED:
      return classes.closedMetaGov;
    case ProposalState.SUCCEEDED:
    case ProposalState.EXECUTED:
      return classes.success;
    case ProposalState.DEFEATED:
    case ProposalState.VETOED:
      return classes.danger;
    case ProposalState.QUEUED:
    case ProposalState.CANCELLED:
    case ProposalState.EXPIRED:
    default:
      return classes.secondary;
  }
};

const statusText = (status: ProposalState | undefined) => {
  switch (status) {
    case ProposalState.PENDING:
      return 'Pending';
    case ProposalState.ACTIVE:
      return 'Active';
    case ProposalState.SUCCEEDED:
      return 'Succeeded';
    case ProposalState.EXECUTED:
      return 'Executed';
    case ProposalState.DEFEATED:
      return 'Defeated';
    case ProposalState.QUEUED:
      return 'Queued';
    case ProposalState.CANCELLED:
      return 'Canceled';
    case ProposalState.VETOED:
      return 'Vetoed';
    case ProposalState.EXPIRED:
      return 'Expired';
    case ProposalState.METAGOV_ACTIVE:
      return 'Active Lil Nouns Vote';
    case ProposalState.METAGOV_CLOSED:
      return 'Awaiting Nouns Vote'; //Pending Nouns Vote
    case ProposalState.METAGOV_PENDING:
      return 'Pending Lil Nouns Vote';
    case ProposalState.METAGOV_AWAITING_INITIATION:
      return 'Ready to start';
    case ProposalState.METAGOV_AWAITING_EXECUTION:
      return 'Ready to execute';
    case ProposalState.METAGOV_EXPIRED:
      return 'Expired Lil Nouns Vote';
    case ProposalState.METAGOV_VETOED:
      return 'Vetoed Lil Nouns Vote';
    default:
      return 'Undetermined';
  }
};

interface ProposalStateProps {
  status?: ProposalState;
  className?: string;
}

const ProposalStatus: React.FC<ProposalStateProps> = props => {
  const { status, className } = props;
  return (
    <div className={clsx(statusVariant(status), classes.proposalStatus, className)}>
      {statusText(status)}
    </div>
  );
};

export default ProposalStatus;
