/*
  Behavior:
  - Master mode: starts an Express health server and spawns child processes (workers).
  - Worker mode (--worker): each worker creates one Mineflayer bot.
  - Bots get random usernames & passwords, register/login, then AFK forever.
  - Intended for YOUR OWN server. Do not use on public ones.

  Perfect for Render + GitHub + UptimeRobot (Express keeps it alive).
*/

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const configPath = path.resolve(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('Missing config.json — copy the provided example and edit it.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

if (process.argv.includes('--worker')) startWorker();
else startMaster();

// ------------------ Master ------------------
function startMaster() {
  const express = require('express');
  const app = express();
  const total = config.numberOfBots || 65;
  const staggerMs = config.staggerMs || 2000;
  const maxConcurrent = config.maxConcurrentWorkers || 20;

  let launched = 0;
  let finished = 0;
  let aliveWorkers = 0;
  const workers = [];

  app.get('/', (req, res) => {
    res.send(`AFK bot spawner running. launched=${launched}, alive=${aliveWorkers}, finished=${finished}`);
  });

  app.get('/status', (req, res) => {
    res.json({ launched, alive: aliveWorkers, finished, total });
  });

  const port = config.expressPort || 3000;
  app.listen(port, () => console.log(`Health server on http://0.0.0.0:${port}`));

  const launchQueue = Array.from({ length: total }, (_, i) => i);

  function tryLaunchNext() {
    while (launched - finished < maxConcurrent && launchQueue.length > 0) {
      const idx = launchQueue.shift();
      launchWorker(idx);
    }
  }

  function launchWorker(index) {
    const worker = cp.fork(__filename, ['--worker'], { env: { WORKER_INDEX: String(index) } });
    workers.push(worker);
    launched++;
    aliveWorkers++;
    console.log(`Launched worker #${index} (${launched}/${total})`);

    worker.on('message', msg => {
      if (msg?.type === 'ready') console.log(`✅ Worker ${index} ready - ${msg.username}`);
      if (msg?.type === 'error') console.log(`❌ Worker ${index} error: ${msg.error}`);
    });

    worker.on('exit', (code, sig) => {
      aliveWorkers--;
      finished++;
      console.log(`Worker ${index} exited (code=${code}, sig=${sig})`);
      setTimeout(tryLaunchNext, 500);
    });

    setTimeout(tryLaunchNext, staggerMs);
  }

  for (let i = 0; i < Math.min(maxConcurrent, launchQueue.length); i++) tryLaunchNext();
}

// ------------------ Worker ------------------
function startWorker() {
  const mineflayer = require('mineflayer');

  function randName() {
    const n = Math.floor(Math.random() * 900000) + 100000;
    return `AFKBot${n}`;
  }
  function randPass() {
    return `pw${Math.random().toString(36).slice(2, 12)}`;
  }

  const username = randName();
  const password = randPass();

  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port || 25565,
    username,
    version: config.version || false
  });

  bot.once('login', () => {
    console.log(`${username} connected. Registering...`);
    setTimeout(() => doRegisterAndLogin(bot, password), config.joinDelayMs || 2000);
  });

  bot.on('spawn', () => {
    process.send?.({ type: 'ready', username });
    console.log(`${username} spawned. AFK active.`);
    const interval = (config.antiAfkIntervalSec || 60) * 1000;
    setInterval(() => {
      try {
        const yaw = (Math.random() - 0.5) * 0.02;
        const pitch = (Math.random() - 0.5) * 0.02;
        bot.look(bot.entity.yaw + yaw, bot.entity.pitch + pitch, true);
        bot.setControlState('sneak', true);
        setTimeout(() => bot.setControlState('sneak', false), 700);
      } catch {}
    }, interval);
  });

  bot.on('error', e => {
    console.log(`${username} error:`, e);
    process.send?.({ type: 'error', error: String(e) });
    setTimeout(() => process.exit(1), 1000);
  });

  bot.on('kicked', reason => {
    console.log(`${username} kicked:`, reason);
    setTimeout(() => process.exit(0), 1000);
  });

  function doRegisterAndLogin(bot, pw) {
    bot.chat(`/register ${pw} ${pw}`);
    setTimeout(() => bot.chat(`/register ${pw}`), 800);
    setTimeout(() => bot.chat(`/login ${pw}`), 1600);
    setTimeout(() => bot.chat(config.serverCommand || '/server servival'), config.afterLoginDelayMs || 2500);
  }
           }
