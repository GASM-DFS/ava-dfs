const app = require('./app');

function startServer() {
  const port = Number(process.env.PORT || 8080);
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

module.exports = { startServer };
