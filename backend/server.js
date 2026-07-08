const express = require('express');
const cors = require('cors');
const cryptRouter = require('./crypt'); // Line 3

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

app.use(cryptRouter); // Line 12 - passing the clean router function directly
