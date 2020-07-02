import { Observable } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

import ApiPromise from '@polkadot/api/promise';
import { Balance } from '@polkadot/types/interfaces';
import { GenericAccountId, Option, u32, u128, Vec } from '@polkadot/types';
import { Constructor } from '@polkadot/types/types';
import { Moment } from '@polkadot/types/interfaces/runtime';
import { QueueTxExtrinsicAdd } from '@polkadot/react-components/Status/types';
import { SubmittableExtrinsic } from '@polkadot/api/promise/types';
import keyringOption from '@polkadot/ui-keyring/options';

import { APIQueryCache, MultipleLinkedMapEntry, SingleLinkedMapEntry, Subscribable, Transport as TransportBase } from '@polkadot/joy-utils/index';

import { ITransport } from './transport';
import { GroupMember } from './elements';

import {
  Curator, CuratorId,
  CuratorApplication, CuratorApplicationId,
  CuratorRoleStakeProfile,
  CuratorOpening, CuratorOpeningId,
  Lead, LeadId
} from '@joystream/types/content-working-group';

import {
  Application as WGApplication,
  Opening as WGOpening,
  Worker, WorkerId,
  RoleStakeProfile
} from '@joystream/types/working-group';

import { Application, Opening, OpeningId, ApplicationId } from '@joystream/types/hiring';
import { Stake, StakeId } from '@joystream/types/stake';
import { RewardRelationship, RewardRelationshipId } from '@joystream/types/recurring-rewards';
import { ActorInRole, Profile, MemberId, Role, RoleKeys, ActorId } from '@joystream/types/members';
import { createAccount, generateSeed } from '@polkadot/joy-utils/accounts';

import { WorkingGroupMembership, GroupLeadStatus } from './tabs/WorkingGroup';
import { WorkingGroupOpening } from './tabs/Opportunities';
import { ActiveRole, OpeningApplication } from './tabs/MyRoles';

import { keyPairDetails } from './flows/apply';

import {
  classifyApplicationCancellation,
  classifyOpeningStage,
  classifyOpeningStakes,
  isApplicationHired
} from './classifiers';
import { WorkingGroups, AvailableGroups } from './working_groups';
import { Sort, Sum, Zero } from './balances';
import _ from 'lodash';

type WorkingGroupPair<HiringModuleType, WorkingGroupType> = {
  hiringModule: HiringModuleType;
  workingGroup: WorkingGroupType;
}

type StakePair<T = Balance> = {
  application: T;
  role: T;
}

type WGApiMethodType =
  'nextOpeningId'
  | 'openingById'
  | 'nextApplicationId'
  | 'applicationById'
  | 'nextWorkerId'
  | 'workerById';
type WGApiMethodsMapping = { [key in WGApiMethodType]: string };

type GroupApplication = CuratorApplication | WGApplication;
type GroupApplicationId = CuratorApplicationId | ApplicationId;
type GroupOpening = CuratorOpening | WGOpening;
type GroupOpeningId = CuratorOpeningId | OpeningId;
type GroupWorker = Worker | Curator;
type GroupWorkerId = CuratorId | WorkerId;
type GroupWorkerStakeProfile = RoleStakeProfile | CuratorRoleStakeProfile;
type GroupLead = Lead | Worker;
type GroupLeadWithMemberId = {
  lead: GroupLead;
  memberId: MemberId;
}

type WGApiMapping = {
  [key in WorkingGroups]: {
    module: string;
    methods: WGApiMethodsMapping;
    openingType: Constructor<GroupOpening>;
    applicationType: Constructor<GroupApplication>;
    workerType: Constructor<GroupWorker>;
  }
};

const workingGroupsApiMapping: WGApiMapping = {
  [WorkingGroups.StorageProviders]: {
    module: 'storageWorkingGroup',
    methods: {
      nextOpeningId: 'nextOpeningId',
      openingById: 'openingById',
      nextApplicationId: 'nextApplicationId',
      applicationById: 'applicationById',
      nextWorkerId: 'nextWorkerId',
      workerById: 'workerById'
    },
    openingType: WGOpening,
    applicationType: WGApplication,
    workerType: Worker
  },
  [WorkingGroups.ContentCurators]: {
    module: 'contentWorkingGroup',
    methods: {
      nextOpeningId: 'nextCuratorOpeningId',
      openingById: 'curatorOpeningById',
      nextApplicationId: 'nextCuratorApplicationId',
      applicationById: 'curatorApplicationById',
      nextWorkerId: 'nextCuratorId',
      workerById: 'curatorById'
    },
    openingType: CuratorOpening,
    applicationType: CuratorApplication,
    workerType: Curator
  }
};

export class Transport extends TransportBase implements ITransport {
  protected api: ApiPromise
  protected cachedApi: APIQueryCache
  protected queueExtrinsic: QueueTxExtrinsicAdd

  constructor (api: ApiPromise, queueExtrinsic: QueueTxExtrinsicAdd) {
    super();
    this.api = api;
    this.cachedApi = new APIQueryCache(api);
    this.queueExtrinsic = queueExtrinsic;
  }

  cachedApiMethodByGroup (group: WorkingGroups, method: WGApiMethodType) {
    const apiModule = workingGroupsApiMapping[group].module;
    const apiMethod = workingGroupsApiMapping[group].methods[method];

    return this.cachedApi.query[apiModule][apiMethod];
  }

  unsubscribe () {
    this.cachedApi.unsubscribe();
  }

  async roles (): Promise<Array<Role>> {
    const roles: any = await this.cachedApi.query.actors.availableRoles();
    return this.promise<Array<Role>>(roles.map((role: Role) => role));
  }

  protected async stakeValue (stakeId: StakeId): Promise<Balance> {
    const stake = new SingleLinkedMapEntry<Stake>(
      Stake,
      await this.cachedApi.query.stake.stakes(
        stakeId
      )
    );
    return stake.value.value;
  }

  protected async workerStake (stakeProfile: GroupWorkerStakeProfile): Promise<Balance> {
    return this.stakeValue(stakeProfile.stake_id);
  }

  protected async workerTotalReward (relationshipId: RewardRelationshipId): Promise<Balance> {
    const relationship = new SingleLinkedMapEntry<RewardRelationship>(
      RewardRelationship,
      await this.cachedApi.query.recurringRewards.rewardRelationships(
        relationshipId
      )
    );
    return relationship.value.total_reward_received;
  }

  protected async memberIdFromRoleAndActorId (role: Role, id: ActorId): Promise<MemberId> {
    const memberId = (
      await this.cachedApi.query.members.membershipIdByActorInRole(
        new ActorInRole({
          role: role,
          actor_id: id
        })
      )
    ) as MemberId;

    return memberId;
  }

  protected memberIdFromCuratorId (curatorId: CuratorId): Promise<MemberId> {
    return this.memberIdFromRoleAndActorId(
      new Role(RoleKeys.Curator),
      curatorId
    );
  }

  protected memberIdFromLeadId (leadId: LeadId): Promise<MemberId> {
    return this.memberIdFromRoleAndActorId(
      new Role(RoleKeys.CuratorLead),
      leadId
    );
  }

  protected async groupMember (
    group: WorkingGroups,
    id: GroupWorkerId,
    worker: GroupWorker
  ): Promise<GroupMember> {
    const roleAccount = worker.role_account_id;
    const memberId = group === WorkingGroups.ContentCurators
      ? await this.memberIdFromCuratorId(id)
      : (worker as Worker).member_id;

    const profile = await this.cachedApi.query.members.memberProfile(memberId) as Option<Profile>;
    if (profile.isNone) {
      throw new Error('no profile found');
    }

    let stakeValue: Balance = new u128(0);
    if (worker.role_stake_profile && worker.role_stake_profile.isSome) {
      stakeValue = await this.workerStake(worker.role_stake_profile.unwrap());
    }

    let earnedValue: Balance = new u128(0);
    if (worker.reward_relationship && worker.reward_relationship.isSome) {
      earnedValue = await this.workerTotalReward(worker.reward_relationship.unwrap());
    }

    return ({
      roleAccount,
      memberId,
      profile: profile.unwrap(),
      title: _.startCase(group).slice(0, -1), // FIXME: Temporary solution (just removes "s" at the end)
      stake: stakeValue,
      earned: earnedValue
    });
  }

  protected async areAnyGroupRolesOpen (group: WorkingGroups): Promise<boolean> {
    const nextId = await this.cachedApiMethodByGroup(group, 'nextOpeningId')() as GroupOpeningId;

    // This is chain specfic, but if next id is still 0, it means no openings have been added yet
    if (nextId.eq(0)) {
      return false;
    }

    const groupOpenings = new MultipleLinkedMapEntry<GroupOpeningId, GroupOpening>(
      OpeningId,
      workingGroupsApiMapping[group].openingType,
      await this.cachedApiMethodByGroup(group, 'openingById')()
    );

    for (let i = 0; i < groupOpenings.linked_values.length; i++) {
      const opening = await this.opening(groupOpenings.linked_values[i].hiring_opening_id.toNumber());
      if (opening.is_active) {
        return true;
      }
    }

    return false;
  }

  protected async areAnyCuratorRolesOpen (): Promise<boolean> {
    // Backward compatibility
    return this.areAnyGroupRolesOpen(WorkingGroups.ContentCurators);
  }

  protected async currentCuratorLead (): Promise<GroupLeadWithMemberId | null> {
    const optLeadId = (await this.cachedApi.query.contentWorkingGroup.currentLeadId()) as Option<LeadId>;

    if (!optLeadId.isSome) {
      return null;
    }

    const leadId = optLeadId.unwrap();
    const lead = new SingleLinkedMapEntry<Lead>(
      Lead,
      await this.cachedApi.query.contentWorkingGroup.leadById(leadId)
    );

    const memberId = await this.memberIdFromLeadId(leadId);

    return {
      lead: lead.value,
      memberId
    };
  }

  protected async currentStorageLead (): Promise <GroupLeadWithMemberId | null> {
    const optLeadId = (await this.cachedApi.query.storageWorkingGroup.currentLead()) as Option<WorkerId>;

    if (!optLeadId.isSome) {
      return null;
    }

    const leadWorkerId = optLeadId.unwrap();
    const leadWorkerLink = new SingleLinkedMapEntry(
      Worker,
      await this.cachedApi.query.storageWorkingGroup.workerById(leadWorkerId)
    );
    const leadWorker = leadWorkerLink.value;

    if (!leadWorker.is_active) {
      return null;
    }

    return {
      lead: leadWorker,
      memberId: leadWorker.member_id
    };
  }

  async groupLeadStatus (group: WorkingGroups = WorkingGroups.ContentCurators): Promise<GroupLeadStatus> {
    const currentLead = group === WorkingGroups.ContentCurators
      ? await this.currentCuratorLead()
      : await this.currentStorageLead();

    if (currentLead !== null) {
      const profile = await this.cachedApi.query.members.memberProfile(currentLead.memberId) as Option<Profile>;

      if (profile.isNone) {
        throw new Error(`${group} lead profile not found!`);
      }

      return {
        lead: {
          memberId: currentLead.memberId,
          roleAccount: currentLead.lead.role_account_id,
          profile: profile.unwrap(),
          title: _.startCase(group) + ' Lead',
          stage: group === WorkingGroups.ContentCurators ? (currentLead.lead as Lead).stage : undefined
        },
        loaded: true
      };
    } else {
      return {
        loaded: true
      };
    }
  }

  async groupOverview (group: WorkingGroups): Promise<WorkingGroupMembership> {
    const rolesAvailable = await this.areAnyGroupRolesOpen(group);

    const nextId = await this.cachedApiMethodByGroup(group, 'nextWorkerId')() as GroupWorkerId;

    // This is chain specfic, but if next id is still 0, it means no curators have been added yet
    if (nextId.eq(0)) {
      return {
        members: [],
        rolesAvailable
      };
    }

    const values = new MultipleLinkedMapEntry<GroupWorkerId, GroupWorker>(
      ActorId,
      workingGroupsApiMapping[group].workerType,
      await this.cachedApiMethodByGroup(group, 'workerById')() as GroupWorker
    );

    const workers = values.linked_values.filter(value => value.is_active).reverse();
    const workerIds = values.linked_keys.filter((v, k) => values.linked_values[k].is_active).reverse();

    return {
      members: await Promise.all(
        workers.map((worker, k) => this.groupMember(group, workerIds[k], worker))
      ),
      rolesAvailable
    };
  }

  curationGroup (): Promise<WorkingGroupMembership> {
    return this.groupOverview(WorkingGroups.ContentCurators);
  }

  storageGroup (): Promise<WorkingGroupMembership> {
    return this.groupOverview(WorkingGroups.StorageProviders);
  }

  async opportunitiesByGroup (group: WorkingGroups): Promise<WorkingGroupOpening[]> {
    const output = new Array<WorkingGroupOpening>();
    const nextId = (await this.cachedApiMethodByGroup(group, 'nextOpeningId')()) as GroupOpeningId;

    // This is chain specfic, but if next id is still 0, it means no curator openings have been added yet
    if (!nextId.eq(0)) {
      const highestId = nextId.toNumber() - 1;

      for (let i = highestId; i >= 0; i--) {
        output.push(await this.groupOpening(group, i));
      }
    }

    return output;
  }

  async currentOpportunities (): Promise<WorkingGroupOpening[]> {
    let opportunities: WorkingGroupOpening[] = [];

    for (const group of AvailableGroups) {
      opportunities = opportunities.concat(await this.opportunitiesByGroup(group));
    }

    return opportunities.sort((a, b) => b.stage.starting_block - a.stage.starting_block);
  }

  protected async opening (id: number): Promise<Opening> {
    const opening = new SingleLinkedMapEntry<Opening>(
      Opening,
      await this.cachedApi.query.hiring.openingById(id)
    );

    return opening.value;
  }

  protected async groupOpeningApplications (group: WorkingGroups, groupOpeningId: number): Promise<WorkingGroupPair<Application, GroupApplication>[]> {
    const output = new Array<WorkingGroupPair<Application, GroupApplication>>();

    const nextAppid = (await this.cachedApiMethodByGroup(group, 'nextApplicationId')()) as GroupApplicationId;
    for (let i = 0; i < nextAppid.toNumber(); i++) {
      const cApplication = new SingleLinkedMapEntry<GroupApplication>(
        workingGroupsApiMapping[group].applicationType,
        await this.cachedApiMethodByGroup(group, 'applicationById')(i)
      );

      if (cApplication.value.opening_id.toNumber() !== groupOpeningId) {
        continue;
      }

      const appId = cApplication.value.application_id;
      const baseApplications = new SingleLinkedMapEntry<Application>(
        Application,
        await this.cachedApi.query.hiring.applicationById(
          appId
        )
      );

      output.push({
        hiringModule: baseApplications.value,
        workingGroup: cApplication.value
      });
    }

    return output;
  }

  protected async curatorOpeningApplications (curatorOpeningId: number): Promise<WorkingGroupPair<Application, CuratorApplication>[]> {
    // Backwards compatibility
    const applications = await this.groupOpeningApplications(WorkingGroups.ContentCurators, curatorOpeningId);
    return applications as WorkingGroupPair<Application, CuratorApplication>[];
  }

  async groupOpening (group: WorkingGroups, id: number): Promise<WorkingGroupOpening> {
    const nextId = (await this.cachedApiMethodByGroup(group, 'nextOpeningId')() as u32).toNumber();
    if (id < 0 || id >= nextId) {
      throw new Error('invalid id');
    }

    const groupOpening = new SingleLinkedMapEntry<GroupOpening>(
      workingGroupsApiMapping[group].openingType,
      await this.cachedApiMethodByGroup(group, 'openingById')(id)
    );

    const opening = await this.opening(
      groupOpening.value.hiring_opening_id.toNumber()
    );

    const applications = await this.groupOpeningApplications(group, id);
    const stakes = classifyOpeningStakes(opening);

    return ({
      opening: opening,
      meta: {
        id: id.toString(),
        group
      },
      stage: await classifyOpeningStage(this, opening),
      applications: {
        numberOfApplications: applications.length,
        maxNumberOfApplications: opening.max_applicants,
        requiredApplicationStake: stakes.application,
        requiredRoleStake: stakes.role,
        defactoMinimumStake: new u128(0)
      },
      defactoMinimumStake: new u128(0)
    });
  }

  async curationGroupOpening (id: number): Promise<WorkingGroupOpening> {
    // Backwards compatibility
    return this.groupOpening(WorkingGroups.ContentCurators, id);
  }

  protected async openingApplicationTotalStake (application: Application): Promise<Balance> {
    const promises = new Array<Promise<Balance>>();

    if (application.active_application_staking_id.isSome) {
      promises.push(this.stakeValue(application.active_application_staking_id.unwrap()));
    }

    if (application.active_role_staking_id.isSome) {
      promises.push(this.stakeValue(application.active_role_staking_id.unwrap()));
    }

    return Sum(await Promise.all(promises));
  }

  async openingApplicationRanks (openingId: number): Promise<Balance[]> {
    const applications = await this.curatorOpeningApplications(openingId);
    return Sort(
      (await Promise.all(
        applications.map(application => this.openingApplicationTotalStake(application.hiringModule))
      ))
        .filter((b) => !b.eq(Zero))
    );
  }

  expectedBlockTime (): Promise<number> {
    return this.promise<number>(
      (this.api.consts.babe.expectedBlockTime as Moment).toNumber() / 1000
    );
  }

  async blockHash (height: number): Promise<string> {
    const blockHash = await this.cachedApi.query.system.blockHash(height);
    return blockHash.toString();
  }

  async blockTimestamp (height: number): Promise<Date> {
    const blockTime = await this.api.query.timestamp.now.at(
      await this.blockHash(height)
    ) as Moment;

    return new Date(blockTime.toNumber());
  }

  transactionFee (): Promise<Balance> {
    return this.promise<Balance>(new u128(5));
  }

  accounts (): Subscribable<keyPairDetails[]> {
    return keyringOption.optionsSubject.pipe(
      map(accounts => {
        return accounts.all
          .filter(x => x.value)
          .map(async (result, k) => {
            return {
              shortName: result.name,
              accountId: new GenericAccountId(result.value as string),
              balance: await this.cachedApi.query.balances.freeBalance(result.value as string)
            };
          });
      }),
      switchMap(async x => Promise.all(x))
    ) as Subscribable<keyPairDetails[]>;
  }

  protected async applicationStakes (app: Application): Promise<StakePair<Balance>> {
    const stakes = {
      application: Zero,
      role: Zero
    };

    const appStake = app.active_application_staking_id;
    if (appStake.isSome) {
      stakes.application = await this.stakeValue(appStake.unwrap());
    }

    const roleStake = app.active_role_staking_id;
    if (roleStake.isSome) {
      stakes.role = await this.stakeValue(roleStake.unwrap());
    }

    return stakes;
  }

  protected async myApplicationRank (myApp: Application, applications: Array<Application>): Promise<number> {
    const stakes = await Promise.all(
      applications.map(app => this.openingApplicationTotalStake(app))
    );

    const appvalues = applications.map((app, key) => {
      return {
        app: app,
        value: stakes[key]
      };
    });

    appvalues.sort((a, b): number => {
      if (a.value.eq(b.value)) {
        return 0;
      } else if (a.value.gt(b.value)) {
        return -1;
      }

      return 1;
    });

    return appvalues.findIndex(v => v.app.eq(myApp)) + 1;
  }

  async openingApplications (roleKeyId: string): Promise<OpeningApplication[]> {
    const curatorApps = new MultipleLinkedMapEntry<CuratorApplicationId, CuratorApplication>(
      CuratorApplicationId,
      CuratorApplication,
      await this.cachedApi.query.contentWorkingGroup.curatorApplicationById()
    );

    const myApps = curatorApps.linked_values.filter(app => app.role_account.eq(roleKeyId));
    const myAppIds = curatorApps.linked_keys.filter((id, key) => curatorApps.linked_values[key].role_account.eq(roleKeyId));

    const hiringAppPairs = await Promise.all(
      myApps.map(
        async app => new SingleLinkedMapEntry<Application>(
          Application,
          await this.cachedApi.query.hiring.applicationById(
            app.application_id
          )
        )
      )
    );

    const hiringApps = hiringAppPairs.map(app => app.value);

    const stakes = await Promise.all(
      hiringApps.map(app => this.applicationStakes(app))
    );

    const wgs = await Promise.all(
      myApps.map(curatorOpening => {
        return this.curationGroupOpening(curatorOpening.curator_opening_id.toNumber());
      })
    );

    const allAppsByOpening = (await Promise.all(
      myApps.map(curatorOpening => {
        return this.curatorOpeningApplications(curatorOpening.curator_opening_id.toNumber());
      })
    ));

    return await Promise.all(
      wgs.map(async (wg, key) => {
        return {
          id: myAppIds[key].toNumber(),
          hired: isApplicationHired(hiringApps[key]),
          cancelledReason: classifyApplicationCancellation(hiringApps[key]),
          rank: await this.myApplicationRank(hiringApps[key], allAppsByOpening[key].map(a => a.hiringModule)),
          capacity: wg.applications.maxNumberOfApplications,
          stage: wg.stage,
          opening: wg.opening,
          meta: wg.meta,
          applicationStake: stakes[key].application,
          roleStake: stakes[key].role,
          review_end_time: wg.stage.review_end_time,
          review_end_block: wg.stage.review_end_block
        };
      })
    );
  }

  async myCurationGroupRoles (roleKeyId: string): Promise<ActiveRole[]> {
    const curators = new MultipleLinkedMapEntry<CuratorId, Curator>(
      CuratorId,
      Curator,
      await this.cachedApi.query.contentWorkingGroup.curatorById()
    );

    return Promise.all(
      curators
        .linked_values
        .toArray()
        .filter(curator => curator.role_account.eq(roleKeyId) && curator.is_active)
        .map(async (curator, key) => {
          let stakeValue: Balance = new u128(0);
          if (curator.role_stake_profile && curator.role_stake_profile.isSome) {
            stakeValue = await this.workerStake(curator.role_stake_profile.unwrap());
          }

          let earnedValue: Balance = new u128(0);
          if (curator.reward_relationship && curator.reward_relationship.isSome) {
            earnedValue = await this.workerTotalReward(curator.reward_relationship.unwrap());
          }

          return {
            curatorId: curators.linked_keys[key],
            name: 'Content curator',
            reward: earnedValue,
            stake: stakeValue
          };
        })
    );
  }

  myStorageGroupRoles (): Subscribable<ActiveRole[]> {
    return new Observable<ActiveRole[]>(observer => { /* do nothing */ });
  }

  protected generateRoleAccount (name: string, password = ''): string | null {
    const { address, deriveError, derivePath, isSeedValid, pairType, seed } = generateSeed(null, '', 'bip');

    const isValid = !!address && !deriveError && isSeedValid;
    if (!isValid) {
      return null;
    }

    const status = createAccount(`${seed}${derivePath}`, pairType, name, password, 'created account');
    return status.account as string;
  }

  applyToCuratorOpening (
    id: number,
    roleAccountName: string,
    sourceAccount: string,
    appStake: Balance,
    roleStake: Balance,
    applicationText: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      (this.cachedApi.query.members.memberIdsByControllerAccountId(sourceAccount) as Promise<Vec<MemberId>>)
        .then(membershipIds => {
          if (membershipIds.length === 0) {
            reject(new Error('No membship ID associated with this address'));
          }

          const roleAccount = this.generateRoleAccount(roleAccountName);
          if (!roleAccount) {
            reject(new Error('failed to create role account'));
          }
          const tx = this.api.tx.contentWorkingGroup.applyOnCuratorOpening(
            membershipIds[0],
            new u32(id),
            new GenericAccountId(roleAccount as string),
            roleStake.eq(Zero) ? null : roleStake,
            appStake.eq(Zero) ? null : appStake,
            applicationText
          ) as unknown as SubmittableExtrinsic;

          const txFailedCb = () => {
            reject(new Error('transaction failed'));
          };

          const txSuccessCb = () => {
            resolve(1);
          };

          this.queueExtrinsic({
            accountId: sourceAccount,
            extrinsic: tx,
            txFailedCb,
            txSuccessCb
          });
        });
    });
  }

  leaveCurationRole (sourceAccount: string, id: number, rationale: string) {
    const tx = this.api.tx.contentWorkingGroup.leaveCuratorRole(
      id,
      rationale
    ) as unknown as SubmittableExtrinsic;

    this.queueExtrinsic({
      accountId: sourceAccount,
      extrinsic: tx
    });
  }

  withdrawCuratorApplication (sourceAccount: string, id: number) {
    const tx = this.api.tx.contentWorkingGroup.withdrawCuratorApplication(
      id
    ) as unknown as SubmittableExtrinsic;

    this.queueExtrinsic({
      accountId: sourceAccount,
      extrinsic: tx
    });
  }
}