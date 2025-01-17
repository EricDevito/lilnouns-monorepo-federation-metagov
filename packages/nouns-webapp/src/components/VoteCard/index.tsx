import React, { useEffect, useState } from 'react';
import { Card, Col, Row } from 'react-bootstrap';
import { isMobileScreen } from '../../utils/isMobile';
import { Proposal } from '../../wrappers/nounsDao';
import NounImageVoteTable from '../NounImageVoteTable';
import VoteProgresBar from '../VoteProgressBar';
import classes from './VoteCard.module.css';
import responsiveUiUtilsClasses from '../../utils/ResponsiveUIUtils.module.css';
import clsx from 'clsx';
import { ensCacheKey } from '../../utils/ensLookup';
import { lookupNNSOrENS } from '../../utils/lookupNNSOrENS';
import { useEthers } from '@usedapp/core';
import DelegateGroupedNounImageVoteTable from '../DelegateGroupedNounImageVoteTable';

export enum VoteCardVariant {
  FOR,
  AGAINST,
  ABSTAIN,
}

interface VoteCardProps {
  proposal: Proposal;
  percentage: number;
  isLilNounView?: boolean;
  nounIds: Array<string>;
  variant: VoteCardVariant;
  isNounsDAOProp?: boolean;
  lilnounIds: Array<string>;
  delegateView?: boolean;
  snapshotView?: boolean;
  snapshotVoteCount?: number;
  delegateGroupedVoteData?:
    | { delegate: string; supportDetailed: 0 | 1 | 2; nounsRepresented: string[] }[]
    | undefined;
}

const VoteCard: React.FC<VoteCardProps> = props => {
  const {
    proposal,
    percentage,
    isLilNounView,
    nounIds,
    variant,
    isNounsDAOProp,
    delegateView,
    delegateGroupedVoteData,
    lilnounIds,
    snapshotVoteCount,
  } = props;
  const isMobile = isMobileScreen();

  //DONE: for Nouns votes, use Big Nouns in NounImageVoteTable

  let titleClass;
  let titleCopy;
  let voteCount;
  let supportDetailedValue: 0 | 1 | 2;
  switch (variant) {
    case VoteCardVariant.FOR:
      titleClass = classes.for;
      titleCopy = 'For';
      voteCount = isLilNounView ? snapshotVoteCount : proposal.forCount;
      supportDetailedValue = 1;
      break;
    case VoteCardVariant.AGAINST:
      titleClass = classes.against;
      titleCopy = 'Against';
      voteCount = isLilNounView ? snapshotVoteCount : proposal.againstCount;
      supportDetailedValue = 0;
      break;
    default:
      titleClass = classes.abstain;
      titleCopy = 'Abstain';
      voteCount = isLilNounView ? snapshotVoteCount : proposal.abstainCount;
      supportDetailedValue = 2;
      break;
  }

  const { library } = useEthers();
  const [ensCached, setEnsCached] = useState(false);
  const filteredDelegateGroupedVoteData =
    delegateGroupedVoteData?.filter(v => v.supportDetailed === supportDetailedValue) ?? [];

  // Pre-fetch ENS  of delegates (with 30min TTL)
  // This makes hover cards load more smoothly
  useEffect(() => {
    if (isNounsDAOProp) return;

    if (!delegateGroupedVoteData || !library || ensCached) {
      return;
    }
    delegateGroupedVoteData.forEach((delegateInfo: { delegate: string }) => {
      if (localStorage.getItem(ensCacheKey(delegateInfo.delegate))) {
        return;
      }

      lookupNNSOrENS(library, delegateInfo.delegate)
        .then(name => {
          // Store data as mapping of address_Expiration => address or ENS
          if (name) {
            localStorage.setItem(
              ensCacheKey(delegateInfo.delegate),
              JSON.stringify({
                name,
                expires: Date.now() / 1000 + 30 * 60,
              }),
            );
          }
        })
        .catch(error => {
          console.log(`error resolving reverse ens lookup: `, error);
        });
    });
    setEnsCached(true);
  }, [library, ensCached, delegateGroupedVoteData]);

  return (
    <Col lg={4} className={classes.wrapper}>
      <Card className={classes.voteCountCard}>
        <Card.Body className="p-2">
          <Card.Text className="py-2 m-0">
            <span className={`${classes.voteCardHeaderText} ${titleClass}`}>{titleCopy}</span>
            {!isMobile && (
              <span
                className={clsx(
                  classes.voteCardVoteCount,
                  responsiveUiUtilsClasses.desktopOnly,
                  classes.smallerVoteCountText,
                )}
              >
                {delegateView ? (
                  <>
                    {filteredDelegateGroupedVoteData.length === 1 ? (
                      <>
                        {filteredDelegateGroupedVoteData.length} <span>Address</span>
                      </>
                    ) : (
                      <>
                        {filteredDelegateGroupedVoteData.length} <span>Addresses</span>
                      </>
                    )}
                  </>
                ) : isLilNounView ? (
                  <>
                    {voteCount}
                    {/* <span>Lil Nouns</span> */}
                  </>
                ) : (
                  voteCount
                )}
              </span>
            )}
          </Card.Text>
          {isMobile && (
            <Card.Text className="py-2 m-0">
              <span className={classes.voteCardVoteCount}>{voteCount}</span>
            </Card.Text>
          )}

          <VoteProgresBar variant={variant} percentage={percentage} />
          {!isMobile && (
            <Row className={classes.nounProfilePics}>
              {delegateView ? (
                <DelegateGroupedNounImageVoteTable
                  isNounsDAOProp={isNounsDAOProp}
                  filteredDelegateGroupedVoteData={filteredDelegateGroupedVoteData}
                  propId={parseInt(proposal.id || '0')}
                  proposalCreationBlock={proposal.createdBlock}
                />
              ) : isLilNounView ? (
                <NounImageVoteTable
                  nounIds={lilnounIds}
                  propId={parseInt(proposal.id || '0')}
                  isNounsDAOProp={false}
                />
              ) : (
                <NounImageVoteTable
                  nounIds={nounIds}
                  propId={parseInt(proposal.id || '0')}
                  isNounsDAOProp={isNounsDAOProp}
                />
              )}
            </Row>
          )}
        </Card.Body>
      </Card>
    </Col>
  );
};

export default VoteCard;
