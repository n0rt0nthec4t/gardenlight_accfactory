// Verify application signal handling while HomeKit publication is pending.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(signal + ' during publication closes GPIO and exits successfully', { timeout: 5000 }, async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gardenlight-shutdown-'));
    const configuration = path.join(directory, 'config.json');
    const preload = path.join(directory, 'preload.mjs');
    fs.writeFileSync(configuration, JSON.stringify({ gardenLight: { zones: [{ pin: 12 }] }, options: { webUIPort: 0 } }));
    // Replace only hardware and publication boundaries; run the actual entry point and lifecycle.
    fs.writeFileSync(
      preload,
      'import GPIO from ' +
        JSON.stringify(new URL('../node_modules/rpio/lib/rpio.js', import.meta.url).href) +
        ';\n' +
        'import HAP from ' +
        JSON.stringify(new URL('../node_modules/@homebridge/hap-nodejs/dist/index.js', import.meta.url).href) +
        ';\n' +
        'GPIO.init = () => {}; GPIO.open = () => {}; GPIO.pwmSetClockDivider = () => {};\n' +
        'GPIO.pwmSetRange = () => {}; GPIO.pwmSetData = () => {}; GPIO.close = () => console.log("GPIO_CLOSED");\n' +
        'HAP.Accessory.prototype.publish = async function() {\n' +
        '  console.log("PUBLICATION_PENDING");\n' +
        '  await new Promise(() => { setInterval(() => {}, 1000); });\n' +
        '};\n',
    );
    const child = spawn(
      process.execPath,
      ['--import', preload, fileURLToPath(new URL('../dist/index.js', import.meta.url)), configuration],
      { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const exited = once(child, 'exit');
    t.after(async () => {
      // A regression must not leave the deliberately stalled publisher running.
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
      fs.rmSync(directory, { recursive: true, force: true });
    });
    let output = '';
    let errors = '';
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    let sent = false;
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (sent === false && output.includes('PUBLICATION_PENDING') === true) {
        sent = true;
        child.kill(signal);
      }
    });
    const [code, exitSignal] = await exited;
    assert.equal(sent, true);
    assert.equal(code, 0, errors);
    assert.equal(exitSignal, null);
    assert.equal(output.includes('GPIO_CLOSED'), true);
    assert.equal(errors.includes('Failed to start'), false);
  });
}
