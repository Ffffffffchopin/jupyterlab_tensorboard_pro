import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@blueprintjs/core/lib/esm/components/button/buttons';
import { MenuItem } from '@blueprintjs/core/lib/esm/components/menu/menuItem';
import { InputGroup } from '@blueprintjs/core/lib/esm/components/forms/inputGroup';
import { Switch } from '@blueprintjs/core/lib/esm/components/forms/controls';
import { Tag } from '@blueprintjs/core/lib/esm/components/tag/tag';
import { toArray } from '@lumino/algorithm';
import classNames from 'classnames';
import { Select } from '@blueprintjs/select';
import { showDialog, Dialog } from '@jupyterlab/apputils';
import { Loading } from './loading';
import { Tensorboard } from '../tensorboard';
import { TensorboardManager } from '../manager';
import { DEFAULT_REFRESH_INTERVAL } from '../consts';
import { copyToClipboard } from '../utils/copy';

export interface TensorboardCreatorProps {
  disable: boolean;
  getCWD: () => string;
  openDoc: () => void;
  startTensorBoard: (
    logDir: string,
    reloadInterval: number,
    enableMultiLog: boolean,
    additionalArgs: string
  ) => void;
}

const TensorboardCreator = (props: TensorboardCreatorProps): JSX.Element => {
  const [logDir, setLogDir] = useState(props.getCWD());
  const [reloadInterval, setReloadInterval] = useState(DEFAULT_REFRESH_INTERVAL);
  const [additionalArgs, setAdditionalArgs] = useState('');
  const [enableReloadInterval, setEnableReloadInterval] = useState(false);
  const [enableMultiLog, setEnableMultiLog] = useState(false);

  return (
    <div className="tensorboard-ng-creator">
      <div className="tensorboard-ng-config">
        <div className="input-container tensorboard-ng-logdir">
          <label title="Path relative to workspace, don\'t start with `/`">
            <strong>Log Dir</strong>
          </label>
          <InputGroup
            style={{ width: 160 }}
            small={true}
            placeholder="Enter your log dir..."
            value={logDir}
            onChange={e => {
              setLogDir(e.target.value);
              if (e.target.value.includes(',')) {
                setEnableMultiLog(true);
              }
            }}
          />
        </div>
        <div className="input-container tensorboard-ng-logdir">
          <Switch
            className="multi-log-switch"
            checked={enableMultiLog}
            onChange={() => {
              setEnableMultiLog(!enableMultiLog);
            }}
            labelElement={
              <strong title="Use `--logdir_spec` instead of `--logdir` to support multi log dirs, This flag is discouraged and can usually be avoided. for finer-grained control, prefer using a symlink tree. Some features may not work when using `--logdir_spec` instead of `--logdir`">
                Multi LogDir
              </strong>
            }
          />
          <Switch
            className="interval-switch"
            checked={enableReloadInterval}
            onChange={() => {
              setEnableReloadInterval(!enableReloadInterval);
            }}
            labelElement={
              <strong title="Setting reload interval may cause additional burden on the jupyter backend">
                Reload Interval
              </strong>
            }
          />
          {enableReloadInterval && (
            <InputGroup
              style={{ width: 80 }}
              small={true}
              placeholder="Enter your reload_interval ..."
              value={enableReloadInterval ? `${reloadInterval}` : ''}
              onChange={e => {
                setReloadInterval(Number(e.target.value));
              }}
              rightElement={<Tag minimal={true}>s</Tag>}
              type="number"
            />
          )}
        </div>
      </div>
      <InputGroup
        className={classNames('additional-config-input', {
          'with-content': !!additionalArgs.length
        })}
        small={true}
        placeholder="Custom Args..."
        value={additionalArgs}
        onChange={e => {
          setAdditionalArgs(e.target.value);
        }}
      />
      <div className="tensorboard-ng-ops create">
        <Button
          small={true}
          intent="warning"
          className="tensorboard-ng-op-btn"
          onClick={() => {
            props.startTensorBoard(
              logDir,
              enableReloadInterval ? reloadInterval : 0,
              enableMultiLog,
              additionalArgs
            );
          }}
          disabled={props.disable}
        >
          Create TensorBoard
        </Button>
      </div>
      <div className="tensorboard-ng-expand" />
      <Button
        small={true}
        outlined={true}
        icon="help"
        onClick={() => {
          props.openDoc();
        }}
      >
        Document
      </Button>
    </div>
  );
};

export interface TensorboardTabReactProps {
  setWidgetName?: (name: string) => void;
  createdModelName?: string;
  tensorboardManager: TensorboardManager;
  closeWidget: () => void;
  getCWD: () => string;
  openTensorBoard: (modelName: string, copy: boolean) => void;
  openDoc: () => void;
  update: () => void;
  updateCurrentModel: (model: Tensorboard.IModel | null) => void;
  startNew: (
    logdir: string,
    refreshInterval: number,
    enableMultiLog: boolean,
    additionalArgs: string,
    options?: Tensorboard.IOptions
  ) => Promise<Tensorboard.ITensorboard>;
}

const ModelSelector = Select.ofType<Tensorboard.IModel>();

const useRefState = <T,>(initValue: T): [T, { current: T }, (value: T) => void] => {
  const [value, setValue] = useState(initValue);
  const valueRef = useRef(value);
  const updateValue = (value: T) => {
    setValue(value);
    valueRef.current = value;
  };
  return [value, valueRef, updateValue];
};

export const TensorboardTabReact = (props: TensorboardTabReactProps): JSX.Element => {
  const [ready, readyRef, updateReady] = useRefState(false);

  const [createPending, createPendingRef, updateCreatePending] = useRefState(false);
  const [reloadPending, reloadPendingRef, updateReloadPending] = useRefState(false);

  const [showNewRow, setShowNewRow] = useState(false);
  const [showListStatus, setShowListStatus] = useState(false);

  const [currentTensorBoard, setCurrentTensorBoard] = useState<Tensorboard.IModel | null>(null);
  const currentTensorBoardRef = useRef(currentTensorBoard);
  const updateCurrentTensorBoard = (model: Tensorboard.IModel | null) => {
    props.updateCurrentModel(model);
    setCurrentTensorBoard(model);
    currentTensorBoardRef.current = model;
  };

  const [runningTensorBoards, setRunningTensorBoards] = useState<Tensorboard.IModel[]>([]);

  // currently inactive
  const [notActiveError, setNotActiveError] = useState(false);

  const currentLoading = reloadPending || createPending;

  const refreshRunning = () => {
    if (createPendingRef.current || reloadPendingRef.current) {
      return;
    }
    props.tensorboardManager.refreshRunning().then(() => {
      const runningTensorboards = [...toArray(props.tensorboardManager.running())];

      // hint: Using runningTensorboards directly may cause setState to fail to respond
      const modelList = [];
      for (const model of runningTensorboards) {
        modelList.push(model);
      }
      setRunningTensorBoards(modelList);

      if (readyRef.current) {
        // 如果不是第一次了
        if (currentTensorBoardRef.current) {
          if (!modelList.find(model => model.name === currentTensorBoardRef.current!.name)) {
            setNotActiveError(true);
          }
        } else {
          // do nothing
          // Maybe not at the beginning, the user planned to create a new one later, and then did not create a new one. At this time, he found that there was
        }

        return;
      }

      const model = props.createdModelName
        ? modelList.find(model => model.name === props.createdModelName)
        : null;

      if (model) {
        // if createdModelName exist，maybe from Sidebar kernels tab
        updateCurrentTensorBoard(model);
        setShowListStatus(true);
        if (props.setWidgetName) {
          props.setWidgetName(`${model.name}:` + props.tensorboardManager.formatDir(model.logdir));
        }
      } else {
        setShowNewRow(true);
        setShowListStatus(false);
      }
      updateReady(true);
    });
  };

  const startTensorBoard = (
    logDir: string,
    reloadInterval: number,
    enableMultiLog: boolean,
    additionalArgs: string
  ) => {
    if (Number.isNaN(reloadInterval) || reloadInterval < 0) {
      return showDialog({
        title: 'Param Check Failed',
        body: 'reloadInterval should > 0 when enabled',
        buttons: [Dialog.okButton()]
      });
    }
    updateCreatePending(true);
    const currentName = currentTensorBoard?.name;
    props
      .startNew(logDir, reloadInterval, enableMultiLog, additionalArgs)
      .then(tb => {
        if (currentName === tb.model.name) {
          showDialog({
            body: 'Existing tensorBoard for the logDir will be reused directly',
            buttons: [Dialog.okButton()]
          });
        }
        if (props.setWidgetName) {
          props.setWidgetName(
            `${tb.model.name}:` + props.tensorboardManager.formatDir(tb.model.logdir)
          );
        }
        updateCurrentTensorBoard(tb.model);
        updateCreatePending(false);
        refreshRunning();

        setShowListStatus(true);
        setShowNewRow(false);
      })
      .catch(e => {
        updateCreatePending(false);

        const getMessage = () =>
          e.response.json().then((json: any) => {
            return json.message as string;
          });
        const defaultMessage = 'Start TensorBoard internal error';

        getMessage()
          .then((msg: string) => {
            showDialog({
              body: msg || defaultMessage,
              buttons: [Dialog.okButton()]
            });
          })
          .catch(() => {
            showDialog({
              body: defaultMessage,
              buttons: [Dialog.okButton()]
            });
          });
      });
  };

  // hint: Because we are simulating reload here, the tab component cannot listen to runningChanged
  const reloadTensorBoard = () => {
    // There was no reload in the world, so I had to stop and restart to simulate reload
    if (!currentTensorBoard) {
      return;
    }
    updateReloadPending(true);
    updateCurrentTensorBoard(null);
    const reloadInterval =
      typeof currentTensorBoard.reload_interval === 'number'
        ? currentTensorBoard.reload_interval
        : DEFAULT_REFRESH_INTERVAL;
    const currentLogDir = currentTensorBoard.logdir;
    const enableMultiLog = currentTensorBoard.enable_multi_log;
    const additionalArgs = currentTensorBoard.additional_args;

    const errorCallback = (e: any) => {
      showDialog({
        title: 'TensorBoard Reload Error',
        body: 'The panel has been closed, you can reopen to create new',
        buttons: [Dialog.okButton()]
      });
      props.closeWidget();
    };

    try {
      props.tensorboardManager
        .shutdown(currentTensorBoard.name)
        .then(res => {
          props.tensorboardManager
            .startNew(currentLogDir, reloadInterval, enableMultiLog, additionalArgs)
            .then(res => {
              refreshRunning();
              updateReloadPending(false);
              updateCurrentTensorBoard(currentTensorBoard);
            })
            .catch(e => {
              errorCallback(e);
            });
        })
        .catch(e => {
          errorCallback(e);
        });
    } catch (e) {
      errorCallback(e);
    }
  };

  const destroyTensorBoard = () => {
    if (!currentTensorBoard) {
      return;
    }
    props.tensorboardManager.shutdown(currentTensorBoard.name).then(res => {
      props.closeWidget();
    });
  };

  const copyTensorBoard = () => {
    if (!currentTensorBoard) {
      return;
    }
    props.openTensorBoard(currentTensorBoard.name, true);
  };

  const getShowName = (model: Tensorboard.IModel) => {
    const formattedDir = props.tensorboardManager.formatDir(model.logdir);
    return `${model.name} - ${formattedDir}`;
  };

  const changeModel = (model: Tensorboard.IModel) => {
    if (currentTensorBoard?.name === model.name) {
      return;
    }
    if (props.setWidgetName) {
      props.setWidgetName(`${model.name}:` + props.tensorboardManager.formatDir(model.logdir));
    }
    setCurrentTensorBoard(model);
  };

  const toggleNewRow = () => {
    setShowNewRow(!showNewRow);
  };

  const openInNewTab = () => {
    if (!currentTensorBoard) {
      return;
    }
    window.open(Tensorboard.getUrl(currentTensorBoard.name));
  };

  useEffect(() => {
    refreshRunning();
    const refreshIntervalId = setInterval(refreshRunning, 30 * 1000);
    return () => {
      clearInterval(refreshIntervalId);
    };
  }, []);

  const getBlankContent = () => {
    if (!ready) {
      return <Loading title="initializing" />;
    } else if (createPending) {
      return (
        <Loading
          title="TensorBoard is initializing"
          desc="This stage may take a long time (the more content in the directory, the longer it will be)"
        />
      );
    } else if (reloadPending) {
      return (
        <Loading
          title="TensorBoard is reloading"
          desc="This stage may take a long time (the more content in the directory, the longer it will be)"
        />
      );
    } else {
      return (
        <div className="common-tip">
          <p className="title">
            No instance for current directory yet, please create a new TensorBoard
          </p>
          <p className="desc">
            <i>
              If the selected log directory has too much content, tensorboard initialization may
              take a long time, during which jupyter will get stuck
            </i>
          </p>
        </div>
      );
    }
  };

  return (
    <div className="tensorboard-ng-main">
      {ready && (
        <div
          className={classNames('tensorboard-ng-control-layout', {
            'hide-one': !(showNewRow && showListStatus)
          })}
        >
          <div className={classNames('tensorboard-ng-control-row', { hide: !showListStatus })}>
            <div className="tensorboard-ng-config">
              <div className="input-container tensorboard-ng-logdir">
                <Button
                  className="refresh-dir-btn"
                  small={true}
                  icon="refresh"
                  disabled={currentLoading}
                  onClick={refreshRunning}
                />
                <ModelSelector
                  className="tb-ng-model-selector"
                  popoverProps={{ minimal: true }}
                  itemRenderer={(model, { handleClick }) => {
                    return (
                      <MenuItem key={model.name} onClick={handleClick} text={getShowName(model)} />
                    );
                  }}
                  items={runningTensorBoards}
                  onItemSelect={model => changeModel(model)}
                  filterable={false}
                  activeItem={currentTensorBoard}
                  disabled={currentLoading}
                >
                  <Button
                    title={currentTensorBoard ? getShowName(currentTensorBoard) : 'NONE'}
                    className="selector-active-btn"
                    rightIcon="caret-down"
                    text={
                      <span className="active-btn-text">
                        {currentTensorBoard ? getShowName(currentTensorBoard) : 'NONE'}
                      </span>
                    }
                    small={true}
                  />
                </ModelSelector>
                <Button
                  className="refresh-dir-btn"
                  small={true}
                  icon="document-open"
                  disabled={currentLoading}
                  onClick={openInNewTab}
                />
                {currentTensorBoard && currentTensorBoard.enable_multi_log && (
                  <p className="multi-log-tip">Multi LogDir</p>
                )}
                {currentTensorBoard && (
                  <p className="reload-tip">
                    reload interval(s): {currentTensorBoard?.reload_interval || 'Never'}
                  </p>
                )}
                {currentTensorBoard?.additional_args && (
                  <>
                    <p title={currentTensorBoard?.additional_args} className="custom-args-tip">
                      {currentTensorBoard?.additional_args}
                    </p>
                    <Button
                      small={true}
                      minimal
                      icon="duplicate"
                      onClick={() => {
                        copyToClipboard(currentTensorBoard?.additional_args);
                      }}
                    />
                  </>
                )}
              </div>
            </div>
            <div className="tensorboard-ng-expand" />
            <div className="tensorboard-ng-ops">
              <Button
                small={true}
                intent="primary"
                className="tensorboard-ng-op-btn"
                onClick={reloadTensorBoard}
                disabled={currentLoading}
              >
                Reload
              </Button>
              <Button
                small={true}
                intent="danger"
                disabled={currentLoading}
                className="tensorboard-ng-op-btn"
                onClick={destroyTensorBoard}
                title="Destroy current tensorboard, sidebar `running terminals and kernels` supports destroy all"
              >
                Destroy
              </Button>
              <Button
                small={true}
                intent="none"
                disabled={currentLoading}
                className="tensorboard-ng-op-btn"
                onClick={copyTensorBoard}
              >
                Duplicate
              </Button>
              <Button
                small={true}
                intent="none"
                disabled={currentLoading}
                className="tensorboard-ng-op-btn"
                onClick={toggleNewRow}
                active={showNewRow}
              >
                New..
              </Button>
            </div>
          </div>
          <div className={classNames('tensorboard-ng-control-row creator', { hide: !showNewRow })}>
            <TensorboardCreator
              disable={currentLoading}
              getCWD={props.getCWD}
              startTensorBoard={startTensorBoard}
              openDoc={props.openDoc}
            />
            <div className="tensorboard-ng-expand" />
          </div>
        </div>
      )}
      <div className="tensorboard-ng-iframe-container">
        {currentTensorBoard && (
          <iframe
            sandbox="allow-scripts allow-forms allow-same-origin"
            referrerPolicy="no-referrer"
            className={'tensorboard-ng-iframe'}
            src={Tensorboard.getUrl(currentTensorBoard.name)}
          />
        )}
        {!currentTensorBoard && (
          <div className="tensorboard-ng-iframe-tip">{getBlankContent()}</div>
        )}
        {notActiveError && (
          <div className="tensorboard-ng-iframe-tip">
            <p className="error">
              Current Tensorboard is not active. Please select others or create a new one.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export declare namespace TensorboardTab {
  /**
   * Options of the tensorboard widget.
   */
  interface IOptions {
    /**
     * The model of tensorboard instance.
     */
    readonly model: Tensorboard.IModel;
  }
}
