import { JupyterFrontEnd } from '@jupyterlab/application';
import { ReactWidget } from '@jupyterlab/apputils';
import { IFileBrowserFactory } from '@jupyterlab/filebrowser';
import React from 'react';
import { Tensorboard } from '../tensorboard';
import { Message } from '@lumino/messaging';
import { TensorboardManager } from '../manager';
import { CommandIDs } from '../commands';

const TENSORBOARD_CLASS = 'jp-Tensorboard';
const TENSORBOARD_ICON_CLASS = 'jp-Tensorboards-itemIcon';

import { TensorboardTabReact } from './tab';

export interface TensorboardInvokeOptions {
  browserFactory: IFileBrowserFactory;
  tensorboardManager: TensorboardManager;
  createdModelName?: string;
  app: JupyterFrontEnd;
}

/**
 * A Counter Lumino Widget that wraps a CounterComponent.
 */
export class TensorboardTabReactWidget extends ReactWidget {
  browserFactory: IFileBrowserFactory;
  tensorboardManager: TensorboardManager;
  app: JupyterFrontEnd;

  currentTensorBoardModel: Tensorboard.IModel | null = null;
  createdModelName?: string;

  /**
   * Constructs a new CounterWidget.
   */
  constructor(options: TensorboardInvokeOptions) {
    super();
    this.browserFactory = options.browserFactory;
    this.tensorboardManager = options.tensorboardManager;
    this.createdModelName = options.createdModelName;
    this.app = options.app;

    this.addClass('tensorboard-ng-widget');
    this.addClass(TENSORBOARD_CLASS);
    this.title.label = 'TensorBoard';
    this.title.icon = TENSORBOARD_ICON_CLASS;
    this.title.closable = true;
    const caption = 'Name: TensorBoard';
    this.title.caption = caption;
  }

  /**
   * Dispose of the resources held by the tensorboard widget.
   */
  dispose(): void {
    super.dispose();
  }

  closeCurrent = (): void => {
    this.dispose();
    this.close();
  };

  protected updateCurrentModel = (model: Tensorboard.IModel): void => {
    this.currentTensorBoardModel = model;
  };

  protected getCWD = (): string => {
    return this.browserFactory.defaultBrowser.model.path;
  };

  protected onCloseRequest(msg: Message): void {
    super.onCloseRequest(msg);
    this.dispose();
  }

  protected openTensorBoard = (modelName: string, copy: boolean): void => {
    this.app.commands.execute(CommandIDs.open, {
      modelName,
      copy
    });
  };

  protected openDoc = (): void => {
    this.app.commands.execute(CommandIDs.openDoc);
  };

  render(): JSX.Element {
    return (
      <TensorboardTabReact
        update={this.update.bind(this)}
        updateCurrentModel={this.updateCurrentModel}
        tensorboardManager={this.tensorboardManager}
        getCWD={this.getCWD}
        openTensorBoard={this.openTensorBoard}
        closeWidget={this.closeCurrent}
        openDoc={this.openDoc}
        createdModelName={this.createdModelName}
      />
    );
  }
}
