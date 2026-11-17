require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const { buildApiRouter, resources } = require('./routes');
const { errorHandler } = require('./lib/errors');
const { syncCounters } = require('./models');
const { seedIfEmpty } = require('./seed');

const PORT = Number(process.env.PORT) || 3000;
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // The same API is reachable at /api, /api/v1 (the OpenAPI server URL) and as root aliases (/customers, /bookings, ...)
  const api = buildApiRouter();
  app.use('/api/v1', api);
  app.use('/api', api);
  for (const name of Object.keys(resources)) app.use(`/${name}`, resources[name]);

  // Frontend (http://localhost:3000 -> index.html)
  app.use(express.static(FRONTEND_DIR));

  app.use((req, res) => res.status(404).json({ code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.path}` }));
  app.use(errorHandler);
  return app;
}

async function connectDb() {
  if (process.argv.includes('--memory') || process.env.USE_MEMORY_DB === '1') {
    let MongoMemoryServer;
    try {
      ({ MongoMemoryServer } = require('mongodb-memory-server-core'));
    } catch {
      throw new Error('In-memory mode needs dev dependencies: run "npm install" (without --omit=dev) first.');
    }
    const mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri('freight_flow'));
    console.log('🧪 Using an in-memory MongoDB (data is discarded on exit)');
    return;
  }
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/freight_flow';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  console.log(`✅ Connected to MongoDB (${mongoose.connection.name})`);
}

async function start() {
  try {
    await connectDb();
  } catch (err) {
    console.error(`❌ Could not connect to MongoDB: ${err.message}`);
    console.error('   Start MongoDB locally, set MONGODB_URI, or run "npm run start:memory" for a throwaway in-memory database.');
    process.exit(1);
  }
  // Build indexes (non-destructive: never drops indexes that other tools created)
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await syncCounters();
  await seedIfEmpty();

  const app = createApp();
  app.listen(PORT, () => {
    console.log(`🚀 Freight-Flow Express running at http://localhost:${PORT}`);
    console.log(`   API:      http://localhost:${PORT}/api   (also /api/v1 and root aliases like /customers)`);
    console.log(`   Frontend: http://localhost:${PORT}/`);
  });
}

if (require.main === module) start();

module.exports = { createApp };
