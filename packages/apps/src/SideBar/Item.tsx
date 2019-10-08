// Copyright 2017-2019 @polkadot/apps authors & contributors
// This software may be modified and distributed under the terms
// of the Apache-2.0 license. See the LICENSE file for details.

import { I18nProps } from '@polkadot/react-components/types';
import { SubjectInfo } from '@polkadot/ui-keyring/observable/types';
import { Route } from '@polkadot/apps-routing/types';

import React, { useContext } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon, Menu, Tooltip } from '@polkadot/react-components';
import accountObservable from '@polkadot/ui-keyring/observable/accounts';
import { ApiContext, withCalls, withMulti, withObservable } from '@polkadot/react-api';
import { isFunction } from '@polkadot/util';
import { Option } from '@polkadot/types';

import translate from '../translate';

import { queryToProp } from '@polkadot/joy-utils/index';
import { ElectionStage } from '@joystream/types/';
import { councilSidebarName } from '@polkadot/apps-routing/joy-election';


interface Props extends I18nProps {
  isCollapsed: boolean;
  onClick: () => void;
  allAccounts?: SubjectInfo;
  route: Route;
  sudoKey: string;
  electionStage: Option<ElectionStage>;
}

type Subtitle = {
  text: string,
  classes: string[]
};


const disabledLog: Map<string, string> = new Map();

function logDisabled (route: string, message: string): void {
  if (!disabledLog.get(route)) {
    disabledLog.set(route, message);

    console.warn(`Disabling ${route}: ${message}`);
  }
}

function Item ({ allAccounts, route: { Modal, display: { isHidden, needsAccounts, needsApi, needsSudo }, i18n, icon, name }, t, isCollapsed, onClick, sudoKey, electionStage }: Props): React.ReactElement<Props> | null {
  const { api, isApiConnected, isApiReady } = useContext(ApiContext);

  const _getSubtitle = (name: string): Subtitle | undefined => {
    if (name === councilSidebarName) {
      if (electionStage && electionStage.isSome) {
        const classes: string[] = [];
        let text = 'No active election';
        if (electionStage.isSome) {
          const stageValue = electionStage.value as ElectionStage;
          const stageName = stageValue.type;
          text = `${stageName} stage`;
          classes.push(stageName);
        }
        return { text, classes };
      }
    }
    return undefined;
  }

  const _hasApi = (endpoint: string): boolean => {
    const [area, section, method] = endpoint.split('.');

    try {
      return isFunction((api as any)[area][section][method]);
    } catch (error) {
      return false;
    }
  };
  const _isVisible = (): boolean => {
    const hasAccounts = !!allAccounts && Object.keys(allAccounts).length !== 0;
    const hasSudo = !!allAccounts && Object.keys(allAccounts).some((address): boolean => address === sudoKey);

    if (isHidden) {
      return false;
    } else if (needsAccounts && !hasAccounts) {
      return false;
    } else if (!needsApi) {
      return true;
    } else if (!isApiReady || !isApiConnected) {
      return false;
    } else if (needsSudo) {
      if (!hasSudo) {
        logDisabled(name, 'Sudo key not available');
        return false;
      }
    }

    const notFound = needsApi.filter((endpoint: string | string[]): boolean => {
      const hasApi = Array.isArray(endpoint)
        ? endpoint.reduce((hasApi, endpoint): boolean => hasApi || _hasApi(endpoint), false)
        : _hasApi(endpoint);

      return !hasApi;
    });

    if (notFound.length !== 0) {
      logDisabled(name, `API not available: ${notFound}`);
    }

    return notFound.length === 0;
  };

  if (!_isVisible()) {
    return null;
  }

  const subtitle = _getSubtitle(name);

  const body = (
    <>
      <Icon name={icon} />
      <div className='text SidebarItem'>
            <div>{t(`sidebar.${name}`, i18n)}</div>
            {subtitle && <div className={`SidebarSubtitle ${subtitle.classes.join(' ')}`}>{subtitle.text}</div>}
      </div>
      <Tooltip
        offset={{ right: -4 }}
        place='right'
        text={t(`sidebar.${name}`, i18n)}
        trigger={`nav-${name}`}
      />
    </>
  );

  return (
    <Menu.Item className='apps--SideBar-Item'>
      {Modal
        ? (
          <a
            className='apps--SideBar-Item-NavLink'
            data-for={`nav-${name}`}
            data-tip
            data-tip-disable={!isCollapsed}
            onClick={onClick}
          >
            {body}
          </a>
        )
        : (
          <NavLink
            activeClassName='apps--SideBar-Item-NavLink-active'
            className='apps--SideBar-Item-NavLink'
            data-for={`nav-${name}`}
            data-tip
            data-tip-disable={!isCollapsed}
            onClick={onClick}
            to={`/${name}`}
          >
            {body}
          </NavLink>
        )
      }
    </Menu.Item>
  );
}

export default withMulti(
  Item,
  translate,
  withCalls(queryToProp('query.councilElection.stage', { propName: 'electionStage' })),
  withCalls<Props>(
    ['query.sudo.key', {
      propName: 'sudoKey',
      transform: (key): string =>
        key.toString()
    }]
  ),
  withObservable(accountObservable.subject, { propName: 'allAccounts' })
);
