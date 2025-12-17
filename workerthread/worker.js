import { fork } from 'node:child_process';

// Fork a child process running child.js
const child = fork('./main.js');

// Send a message to the child
child.send({ task: 'process-data', payload: [1, 2, 3, 4, 5] });

// Listen for messages from the child
child.on('message', (msg) => {
  console.log('Message from child:', msg);
});

// Handle errors
child.on('error', (err) => {
  console.error('Child process error:', err);
});

// Handle exit
child.on('exit', (code) => {
  console.log(`Child exited with code ${code}`);
});
