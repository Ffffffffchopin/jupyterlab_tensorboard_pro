//Tensorboard manager
import { IIterator, ArrayExt, iter } from '@lumino/algorithm';
import { Signal, ISignal } from '@lumino/signaling';
import { JSONExt } from '@lumino/coreutils';
import { Tensorboard } from './tensorboard';
import { ServerConnection } from '@jupyterlab/services';
import { DEFAULT_ENABLE_MULTI_LOG, DEFAULT_REFRESH_INTERVAL } from './consts';

/**
 * A tensorboard manager.
 */
export class TensorboardManager implements Tensorboard.IManager {
  getStaticConfigPromise: Promise<void>;

  /**
   * Construct a new tensorboard manager.
   */
  constructor(options: TensorboardManager.IOptions = {}) {
    this.serverSettings = options.serverSettings || ServerConnection.makeSettings();
    this._readyPromise = this._refreshRunning();
    this._refreshTimer = (setInterval as any)(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      this._refreshRunning();
    }, 10000);
    this.getStaticConfigPromise = this._getStaticConfig();
  }

  /**
   * A signal emitted when the running tensorboards change.
   */
  get runningChanged(): ISignal<this, Tensorboard.IModel[]> {
    return this._runningChanged;
  }

  /**
   * Test whether the terminal manager is disposed.
   */
  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * The server settings of the manager.
   */
  readonly serverSettings: ServerConnection.ISettings;

  /**
   * Dispose of the resources used by the manager.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._isDisposed = true;
    clearInterval(this._refreshTimer);
    Signal.clearData(this);
    this._models = [];
  }

  /**
   * Test whether the manager is ready.
   */
  get isReady(): boolean {
    return this._isReady;
  }

  /**
   * A promise that fulfills when the manager is ready.
   */
  get ready(): Promise<void> {
    return this._readyPromise;
  }

  /**
   * Create an iterator over the most recent running Tensorboards.
   *
   * @returns A new iterator over the running tensorboards.
   */
  running(): IIterator<Tensorboard.IModel> {
    return iter(this._models);
  }

  formatDir(dir: string): string {
    const pageRoot = this._statusConfig?.notebook_dir;

    if (dir.includes(',')) {
      const dirs = dir.split(',');
      return dirs
        .map(dir => {
          if (dir.includes(':')) {
            return `${dir.split(':')![0]}:${this.formatDir(dir.split(':')![1])}`;
          } else {
            return this.formatDir(dir);
          }
        })
        .join(',');
    }

    if (pageRoot && dir.indexOf(pageRoot) === 0) {
      let replaceResult = dir.replace(pageRoot, '');
      if (replaceResult === '') {
        replaceResult = '/';
      }
      const formatted = `${replaceResult}`.replace(/^\//, '');
      if (!formatted) {
        return '<workspace_root>';
      }
      return formatted;
    }
    return dir;
  }

  /**
   * Create a new tensorboard.
   *
   * @param logdir - The logdir used to create a new tensorboard.
   *
   * @param options - The options used to connect to the tensorboard.
   *
   * @returns A promise that resolves with the tensorboard instance.
   */
  async startNew(
    logdir: string,
    refreshInterval: number = DEFAULT_REFRESH_INTERVAL,
    enableMultiLog: boolean = DEFAULT_ENABLE_MULTI_LOG,
    additionalArgs = '',
    options?: Tensorboard.IOptions
  ): Promise<Tensorboard.ITensorboard> {
    const tensorboard = await Tensorboard.startNew(
      logdir,
      refreshInterval,
      enableMultiLog,
      additionalArgs,
      this._getOptions(options)
    );
    this._onStarted(tensorboard);
    return tensorboard;
  }

  /**
   * Shut down a tensorboard by name.
   */
  async shutdown(name: string): Promise<void> {
    const index = ArrayExt.findFirstIndex(this._models, value => value.name === name);
    if (index === -1) {
      return;
    }

    this._models.splice(index, 1);
    this._runningChanged.emit(this._models.slice());

    return Tensorboard.shutdown(name, this.serverSettings).then(() => {
      const toRemove: Tensorboard.ITensorboard[] = [];
      this._tensorboards.forEach(t => {
        if (t.name === name) {
          t.dispose();
          toRemove.push(t);
        }
      });
      toRemove.forEach(s => {
        this._tensorboards.delete(s);
      });
    });
  }

  /**
   * Shut down all tensorboards.
   *
   * @returns A promise that resolves when all of the tensorboards are shut down.
   */
  shutdownAll(): Promise<void> {
    const models = this._models;
    if (models.length > 0) {
      this._models = [];
      this._runningChanged.emit([]);
    }

    return this._refreshRunning().then(() => {
      return Promise.all(
        models.map(model => {
          return Tensorboard.shutdown(model.name, this.serverSettings).then(() => {
            const toRemove: Tensorboard.ITensorboard[] = [];
            this._tensorboards.forEach(t => {
              t.dispose();
              toRemove.push(t);
            });
            toRemove.forEach(t => {
              this._tensorboards.delete(t);
            });
          });
        })
      ).then(() => {
        return undefined;
      });
    });
  }

  /**
   * Force a refresh of the running tensorboards.
   *
   * @returns A promise that with the list of running tensorboards.
   */
  refreshRunning(): Promise<void> {
    return this._refreshRunning();
  }

  /**
   * Handle a tensorboard terminating.
   */
  private _onTerminated(name: string): void {
    const index = ArrayExt.findFirstIndex(this._models, value => value.name === name);
    if (index !== -1) {
      this._models.splice(index, 1);
      this._runningChanged.emit(this._models.slice());
    }
  }

  /**
   * Handle a tensorboard starting.
   */
  private _onStarted(tensorboard: Tensorboard.ITensorboard): void {
    const name = tensorboard.name;
    this._tensorboards.add(tensorboard);
    const index = ArrayExt.findFirstIndex(this._models, value => value.name === name);
    if (index === -1) {
      this._models.push(tensorboard.model);
      this._runningChanged.emit(this._models.slice());
    }
    tensorboard.terminated.connect(() => {
      this._onTerminated(name);
    });
  }

  /**
   * Refresh the running tensorboards.
   */
  private _refreshRunning(): Promise<void> {
    return Tensorboard.listRunning(this.serverSettings).then(models => {
      this._isReady = true;
      if (!JSONExt.deepEqual(models, this._models)) {
        const names = models.map(r => r.name);
        const toRemove: Tensorboard.ITensorboard[] = [];
        this._tensorboards.forEach(t => {
          if (names.indexOf(t.name) === -1) {
            t.dispose();
            toRemove.push(t);
          }
        });
        toRemove.forEach(t => {
          this._tensorboards.delete(t);
        });
        this._models = models.slice();
        this._runningChanged.emit(models);
      }
    });
  }

  private _getStaticConfig(): Promise<void> {
    return Tensorboard.getStaticConfig(this.serverSettings).then(config => {
      this._statusConfig = config;
    });
  }

  /**
   * Get a set of options to pass.
   */
  private _getOptions(options: Tensorboard.IOptions = {}): Tensorboard.IOptions {
    return { ...options, serverSettings: this.serverSettings };
  }

  private _models: Tensorboard.IModel[] = [];
  private _tensorboards = new Set<Tensorboard.ITensorboard>();
  private _isDisposed = false;
  private _isReady = false;
  private _readyPromise: Promise<void>;
  private _refreshTimer = -1;
  private _runningChanged = new Signal<this, Tensorboard.IModel[]>(this);
  private _statusConfig: Tensorboard.StaticConfig | null = null;
}
/**
 * The namespace for TensorboardManager statics.
 */
export namespace TensorboardManager {
  /**
   * The options used to initialize a tensorboard manager.
   */
  export interface IOptions {
    /**
     * The server settings used by the manager.
     */
    serverSettings?: ServerConnection.ISettings;
  }
}
