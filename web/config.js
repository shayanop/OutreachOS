// GrowthPilot Frontend Configuration
// Local dev (page served from localhost) talks to the local API; everything else talks to Render.
// TODO after deploy: replace the Render URL with the real one from the Render dashboard.
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
window.API_BASE = IS_LOCAL ? 'http://127.0.0.1:8000' : 'https://growthpilot-api.onrender.com';
window.USE_MOCK = false; // true = offline demo data from web/mock/*.json (not committed)
