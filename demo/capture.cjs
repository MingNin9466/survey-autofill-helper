/** 生成 README 截图：demo 页 + 面板填充结果 / 抓题列表 */
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9339;
const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'survey-autofill-helper.user.js'), 'utf8');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class C {
  constructor(u) {
    this.ws = new WebSocket(u);
    this.id = 0;
    this.p = new Map();
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.p.has(m.id)) {
        const { res, rej } = this.p.get(m.id);
        this.p.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      }
    };
  }
  open() { return new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = j; }); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.p.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result && r.result.value;
  }
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfh-shot-'));
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + dir, '--remote-debugging-port=' + PORT, '--window-size=1600,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) {
      try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) { await sleep(300); }
    }
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const c = new C(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await c.open();
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });

    await c.send('Page.navigate', { url: 'file:///' + path.join(ROOT, 'demo', 'demo.html').replace(/\\/g, '/') });
    await sleep(1200);
    await c.eval(SRC);
    await sleep(300);

    await c.eval(`window.__SFH__.setState({templates:[{id:'demo',name:'示例模板',rules:[
      {id:'r1',kw:'姓名',ans:'李明'},
      {id:'r2',kw:'性别',ans:'男'},
      {id:'r3',kw:'年级',ans:'大一'},
      {id:'r4',kw:'活动',ans:'志愿服务|学术讲座'},
      {id:'r5',kw:'建议',ans:'希望多安排周末场次'}
    ]}],activeId:'demo',settings:{onlyEmpty:false,highlight:true,delayMin:0,delayMax:0,autoOpen:false}})`);
    await c.eval('window.__SFH__.open()');
    await sleep(400);

    // 点面板里的「一键填充」，让结果列表出现
    await c.eval('document.getElementById("sfh-host").shadowRoot.querySelector(\'[data-act="fill"]\').click()');
    await sleep(1800);
    const fillShot = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, 'fill.png'), Buffer.from(fillShot.data, 'base64'));

    // 切到抓题
    await c.eval('document.getElementById("sfh-host").shadowRoot.querySelector(\'[data-tab="scan"]\').click()');
    await sleep(600);
    const scanShot = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, 'scan.png'), Buffer.from(scanShot.data, 'base64'));

    console.log('saved', fs.readdirSync(SHOTS));
  } finally {
    try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
  process.exit(0);
}
main().catch((e) => { console.error('FAIL', e.stack || e); process.exit(1); });
