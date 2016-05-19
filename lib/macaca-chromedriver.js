'use strict';

const path = require('path');
const EventEmitter = require('events');
const childProcess = require('child_process');

const _ = require('./helper');
const Proxy = require('./proxy');
const logger = require('./logger');

const fileName = _.platform.isWindows ? 'chromedriver.exe' : 'chromedriver';
const binPath = path.join(__dirname, '..', 'exec', fileName);

class ChromeDriver extends EventEmitter {
  constructor(options) {
    super();
    Object.assign(this, {
      proxyHost: 'localhost',
      proxyPort: 9515,
      urlBase: 'wd/hub'
    }, options || {});
    this.binPath = binPath;
    this.proxy = null;
    this.chromedriver = null;
    this.capabilities = null;
    this.sessionId = null;
    this.init();
  }

  init() {
    this.checkBinPath();
    this.initPorxy();
  }

  checkBinPath() {
    if (_.isExistedFile(this.binPath)) {
      logger.info(`chromedriver bin path: ${this.binPath}`);
    } else {
      logger.error('chromedriver bin path not found');
    }
  }

  initPorxy() {
    this.proxy = new Proxy({
      proxyHost: this.proxyHost,
      proxyPort: this.proxyPort,
      urlBase: this.urlBase
    });
  }

  waitReadyStatus() {
    logger.info('chromedriver starting success.');

    return _.retry(this.getStatus.bind(this), 1000, 20).then(() => _.retry(this.createSession.bind(this), 1000, 20).then(data => {
        this.emit(ChromeDriver.EVENT_READY, data);
      }).catch(err => {
        logger.error('create chromedriver session failed');
      })).catch(err => {
      logger.error('get chromedriver ready status failed');
    });
  }

  sendCommand(url, method, body) {
    return this.proxy.send(url, method, body);
  }

  getStatus() {
    return this.sendCommand('/status', 'GET');
  }

  createSession() {
    return this.sendCommand('/session', 'POST', {
      desiredCapabilities: this.capabilities
    });
  }

  killAll() {

    let cmd;
    if (_.platform.isOSX) {
      cmd = `ps -ef | grep chromedriver | grep -v grep | grep -e '--port=' | awk '{ print $2 }' | xargs kill -15`;
    } else if (_.platform.isLinux) {
      cmd = `ps -ef | grep chromedriver | grep -v grep | grep -e '--port=' | awk '{ print $2 }' | xargs -r kill -15`;
    } else if (_.platform.isWindows) {
      cmd = 'taskkill /f /im chromedriver.exe';
      return _.exec(cmd).catch(err => {
        logger.debug('Noting to kill.');
      });
    } else {
      return reject(new Error(`${process.platform} not supported!`));
    }
    logger.info(`Kill all running chromedriver process by: ${cmd}`);
    return _.exec(cmd);
  }

  start(caps) {
    this.capabilities = caps;

    return this.starting().then(this.waitReadyStatus.bind(this)).catch(err => {
      logger.warn('chromedriver starting failed.');
      setTimeout(function() {
        throw err;
      });
    });
  }

  starting() {
    return this.killAll().then(() => {
      logger.info('kill all chromedriver process success!');
      return new Promise((resolve, reject) => {
        let args = [`--url-base=${this.urlBase}`];
        args.push(`--port=${this.proxyPort}`);

        this.chromedriver = childProcess.spawn(this.binPath, args, {});

        this.chromedriver.stderr.setEncoding('utf8');
        this.chromedriver.stdout.setEncoding('utf8');

        var res = '';
        var startFlag = 'Starting';

        this.chromedriver.stdout.on('data', data => {
          res += data;
          logger.info(data);
          if (res.startsWith(startFlag)) {
            resolve('chromedriver start success!');
          } else if (res.length >= startFlag.length) {
            reject(new Error('chromedriver start failed.'));
          }
        });

        this.chromedriver.on('error', (err) => {
          this.emit(ChromeDriver.EVENT_ERROR, err);
          logger.warn(`chromedriver error with ${err}`);
          reject(err);
        });

        this.chromedriver.on('exit', (code, signal) => {
          logger.warn(`chromedriver exit with code: ${code}, signal: ${signal}`);
          reject(new Error(`chromedriver exit with code: ${code}, signal: ${signal}`));
        });
      });
    }).catch(err => {
      logger.info('kill all chromedriver process failed!');
      throw err;
    });
  }
}

ChromeDriver.start = () => {
  ChromeDriver.chromedriver = childProcess.execFile(binPath);
  return ChromeDriver.chromedriver;
};

ChromeDriver.stop = () => {
  if (ChromeDriver.chromedriver) {
    ChromeDriver.chromedriver.kill();
    logger.info('chromedriver killed');
  }
};

ChromeDriver.EVENT_READY = 'ready';
ChromeDriver.EVENT_ERROR = 'error';

ChromeDriver.version = '2.20';
ChromeDriver.binPath = binPath;
ChromeDriver.fileName = fileName;

module.exports = ChromeDriver;
