const express = require('express');
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Ava-DFS Ingestor is VIBING. 🚀');
});

app.post('/ingest', (req, res) => {
  const data = req.body;
  console.log('Received data:', data);
  res.status(200).send({ status: 'success', message: 'Data received' });
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
// Vibe check: Mon May  4 09:09:04 PM UTC 2026
