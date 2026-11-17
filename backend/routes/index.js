const express = require('express');

const resources = {
  customers: require('./customers'),
  branches: require('./branches'),
  staff: require('./staff'),
  bookings: require('./bookings'),
  payments: require('./payments'),
  parcels: require('./parcels'),
  complaints: require('./complaints'),
  auth: require('./auth'),
  dashboard: require('./dashboard'),
};

// Router that serves every resource under its own path; mounted at /api, /api/v1 and (aliased) the site root.
function buildApiRouter() {
  const router = express.Router();
  router.get('/health', (req, res) => res.json({ status: 'ok', service: 'freight-flow-api', time: new Date().toISOString() }));
  for (const [name, r] of Object.entries(resources)) router.use(`/${name}`, r);
  return router;
}

module.exports = { resources, buildApiRouter };
