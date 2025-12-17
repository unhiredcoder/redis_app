// Child listens for messages from parent
process.on('message', (msg) => {
  console.log('Child received:', msg);

  if (msg.task === 'process-data') {
    // Example: square each number
    const result = msg.payload.map(n => n * n);

    // Send result back to parent
    process.send({ result });
  }
});
