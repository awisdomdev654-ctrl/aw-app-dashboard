const express = require('express');
const cors = require('cors');
const cryptRouter = require('./crypt');

const app = express();
const PORT = 5000;

const ALLOWED_ORIGINS = [
  'http://localhost:5173', // Vite primary port
  'http://localhost:5174', // Vite fallback port
];

// Explicit CORS config — reflect the caller's origin dynamically so both
// Vite ports work without a wildcard (wildcard breaks credentialed requests).
app.use(cors({
  origin: (incoming, callback) => {
    if (!incoming || ALLOWED_ORIGINS.includes(incoming)) {
      callback(null, incoming || ALLOWED_ORIGINS[0]);
    } else {
      callback(new Error(`CORS: origin ${incoming} not allowed`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with'],
  credentials: true,
}));

// Handle OPTIONS preflight explicitly before any route middleware runs
app.options('*', cors());

app.use(express.json());
app.use(cryptRouter);

app.listen(PORT, () => {
  console.log(`Gatekeeper Express server running on http://localhost:${PORT}`);
});