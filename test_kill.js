const { spawn } = require('child_process');

const proc = spawn('sleep', ['10']);
proc.on('close', (code, signal) => {
  console.log(`closed with code ${code} and signal ${signal}`);
});
proc.on('error', (err) => {
  console.error('error', err);
});

setTimeout(() => {
  proc.kill('SIGKILL');
  console.log('killed');
}, 1000);
