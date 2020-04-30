import React from "react";

import { Container } from "semantic-ui-react";
import Details from "./Details";
import Body from "./Body";
import VotingSection from "./VotingSection";
import Votes from "./Votes";
import { MyAccountProps, withMyAccount } from "@polkadot/joy-utils/MyAccount"
import { ParsedProposal } from "../runtime";
import { withCalls } from '@polkadot/react-api';
import { withMulti } from '@polkadot/react-api/with';

import "./Proposal.css";
import { ProposalId, ProposalDecisionStatuses, ApprovedProposalStatuses } from "@joystream/types/proposals";
import { BlockNumber } from '@polkadot/types/interfaces'
import { MemberId } from "@joystream/types/members";
import { Seat } from "@joystream/types/";

type BasicProposalStatus = 'Active' | 'Finalized';
type ProposalPeriodStatus = 'Voting period' | 'Grace period';
type ProposalDisplayStatus = BasicProposalStatus | ProposalDecisionStatuses | ApprovedProposalStatuses;

export type ExtendedProposalStatus = {
  displayStatus: ProposalDisplayStatus,
  periodStatus: ProposalPeriodStatus | null,
  expiresIn: number | null,
}

export function getExtendedStatus(proposal: ParsedProposal, bestNumber: BlockNumber | undefined): ExtendedProposalStatus {
  const basicStatus = Object.keys(proposal.status)[0] as BasicProposalStatus;
  let expiresIn: number | null = null;

  let displayStatus: ProposalDisplayStatus = basicStatus;
  let periodStatus: ProposalPeriodStatus | null = null;

  if (!bestNumber) return { displayStatus, periodStatus, expiresIn };

  const { votingPeriod, gracePeriod } = proposal.parameters;
  const blockAge = bestNumber.toNumber() - proposal.createdAtBlock;

  if (basicStatus === 'Active') {
    expiresIn = Math.max(votingPeriod - blockAge, 0) || null;
    if (expiresIn) periodStatus = 'Voting period';
  }

  if (basicStatus === 'Finalized') {
    const { finalizedAt, proposalStatus } = proposal.status['Finalized'];

    const decisionStatus: ProposalDecisionStatuses = Object.keys(proposalStatus)[0] as ProposalDecisionStatuses;
    displayStatus = decisionStatus;
    if (decisionStatus === 'Approved') {
      const approvedStatus: ApprovedProposalStatuses = Object.keys(proposalStatus["Approved"])[0] as ApprovedProposalStatuses;
      if (approvedStatus === 'PendingExecution') {
        const finalizedAge = bestNumber.toNumber() - finalizedAt;
        expiresIn = Math.max(gracePeriod - finalizedAge, 0) || null;
        if (expiresIn) periodStatus = 'Grace period';
      }
      else {
        displayStatus = approvedStatus; // Executed / ExecutionFailed
      }
    }
  }

  return {
    displayStatus,
    periodStatus,
    expiresIn
  }
}


type ProposalDetailsProps = MyAccountProps & {
  proposal: ParsedProposal,
  proposalId: ProposalId,
  bestNumber?: BlockNumber,
  council?: Seat[]
};

function ProposalDetails({ proposal, proposalId, myAddress, myMemberId, iAmMember, council, bestNumber }: ProposalDetailsProps) {
  const iAmCouncilMember = iAmMember && council && council.some(seat => seat.member.toString() === myAddress);
  const extendedStatus = getExtendedStatus(proposal, bestNumber);
  return (
    <Container className="Proposal">
      <Details proposal={proposal} extendedStatus={extendedStatus}/>
      <Body
        type={ proposal.type }
        title={ proposal.title }
        description={ proposal.description }
        params={ proposal.details }
        />
      { iAmCouncilMember && (
        <VotingSection
          proposalId={proposalId}
          memberId={ myMemberId as MemberId }
          isVotingPeriod={ extendedStatus.periodStatus === 'Voting period' }/>
      ) }
      <Votes proposalId={proposalId} />
    </Container>
  );
}

export default withMulti<ProposalDetailsProps>(
  ProposalDetails,
  withMyAccount,
  withCalls(
    ['derive.chain.bestNumber', { propName: 'bestNumber' }],
    ['query.council.activeCouncil', { propName: 'council' }], // TODO: Handle via transport?
  )
);
