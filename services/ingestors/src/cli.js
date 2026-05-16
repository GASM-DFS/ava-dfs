const { run } = require('./index');

async function main() {
  const sourceName = process.argv[2];
  if (!sourceName) {
    throw new Error('Usage: node services/ingestors/src/cli.js <source-name>');
  }

  const result = await run(sourceName);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
