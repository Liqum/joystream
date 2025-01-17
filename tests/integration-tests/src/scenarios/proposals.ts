import proposals from '../flows/proposals'
import cancellingProposals from '../flows/proposals/cancellingProposal'
import vetoProposal from '../flows/proposals/vetoProposal'
import electCouncil from '../flows/council/elect'
import runtimeUpgradeProposal from '../flows/proposals/runtimeUpgradeProposal'
import exactExecutionBlock from '../flows/proposals/exactExecutionBlock'
import expireProposal from '../flows/proposals/expireProposal'
import { scenario } from '../Scenario'

scenario(async ({ job, env }) => {
  const councilJob = job('electing council', electCouncil)
  const runtimeUpgradeProposalJob = env.RUNTIME_UPGRADE_TARGET_WASM_PATH
    ? job('runtime upgrade proposal', runtimeUpgradeProposal).requires(councilJob)
    : undefined
  job('proposals', [proposals, cancellingProposals, vetoProposal, exactExecutionBlock, expireProposal]).requires(
    runtimeUpgradeProposalJob || councilJob
  )
})
