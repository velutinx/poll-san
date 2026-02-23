fetch('https://jsonplaceholder.typicode.com/todos/1')
  .then(res => res.json())
  .then(data => console.log('TEST SUCCESS:', data))
  .catch(err => console.error('TEST FAILED:', err.message));