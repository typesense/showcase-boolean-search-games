#!/usr/bin/env node

/**
 * Build script to inject environment variables into HTML
 * This is used for Vercel deployments
 */

const fs = require('fs');
const path = require('path');

const typesenseUrl = process.env.TYPESENSE_URL || 'http://localhost:8108';
const searchOnlyApiKey = process.env.TYPESENSE_SEARCH_ONLY_API_KEY || 'xyz';

// Read index.html
const htmlPath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Replace the default localhost URL with the environment variable URL
// Only replace if TYPESENSE_URL is set (not localhost)
if (typesenseUrl !== 'http://localhost:8108') {
  html = html.replace("window.TYPESENSE_URL = 'http://localhost:8108';", `window.TYPESENSE_URL = '${typesenseUrl}';`);
}

// Replace the default API key with the environment variable
if (searchOnlyApiKey !== 'xyz') {
  html = html.replace("window.TYPESENSE_SEARCH_ONLY_API_KEY = 'xyz';", `window.TYPESENSE_SEARCH_ONLY_API_KEY = '${searchOnlyApiKey}';`);
}

// Write back
fs.writeFileSync(htmlPath, html);

console.log(`✓ Injected TYPESENSE_URL: ${typesenseUrl}`);
console.log(`✓ Injected TYPESENSE_SEARCH_ONLY_API_KEY: ${searchOnlyApiKey.substring(0, 8)}...`);

